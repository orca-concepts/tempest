#!/usr/bin/env node

/**
 * Chaos — safe dev-DB reset for the Phase A campaign (DESTRUCTIVE, two-step).
 *
 * Resets the Chaos DEV database to a clean slate — empty seeded graph and empty
 * Chaos run data, on the final v0.11 schema — while preserving reference data (the
 * attribute domains), accounts (users), all legal/audit records, and every table's
 * STRUCTURE. The episodic store is untouched (it lives in committed files under
 * chaos/episodic/, not in the DB).
 *
 * SAFETY MODEL
 *   1. Production guard (hard stop). Refuses unless the resolved host is
 *      localhost/127.0.0.1 AND the database is `concept_hierarchy`. Refuses outright
 *      if a DATABASE_URL connection is in use (the dev posture is discrete DB_* vars;
 *      a DATABASE_URL is the production / SSL posture per backend/src/config/database.js)
 *      or if any production marker (rlwy.net / switchback.proxy / railway) appears.
 *   2. Required backup gate. A full pg_dump is written and verified non-empty BEFORE
 *      any truncation, in BOTH modes. If the backup fails, nothing is truncated.
 *   3. Two-step. Default run is a dry-run preview (guard + counts + classification +
 *      backup, then STOP). Destruction happens only with --confirm.
 *   4. No blind CASCADE. The WIPE set is FK-closed by construction; the truncate names
 *      every dependent explicitly. If an FK from a PRESERVED or UNCLASSIFIED table
 *      would block the truncate, the script aborts and reports rather than cascading
 *      into unknown tables.
 *   5. Unknown tables are never wiped. Anything the classifier can't confidently bucket
 *      as content is listed under "unclassified — review" and left alone.
 *
 * Connection: reuses the backend pg pool + backend/.env exactly like chaos/clear.js,
 * chaos/check-schema.js, and chaos/migrate-chaos.js. Prints database name + host only.
 *
 * Usage:
 *   node chaos/reset-dev-db.js            # dry-run preview (safe; truncates nothing)
 *   node chaos/reset-dev-db.js --confirm  # actually truncate the WIPE set
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const backendDir = path.join(__dirname, '..', 'backend');

// Load backend env first (same as the sibling chaos scripts), then the pool.
require(require.resolve('dotenv', { paths: [backendDir] })).config({
  path: path.join(backendDir, '.env'),
});
const pool = require(path.join(backendDir, 'src', 'config', 'database'));

const CONFIRM = process.argv.includes('--confirm');

// Expected dev identity.
const EXPECTED_DB = 'concept_hierarchy';
const EXPECTED_HOSTS = ['localhost', '127.0.0.1'];

// Markers that indicate the Railway production proxy (NOT the dev DB).
const PROD_MARKERS = ['switchback.proxy.rlwy.net', 'rlwy.net', 'railway'];
const looksProd = (s) => PROD_MARKERS.some((m) => String(s || '').toLowerCase().includes(m));

// ---------------------------------------------------------------------------
// Classification rules.
//
// PRESERVE — structural / reference / identity tables. Never truncated.
//   • attributes              the four seeded attribute domains (reference data)
//   • users                   accounts / auth / identity
//   • *migration* / session   migration-tracking or session tables, if any appear
//
// WIPE — the campaign content set: the seeded graph + everything FK-anchored to it,
//   plus the Chaos run data (papers, citations, prediction ledger, situation meta).
//   This list is FK-CLOSED: every table that has a foreign key into any WIPE table is
//   itself in WIPE, so a single TRUNCATE ... RESTART IDENTITY (no CASCADE) succeeds.
//   `comment_mentions` is included explicitly because it is graph content but has NO
//   foreign keys (see ORCA_STATUS.md "No FK on comment_mentions"), so neither CASCADE
//   nor FK-closure would otherwise reach it.
//
// Anything live that matches neither rule set is reported as UNCLASSIFIED and left
// untouched — this is the safety valve for unexpected / future tables. In this schema
// the unclassified set is the legal/forensic + info-page-comment tables (legal_removals,
// dmca_strikes, link_removal_log, safe_browsing_rejections, copyright_* , page_comments,
// page_comment_votes, data_export_requests): none are graph or Chaos content, and none
// FK into the WIPE set, so they neither need wiping nor block the truncate.
// ---------------------------------------------------------------------------
const PRESERVE_EXACT = new Set(['attributes', 'users']);
const PRESERVE_PATTERNS = [
  /(^|_)migrations?$/i, // *_migrations / migrations
  /^knex_/i,
  /schema_migrations/i,
  /session/i, // session stores, if ever added
  /^auth_/i,
];

const WIPE_SET = new Set([
  // --- seeded graph core ---
  'concepts',
  'edges',
  'concept_links',
  'concept_link_addenda',
  'concept_link_votes',
  // --- edge satellites (votes / moderation / rankings) ---
  'votes',
  'replace_votes',
  'similarity_votes',
  'vote_set_changes',
  'concept_flags',
  'concept_flag_votes',
  'moderation_comments',
  'child_rankings',
  // --- combos / situations ---
  'combos',
  'combo_edges',
  'combo_subscriptions',
  'combo_votes',
  'chaos_situation_meta',
  // --- tunnels ---
  'tunnel_links',
  'tunnel_link_addenda',
  'tunnel_votes',
  // --- navigation / sidebar state ---
  'graph_tabs',
  'tab_groups',
  'sidebar_items',
  // --- in-orca mention index (no FKs) ---
  'comment_mentions',
  // --- Chaos run data ---
  'papers',
  'paper_citations',
  'chaos_predictions',
  'chaos_prediction_events',
]);

function isPreserve(t) {
  return PRESERVE_EXACT.has(t) || PRESERVE_PATTERNS.some((re) => re.test(t));
}

// --- Resolve connection identity WITHOUT exposing credentials -------------
function resolveConn() {
  const o = pool.options || {};
  if (o.connectionString) {
    try {
      const u = new URL(o.connectionString);
      return {
        host: u.hostname || '(unknown)',
        port: u.port || '5432',
        database: decodeURIComponent((u.pathname || '').replace(/^\//, '')) || '(unknown)',
        user: decodeURIComponent(u.username || '') || process.env.DB_USER || 'postgres',
        password: decodeURIComponent(u.password || '') || process.env.DB_PASSWORD || '',
        via: 'DATABASE_URL',
      };
    } catch {
      return { host: '(unparseable connection string)', port: '?', database: '?', user: '?', password: '', via: 'DATABASE_URL' };
    }
  }
  return {
    host: o.host || 'localhost',
    port: String(o.port || 5432),
    database: o.database || EXPECTED_DB,
    user: o.user || process.env.DB_USER || 'postgres',
    password: o.password || process.env.DB_PASSWORD || '',
    via: 'discrete DB_* vars',
  };
}

// --- Production guard (hard stop) -----------------------------------------
function guard(conn) {
  const refuse = (msg) => {
    console.error('\n*** PRODUCTION GUARD TRIPPED — refusing to run ***');
    console.error(msg);
    console.error('No queries were run, no backup was taken, nothing was truncated.');
    pool.end().finally(() => process.exit(1));
    throw new Error('guard'); // unreachable after exit, but keeps control flow honest
  };

  // (a) The dev posture is discrete DB_* vars. A DATABASE_URL means the SSL/remote
  //     (production) posture per backend/src/config/database.js — refuse it outright.
  if (process.env.DATABASE_URL) {
    return refuse(
      'A DATABASE_URL is set. This reset is DEV-ONLY and requires the discrete dev\n' +
        'DB_* vars (DB_HOST/DB_NAME/...). Refusing to operate over a DATABASE_URL connection' +
        (looksProd(process.env.DATABASE_URL) ? ' (and it carries a production marker).' : '.')
    );
  }

  // (b) Any production marker in the resolved host.
  if (looksProd(conn.host)) {
    return refuse(`Resolved host "${conn.host}" carries a production marker (${PROD_MARKERS.join(', ')}).`);
  }

  // (c) Positive assertion: must be localhost AND the expected dev database.
  if (!EXPECTED_HOSTS.includes(String(conn.host))) {
    return refuse(`Resolved host "${conn.host}" is not localhost/127.0.0.1. Expected a local dev DB.`);
  }
  if (String(conn.database) !== EXPECTED_DB) {
    return refuse(`Resolved database "${conn.database}" is not the expected dev DB "${EXPECTED_DB}".`);
  }
}

// --- Live schema introspection --------------------------------------------
async function liveTables() {
  const { rows } = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
     ORDER BY table_name`
  );
  return rows.map((r) => r.table_name);
}

async function rowCounts(tables) {
  const out = {};
  for (const t of tables) {
    const r = await pool.query(`SELECT COUNT(*)::int AS n FROM ${t}`);
    out[t] = r.rows[0].n;
  }
  return out;
}

// Find FKs from a table OUTSIDE the WIPE set into a table INSIDE it. Such an FK would
// block a no-CASCADE truncate; we report it and abort rather than cascading.
async function fkBlockers(wipeLive) {
  const wipe = new Set(wipeLive);
  const { rows } = await pool.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
     FROM information_schema.table_constraints tc
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`
  );
  const blockers = [];
  for (const { child, parent } of rows) {
    if (wipe.has(parent) && !wipe.has(child)) blockers.push({ child, parent });
  }
  // de-dup (multi-column FKs surface twice)
  const seen = new Set();
  return blockers.filter((b) => {
    const k = `${b.child}->${b.parent}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// --- Backup (required gate) ------------------------------------------------
function findPgDump() {
  // 1) PATH
  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pg_dump'], {
    encoding: 'utf8',
  });
  if (probe.status === 0 && probe.stdout) {
    const first = probe.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  // 2) Standard Windows PostgreSQL install dirs (highest version first).
  const roots = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL'];
  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const ver of fs.readdirSync(root)) {
      const exe = path.join(root, ver, 'bin', 'pg_dump.exe');
      if (fs.existsSync(exe)) candidates.push({ ver, exe });
    }
  }
  candidates.sort((a, b) => parseInt(b.ver, 10) - parseInt(a.ver, 10));
  return candidates.length ? candidates[0].exe : null;
}

function takeBackup(conn) {
  const backupsDir = path.join(__dirname, 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });

  // UTC timestamp, filesystem-safe: YYYYMMDDTHHMMSSZ
  const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const outFile = path.join(backupsDir, `dev-backup-${ts}.sql`);

  const pgDump = findPgDump();
  if (!pgDump) {
    throw new Error(
      'pg_dump not found on PATH or under C:\\Program Files\\PostgreSQL\\*\\bin. ' +
        'Install PostgreSQL client tools or add pg_dump to PATH.'
    );
  }

  const args = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '-f', outFile,
  ];
  const res = spawnSync(pgDump, args, {
    encoding: 'utf8',
    env: { ...process.env, PGPASSWORD: conn.password }, // password via env, never printed
  });

  if (res.error) throw new Error(`pg_dump failed to launch: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`pg_dump exited ${res.status}: ${(res.stderr || '').trim() || '(no stderr)'}`);
  }
  if (!fs.existsSync(outFile) || fs.statSync(outFile).size === 0) {
    throw new Error(`pg_dump produced no / empty file at ${outFile}`);
  }
  return { outFile, bytes: fs.statSync(outFile).size, pgDump };
}

// --- Main ------------------------------------------------------------------
async function main() {
  const conn = resolveConn();

  console.log('======================================================================');
  console.log(` Chaos dev-DB reset  ${CONFIRM ? '(--confirm: DESTRUCTIVE)' : '(dry-run preview — truncates nothing)'}`);
  console.log('======================================================================');
  console.log(`Connected database : ${conn.database}`);
  console.log(`Host               : ${conn.host}   (port ${conn.port}, via ${conn.via})`);
  console.log('');

  // 1) Guard (exits the process on refusal).
  guard(conn);
  console.log('Production guard   : PASSED (localhost + concept_hierarchy, no DATABASE_URL, no prod markers)\n');

  // 2) Classify the live schema.
  const tables = await liveTables();
  const preserve = [];
  const wipe = [];
  const unclassified = [];
  for (const t of tables) {
    if (isPreserve(t)) preserve.push(t);
    else if (WIPE_SET.has(t)) wipe.push(t);
    else unclassified.push(t);
  }
  // WIPE tables we expect but that are absent from the live schema (informational).
  const wipeMissing = [...WIPE_SET].filter((t) => !tables.includes(t)).sort();

  // 3) Current row counts.
  const counts = await rowCounts(tables);
  const fmt = (list) => list.slice().sort().map((t) => `  ${t.padEnd(26)} ${counts[t]}`).join('\n');

  console.log(`--- WIPE  (${wipe.length} tables — emptied with RESTART IDENTITY) -------------------`);
  console.log(fmt(wipe));
  if (wipeMissing.length) console.log(`  (expected but absent: ${wipeMissing.join(', ')})`);
  console.log('');
  console.log(`--- PRESERVE  (${preserve.length} tables — never truncated) ------------------------`);
  console.log(fmt(preserve));
  console.log('');
  console.log(`--- UNCLASSIFIED — REVIEW  (${unclassified.length} tables — left untouched) ---------`);
  if (unclassified.length === 0) console.log('  (none)');
  else console.log(fmt(unclassified));
  console.log('');

  // 4) FK-closure blocker check (an FK from a preserved/unclassified table INTO the
  //    WIPE set would block a no-CASCADE truncate).
  const wipeLive = wipe;
  const blockers = await fkBlockers(wipeLive);
  if (blockers.length) {
    console.log('--- FK BLOCKERS ------------------------------------------------------');
    console.log('A foreign key from a non-WIPE table points INTO the WIPE set. A no-CASCADE');
    console.log('truncate would fail, and this script will NOT cascade into unknown tables:');
    for (const b of blockers) console.log(`  ${b.child}  →  ${b.parent}`);
    console.log('\nResolve the classification (add the child to WIPE, or rethink the set) first.');
    if (CONFIRM) {
      console.error('\nAborting --confirm: refusing to truncate with unresolved FK blockers.');
      await pool.end();
      process.exit(1);
    }
  } else {
    console.log('FK-closure check   : OK (no preserved/unclassified table references the WIPE set)\n');
  }

  // 5) Backup (required gate, BEFORE any truncation, in both modes).
  console.log('--- BACKUP -----------------------------------------------------------');
  const backup = takeBackup(conn);
  console.log(`pg_dump            : ${backup.pgDump}`);
  console.log(`Backup written     : ${backup.outFile}`);
  console.log(`Backup size        : ${backup.bytes.toLocaleString()} bytes (verified non-empty)\n`);

  // 6) Dry-run stops here.
  if (!CONFIRM) {
    console.log('======================================================================');
    console.log(' DRY RUN COMPLETE — nothing was truncated.');
    console.log(' Review the classification above. To perform the reset, re-run with:');
    console.log('     node chaos/reset-dev-db.js --confirm');
    console.log('======================================================================');
    await pool.end();
    process.exit(0);
  }

  // 7) --confirm: single-transaction TRUNCATE of the WIPE set (no CASCADE).
  if (wipeLive.length === 0) {
    console.log('Nothing to truncate (WIPE set is empty in the live schema).');
    await pool.end();
    process.exit(0);
  }
  console.log('--- TRUNCATE (single transaction, RESTART IDENTITY, no CASCADE) ------');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`TRUNCATE ${wipeLive.join(', ')} RESTART IDENTITY`);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\nTRUNCATE failed — transaction rolled back, nothing changed.');
    console.error(`  ${err.message}`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();
  console.log(`Truncated ${wipeLive.length} tables.\n`);

  // 8) Post-reset verification.
  const after = await rowCounts(tables);
  const allZero = wipeLive.every((t) => after[t] === 0);
  const attrsOk = after.attributes === 4;
  const allPresent = (await liveTables()).length === tables.length;
  // sequence restart check on a representative table that just had rows.
  let seqOk = true;
  try {
    const seqName = (await pool.query(`SELECT pg_get_serial_sequence('concepts','id') AS s`)).rows[0].s;
    if (seqName) {
      const nv = (await pool.query(`SELECT last_value, is_called FROM ${seqName}`)).rows[0];
      seqOk = Number(nv.last_value) === 1 && nv.is_called === false; // fresh sequence
    }
  } catch {
    seqOk = true; // non-fatal
  }

  console.log('--- POST-RESET CHECK -------------------------------------------------');
  console.log(`  WIPE tables all at 0       : ${allZero ? 'YES' : 'NO'}`);
  console.log(`  attributes still present   : ${attrsOk ? 'YES (4)' : `NO (${after.attributes})`}`);
  console.log(`  users preserved            : ${after.users} row(s)`);
  console.log(`  every table still present  : ${allPresent ? 'YES' : 'NO'}`);
  console.log(`  sequences restarted        : ${seqOk ? 'YES (concepts.id → 1)' : 'CHECK'}`);
  console.log('');
  console.log('======================================================================');
  console.log(' RESET COMPLETE. Dev graph + Chaos run data cleared on the v0.11 schema.');
  console.log(`Backup retained at: ${backup.outFile}`);
  console.log('======================================================================');

  await pool.end();
  process.exit(allZero && attrsOk && allPresent ? 0 : 1);
}

main().catch((err) => {
  console.error('\nreset-dev-db failed:', err.message);
  pool.end().finally(() => process.exit(1));
});
