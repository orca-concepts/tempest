const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;
const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { error: 'Too many password reset requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Password login
router.post('/login', loginLimiter, authController.login);

// Protected routes
router.get('/me', authenticateToken, authController.getCurrentUser);
router.post('/logout-everywhere', authenticateToken, authController.logoutEverywhere);
router.post('/delete-account', authenticateToken, authController.deleteAccount);

// ORCID OAuth (link/unlink for logged-in users)
router.get('/orcid/authorize-url', optionalAuth, authController.getOrcidAuthorizeUrl);
router.post('/orcid/callback', authenticateToken, authController.orcidCallback);
router.post('/orcid/disconnect', authenticateToken, authController.disconnectOrcid);
router.post('/orcid/dev-connect', authenticateToken, authController.devConnectOrcid);

// ORCID-first registration + email-based auth (Phase 61b)
router.post('/orcid/begin-registration', authController.beginOrcidRegistration);
router.post('/register-with-orcid', authController.registerWithOrcid);
router.get('/verify-email', authController.verifyEmail);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/reset-password', verifyCodeLimiter, authController.resetPassword);

module.exports = router;
