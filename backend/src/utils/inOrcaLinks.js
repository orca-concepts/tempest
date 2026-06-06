/**
 * In-orca URL grammar — shared regex and parser for in-orca link detection.
 *
 * IMPORTANT: The regex pattern here must match character-for-character with the
 * pattern defined in frontend/src/components/LinkifiedText.jsx. They are not
 * literally shared at build time, but must be kept in sync manually.
 */

// Match production URLs (orcaconcepts.org) and local dev (localhost with optional port).
// Trailing punctuation (commas, periods, parens, brackets) is excluded via the
// negative lookahead on common prose punctuation at the end.
const IN_ORCA_LINK_PATTERN =
  '(?:https://orcaconcepts\\.org|https?://localhost(?::\\d+)?)/(?:concept|situation|link|tunnel)/\\d+(?:\\?path=[\\d,]*)?(?:#(?:link|tunnel)-\\d+)?';

const IN_ORCA_LINK_REGEX_GLOBAL = new RegExp(IN_ORCA_LINK_PATTERN, 'g');

/**
 * Parse all in-orca URLs from a text string.
 *
 * @param {string} text — the text to scan
 * @returns {Array<{
 *   targetType: 'concept'|'situation'|'link'|'tunnel',
 *   targetId: number,
 *   targetPath: number[]|null,
 *   fragment: { type: 'link'|'tunnel', id: number } | null
 * }>}
 */
function parseInOrcaLinks(text) {
  if (!text) return [];

  const regex = new RegExp(IN_ORCA_LINK_PATTERN, 'g');
  const results = [];
  const seen = new Set();
  let match;

  while ((match = regex.exec(text)) !== null) {
    const url = match[0];

    try {
      // Use URL parsing to extract components reliably
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      // pathParts = ['concept', '123'] or ['link', '456'] etc.
      if (pathParts.length !== 2) continue;

      const targetType = pathParts[0];
      const targetId = parseInt(pathParts[1], 10);
      if (!Number.isFinite(targetId)) continue;

      // Extract ?path= query param
      const pathParam = parsed.searchParams.get('path');
      const targetPath = pathParam
        ? pathParam.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0)
        : null;

      // Extract #link-N or #tunnel-N fragment
      let fragment = null;
      if (parsed.hash) {
        const fragMatch = parsed.hash.match(/^#(link|tunnel)-(\d+)$/);
        if (fragMatch) {
          fragment = { type: fragMatch[1], id: parseInt(fragMatch[2], 10) };
        }
      }

      // Deduplicate by (targetType, targetId, targetPath serialized)
      const dedupeKey = `${targetType}:${targetId}:${targetPath ? targetPath.join(',') : ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      results.push({ targetType, targetId, targetPath: targetPath && targetPath.length > 0 ? targetPath : null, fragment });
    } catch {
      // Invalid URL — skip
      continue;
    }
  }

  return results;
}

module.exports = { IN_ORCA_LINK_REGEX_GLOBAL, parseInOrcaLinks };
