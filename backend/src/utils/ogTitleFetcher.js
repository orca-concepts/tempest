// ogTitleFetcher.js — Server-side Open Graph title extraction with SSRF protections.
//
// SSRF defense: Before making any HTTP request, the target hostname is resolved
// via DNS and the resulting IP is checked against private/loopback/link-local
// ranges. This prevents attackers from submitting URLs that redirect to internal
// services (e.g., http://localhost, http://169.254.169.254 for cloud metadata).
// Each redirect hop is re-validated to block redirect-based SSRF bypasses.

const dns = require('dns');
const net = require('net');

// --- Private IP range checks ---

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return true; // malformed = reject
  const [a, b] = parts;
  if (a === 10) return true;                          // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true;   // 172.16.0.0/12
  if (a === 192 && b === 168) return true;             // 192.168.0.0/16
  if (a === 127) return true;                          // 127.0.0.0/8
  if (a === 169 && b === 254) return true;             // 169.254.0.0/16
  if (a === 0) return true;                            // 0.0.0.0/8
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') return true;               // loopback
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // fc00::/7
  if (normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
      normalized.startsWith('fea') || normalized.startsWith('feb')) return true; // fe80::/10
  return false;
}

function isPrivateIP(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // unknown format = reject
}

// Resolve hostname and check against private ranges
async function validateHost(hostname) {
  // If the hostname is already an IP literal, check it directly
  if (net.isIP(hostname)) {
    return !isPrivateIP(hostname);
  }
  try {
    const { address } = await dns.promises.lookup(hostname);
    return !isPrivateIP(address);
  } catch {
    return false; // DNS failure = reject
  }
}

// --- HTML title extraction via regex (no external parser needed) ---

function extractTitle(html) {
  // Priority 1: og:title
  const ogMatch = html.match(/<meta[^>]+property\s*=\s*["']og:title["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+property\s*=\s*["']og:title["']/i);
  if (ogMatch) return ogMatch[1];

  // Priority 2: twitter:title
  const twMatch = html.match(/<meta[^>]+name\s*=\s*["']twitter:title["'][^>]+content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+name\s*=\s*["']twitter:title["']/i);
  if (twMatch) return twMatch[1];

  // Priority 3: <title>
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1];

  return null;
}

/**
 * Fetch the Open Graph (or fallback) title for a URL.
 * Returns a trimmed title string (max 255 chars) or null on any failure.
 * Never throws — all errors are caught and return null.
 */
async function fetchOgTitle(url) {
  try {
    // Validate URL format
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }

    // SSRF check: resolve hostname and block private IPs
    const hostSafe = await validateHost(parsed.hostname);
    if (!hostSafe) return null;

    // Fetch with timeout and redirect handling
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'OrcaBot/1.0 (+https://orcaconcepts.org)',
          'Accept': 'text/html, */*;q=0.1',
        },
        redirect: 'follow', // Node fetch follows redirects automatically
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) return null;

    // After redirects, re-validate the final URL's host (redirect-based SSRF bypass defense)
    if (response.url && response.url !== url) {
      try {
        const finalParsed = new URL(response.url);
        const finalSafe = await validateHost(finalParsed.hostname);
        if (!finalSafe) return null;
      } catch {
        return null;
      }
    }

    // Check Content-Type — only parse HTML-ish responses
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.startsWith('text/')) {
      return null;
    }

    // Read only the first 64KB to avoid downloading huge pages
    const reader = response.body.getReader();
    const chunks = [];
    let totalBytes = 0;
    const MAX_BYTES = 64 * 1024;

    while (totalBytes < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.length;
    }
    reader.cancel(); // stop reading the rest

    const html = Buffer.concat(chunks).toString('utf-8');

    const rawTitle = extractTitle(html);
    if (!rawTitle) return null;

    // Clean up: trim whitespace, collapse newlines, cap at 255 chars
    const cleaned = rawTitle.replace(/[\r\n]+/g, ' ').trim();
    return cleaned.substring(0, 255) || null;
  } catch {
    // Timeout, network error, abort, etc. — all return null
    return null;
  }
}

module.exports = { fetchOgTitle };
