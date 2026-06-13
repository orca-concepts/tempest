#!/usr/bin/env node

/**
 * Chaos — episodic run-record writer.
 *
 * Validates an episodic run record and writes it to chaos/episodic/run-<id>.json
 * (zero-padded to 4 digits), then appends a summary entry to index.json. Records
 * are committed (not gitignored) so episodic memory survives dev-DB rebuilds —
 * see chaos/episodic/README.md.
 *
 * Built-ins only (fs/path) to match chaos/snapshot.js's dependency posture; no
 * Postgres, no external npm packages. This stage is intentionally standalone.
 *
 * Usage (CLI):
 *   node chaos/episodic/writeRecord.js path/to/record.json
 *
 * Usage (programmatic):
 *   const { writeRecord } = require('./writeRecord');
 *   const { run_id, file } = writeRecord(recordObject);
 *
 * Behavior:
 *   - Validates via recordSchema.validate; aborts with a clear message if invalid.
 *   - run_id: if the record supplies an integer run_id, it is used as-is.
 *     Otherwise the next id is (max existing run-NNNN.json id) + 1, starting at 1.
 *   - Writes run-<id>.json pretty-printed; appends { run_id, timestamp,
 *     rubric_version, proposal_count, accept_count } to index.json.
 */

const fs = require('fs');
const path = require('path');

const { validate } = require('./recordSchema');

const EPISODIC_DIR = __dirname;
const INDEX_PATH = path.join(EPISODIC_DIR, 'index.json');
const RUN_FILE_RE = /^run-(\d{4})\.json$/;

// Scan the episodic dir for run-NNNN.json files and return the highest id found
// (0 if none). The next run_id is this + 1.
function maxExistingRunId() {
  let max = 0;
  for (const name of fs.readdirSync(EPISODIC_DIR)) {
    const m = RUN_FILE_RE.exec(name);
    if (m) {
      const id = parseInt(m[1], 10);
      if (id > max) max = id;
    }
  }
  return max;
}

function runFileName(id) {
  return `run-${String(id).padStart(4, '0')}.json`;
}

// Load index.json (an array). Missing file => []. Throws on malformed JSON so we
// never silently clobber a corrupt index.
function loadIndex() {
  if (!fs.existsSync(INDEX_PATH)) return [];
  const raw = fs.readFileSync(INDEX_PATH, 'utf8').trim();
  if (raw === '') return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`index.json is not a JSON array (found ${typeof parsed})`);
  }
  return parsed;
}

/**
 * Validate and write a record. Returns { run_id, file, indexEntry }.
 * Throws Error on validation failure or filesystem conflict.
 * @param {object} recordInput
 */
function writeRecord(recordInput) {
  // Shallow clone so we can fill in run_id without mutating the caller's object.
  const record = { ...recordInput };

  // Resolve run_id BEFORE validation so a generated id is validated too.
  if (record.run_id === undefined || record.run_id === null) {
    record.run_id = maxExistingRunId() + 1;
  }

  const { ok, errors } = validate(record);
  if (!ok) {
    throw new Error(
      `Record failed validation (${errors.length} problem${
        errors.length === 1 ? '' : 's'
      }):\n  - ${errors.join('\n  - ')}`
    );
  }

  const fileName = runFileName(record.run_id);
  const filePath = path.join(EPISODIC_DIR, fileName);
  if (fs.existsSync(filePath)) {
    throw new Error(
      `${fileName} already exists — refusing to overwrite run ${record.run_id}. ` +
        `Omit run_id to auto-assign the next available id.`
    );
  }

  // Write the run record (pretty-printed, trailing newline).
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2) + '\n', 'utf8');

  // Append the summary to the index.
  const index = loadIndex();
  const indexEntry = {
    run_id: record.run_id,
    timestamp: record.timestamp,
    rubric_version: record.rubric_version,
    proposal_count: Array.isArray(record.proposals) ? record.proposals.length : 0,
    accept_count: Array.isArray(record.outcomes)
      ? record.outcomes.filter((o) => o && o.decision === 'accept').length
      : 0,
  };
  index.push(indexEntry);
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2) + '\n', 'utf8');

  return { run_id: record.run_id, file: filePath, indexEntry };
}

// --- CLI entry point -------------------------------------------------------

function mainCli() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node chaos/episodic/writeRecord.js path/to/record.json');
    process.exit(2);
  }

  const recordPath = path.resolve(arg);
  let recordInput;
  try {
    recordInput = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  } catch (err) {
    console.error(`Could not read/parse ${recordPath}: ${err.message}`);
    process.exit(2);
  }

  try {
    const { run_id, file } = writeRecord(recordInput);
    console.log(`Wrote ${file}`);
    console.log(`Updated ${INDEX_PATH} (run_id ${run_id})`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  mainCli();
}

module.exports = { writeRecord, maxExistingRunId, runFileName };
