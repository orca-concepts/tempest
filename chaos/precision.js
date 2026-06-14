/**
 * Chaos — shared P16 precision math (single source of truth).
 *
 * The precision CURVE lives here so both callers compute it identically:
 *   - reason.js  (precisionFor)         — a per-run ESTIMATE from this run's grounding.
 *   - apply.js   (accumulated recompute) — the AUTHORITATIVE value from the concept's
 *                FULL grounding across all runs (chaos_prediction_events), which
 *                overwrites the per-run estimate so precision rises with recurrence.
 *
 * Pure + dependency-free. The formula is unchanged from its original inline form in
 * reason.js; only its INPUTS differ between callers (per-run vs accumulated).
 *
 *   weightedEvidence = Σ over distinct grounding papers of a per-confirmation weight —
 *     an INDEPENDENT / unknown-provenance confirmation counts 1.0, a TARGETED one counts
 *     TARGETED_WEIGHT (< 1: a sample aimed at the node is weaker evidence of generality).
 *   diversityMult    = 1 + DIVERSITY_BONUS·(distinctDisciplines − 1) — cross-field
 *     corroboration is rewarded; single-field grounding gets ×1.
 *   precision        = 1 − 1/(1 + weightedEvidence·diversityMult), 2 dp; 0 if ungrounded.
 */

// The tunable knob (PROVISIONAL — see chaos.md P16). Kept here as the one definition.
const TARGETED_WEIGHT = 0.5;
const DIVERSITY_BONUS = 0.5;

// Core curve. Given total weighted evidence and a distinct-discipline count, return the
// precision in [0,1] (2 dp). 0 when there is no evidence.
function precisionFromEvidence(weighted, distinctDisciplines) {
  const w = Number(weighted);
  if (!(w > 0)) return 0;
  const diversityMult = 1 + DIVERSITY_BONUS * Math.max(0, (Number(distinctDisciplines) || 0) - 1);
  const evidence = w * diversityMult;
  return Math.round((1 - 1 / (1 + evidence)) * 100) / 100;
}

module.exports = { TARGETED_WEIGHT, DIVERSITY_BONUS, precisionFromEvidence };
