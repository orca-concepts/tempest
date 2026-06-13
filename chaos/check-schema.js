#!/usr/bin/env node

/**
 * Chaos — dev-DB schema-readiness check (STRICTLY READ-ONLY).
 *
 * Confirms the dev database has the schema the Phase A campaign depends on:
 *   - a per-concept prediction ledger (with recurrence / precision / provenance /
 *     severe / surprise_level state),
 *   - a paper-to-paper citations table,
 *   - a papers/sources table with openalex_id,
 * plus a table inventory and row counts, and prints a readiness verdict.
 *
 * SAFETY: only SELECT against information_schema / pg_catalog, plus COUNT(*). No
 * INSERT/UPDATE/DELETE, no DDL, no migration, no writes to any data file. Reuses the
 * exact connection mechanism of snapshot.js / migrate-chaos.js (the backend pool +
 * backend/.env), so it hits the same dev DB those operate on. Prints database name +
 * host only — never the password or full connection URL. Stops if the host looks like
 * the production Railway proxy.
 *
 * Usage:  node chaos/check-schema.js
 */

const path = require('path');

const backendDir = path.join(__dirname, '..', 'backend');

// Load backend env first (same as snapshot.js / migrate-chaos.js), then the pool.
require(require.resolve('dotenv', { paths: [backendDir] })).config({
  path: path.join(backendDir, '.env'),
});
const pool = require(path.join(backendDir, 'src', 'config', 'database'));

