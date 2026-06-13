/**
 * ORCID public-format validator (frontend copy).
 *
 * IMPORTANT: ORCID_DISPLAY_REGEX must match character-for-character with the copy
 * in backend/src/utils/orcidValidator.js. They are kept in sync manually (same
 * convention as LinkifiedText.jsx ↔ inOrcaLinks.js).
 *
 * Used as defense-in-depth so a non-ORCID sentinel (e.g. the chaos-seed-data system
 * account) never renders an ORCID badge that 400s at orcid.org.
 */

// A public ORCID iD: four groups of four, digits, last char a digit or 'X'.
export const ORCID_DISPLAY_REGEX = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export function isValidOrcid(value) {
  return typeof value === 'string' && ORCID_DISPLAY_REGEX.test(value);
}
