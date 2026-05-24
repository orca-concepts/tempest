/**
 * Mention-specific parser for in-orca URLs.
 *
 * Different from parseInOrcaLinks (Phase 65a) in two ways:
 * 1. For concept URLs, ?path= is REQUIRED. Concept URLs without a path are
 *    not indexed as mentions (path-dependent identity AD).
 * 2. Returns rows shaped for the comment_mentions table — no fragment field.
 *
 * The linkifier (LinkifiedText / inOrcaLinks.js) is intentionally more
 * permissive — it renders all in-orca URLs as clickable. This parser is
 * strict about what gets indexed.
 */

// Same base pattern as inOrcaLinks.js — kept in sync manually.
const IN_ORCA_LINK_PATTERN =
  '(?:https://orcaconcepts\\.org|https?://localhost(?::\\d+)?)/(?:concept|superconcept|link|tunnel)/\\d+(?:\\?path=[\\d,]*)?(?:#(?:link|tunnel)-\\d+)?';

/**
 * Parse text for in-orca URLs that qualify as indexable mentions.
 *
 * @param {string} text
 * @returns {Array<{ targetType: string, targetId: number, targetPath: number[]|null }>}
 */
function parseMentions(text) {
  if (!text) return [];

  const regex = new RegExp(IN_ORCA_LINK_PATTERN, 'g');
  const results = [];
  const seen = new Set();
  let match;

  while ((match = regex.exec(text)) !== null) {
    const url = match[0];

    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/').filter(Boolean);
      if (pathParts.length !== 2) continue;

      const targetType = pathParts[0];
      const targetId = parseInt(pathParts[1], 10);
      if (!Number.isFinite(targetId)) continue;

      // For concept URLs, ?path= is REQUIRED for mention indexing
      const pathParam = parsed.searchParams.get('path');
      if (targetType === 'concept') {
        if (pathParam === null || pathParam === undefined) continue; // absent ?path= → reject
        const targetPath = pathParam === '' ? [] : pathParam.split(',').map(Number).filter(n => Number.isFinite(n) && n > 0);

        const dedupeKey = `concept:${targetId}:${targetPath.join(',')}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        results.push({ targetType: 'concept', targetId, targetPath });
      } else if (['superconcept', 'link', 'tunnel'].includes(targetType)) {
        const dedupeKey = `${targetType}:${targetId}:`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        results.push({ targetType, targetId, targetPath: null });
      }
      // Unknown target types are silently skipped
    } catch {
      continue;
    }
  }

  return results;
}

module.exports = { parseMentions };
