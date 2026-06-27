#!/usr/bin/env node

/**
 * Chaos — Krius placement APPLIER. Writes the WRITABLE `missing_placement` frontiers from
 * chaos/genesis/krius-proposal.json into the LOCAL DEV graph as ADDITIVE, name-based,
 * multi-parent parent edges (path-dependent identity, chaos.md §5.3 / §8).
 *
 * ONLY placements are writable. `missing_adjective`, `missing_abstraction`, and
 * `possible_merge` are advisory and are NEVER applied here.
 *
 * Safety contract (mirrors chaos/genesis/write.js):
 *   - ADDITIVE ONLY. It adds parent edges to EXISTING concepts. It creates/renames/moves/
 *     deletes nothing, and touches no dormant v0.x payload (no papers, links, tunnels,
 *     predictions, precision). The proposals object handed to apply.js carries empty
 *     papers/links/tunnels, so apply.js only ever INSERTs concepts (none — all exist) + edges.
 *   - DRY RUN BY DEFAULT. With no flag (or --dry-run) it resolves read-only and prints the
 *     numbered would-add list, performing ZERO database writes. The real write requires the
 *     explicit flag --confirm.
 *   - BACKED UP BEFORE ANY WRITE. The real write delegates to chaos/apply.js, which takes a
 *     pg_dump backup BEFORE its transaction and aborts (non-zero exit, no write) if the
 *     backup fails. We refuse to claim success unless apply.js exits 0, and surface its
 *     backup path.
 *   - APPEND-ONLY / IDEMPOTENT. apply.js's getOrCreateConcept / getOrCreateEdge reuse existing
 *     rows, so re-applying an edge that already exists is a no-op (zero rows created).
 *   - DEV-DB GUARD. --confirm refuses anything that isn't the local dev DB.
 *   - NEVER GUESS. A placement whose child or whose target parent-path names do not resolve
 *     against the LIVE dev graph is SKIPPED and reported — never auto-created. (apply.js would
 *     auto-create a missing ancestor, so unresolved placements are excluded from its input.)
 *
 * Stable numbering: every selected placement gets a number 1..N in a deterministic order
 * (region, then child name, then target path). The number printed in --dry-run maps to the
 * SAME edge at --confirm time, so `--skip <n,…>` is reliable across the two invocations.
 *
 * REUSE, NOT REIMPLEMENTATION: the actual edge writing + backup is apply.js's, driven through
 * its existing `--proposals <file>` override (same delegation pattern as write.js). apply.js
 * is NOT modified.
 *
 * Usage:
 *   node chaos/genesis/apply-krius.js                 # dry run (default) — no DB writes
 *   node chaos/genesis/apply-krius.js --dry-run       # same
 *   node chaos/genesis/apply-krius.js --skip 7,19     # exclude those numbered placements
 *   node chaos/genesis/apply-krius.js --confirm       # real write (dev-only; pg_dump first)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const GENESIS_DIR = __dirname;
const CHAOS_DIR = path.join(GENESIS_DIR, '..');
const REPO_DIR = path.join(CHAOS_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const APPLY_PATH = path.join(CHAOS_DIR, 'apply.js');
const KRIUS_PROPOSAL_PATH = path.join(GENESIS_DIR, 'krius-proposal.json');
// Temp proposals file fed to apply.js --proposals (gitignored; removed after the run).
const TEMP_PROPOSALS = path.join(GENESIS_DIR, '.krius-apply.tmp.json');

const ATTRIBUTE = 'value'; // the single attribute domain (chaos.md §9)

// dotenv (same as apply.js / write.js). Requiring the pool does NOT open a connection — the
// first query does — so a pure dry run still prints if the DB happens to be down.
require(require.resolve('dotenv', { paths: [BACKEND_DIR] })).config({
  path: path.join(BACKEND_DIR, '.env'),
});

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

const CONFIRM = process.argv.includes('--confirm');
const DRY_RUN = !CONFIRM; // dry run is the default; --confirm is the only way to write

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const pre = process.argv.find((x) => x.startsWith(flag + '='));
  return pre ? pre.split('=').slice(1).join('=') : null;
}
const SKIP = (() => {
  const raw = argValue('--skip');
  if (!raw) return new Set();
  return new Set(
    String(raw).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0)
  );
})();

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

function asArray(v) { return Array.isArray(v) ? v : []; }
function norm(s) { return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim(); }
function pathDisp(names) { return asArray(names).join(' › '); }

// ----------------------------------------------------------------------------
// Load + select the writable placements; order deterministically + number 1..N.
// ----------------------------------------------------------------------------

function loadPlacements() {
  if (!fs.existsSync(KRIUS_PROPOSAL_PATH)) {
    throw new Error(`krius proposal not found at ${path.relative(REPO_DIR, KRIUS_PROPOSAL_PATH)}. Run chaos/krius.js first.`);
  }
  const proposal = JSON.parse(fs.readFileSync(KRIUS_PROPOSAL_PATH, 'utf8'));
  // ONLY placements: kind missing_placement AND writable:true. Every advisory kind is ignored.
  const placements = asArray(proposal.frontiers).filter(
    (f) => f && f.kind === 'missing_placement' && f.writable === true
  );
  // Deterministic order: region, then child name, then target parent-path — stable so a
  // number seen in --dry-run addresses the same edge at --confirm time.
  placements.sort((a, b) =>
    norm(a.region).localeCompare(norm(b.region)) ||
    norm(a.concept_name).localeCompare(norm(b.concept_name)) ||
    norm(asArray(a.new_parent_path).join('>')).localeCompare(norm(asArray(b.new_parent_path).join('>')))
  );
  // Assign stable 1..N over the FULL selected set (independent of skip / resolution outcome).
  placements.forEach((p, i) => { p._n = i + 1; });
  return { proposal, placements };
}

// ----------------------------------------------------------------------------
// DB: dev guard + read-only resolution against the LIVE graph.
// ----------------------------------------------------------------------------

function resolveDb() {
  const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
  const o = pool.options || {};
  let host;
  let database;
  if (o.connectionString) {
    try {
      const u = new URL(o.connectionString);
      host = u.hostname || '';
      database = decodeURIComponent((u.pathname || '').replace(/^\//, '')) || '';
    } catch { host = '(unparseable)'; database = '(unknown)'; }
  } else {
    host = o.host || 'localhost';
    database = o.database || 'concept_hierarchy';
  }
  return { pool, host, database };
}

// Mirrors apply.js / write.js — must never touch production.
function isDevDb(host, database) {
  const PROD = ['proxy.rlwy.net', 'rlwy.net', 'railway'];
  const marked = (s) => PROD.some((m) => String(s || '').toLowerCase().includes(m));
  return (
    !process.env.DATABASE_URL &&
    !marked(host) &&
    ['localhost', '127.0.0.1'].includes(String(host)) &&
    String(database) === 'concept_hierarchy'
  );
}

// Resolve a single placement against the live graph (READ-ONLY). Returns:
//   { status: 'unresolved', reason }                     — child or a path name not found
//   { status: 'exists',  currentParents }                — the edge already exists (no-op)
//   { status: 'add',     currentParents }                — would add this parent edge
async function resolvePlacement(pool, valueAttrId, p) {
  const child = p.concept_name;
  const childRow = await pool.query('SELECT id FROM concepts WHERE LOWER(name) = $1 LIMIT 1', [norm(child)]);
  if (!childRow.rows[0]) return { status: 'unresolved', reason: `child concept "${child}" not in graph` };
  const childId = childRow.rows[0].id;

  // Resolve every name in the target parent path (root → parent) to a concept id.
  const pathIds = [];
  for (const name of asArray(p.new_parent_path)) {
    const r = await pool.query('SELECT id FROM concepts WHERE LOWER(name) = $1 LIMIT 1', [norm(name)]);
    if (!r.rows[0]) return { status: 'unresolved', reason: `target parent "${name}" not in graph` };
    pathIds.push(r.rows[0].id);
  }
  const parentId = pathIds.length ? pathIds[pathIds.length - 1] : null;
  const graphPath = pathIds; // edges.graph_path is root-to-parent inclusive == the new_parent_path ids

  // Current parents (live, for display): every non-root parent the child already sits under.
  const cp = await pool.query(
    `SELECT DISTINCT c.name FROM edges e JOIN concepts c ON c.id = e.parent_id
      WHERE e.child_id = $1 AND e.parent_id IS NOT NULL ORDER BY c.name`,
    [childId]
  );
  const currentParents = cp.rows.map((r) => r.name);

  // Does the additive edge already exist? (parent_id, child_id, graph_path, attribute_id)
  let edge;
  if (parentId == null) {
    edge = await pool.query(
      `SELECT id FROM edges WHERE parent_id IS NULL AND child_id=$1 AND attribute_id=$2 AND graph_path=$3::int[] LIMIT 1`,
      [childId, valueAttrId, graphPath]
    );
  } else {
    edge = await pool.query(
      `SELECT id FROM edges WHERE parent_id=$1 AND child_id=$2 AND attribute_id=$3 AND graph_path=$4::int[] LIMIT 1`,
      [parentId, childId, valueAttrId, graphPath]
    );
  }
  if (edge.rows[0]) return { status: 'exists', currentParents };
  return { status: 'add', currentParents };
}

// Resolve all placements (read-only). Returns each placement annotated with its resolution.
async function resolveAll(pool, placements) {
  const attr = await pool.query('SELECT id FROM attributes WHERE name = $1 LIMIT 1', [ATTRIBUTE]);
  if (!attr.rows[0]) throw new Error(`attribute "${ATTRIBUTE}" not found in the graph.`);
  const valueAttrId = attr.rows[0].id;
  const out = [];
  for (const p of placements) {
    const res = await resolvePlacement(pool, valueAttrId, p);
    out.push({ p, res });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Numbered would-add report (dry run + confirm preamble)
// ----------------------------------------------------------------------------

function printNumberedList(resolved) {
  console.log('\nNumbered placements (writable missing_placement only):');
  let willAdd = 0;
  let noop = 0;
  let unresolved = 0;
  let skipped = 0;
  for (const { p, res } of resolved) {
    const n = p._n;
    const isSkipped = SKIP.has(n);
    const parent = asArray(p.new_parent_path)[asArray(p.new_parent_path).length - 1] || '(root)';
    const cur = res.currentParents && res.currentParents.length ? res.currentParents.join(', ') : '(none)';
    let tag;
    if (res.status === 'unresolved') { tag = `UNRESOLVED — ${res.reason} → SKIP`; unresolved += 1; }
    else if (res.status === 'exists') { tag = 'already exists → no-op'; noop += 1; }
    else { tag = 'would ADD'; }
    if (isSkipped) { tag = `SKIPPED (--skip) [${tag}]`; skipped += 1; }
    else if (res.status === 'add') { willAdd += 1; }
    const flag = isSkipped ? '·' : (res.status === 'add' ? '+' : (res.status === 'exists' ? '=' : '!'));
    console.log(
      `  #${String(n).padStart(2)} ${flag} add parent {${parent}} to {${p.concept_name}} ` +
        `(current parents: ${cur})  [${tag}]`
    );
    if (res.status !== 'unresolved') console.log(`        path: ${pathDisp(p.proposed_chain || [...asArray(p.new_parent_path), p.concept_name])}`);
  }
  return { willAdd, noop, unresolved, skipped, total: resolved.length };
}

// ----------------------------------------------------------------------------
// Build the apply.js proposals object (multi-parent concepts; additive only).
// Includes ONLY non-skipped, fully-resolved placements (unresolved ones are excluded so
// apply.js never auto-creates a missing ancestor). Already-existing edges are still passed
// through and become no-ops via apply.js's idempotent getOrCreateEdge.
// ----------------------------------------------------------------------------

function buildApplyProposals(proposal, resolved) {
  const byChild = new Map(); // norm(child) -> { attribute, name, parent_paths, _seen:Set }
  for (const { p, res } of resolved) {
    if (SKIP.has(p._n)) continue;
    if (res.status === 'unresolved') continue; // never guess
    const key = norm(p.concept_name);
    if (!byChild.has(key)) byChild.set(key, { attribute: ATTRIBUTE, name: p.concept_name, parent_paths: [], _seen: new Set() });
    const acc = byChild.get(key);
    const pk = asArray(p.new_parent_path).map(norm).join('>');
    if (!acc._seen.has(pk)) { acc._seen.add(pk); acc.parent_paths.push(asArray(p.new_parent_path)); }
  }
  const concepts = [...byChild.values()].map(({ attribute, name, parent_paths }) => ({
    attribute, name, parent_paths, parent_path: [],
  }));
  return {
    generated_by: 'chaos/genesis/apply-krius.js (writable missing_placement edges, additive)',
    rubric_version: proposal.rubric_version || '0',
    graph_state: 'populated (additive multi-parent placement)',
    papers: [],
    concepts,
    links: [],
    tunnels: [],
  };
}

function writeTempProposals(obj) {
  fs.writeFileSync(TEMP_PROPOSALS, JSON.stringify(obj, null, 2), 'utf8');
}
function cleanupTemp() {
  try { if (fs.existsSync(TEMP_PROPOSALS)) fs.unlinkSync(TEMP_PROPOSALS); } catch { /* best effort */ }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const { proposal, placements } = loadPlacements();

  console.log('================ CHAOS — APPLY KRIUS PLACEMENTS ================');
  console.log(`source: ${path.relative(REPO_DIR, KRIUS_PROPOSAL_PATH)}  ·  rubric v${proposal.rubric_version || '?'}  ·  prompt ${proposal.krius_prompt_version || '?'}`);
  console.log(`mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'CONFIRM (real write — additive edges only)'}`);
  console.log(`writable placements selected: ${placements.length}  (advisory kinds ignored)`);
  if (SKIP.size) console.log(`--skip: ${[...SKIP].sort((a, b) => a - b).join(', ')}`);

  const { pool, host, database } = resolveDb();

  // Dev guard on the real write (read-only resolution does not need it).
  if (CONFIRM && !isDevDb(host, database)) {
    throw new Error(
      `--confirm refused by dev guard — resolved host="${host}" db="${database}". ` +
        'This is dev-only (localhost + concept_hierarchy, no DATABASE_URL).'
    );
  }

  // Read-only resolution against the live graph.
  const resolved = await resolveAll(pool, placements);
  const counts = printNumberedList(resolved);

  console.log(
    `\nSummary: ${counts.total} selected · ${counts.willAdd} would add · ${counts.noop} already exist (no-op) · ` +
      `${counts.unresolved} unresolved (skipped) · ${counts.skipped} skipped via --skip`
  );

  if (DRY_RUN) {
    console.log('\nDRY RUN COMPLETE — zero database operations performed (read-only resolution only).');
    console.log('To perform the real write (dev-only; apply.js takes a pg_dump backup first):');
    console.log('    node chaos/genesis/apply-krius.js --confirm   [--skip n,…]');
    return;
  }

  // ---- CONFIRM path: delegate the additive write (+ backup) to apply.js ----
  const applyProposals = buildApplyProposals(proposal, resolved);
  if (!applyProposals.concepts.length) {
    console.log('\nNothing to write (every placement is skipped, unresolved, or already exists). No backup, no write.');
    return;
  }
  console.log(`\n================ COMMITTING (delegating to apply.js) ================`);
  console.log(`DB: ${database} @ ${host}  (dev guard passed)`);
  console.log(`concepts in plan: ${applyProposals.concepts.length}  ·  additive parent edges only (no papers/links/tunnels/predictions)`);
  try {
    writeTempProposals(applyProposals);
    // apply.js takes its OWN pg_dump backup BEFORE its transaction and aborts (non-zero exit,
    // no write) if the backup fails. Inherit stdio so its "Backup: <path>" line streams through.
    const r = spawnSync('node', [APPLY_PATH, '--proposals', TEMP_PROPOSALS], { stdio: 'inherit', cwd: REPO_DIR });
    if (r.status !== 0) {
      throw new Error(`apply.js exited with status ${r.status}. Backup may have failed or the transaction rolled back; no rows were written.`);
    }
  } finally {
    cleanupTemp();
  }
  console.log('\nApply complete — additive multi-parent edges materialized via apply.js (idempotent).');
}

main()
  .then(() => {
    try {
      const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
      if (pool && typeof pool.end === 'function') return pool.end();
    } catch { /* ignore */ }
  })
  .then(() => { process.exitCode = 0; })
  .catch((err) => {
    cleanupTemp();
    console.error('\napply-krius.js failed:', err.message);
    try {
      const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
      if (pool && typeof pool.end === 'function') { pool.end().finally(() => { process.exitCode = 1; }); return; }
    } catch { /* ignore */ }
    process.exitCode = 1;
  });

module.exports = { loadPlacements, isDevDb, buildApplyProposals };
