#!/usr/bin/env node
/**
 * Test script for Resend email integration (Phase 61a).
 * Usage: node scripts/test-email.js <email-address>
 *
 * Sends a single verification-style test email to confirm the
 * Resend API key and from-address are working correctly.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { sendVerificationEmail } = require('../src/utils/email');

const recipient = process.argv[2];

if (!recipient) {
  console.error('Usage: node scripts/test-email.js <email-address>');
  process.exit(1);
}

if (!process.env.RESEND_API_KEY) {
  console.error('Error: RESEND_API_KEY is not set in backend/.env');
  console.error('Get your API key from https://resend.com and add it to backend/.env');
  process.exit(1);
}

(async () => {
  console.log(`Sending test verification email to: ${recipient}`);
  const result = await sendVerificationEmail(recipient, 'TestUser', 'abc123testtoken');

  if (result.success) {
    console.log('Success! Check your inbox.');
  } else {
    console.error('Failed:', result.error);
    process.exit(1);
  }
})();
