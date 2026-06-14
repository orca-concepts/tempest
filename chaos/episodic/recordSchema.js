/**
 * Chaos — episodic run-record schema (source of truth for the record format).
 *
 * One episodic record describes a single Chaos run: the working set it sampled,
 * the proposals it emitted, the outcomes of reviewing those proposals, and any
 * free-form reflection for later consolidation. Records are written by
 * writeRecord.js and committed under chaos/episodic/ (see README.md).
 *
 * This module exports:
 *   - RECORD_SCHEMA_VERSION : the current schema version string ("1").
 *   - ENUMS                 : the enum-constrained field vocabularies.
 *   - validate(record)      : returns { ok, errors } — every problem found, not
 *                             just the first. No throwing; pure inspection.
 *
 * Validation philosophy: this is a lightweight structural validator (presence +
 * basic type + enum membership), not a full JSON-schema engine. It exists to
 * stop malformed records from being committed, and to make the record shape
 * legible in one place. Keep it dependency-free (built-ins only).
 */

const RECORD_SCHEMA_VERSION = '1';

// Enum vocabularies for the constrained fields. Exported so callers (and tests)
// can reference the canonical lists rather than re-typing string literals.
const ENUMS = {
  proposalType: [
    'concept',
    'frontier_concept',
    'link',
    'tunnel',
    'situation',
    'restructure_mention',
    'citation',
    'mid_path_insertion',
  ],
  decision: ['accept', 'reject', 'modify'],
  provenance: ['independent', 'targeted'], // or null
  surpriseLevel: ['local', 'parent_unabsorbed'], // or null
};

// --- small internal type guards -------------------------------------------

function isString(v) {
  return typeof v === 'string';
}
function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}
function isInteger(v) {
  return typeof v === 'number' && Number.isInteger(v);
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isArray(v) {
  return Array.isArray(v);
}
// number in [0,1], or explicitly null. Used for precision.
function isUnitIntervalOrNull(v) {
  if (v === null) return true;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
}
// member of `allowed`, or explicitly null. Used for provenance/surprise_level.
function isEnumOrNull(v, allowed) {
  if (v === null) return true;
  return allowed.includes(v);
}

/**
 * Validate an episodic run record.
 * @param {*} record
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validate(record) {
  const errors = [];

  if (!isPlainObject(record)) {
    return { ok: false, errors: ['record must be a plain object'] };
  }

  // --- top-level scalar fields ---
  if (!isNonEmptyString(record.record_schema_version)) {
    errors.push('record_schema_version must be a non-empty string');
  }
  if (!isInteger(record.run_id)) {
    errors.push('run_id must be an integer');
  }
  if (!isNonEmptyString(record.timestamp)) {
    errors.push('timestamp must be a non-empty ISO 8601 string');
  }
  if (!isNonEmptyString(record.rubric_version)) {
    errors.push('rubric_version must be a non-empty string');
  }
  if (!isNonEmptyString(record.run_notes)) {
    // run_notes may legitimately be brief, but it must be a string. Allow empty.
    if (!isString(record.run_notes)) {
      errors.push('run_notes must be a string');
    }
  }

  // reflect: object or null
  if (!(record.reflect === null || isPlainObject(record.reflect))) {
    errors.push('reflect must be an object or null');
  }

  // db_run_id: OPTIONAL. apply.js's hash run_id (the `reason-v<rubric>-<hash>` string),
  // linking this episodic record to the DB rows the run wrote. Absent/null on records
  // written before this field existed — backward-compatible: only validated when present.
  if (record.db_run_id !== undefined && record.db_run_id !== null && !isString(record.db_run_id)) {
    errors.push('db_run_id must be a string or null when present');
  }

  // --- working_set ---
  if (!isArray(record.working_set)) {
    errors.push('working_set must be an array');
  } else {
    record.working_set.forEach((item, i) => {
      const at = `working_set[${i}]`;
      if (!isPlainObject(item)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!isNonEmptyString(item.paper_ref)) {
        errors.push(`${at}.paper_ref must be a non-empty string`);
      }
      if (!isNonEmptyString(item.source_field)) {
        errors.push(`${at}.source_field must be a non-empty string`);
      }
      if (!isPlainObject(item.sampling_rationale)) {
        errors.push(`${at}.sampling_rationale must be an object`);
      } else {
        if (!isString(item.sampling_rationale.epistemic)) {
          errors.push(`${at}.sampling_rationale.epistemic must be a string`);
        }
        if (!isString(item.sampling_rationale.pragmatic)) {
          errors.push(`${at}.sampling_rationale.pragmatic must be a string`);
        }
      }
    });
  }

  // --- proposals ---
  const proposalRefs = new Set();
  if (!isArray(record.proposals)) {
    errors.push('proposals must be an array');
  } else {
    record.proposals.forEach((p, i) => {
      const at = `proposals[${i}]`;
      if (!isPlainObject(p)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!isNonEmptyString(p.ref)) {
        errors.push(`${at}.ref must be a non-empty string`);
      } else if (proposalRefs.has(p.ref)) {
        errors.push(`${at}.ref "${p.ref}" is not unique within the run`);
      } else {
        proposalRefs.add(p.ref);
      }
      if (!ENUMS.proposalType.includes(p.type)) {
        errors.push(
          `${at}.type must be one of: ${ENUMS.proposalType.join(' | ')}`
        );
      }
      if (!isPlainObject(p.payload)) {
        errors.push(`${at}.payload must be an object`);
      }
      if (!isString(p.prediction_made)) {
        errors.push(`${at}.prediction_made must be a string`);
      }
      if (!isString(p.phi_note)) {
        errors.push(`${at}.phi_note must be a string`);
      }
      if (!isUnitIntervalOrNull(p.precision)) {
        errors.push(`${at}.precision must be a number in [0,1] or null`);
      }
      if (!isEnumOrNull(p.provenance, ENUMS.provenance)) {
        errors.push(
          `${at}.provenance must be one of: ${ENUMS.provenance.join(
            ' | '
          )} or null`
        );
      }
      if (!isEnumOrNull(p.surprise_level, ENUMS.surpriseLevel)) {
        errors.push(
          `${at}.surprise_level must be one of: ${ENUMS.surpriseLevel.join(
            ' | '
          )} or null`
        );
      }
    });
  }

  // --- outcomes ---
  if (!isArray(record.outcomes)) {
    errors.push('outcomes must be an array');
  } else {
    record.outcomes.forEach((o, i) => {
      const at = `outcomes[${i}]`;
      if (!isPlainObject(o)) {
        errors.push(`${at} must be an object`);
        return;
      }
      if (!isNonEmptyString(o.proposal_ref)) {
        errors.push(`${at}.proposal_ref must be a non-empty string`);
      } else if (proposalRefs.size > 0 && !proposalRefs.has(o.proposal_ref)) {
        // Only enforce referential integrity when proposals parsed cleanly.
        errors.push(
          `${at}.proposal_ref "${o.proposal_ref}" does not match any proposal ref in this run`
        );
      }
      if (!ENUMS.decision.includes(o.decision)) {
        errors.push(`${at}.decision must be one of: ${ENUMS.decision.join(' | ')}`);
      }
      if (!isString(o.reason)) {
        errors.push(`${at}.reason must be a string`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

module.exports = { RECORD_SCHEMA_VERSION, ENUMS, validate };
