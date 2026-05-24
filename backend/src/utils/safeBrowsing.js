// safeBrowsing.js — Google Safe Browsing v4 API wrapper.
// Fail-open semantics: on any error (network, timeout, missing key), returns safe.
// Never throws.

const API_KEY = process.env.GOOGLE_SAFE_BROWSING_API_KEY;

if (!API_KEY) {
  console.warn('[safeBrowsing] GOOGLE_SAFE_BROWSING_API_KEY not set — all URLs will be allowed');
}

/**
 * Check a URL against Google Safe Browsing v4.
 * @param {string} url — the URL to check
 * @returns {Promise<{ safe: boolean, threats: string[] }>}
 */
async function checkUrl(url) {
  if (!API_KEY) {
    return { safe: true, threats: [] };
  }

  const body = JSON.stringify({
    client: { clientId: 'orca-concepts', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }],
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      console.warn(`[safeBrowsing] API returned ${response.status}`);
      return { safe: true, threats: [] };
    }

    const data = await response.json();
    if (data.matches && data.matches.length > 0) {
      const threats = [...new Set(data.matches.map(m => m.threatType))];
      return { safe: false, threats };
    }

    return { safe: true, threats: [] };
  } catch (err) {
    clearTimeout(timeout);
    console.warn(`[safeBrowsing] check failed: ${err.message}`);
    return { safe: true, threats: [] };
  }
}

module.exports = { checkUrl };
