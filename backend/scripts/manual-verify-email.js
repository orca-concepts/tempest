#!/usr/bin/env node
/**
 * Manually verify a user's email (admin/dev tool).
 * Usage: node scripts/manual-verify-email.js <user-id>
 *
 * Sets email_verified_at = NOW(), clears verification token,
 * and sends the welcome email.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = require('../src/config/database');
const { sendWelcomeEmail } = require('../src/utils/email');

const userId = process.argv[2];

if (!userId || isNaN(Number(userId))) {
  console.error('Usage: node scripts/manual-verify-email.js <user-id>');
  process.exit(1);
}

(async () => {
  try {
    const result = await pool.query(
      `UPDATE users
       SET email_verified_at = NOW(),
           email_verification_token = NULL,
           email_verification_expires_at = NULL
       WHERE id = $1
       RETURNING username, email, email_verified_at`,
      [userId]
    );

    if (result.rows.length === 0) {
      console.error(`No user found with id ${userId}`);
      process.exit(1);
    }

    const user = result.rows[0];
    console.log(`Verified email for user ${user.username} (${user.email}) at ${user.email_verified_at}`);

    if (user.email) {
      const emailResult = await sendWelcomeEmail(user.email, user.username, { orcidLinked: false });
      if (emailResult.success) {
        console.log('Welcome email sent.');
      } else {
        console.warn('Welcome email failed:', emailResult.error);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
