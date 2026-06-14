#!/usr/bin/env node

/**
 * Chaos — record a run into episodic memory (one command, derived from artifacts).
 *
 * Wires the previously-unwired episodic step: instead of hand-authoring a record JSON,
 * this derives a schema-valid episodic record from the run's own artifacts and writes it
 * via chaos/episodic/writeRecord.js (which validates and auto-assigns the sequential
 * episodic run_id). After this, chaos/check-run.js's episodic check passes.
 *
 * It reads three artifacts the pipeline already produces:
 *   - chaos/proposals.reasoned.json — the IMMUTABLE baseline (proposals exactly as
 *     reasoned, before human review). Written by reason.js.
 *   - chaos/proposals.json          — the FINAL proposals (after the human's review edits).
 *   - chaos/last-apply.json         — apply's run identity (hash run_id, rubric_version,
 *     ISO timestamp, applied counts by type). Written by apply.js after a successful apply.
 *
 * Derivation:
 *   - working_set[] ← proposals.json.papers
 *   - proposals[]   ← the BASELINE items (value-only: concepts/links/tunnels), carrying
 *                     each item's prediction_made / precision / provenance / surprise_level
 *                     / phi_note where present.
 *   - outcomes[]    ← BASELINE vs FINAL diff, keyed on each item's identity ref:
 *                       present in final & unchanged ⇒ accept
 *                       present in final & fields changed ⇒ modify
 *                       absent from final ⇒ reject
 *                     reason ← optional --notes file's `reasons[ref]`, else blank.
 *                     (Outcome reasons are NEVER auto-invented; the human supplies them.)
 *   - db_run_id, rubric_version, applied counts ← last-apply.json (counts go into reflect).
 *   - run_notes / reflect ← optional --notes file, else '' / null.
 *
 * Usage:
 *   node chaos/record-run.js [--notes <path>]
 *
 * The --notes file is JSON: { "run_notes": string?, "reflect": object|null?,
 *                             "reasons": { "<proposal_ref>": string }? }.
 *
 * Test-only path overrides (default to the standard pipeline locations):
 *   --baseline <path>   --final <path>   --last-apply <path>
 *
 * READ-ONLY w.r.t. the DB and production: this script never opens a Postgres connection.
 * Its only writes are the episodic record + index.json, via writeRecord.js.
 */

const path = require('path');
const fs = require('fs');

const CHAOS_DIR = __dirname;
const { RECORD_SCHEMA_VERSION, ENUMS } = require('./episodic/recordSchema');
const { writeRecord } = require('./episodic/writeRecord');

// --- CLI -------------------------------------------------------------------
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const pre = process.argv.find((a) => a.startsWith(`${flag}=`));
  return pre ? pre.slice(flag.length + 1) : null;
}
const BASELINE_PATH = argValue('--baseline') || path.join(CHAOS_DIR, 'proposals.reasoned.json');
const FINAL_PATH = argValue('--final') || path.join(CHAOS_DIR, 'proposals.json');
const LAST_APPLY_PATH = argValue('--last-apply') || path.join(CHAOS_DIR, 'last-apply.json');
const NOTES_PATH = argValue('--notes');

// --- small helpers ---------------------------------------------------------
const asArray = (v) => (Array.isArray(v) ? v : []);
const norm = (s) => String(s == null ? '' : s).toLowerCase().trim();
const isStr = (v) => typeof v === 'string';

function readJson(p, label) {
  if (!fs.existsSync(p)) {
    throw new Error(`${label} not found: ${path.relative(process.cwd(), p)}`);
  }
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`${label} is not valid JSON (${path.relative(process.cwd(), p)}): ${err.message}`);
  }
}

// Stable, key-sorted stringify for order-independent deep equality.
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const deepEqual = (a, b) => stableStringify(a) === stableStringify(b);

// Normalized parent-path key (handles single parent_path or multi parent_paths).
function parentKey(item) {
  if (Array.isArray(item.parent_paths) && item.parent_paths.length) {
    return item.parent_paths.map((pp) => asArray(pp).map(norm).join(' > ')).join(' || ');
  }
  return asArray(item.parent_path).map(norm).join(' > ');
}

// Identity ref for an item — the stable key used to match baseline↔final. Identity
// fields only (NOT the fields a review might edit), so a changed field reads as
// "modify", not "reject + add".
function refOf(type, item) {
  switch (type) {
    case 'concept':
      return `concept|${norm(item.attribute)}|${norm(item.name)}|${parentKey(item)}`;
    case 'link':
      return `link|${norm(item.url)}|${norm(item.attribute)}|${norm(item.concept_name)}|${parentKey(item)}`;
    case 'tunnel':
      return `tunnel|${norm(item.from && item.from.attribute)}|${norm(item.from && item.from.name)}`
        + `|${norm(item.to && item.to.attribute)}|${norm(item.to && item.to.name)}|${norm(item.cogrounding_url)}`;
    default:
      return `${type}|${norm(item.name)}`;
  }
}

// Ledger fields carried onto a record proposal, schema-valid and "where present".
function ledgerOf(item) {
  const precision = typeof item.precision === 'number' ? item.precision : null;
  const provenance = ENUMS.provenance.includes(item.provenance) ? item.provenance : null;
  const surprise_level = ENUMS.surpriseLevel.includes(item.surprise_level) ? item.surprise_level : null;
  return {
    prediction_made: isStr(item.prediction) ? item.prediction : '',
    phi_note: isStr(item.phi) ? item.phi : '',
    precision,
    provenance,
    surprise_level,
  };
}

