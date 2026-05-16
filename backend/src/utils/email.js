const { Resend } = require('resend');
const fs = require('fs');
const path = require('path');

// ── Configuration ──────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'noreply@orcaconcepts.org';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Orca';
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://localhost:5173';

if (!RESEND_API_KEY) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_API_KEY is required in production');
  }
  console.warn('[email] RESEND_API_KEY not set — email sending will be disabled in dev');
}

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;
const fromAddress = `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`;

// ── Template loading ───────────────────────────────────────────────────────
const templatesDir = path.join(__dirname, '..', 'email-templates');

function loadTemplate(filename) {
  return fs.readFileSync(path.join(templatesDir, filename), 'utf-8');
}

function renderTemplate(template, vars) {
  let result = template;
  // Simple {{var}} replacement
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  // Simple {{#if var}}...{{/if}} blocks
  result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName, content) => {
    return vars[varName] ? content : '';
  });
  return result;
}

// ── Email functions ────────────────────────────────────────────────────────

/**
 * Send email verification link.
 * @param {string} email - Recipient address
 * @param {string} username - User's display name
 * @param {string} token - Verification token (hex)
 * @returns {{ success: boolean, error?: any }}
 */
async function sendVerificationEmail(email, username, token) {
  if (!resend) {
    console.warn('[email] Skipping verification email (no API key)');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const template = loadTemplate('verify-email.html');
    const verifyUrl = `${FRONTEND_BASE_URL}/verify-email?token=${token}`;
    const html = renderTemplate(template, { username, verifyUrl });

    await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: 'Verify your email for Orca',
      html,
    });
    return { success: true };
  } catch (error) {
    console.error('[email] Failed to send verification email:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send welcome email after successful verification.
 * @param {string} email - Recipient address
 * @param {string} username - User's display name
 * @param {{ orcidLinked?: boolean }} options
 * @returns {{ success: boolean, error?: any }}
 */
async function sendWelcomeEmail(email, username, options = {}) {
  if (!resend) {
    console.warn('[email] Skipping welcome email (no API key)');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const template = loadTemplate('welcome.html');
    const html = renderTemplate(template, {
      username,
      siteUrl: FRONTEND_BASE_URL,
      orcidLinked: options.orcidLinked || false,
    });

    await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: 'Welcome to Orca',
      html,
    });
    return { success: true };
  } catch (error) {
    console.error('[email] Failed to send welcome email:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send password reset link.
 * @param {string} email - Recipient address
 * @param {string} username - User's display name
 * @param {string} token - Reset token (hex)
 * @returns {{ success: boolean, error?: any }}
 */
async function sendPasswordResetEmail(email, username, token) {
  if (!resend) {
    console.warn('[email] Skipping password reset email (no API key)');
    return { success: false, error: 'RESEND_API_KEY not configured' };
  }

  try {
    const template = loadTemplate('reset-password.html');
    const resetUrl = `${FRONTEND_BASE_URL}/reset-password?token=${token}`;
    const html = renderTemplate(template, { username, resetUrl });

    await resend.emails.send({
      from: fromAddress,
      to: email,
      subject: 'Reset your Orca password',
      html,
    });
    return { success: true };
  } catch (error) {
    console.error('[email] Failed to send password reset email:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail };
