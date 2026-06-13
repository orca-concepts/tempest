/**
 * ORCID public-format validator — shared regex + helpers for badge display.
 *
 * IMPORTANT: The ORCID_DISPLAY_REGEX here must match character-for-character with
 * the copy in frontend/src/utils/orcidValidator.js. They are not literally shared
 * at build time, but must be kept in sync manually (same convention as
 * inOrcaLinks.js ↔ LinkifiedText.jsx).
 *
 * Purpose: system accounts (e.g. chaos-seed-data) carry a deliberately non-ORCID
 * sentinel orcid_id to satisfy the NOT NULL constraint. The UI renders any orcid_id
 * as a badge linking to https://orcid.org/<value>, which 400s for a sentinel. This
 * is a DISPLAY concern only — these helpers never touch the stored value; they just
 * decide whether a value is renderable as a real ORCID iD.
 */

// A public ORCID iD: four groups of four, digits, last char a digit or 'X'.
// e.g. 0000-0002-1825-0097. Matches the inline checks in authController.js.
const ORCID_DISPLAY_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

function isValidOrcid(value) {
  return typeof value === 'string' && ORCID_DISPLAY_REGEX.test(value);
}

// Convenience for response-emit points: pass the value through if it is a real
// ORCID iD, else null (so the frontend renders no badge).
function orcidForDisplay(value) {
  return isValidOrcid(value) ? value : null;
}

module.exports = { ORCID_DISPLAY_REGEX, isValidOrcid, orcidForDisplay };