// --- Resolve database name + host WITHOUT exposing credentials -------------
function resolveConn() {
  const o = pool.options || {};
  if (o.connectionString) {
    try {
      const u = new URL(o.connectionString);
      return {
        host: u.hostname || '(unknown)',
        port: u.port || '(default)',
        database: decodeURIComponent((u.pathname || '').replace(/^\//, '')) || '(unknown)',
        via: 'DATABASE_URL',
      };
    } catch {
      return { host: '(unparseable connection string)', port: '?', database: '?', via: 'DATABASE_URL' };
    }
  }
  return {
    host: o.host || 'localhost',
    port: String(o.port || 5432),
    database: o.database || '(unknown)',
    via: 'discrete DB_* vars',
  };
}

// Markers that indicate the Railway production proxy (NOT the dev DB).
const PROD_HOST_MARKERS = ['rlwy.net', 'switchback.proxy', 'railway.app'];

async function main() {
  const conn = resolveConn();

  console.log('======================================================================');
  console.log(' Chaos dev-DB schema-readiness check  (READ-ONLY — no writes, no DDL)');
  console.log('======================================================================');
  console.log(`Connected database : ${conn.database}`);
  console.log(`Host               : ${conn.host}   (port ${conn.port}, via ${conn.via})`);
  console.log('');

  // --- Production guard ---
  if (PROD_HOST_MARKERS.some((m) => String(conn.host).includes(m))) {
    console.log('*** PRODUCTION GUARD TRIPPED ***');
    console.log(`The resolved host "${conn.host}" looks like the production Railway proxy,`);
    console.log('not the local dev DB. STOPPING — no queries were run against this host.');
    return;
  }

  // --- 3. Table inventory (public schema, base tables) ---
  const inv = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  const tableNames = inv.rows.map((r) => r.table_name);
  const has = (t) => tableNames.includes(t);

  console.log('--- TABLE INVENTORY (public) -----------------------------------------');
  console.log(`${tableNames.length} tables:`);
  for (const t of tableNames) console.log(`  ${t}`);
  console.log('');

  // --- helpers for targeted introspection ---
  async function columnsOf(table) {
    const r = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    return r.rows;
  }
  async function constraintsOf(table) {
    const r = await pool.query(
      `SELECT conname, contype, pg_get_constraintdef(oid) AS def
       FROM pg_constraint
       WHERE conrelid = to_regclass($1)
       ORDER BY contype, conname`,
      [`public.${table}`]
    );
    return r.rows;
  }
  const CONTYPE = { p: 'PRIMARY KEY', f: 'FOREIGN KEY', u: 'UNIQUE', c: 'CHECK', x: 'EXCLUDE', n: 'NOT NULL' };
  async function describe(table) {
    if (!has(table)) {
      console.log(`  [ABSENT]  ${table}`);
      return;
    }
    const cols = await columnsOf(table);
    const cons = await constraintsOf(table);
    console.log(`  [PRESENT] ${table}  (${cols.length} columns)`);
    for (const c of cols) {
      console.log(`     - ${c.column_name.padEnd(24)} ${c.data_type.padEnd(28)} ${c.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'}`);
    }
    if (cons.length) {
      console.log('     constraints:');
      for (const c of cons) console.log(`       · ${CONTYPE[c.contype] || c.contype}: ${c.def}`);
    }
  }
  const colNames = async (table) => (has(table) ? (await columnsOf(table)).map((c) => c.column_name) : []);

  // --- 4. Targeted tables ------------------------------------------------
  console.log('--- TARGETED TABLES --------------------------------------------------');

  // 4a. papers / sources (must have openalex_id)
  console.log('\n• Papers / sources table:');
  const paperCandidates = tableNames.filter((t) => /paper|source/.test(t) && t !== 'paper_citations');
  const papersTable = has('papers') ? 'papers' : paperCandidates[0] || null;
  if (!papersTable) {
    console.log('  [ABSENT] no papers/sources table found.');
  } else {
    await describe(papersTable);
    const pc = await colNames(papersTable);
    console.log(`  → openalex_id column: ${pc.includes('openalex_id') ? 'PRESENT ✓' : 'ABSENT ✗'}`);
  }

  // 4b. paper-to-paper citations
  console.log('\n• Paper-to-paper citations table:');
  const citationCandidates = tableNames.filter((t) => /citation/.test(t));
  const citationsTable = has('paper_citations') ? 'paper_citations' : citationCandidates[0] || null;
  if (!citationsTable) console.log('  [ABSENT] no *citation* table found.');
  else await describe(citationsTable);

  // 4c. per-concept prediction ledger — identify by columns, do NOT assume name.
  console.log('\n• Per-concept prediction-ledger table (identified by columns, name not assumed):');
  const LEDGER_SIGNAL_COLS = [
    'recurrence', 'recurrence_count', 'precision', 'provenance', 'severe',
    'surprise_level', 'confidence', 'decay', 'last_sampled', 'last_sampled_at',
  ];
  const sig = await pool.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = ANY($1::text[])
     ORDER BY table_name, column_name`,
    [LEDGER_SIGNAL_COLS]
  );
  const byTable = new Map();
  for (const r of sig.rows) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, new Set());
    byTable.get(r.table_name).add(r.column_name);
  }
  if (byTable.size === 0) {
    console.log('  No table carries any ledger-signal column (recurrence/precision/provenance/severe/…).');
  } else {
    console.log('  Tables carrying any ledger-signal columns:');
    for (const [t, set] of byTable) {
      console.log(`     ${t}: ${[...set].sort().join(', ')}`);
    }
  }
  // Explicit presence of the three load-bearing ledger columns, anywhere.
  const where = (col) => sig.rows.filter((r) => r.column_name === col).map((r) => r.table_name);
  const precisionIn = where('precision');
  const provenanceIn = where('provenance');
  const severeIn = where('severe');
  console.log(`  → precision  column: ${precisionIn.length ? 'PRESENT in ' + precisionIn.join(', ') : 'ABSENT'}`);
  console.log(`  → provenance column: ${provenanceIn.length ? 'PRESENT in ' + provenanceIn.join(', ') : 'ABSENT'}`);
  console.log(`  → severe     column: ${severeIn.length ? 'PRESENT in ' + severeIn.join(', ') : 'ABSENT'}`);
  // Describe the obvious prediction tables if present, for context.
  for (const t of tableNames.filter((t) => /prediction|ledger/.test(t))) {
    console.log('');
    await describe(t);
  }
  // The per-concept prediction LEDGER is two coupled tables by design: the standing
  // prediction (chaos_predictions) carries `precision`; the append-only confirmation
  // events (chaos_prediction_events) carry `provenance` / `severe` / `surprise_level`.
  const predCols = await colNames('chaos_predictions');
  const eventCols = await colNames('chaos_prediction_events');
  const ledgerPrecisionOk = predCols.includes('precision');
  const ledgerEventsOk = ['provenance', 'severe', 'surprise_level'].every((c) => eventCols.includes(c));

  // 4d. chaos_situation_meta status (handled by the staged mapping-fixes migration).
  console.log('\n• chaos_situation_meta (expected to be created/extended by the mapping-fixes migration):');
  await describe('chaos_situation_meta');

  // --- 5. Row counts ------------------------------------------------------
  console.log('\n--- ROW COUNTS (read-only COUNT(*)) ----------------------------------');
  const coreTables = ['concepts', 'edges', 'attributes', 'concept_links', 'concept_link_votes',
    'votes', 'combos', 'combo_edges', 'tunnel_links'];
  const chaosTables = tableNames.filter((t) => /^(chaos_|papers$|paper_citations$)/.test(t));
  const countList = [...coreTables.filter(has), ...chaosTables.filter((t) => !coreTables.includes(t))];
  for (const t of countList) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    console.log(`  ${t.padEnd(26)} ${r.rows[0].n}`);
  }

  // --- 6. Readiness verdict ----------------------------------------------
  const ledgerReady = ledgerPrecisionOk && ledgerEventsOk;
  const papersReady = !!papersTable && (await colNames(papersTable)).includes('openalex_id');
  const citationsReady = !!citationsTable;
  const check = (b) => (b ? '[x]' : '[ ]');

  console.log('\n--- READINESS VERDICT ------------------------------------------------');
  console.log(`  ${check(ledgerReady)} per-concept prediction ledger present, with precision + provenance + severe`);
  console.log(`        chaos_predictions.precision: ${ledgerPrecisionOk ? 'PRESENT' : 'ABSENT'}; `
    + `chaos_prediction_events.{provenance,severe,surprise_level}: ${ledgerEventsOk ? 'PRESENT' : 'ABSENT'}`);
  console.log(`  ${check(papersReady)} papers/sources table present with openalex_id`);
  console.log(`  ${check(citationsReady)} paper-to-paper citations table present`);
  console.log(`  [-] chaos_situation_meta: ${has('chaos_situation_meta') ? 'PRESENT' : 'ABSENT'} `
    + `(handled by the staged mapping-fixes migration, not by this check)`);
  console.log('');
  const blockers = [];
  if (!ledgerReady) blockers.push('per-concept prediction ledger (precision/provenance/severe)');
  if (!citationsReady) blockers.push('paper-to-paper citations table');
  if (!papersReady) blockers.push('papers table with openalex_id');
  if (blockers.length === 0) {
    console.log('  BOTTOM LINE: schema is ready — can proceed to reset + campaign.');
  } else {
    console.log('  BOTTOM LINE: NOT ready — a migration is needed first for: ' + blockers.join('; ') + '.');
  }

  console.log('\n(Read-only: no rows were modified, no migration was run, no files were written.)');
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('check-schema failed:', err.message);
    pool.end().finally(() => process.exit(1));
  });
