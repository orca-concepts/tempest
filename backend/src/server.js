const express = require('express');
const cors = require('cors');
const rateLimitStore = require('./utils/pgRateLimitStore');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const conceptsRoutes = require('./routes/concepts');
const votesRoutes = require('./routes/votes');
const moderationRoutes = require('./routes/moderation');
const pageRoutes = require('./routes/pages');
const comboRoutes = require('./routes/combos');
const tunnelRoutes = require('./routes/tunnels');
const userRoutes = require('./routes/users');
const adminLegalRoutes = require('./routes/adminLegal');

const pool = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy (Phase 49a) — Cloudflare → Railway = 2 hops.
// Required so req.ip resolves to the real client IP (not the proxy),
// which makes IP-keyed rate limiters work correctly in production.
// Must be set before any rate limiter or route mounts.
app.set('trust proxy', 2);

// CORS configuration
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phase 49d — Global app-wide safety-net limiter.
const GLOBAL_SAFETY_NET_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_SAFETY_NET_MAX = 2000;

async function globalSafetyNetLimiter(req, res, next) {
  if (req.method === 'GET') {
    return next();
  }
  try {
    const key = `global:ip:${req.ip}`;
    const count = await rateLimitStore.increment(key, GLOBAL_SAFETY_NET_WINDOW_MS);
    const remaining = Math.max(0, GLOBAL_SAFETY_NET_MAX - count);
    const windowStart = rateLimitStore.currentWindowStart(GLOBAL_SAFETY_NET_WINDOW_MS);
    const resetTime = new Date(windowStart.getTime() + GLOBAL_SAFETY_NET_WINDOW_MS);
    const resetSeconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));

    res.setHeader('RateLimit-Limit', GLOBAL_SAFETY_NET_MAX);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (count > GLOBAL_SAFETY_NET_MAX) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: 'Too many requests. Please slow down and try again in a few minutes.',
      });
    }
    return next();
  } catch (err) {
    console.error('[global safety net] store error:', err.message);
    return next();
  }
}

app.use('/api', globalSafetyNetLimiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/concepts', conceptsRoutes);
app.use('/api/votes', votesRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/combos', comboRoutes);
app.use('/api/tunnels', tunnelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/admin', adminLegalRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Phase 54b: In production, serve frontend static files and SPA fallback.
// Placed AFTER all /api routes so API requests are handled first.
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  // SPA fallback — any non-/api route serves index.html so React Router works
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 404 handler (only catches unmatched /api routes in production; catches all in dev)
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Database health check, then start server
let server;
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('Database health check passed');
  } catch (err) {
    console.error('ERROR: Cannot connect to PostgreSQL. Is the database running?');
    console.error(err.message);
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} in use, attempting to free it...`);
      const { exec } = require('child_process');
      exec(`netstat -ano | findstr :${PORT} | findstr LISTENING`, (e, stdout) => {
        if (e || !stdout.trim()) {
          console.error(`Could not find process on port ${PORT}. Please free it manually.`);
          process.exit(1);
        }
        const line = stdout.trim().split('\n')[0];
        const pid = line.trim().split(/\s+/).pop();
        if (!pid || pid === '0') {
          console.error('Could not determine PID. Please free the port manually.');
          process.exit(1);
        }
        console.log(`Killing PID ${pid} on port ${PORT}...`);
        exec(`taskkill /F /PID ${pid}`, (killErr) => {
          if (killErr) {
            console.error(`Failed to kill PID ${pid}:`, killErr.message);
            process.exit(1);
          }
          console.log(`Killed PID ${pid}. Retrying listen on port ${PORT}...`);
          setTimeout(() => {
            server.listen(PORT, () => {
              console.log(`Server is running on port ${PORT}`);
              console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            });
          }, 1000);
        });
      });
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
})();

// Graceful shutdown — release the port so nodemon restarts cleanly
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('Server closed.');
      pool.end().then(() => {
        console.log('Database pool closed.');
        process.exit(0);
      });
    });
  }
  setTimeout(() => process.exit(1), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.once('message', (msg) => {
  if (msg === 'shutdown') shutdown('shutdown message');
});

module.exports = app;
