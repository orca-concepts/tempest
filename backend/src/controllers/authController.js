const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const zxcvbn = require('zxcvbn');
const pool = require('../config/database');
const { exchangeOrcidCode, fetchOrcidEmails, verifyOrcidExists } = require('../utils/orcid');
const { isValidOrcid } = require('../utils/orcidValidator');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');
require('dotenv').config();

// Password validation helper (NIST SP 800-63B)
function validatePassword(password, userInputs = []) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be 128 characters or fewer' };
  }
  const result = zxcvbn(password, userInputs);
  if (result.score < 2) {
    const suggestion = result.feedback.suggestions.join(' ') || result.feedback.warning || 'Please choose a stronger password';
    return { valid: false, error: suggestion };
  }
  return { valid: true };
}

const authController = {
  // Get current user info
  getCurrentUser: async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, username, email, orcid_id, created_at FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const row = result.rows[0];
      const adminUserId = parseInt(process.env.ADMIN_USER_ID || '0');
      res.json({ user: { id: row.id, username: row.username, email: row.email, orcidId: row.orcid_id, isAdmin: row.id === adminUserId, created_at: row.created_at } });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Password login (Phase 40b)
  login: async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    try {
      const isEmail = identifier.includes('@');

      let user;
      if (isEmail) {
        const result = await pool.query(
          'SELECT id, username, password_hash, orcid_id FROM users WHERE LOWER(email) = LOWER($1)',
          [identifier.trim()]
        );
        user = result.rows[0];
      } else {
        const result = await pool.query(
          'SELECT id, username, password_hash, orcid_id FROM users WHERE LOWER(username) = LOWER($1)',
          [identifier.trim()]
        );
        user = result.rows[0];
      }

      if (!user || !user.password_hash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      // Defensive: all accounts must have ORCID linked (Phase 61d/e)
      if (!user.orcid_id) {
        return res.status(403).json({ error: 'account_missing_orcid', message: 'Your account is missing required ORCID linkage. Contact support.' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );

      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Invalidate all existing sessions
  logoutEverywhere: async (req, res) => {
    try {
      await pool.query(
        'UPDATE users SET token_issued_after = NOW() WHERE id = $1',
        [req.user.userId]
      );
      res.json({ message: 'All sessions invalidated. Please log in again.' });
    } catch (error) {
      console.error('Logout everywhere error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Delete user account (Phase 35c)
  deleteAccount: async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pre-check: user must not own any combos/situations (Phase 42c)
      const ownedCombos = await client.query(
        'SELECT id, name FROM combos WHERE created_by = $1',
        [req.user.userId]
      );
      if (ownedCombos.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `You still own ${ownedCombos.rows.length} situation(s). Transfer ownership before deleting your account.`,
          ownedCombos: ownedCombos.rows
        });
      }

      // Delete the user row — CASCADE and SET NULL handle all child tables
      await client.query('DELETE FROM users WHERE id = $1', [req.user.userId]);

      await client.query('COMMIT');
      res.json({ message: 'Account deleted successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete account error:', error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  },

  // Phase 41a: ORCID OAuth — get authorize URL
  getOrcidAuthorizeUrl: async (req, res) => {
    try {
      const clientId = process.env.ORCID_CLIENT_ID;
      const redirectUri = process.env.ORCID_REDIRECT_URI;
      const baseUrl = process.env.ORCID_BASE_URL || 'https://orcid.org';

      if (!clientId || !redirectUri) {
        return res.status(500).json({ error: 'ORCID OAuth is not configured' });
      }

      const url = `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=/authenticate&redirect_uri=${encodeURIComponent(redirectUri)}`;
      res.json({ url });
    } catch (error) {
      console.error('ORCID authorize URL error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 41a: ORCID OAuth — exchange code for verified ORCID iD
  orcidCallback: async (req, res) => {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    try {
      const redirectUri = process.env.ORCID_REDIRECT_URI;
      if (!redirectUri) {
        return res.status(500).json({ error: 'ORCID OAuth is not configured' });
      }

      const result = await exchangeOrcidCode(code, redirectUri);
      if (!result.success) {
        return res.status(400).json({ error: 'Failed to verify ORCID authorization code' });
      }

      const { orcidId } = result;

      // Check uniqueness — another user may already have this ORCID
      const existing = await pool.query(
        'SELECT id FROM users WHERE orcid_id = $1 AND id != $2',
        [orcidId, req.user.userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'This ORCID iD is already linked to another account' });
      }

      // Store the verified ORCID iD
      await pool.query(
        'UPDATE users SET orcid_id = $1 WHERE id = $2',
        [orcidId, req.user.userId]
      );

      res.json({ success: true, orcidId });
    } catch (error) {
      console.error('ORCID callback error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 41a: Dev-mode ORCID bypass (non-production only)
  devConnectOrcid: async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Route not found' });
    }

    const { orcidId } = req.body;
    if (!orcidId) {
      return res.status(400).json({ error: 'orcidId is required' });
    }

    // Validate ORCID format: 0000-0000-0000-0000 (last char can be X)
    if (!isValidOrcid(orcidId)) {
      return res.status(400).json({ error: 'Invalid ORCID format. Expected: 0000-0000-0000-0000' });
    }

    try {
      // Check uniqueness
      const existing = await pool.query(
        'SELECT id FROM users WHERE orcid_id = $1 AND id != $2',
        [orcidId, req.user.userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'This ORCID iD is already linked to another account' });
      }

      await pool.query(
        'UPDATE users SET orcid_id = $1 WHERE id = $2',
        [orcidId, req.user.userId]
      );

      res.json({ success: true, orcidId });
    } catch (error) {
      console.error('Dev ORCID connect error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // ============================================================
  // Phase 61b: ORCID-first registration and email-based auth
  // ============================================================

  // Step 1 of ORCID-first registration: exchange code, return ORCID info
  beginOrcidRegistration: async (req, res) => {
    const { code, redirectUri } = req.body;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Authorization code is required' });
    }
    if (!redirectUri || typeof redirectUri !== 'string') {
      return res.status(400).json({ error: 'Redirect URI is required' });
    }
    try {
      new URL(redirectUri);
    } catch {
      return res.status(400).json({ error: 'Invalid redirect URI' });
    }

    try {
      const result = await exchangeOrcidCode(code, redirectUri);
      if (!result.success) {
        return res.status(400).json({
          error: 'orcid_exchange_failed',
          message: "Couldn't verify your ORCID iD. Please try again.",
        });
      }

      const { orcidId, accessToken, name } = result;

      // Check if already registered
      const existing = await pool.query(
        'SELECT id FROM users WHERE orcid_id = $1',
        [orcidId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({
          error: 'already_registered',
          message: 'An account is already linked to this ORCID iD. Please log in instead.',
        });
      }

      // Fetch emails from ORCID
      const emails = await fetchOrcidEmails(orcidId, accessToken);

      res.json({
        orcidId,
        name,
        verifiedEmails: emails.verified,
        unverifiedEmails: emails.unverified,
      });
    } catch (error) {
      console.error('Begin ORCID registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Step 2: Create account with ORCID + email + password
  registerWithOrcid: async (req, res) => {
    const { orcidId, email, password, username, tosAccepted, tosVersion, ageVerified, verifiedEmailsFromOrcid } = req.body;

    // Validate required fields
    if (!orcidId || !email || !password || !username) {
      return res.status(400).json({ error: 'All fields are required (orcidId, email, password, username)' });
    }

    // Validate ORCID format
    if (!isValidOrcid(orcidId)) {
      return res.status(400).json({ error: 'Invalid ORCID format' });
    }

    // ToS validation
    if (tosAccepted !== true) {
      return res.status(400).json({ error: 'You must accept the Terms of Service and Privacy Policy.' });
    }

    // Age verification
    if (ageVerified !== true) {
      return res.status(400).json({ error: 'You must confirm you are at least 18 years old.' });
    }
    if (!tosVersion || typeof tosVersion !== 'string' || !tosVersion.trim()) {
      return res.status(400).json({ error: 'Invalid Terms of Service version.' });
    }

    // Username format validation
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 1-30 characters, alphanumeric and underscores only' });
    }

    // Email validation
    if (typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    const atIndex = email.indexOf('@');
    if (atIndex < 1 || email.indexOf('.', atIndex) === -1) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    // Password validation
    const passwordValidation = validatePassword(password, [username, email].filter(Boolean));
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
    }

    try {
      // Re-verify ORCID iD exists via public API (skip in dev mode)
      if (process.env.NODE_ENV === 'production') {
        const orcidExists = await verifyOrcidExists(orcidId);
        if (!orcidExists) {
          return res.status(400).json({ error: 'Could not verify ORCID iD. Please try again.' });
        }
      }

      // Check username availability
      const existingUser = await pool.query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
      );
      if (existingUser.rows.length > 0) {
        return res.status(409).json({ error: 'Username already taken' });
      }

      // Check email availability
      const existingEmail = await pool.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [email.trim()]
      );
      if (existingEmail.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this email already exists' });
      }

      // Check ORCID availability
      const existingOrcid = await pool.query(
        'SELECT id FROM users WHERE orcid_id = $1',
        [orcidId]
      );
      if (existingOrcid.rows.length > 0) {
        return res.status(409).json({ error: 'An account is already linked to this ORCID iD' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Determine email verification status
      const verifiedList = Array.isArray(verifiedEmailsFromOrcid)
        ? verifiedEmailsFromOrcid.map(e => e.toLowerCase())
        : [];
      const emailIsVerified = verifiedList.includes(email.trim().toLowerCase());

      let emailVerificationToken = null;
      let emailVerificationExpiresAt = null;

      if (!emailIsVerified) {
        emailVerificationToken = crypto.randomBytes(32).toString('hex');
        // 24 hours from now
        emailVerificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      }

      // INSERT user
      const insertResult = await pool.query(
        `INSERT INTO users (
          username, email, password_hash, orcid_id,
          tos_accepted_at, tos_version_accepted, age_verified_at,
          email_verified_at, email_verification_token, email_verification_expires_at
        ) VALUES ($1, $2, $3, $4, NOW(), $5, NOW(), $6, $7, $8)
        RETURNING id, username`,
        [
          username,
          email.trim(),
          passwordHash,
          orcidId,
          tosVersion.trim(),
          emailIsVerified ? new Date() : null,
          emailVerificationToken,
          emailVerificationExpiresAt,
        ]
      );

      const user = insertResult.rows[0];

      // Send appropriate email (fire-and-forget)
      if (emailIsVerified) {
        sendWelcomeEmail(email.trim(), username, { orcidLinked: true }).catch(err => {
          console.error('Failed to send welcome email:', err);
        });
      } else {
        sendVerificationEmail(email.trim(), username, emailVerificationToken).catch(err => {
          console.error('Failed to send verification email:', err);
        });
      }

      // Generate JWT
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );

      res.status(201).json({
        token,
        user: { id: user.id, username: user.username },
        emailVerificationStatus: emailIsVerified ? 'verified' : 'pending',
      });
    } catch (error) {
      // Handle unique constraint violations (race condition)
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Username, email, or ORCID already in use' });
      }
      console.error('Register with ORCID error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Verify email via token (GET — redirects to frontend)
  verifyEmail: async (req, res) => {
    const { token } = req.query;
    const frontendBase = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

    if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.redirect(`${frontendBase}/email-verification?status=error&reason=invalid_token`);
    }

    try {
      const result = await pool.query(
        `UPDATE users
         SET email_verified_at = NOW(),
             email_verification_token = NULL,
             email_verification_expires_at = NULL
         WHERE email_verification_token = $1
           AND email_verification_expires_at > NOW()
         RETURNING id, username, email`,
        [token]
      );

      if (result.rows.length === 0) {
        return res.redirect(`${frontendBase}/email-verification?status=error&reason=expired_or_used`);
      }

      const user = result.rows[0];

      // Send welcome email (best effort)
      sendWelcomeEmail(user.email, user.username, { orcidLinked: false }).catch(err => {
        console.error('Failed to send welcome email after verification:', err);
      });

      return res.redirect(`${frontendBase}/email-verification?status=success`);
    } catch (error) {
      console.error('Verify email error:', error);
      return res.redirect(`${frontendBase}/email-verification?status=error&reason=server_error`);
    }
  },

  // Forgot password (email-based, Phase 61b)
  forgotPassword: async (req, res) => {
    const { identifier } = req.body;

    if (!identifier || typeof identifier !== 'string' || !identifier.trim()) {
      return res.status(400).json({ error: 'Username or email is required' });
    }

    // Always return 200 to prevent account enumeration
    const genericResponse = { message: 'If an account exists, a password reset email has been sent.' };

    try {
      const userResult = await pool.query(
        'SELECT id, username, email FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)',
        [identifier.trim()]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.json(genericResponse);
      }

      if (!user.email) {
        console.warn(`[forgot-password] User ${user.id} has no email — cannot send reset`);
        return res.json(genericResponse);
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await pool.query(
        'UPDATE users SET password_reset_token = $1, password_reset_expires_at = $2 WHERE id = $3',
        [resetToken, expiresAt, user.id]
      );

      // Send email (fire-and-forget — response already sent)
      sendPasswordResetEmail(user.email, user.username, resetToken).catch(err => {
        console.error('Failed to send password reset email:', err);
      });

      return res.json(genericResponse);
    } catch (error) {
      console.error('Forgot password error:', error);
      // Still return 200 to avoid timing leaks on errors
      return res.json(genericResponse);
    }
  },

  // Reset password via email token (Phase 61b)
  resetPassword: async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: 'invalid_or_expired_token' });
    }
    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    try {
      // Find user with valid reset token
      const userResult = await pool.query(
        'SELECT id, username, email FROM users WHERE password_reset_token = $1 AND password_reset_expires_at > NOW()',
        [token]
      );

      if (userResult.rows.length === 0) {
        return res.status(400).json({ error: 'invalid_or_expired_token' });
      }

      const user = userResult.rows[0];

      // Validate password strength
      const validation = validatePassword(newPassword, [user.username, user.email].filter(Boolean));
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Hash and update — also invalidate all existing sessions
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        `UPDATE users
         SET password_hash = $1,
             password_reset_token = NULL,
             password_reset_expires_at = NULL,
             token_issued_after = NOW()
         WHERE id = $2`,
        [passwordHash, user.id]
      );

      res.json({ message: 'Password reset successful. Please log in with your new password.' });
    } catch (error) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

};

module.exports = authController;