// The proposal arrays in a proposals object, mapped to record `type`s. Value-only
// (v0.12): concept/link/tunnel only — Situations are retired and no longer derived.
// (recordSchema.js keeps the 'situation' enum so historical records still validate.)
const PROPOSAL_ARRAYS = [
  ['concepts', 'concept'],
  ['links', 'link'],
  ['tunnels', 'tunnel'],
];

// Flatten a proposals object into [{ ref, type, item }], de-duplicating refs (a
// collision gets a #n suffix so the within-run ref-uniqueness invariant holds).
function flatten(proposals) {
  const out = [];
  const seen = new Map();
  for (const [arrKey, type] of PROPOSAL_ARRAYS) {
    for (const item of asArray(proposals[arrKey])) {
      let ref = refOf(type, item);
      if (seen.has(ref)) {
        const n = seen.get(ref) + 1;
        seen.set(ref, n);
        ref = `${ref}#${n}`;
      } else {
        seen.set(ref, 1);
      }
      out.push({ ref, type, item });
    }
  }
  return out;
}

// --- derivation (pure: no file I/O, no record write) -----------------------
// Builds the episodic record object from the baseline/final/last-apply/notes inputs.
// Exported so it can be exercised in memory (no write) by tests/harnesses.
function deriveRecord(baseline, final, lastApply, notes) {
  notes = notes || {};
  const noteReasons = (notes && typeof notes.reasons === 'object' && notes.reasons) || {};

  // working_set ← FINAL papers.
  const working_set = asArray(final.papers).map((p) => ({
    paper_ref: String(p.id || p.openalex_id || ''),
    source_field: Array.isArray(p.fields) ? p.fields.join(', ') : String(p.fields || 'unknown') || 'unknown',
    sampling_rationale: { epistemic: '', pragmatic: '' },
  }));

  // proposals ← BASELINE items.
  const baseFlat = flatten(baseline);
  const proposals = baseFlat.map(({ ref, type, item }) => ({
    ref,
    type,
    payload: item,
    ...ledgerOf(item),
  }));

  // outcomes ← BASELINE vs FINAL diff, keyed on identity ref.
  const finalFlat = flatten(final);
  const finalByRef = new Map(finalFlat.map((e) => [e.ref, e.item]));
  const outcomes = baseFlat.map(({ ref, item }) => {
    let decision;
    if (!finalByRef.has(ref)) decision = 'reject';
    else if (deepEqual(item, finalByRef.get(ref))) decision = 'accept';
    else decision = 'modify';
    return { proposal_ref: ref, decision, reason: isStr(noteReasons[ref]) ? noteReasons[ref] : '' };
  });

  // Items the human ADDED in final (not in baseline) are not reasoned proposals, so they
  // get no outcome (and would fail the ref-integrity check if emitted). Report the count.
  const baseRefs = new Set(baseFlat.map((e) => e.ref));
  const addedInFinal = finalFlat.filter((e) => !baseRefs.has(e.ref)).length;

  // reflect ← optional notes.reflect, with apply's counts folded in (schema: object|null).
  const counts = lastApply && lastApply.counts && typeof lastApply.counts === 'object' ? lastApply.counts : null;
  const notesReflect = notes && typeof notes.reflect === 'object' ? notes.reflect : null; // null if absent
  let reflect = null;
  if (counts || notesReflect) reflect = { ...(notesReflect || {}), ...(counts ? { applied_counts: counts } : {}) };

  const record = {
    record_schema_version: RECORD_SCHEMA_VERSION,
    // run_id omitted → writeRecord auto-assigns the next sequential episodic id.
    timestamp: new Date().toISOString(),
    rubric_version: String(lastApply.rubric_version || baseline.rubric_version || final.rubric_version || '0'),
    db_run_id: lastApply.run_id != null ? String(lastApply.run_id) : null,
    working_set,
    proposals,
    outcomes,
    run_notes: isStr(notes.run_notes) ? notes.run_notes : '',
    reflect,
  };

  return { record, addedInFinal };
}

// --- main (reads artifacts, derives, and WRITES the episodic record) --------
function main() {
  const baseline = readJson(BASELINE_PATH, 'baseline (proposals.reasoned.json)');
  const final = readJson(FINAL_PATH, 'final proposals (proposals.json)');
  const lastApply = readJson(LAST_APPLY_PATH, 'last-apply.json');
  const notes = NOTES_PATH ? readJson(NOTES_PATH, 'notes') : {};

  const { record, addedInFinal } = deriveRecord(baseline, final, lastApply, notes);
  const tally = record.outcomes.reduce((m, o) => ((m[o.decision] = (m[o.decision] || 0) + 1), m), {});
  const { run_id, file } = writeRecord(record);

  console.log('Chaos record-run — episodic record written.');
  console.log(`  episodic run_id : ${run_id}`);
  console.log(`  file            : ${path.relative(process.cwd(), file)}`);
  console.log(`  db_run_id       : ${record.db_run_id}`);
  console.log(`  rubric_version  : ${record.rubric_version}`);
  console.log(`  working_set     : ${record.working_set.length} paper(s)`);
  console.log(`  proposals       : ${record.proposals.length} (from baseline)`);
  console.log(`  outcomes        : accept ${tally.accept || 0} / modify ${tally.modify || 0} / reject ${tally.reject || 0}`);
  if (addedInFinal) console.log(`  note            : ${addedInFinal} item(s) added in final are not in the baseline — not recorded as proposals.`);
}

// CLI entry — only runs (and WRITES a record) when invoked directly, so requiring this
// module (e.g. a test harness) derives without writing into chaos/episodic/.
if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('record-run failed:', err.message);
    process.exitCode = 1;
  }
}

module.exports = { deriveRecord, flatten, refOf };
