/**
 * ORCID API utilities (Phase 61b).
 * Shared between the existing /orcid/callback endpoint and the new
 * /orcid/begin-registration endpoint.
 */

const ORCID_BASE_URL = process.env.ORCID_BASE_URL || 'https://orcid.org';
const TIMEOUT_MS = 5000;

/**
 * Exchange an ORCID OAuth authorization code for an access token + ORCID iD.
 * @param {string} code - OAuth authorization code
 * @param {string} redirectUri - The redirect URI used in the OAuth flow
 * @returns {{ success: true, orcidId: string, accessToken: string, name: string|null } | { success: false, error: string }}
 */
async function exchangeOrcidCode(code, redirectUri) {
  const clientId = process.env.ORCID_CLIENT_ID;
  const clientSecret = process.env.ORCID_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { success: false, error: 'ORCID OAuth is not configured' };
  }

  const tokenUrl = `${ORCID_BASE_URL}/oauth/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: body.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ORCID token exchange failed:', response.status, errorText);
      return { success: false, error: 'Token exchange failed' };
    }

    const data = await response.json();
    const orcidId = data.orcid;
    const name = data.name || null;
    const accessToken = data.access_token;

    if (!orcidId) {
      return { success: false, error: 'No ORCID iD in token response' };
    }

    return { success: true, orcidId, accessToken, name };
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('ORCID token exchange timed out');
    } else {
      console.error('ORCID token exchange error:', err.message);
    }
    return { success: false, error: 'ORCID API unavailable' };
  }
}

/**
 * Fetch emails from the ORCID public API using an access token.
 * @param {string} orcidId
 * @param {string} accessToken
 * @returns {{ verified: string[], unverified: string[] }}
 */
async function fetchOrcidEmails(orcidId, accessToken) {
  const url = `https://pub.orcid.org/v3.0/${orcidId}/email`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      console.error('ORCID email fetch failed:', response.status);
      return { verified: [], unverified: [] };
    }

    const data = await response.json();
    const emails = data.email || [];

    const verified = [];
    const unverified = [];

    for (const entry of emails) {
      if (entry.email) {
        if (entry.verified) {
          verified.push(entry.email);
        } else {
          unverified.push(entry.email);
        }
      }
    }

    return { verified, unverified };
  } catch (err) {
    console.error('ORCID email fetch error:', err.message);
    return { verified: [], unverified: [] };
  }
}

/**
 * Verify an ORCID iD exists by calling the public API (no auth required).
 * @param {string} orcidId
 * @returns {boolean}
 */
async function verifyOrcidExists(orcidId) {
  const url = `https://pub.orcid.org/v3.0/${orcidId}/record`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch (err) {
    console.error('ORCID verify-exists error:', err.message);
    return false;
  }
}

module.exports = { exchangeOrcidCode, fetchOrcidEmails, verifyOrcidExists };
