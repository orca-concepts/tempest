#!/usr/bin/env node

/**
 * Chaos — grounding-LINK applier. Writes the new `concept_links` from a Gaia grounding proposal
 * (default chaos/genesis/gaia-multiattach-rejudge-proposal.json) into the LOCAL DEV graph as
 * ADDITIVE link rows, through apply.js's existing concept_links insert path.
 *
 * Additive-only: the target concepts (path-scoped) and the grounding papers ALREADY exist, so the
 * only rows CREATED are concept_links. The proposals object handed to apply.js carries the
 * synthesized concepts (so apply.js can materialize/register the path-scoped edges — all existing,
 * so getOrCreate is a no-op) and the referenced papers (idempotent upsert from their on-disk
 * records, 0 new rows — needed only so apply.js can attach paper_id to each link). apply.js's link
 * insert passes the article title through and attributes to chaos-seed-data, exactly as the cutover.
 *
 * Safety contract (mirrors chaos/genesis/apply-krius.js):
 *   - DRY RUN BY DEFAULT. --dry-run resolves read-only and prints a numbered would-add list,
 *     performing ZERO writes. The real write requires the explicit flag --confirm.
 *   - PATH-SCOPED RESOLUTION. Each link's target is resolved by concept name + FULL parent path
 *     against the LIVE graph. "Blinded under Honest › Disinterested" and "Blinded under Rigorous ›
 *     Controlled" are DISTINCT path-scoped concepts and resolve to their own edge. A link whose
 *     path-scoped concept or whose paper does NOT resolve is SKIPPED and reported — never
 *     mis-placed onto the wrong path.
 *   - IDEMPOTENT. apply.js skips a concept_link that already exists on the same (edge_id, url)
 *     key the cutover used, so re-applying is a no-op. The dry-run flags those as already-present.
 *   - BACKED UP BEFORE ANY WRITE. The real write delegates to apply.js, which takes a pg_dump
 *     backup BEFORE its transaction and aborts (non-zero exit, no write) if the backup fails.
 *   - EMPTY-GRAPH PRECONDITION BYPASSED. That guard lives in write.js (genesis), not apply.js;
 *     this additive append to a populated graph is the intended case.
 *   - DEV-DB GUARD. --confirm refuses anything that isn't the local dev DB.
 *   - ADDITIVE ONLY. Creates no concepts, edges, or papers; touches no dormant payload; removes
 *     or modifies no existing links.
 *
 * Stable numbering: every link gets a number 1..N in a deterministic order. The number printed in
 * --dry-run maps to the SAME link at --confirm time, so `--skip <n,…>` is reliable.
 *
 * Usage:
 *   node chaos/genesis/apply-links.js                 # dry run (default) — no DB writes
 *   node chaos/genesis/apply-links.js --file <path>   # apply a different grounding proposal
 *   node chaos/genesis/apply-links.js --skip 3,7      # exclude those numbered links
 *   node chaos/genesis/apply-links.js --confirm       # real write (dev-only; pg_dump first)
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const GENESIS_DIR = __dirname;
const CHAOS_DIR = path.join(GENESIS_DIR, '..');
const REPO_DIR = path.join(CHAOS_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const APPLY_PATH = path.join(CHAOS_DIR, 'apply.js');
// Temp proposals file fed to apply.js --proposals (gitignored; removed after the run).
const TEMP_PROPOSALS = path.join(GENESIS_DIR, '.links-apply.tmp.json');

const ATTRIBUTE = 'value'; // the single attribute domain (chaos.md §9)

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
const FILE = argValue('--file');
const PROPOSAL_PATH = FILE
  ? (path.isAbsolute(FILE) ? FILE : path.join(REPO_DIR, FILE))
  : path.join(GENESIS_DIR, 'gaia-multiattach-rejudge-proposal.json');
const SKIP = (() => {
  const raw = argValue('--skip');
  if (!raw) return new Set();
  return new Set(String(raw).split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0));
})();

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

function asArray(v) { return Array.isArray(v) ? v : []; }
function norm(s) { return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim(); }
function pathDisp(names) { const a = asArray(names); return a.length ? a.join(' › ') : '(root)'; }
function workIdOf(s) { const m = String(s || '').match(/W\d+/); return m ? m[0] : null; }

// ----------------------------------------------------------------------------
// Load + number the links deterministically.
// ----------------------------------------------------------------------------

function loadLinks() {
  if (!fs.existsSync(PROPOSAL_PATH)) {
    throw new Error(`grounding proposal not found at ${path.relative(REPO_DIR, PROPOSAL_PATH)}. Run the Gaia re-judge (--multiattach --rejudge-upgrades --run) first, or pass --file.`);
  }
  const proposal = JSON.parse(fs.readFileSync(PROPOSAL_PATH, 'utf8'));
  const links = asArray(proposal.links).filter((l) => l && l.concept_name && l.url && l.paper_id);
  // Deterministic order: concept, then path, then paper — stable across dry-run / confirm.
  links.sort((a, b) =>
    norm(a.concept_name).localeCompare(norm(b.concept_name)) ||
    norm(asArray(a.parent_path).join('>')).localeCompare(norm(asArray(b.parent_path).join('>'))) ||
    String(a.paper_id).localeCompare(String(b.paper_id)));
  links.forEach((l, i) => { l._n = i + 1; });
  return { proposal, links };
}

// ----------------------------------------------------------------------------
// DB: dev guard + read-only path-scoped resolution against the LIVE graph.
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

// Resolve ONE link to its path-scoped edge + grounding paper (READ-ONLY). Returns:
//   { status: 'unresolved', reason }
//   { status: 'exists',  edgeId, paperId }   — a concept_link with this (edge, url) already exists
//   { status: 'add',     edgeId, paperId }   — would insert this link
async function resolveLink(pool, valueAttrId, link) {
  const childRow = await pool.query('SELECT id FROM concepts WHERE LOWER(name) = $1 LIMIT 1', [norm(link.concept_name)]);
  if (!childRow.rows[0]) return { status: 'unresolved', reason: `concept "${link.concept_name}" not in graph` };
  const childId = childRow.rows[0].id;

  // Resolve every name in the parent path (root → parent) to a concept id — PATH-SCOPED.
  const pathIds = [];
  for (const name of asArray(link.parent_path)) {
    const r = await pool.query('SELECT id FROM concepts WHERE LOWER(name) = $1 LIMIT 1', [norm(name)]);
    if (!r.rows[0]) return { status: 'unresolved', reason: `path concept "${name}" not in graph` };
    pathIds.push(r.rows[0].id);
  }
  const parentId = pathIds.length ? pathIds[pathIds.length - 1] : null;
  const graphPath = pathIds; // edges.graph_path is root-to-parent inclusive == the parent_path ids

  let edge;
  if (parentId == null) {
    edge = await pool.query(
      `SELECT id FROM edges WHERE parent_id IS NULL AND child_id=$1 AND attribute_id=$2 AND graph_path=$3::int[] LIMIT 1`,
      [childId, valueAttrId, graphPath]);
  } else {
    edge = await pool.query(
      `SELECT id FROM edges WHERE parent_id=$1 AND child_id=$2 AND attribute_id=$3 AND graph_path=$4::int[] LIMIT 1`,
      [parentId, childId, valueAttrId, graphPath]);
  }
  if (!edge.rows[0]) return { status: 'unresolved', reason: `no path-scoped edge for ${link.concept_name} @ ${pathDisp(link.parent_path)}` };
  const edgeId = edge.rows[0].id;

  // Resolve the grounding paper by its OpenAlex work id — it must already exist.
  const w = workIdOf(link.paper_id);
  if (!w) return { status: 'unresolved', reason: `unparseable paper id "${link.paper_id}"` };
  const paper = await pool.query(`SELECT id FROM papers WHERE openalex_id LIKE '%' || $1 LIMIT 1`, [w]);
  if (!paper.rows[0]) return { status: 'unresolved', reason: `paper ${w} not in graph` };
  const paperId = paper.rows[0].id;

  // Idempotency: same (edge_id, url) already present? (the cutover's uniqueness check)
  const exists = await pool.query('SELECT id FROM concept_links WHERE edge_id=$1 AND LOWER(url)=LOWER($2) LIMIT 1', [edgeId, link.url]);
  if (exists.rows[0]) return { status: 'exists', edgeId, paperId };
  return { status: 'add', edgeId, paperId };
}

async function resolveAll(pool, links) {
  const attr = await pool.query('SELECT id FROM attributes WHERE name = $1 LIMIT 1', [ATTRIBUTE]);
  if (!attr.rows[0]) throw new Error(`attribute "${ATTRIBUTE}" not found in the graph.`);
  const valueAttrId = attr.rows[0].id;
  const out = [];
  for (const link of links) out.push({ link, res: await resolveLink(pool, valueAttrId, link) });
  return out;
}

// ----------------------------------------------------------------------------
// Numbered would-add report.
// ----------------------------------------------------------------------------

function printNumberedList(resolved) {
  console.log('\nNumbered grounding links (concept @ path ← paper):');
  let willAdd = 0;
  let noop = 0;
  let unresolved = 0;
  let skipped = 0;
  for (const { link, res } of resolved) {
    const n = link._n;
    const isSkipped = SKIP.has(n);
    let tag;
    if (res.status === 'unresolved') { tag = `UNRESOLVED — ${res.reason} → SKIP`; unresolved += 1; }
    else if (res.status === 'exists') { tag = 'already present → no-op'; noop += 1; }
    else { tag = 'would ADD'; }
    if (isSkipped) { tag = `SKIPPED (--skip) [${tag}]`; skipped += 1; }
    else if (res.status === 'add') { willAdd += 1; }
    const flag = isSkipped ? '·' : (res.status === 'add' ? '+' : (res.status === 'exists' ? '=' : '!'));
    console.log(`  #${String(n).padStart(2)} ${flag} ${link.concept_name} @ ${pathDisp(link.parent_path)} ← ${link.paper_id}  [${tag}]`);
  }
  return { willAdd, noop, unresolved, skipped, total: resolved.length };
}

// ----------------------------------------------------------------------------
// Build the apply.js proposals object. Synthesized concepts let apply.js register the path-scoped
// edges (all existing → getOrCreate no-op); the referenced papers let it attach paper_id (idempotent
// upsert, 0 new rows). Only the links are net-new. Skipped / unresolved links are excluded.
// ----------------------------------------------------------------------------

function buildApplyProposals(proposal, resolved) {
  const conceptByName = new Map();
  const links = [];
  const wids = new Set();
  for (const { link, res } of resolved) {
    if (SKIP.has(link._n)) continue;
    if (res.status === 'unresolved') continue; // never mis-place
    const key = norm(link.concept_name);
    if (!conceptByName.has(key)) conceptByName.set(key, { attribute: ATTRIBUTE, name: link.concept_name, parent_paths: [], parent_path: [], _seen: new Set() });
    const acc = conceptByName.get(key);
    const pk = asArray(link.parent_path).map(norm).join('>');
    if (!acc._seen.has(pk)) { acc._seen.add(pk); acc.parent_paths.push(asArray(link.parent_path)); }
    links.push({ attribute: ATTRIBUTE, concept_name: link.concept_name, parent_path: asArray(link.parent_path), url: link.url, claim: link.claim, paper_id: link.paper_id });
    if (workIdOf(link.paper_id)) wids.add(workIdOf(link.paper_id));
  }
  const concepts = [...conceptByName.values()].map(({ attribute, name, parent_paths, parent_path }) => ({ attribute, name, parent_paths, parent_path }));
  const papers = asArray(proposal.papers).filter((p) => wids.has(workIdOf(p.id)));
  return {
    generated_by: 'chaos/genesis/apply-links.js (additive concept_links from grounding proposal)',
    rubric_version: proposal.rubric_version || '0',
    graph_state: 'populated (additive concept_links append)',
    papers,
    concepts,
    links,
    tunnels: [],
  };
}

function writeTempProposals(obj) { fs.writeFileSync(TEMP_PROPOSALS, JSON.stringify(obj, null, 2), 'utf8'); }
function cleanupTemp() { try { if (fs.existsSync(TEMP_PROPOSALS)) fs.unlinkSync(TEMP_PROPOSALS); } catch { /* best effort */ } }

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const { proposal, links } = loadLinks();

  console.log('================ CHAOS — APPLY GROUNDING LINKS ================');
  console.log(`source: ${path.relative(REPO_DIR, PROPOSAL_PATH)}`);
  console.log(`mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'CONFIRM (real write — additive concept_links only)'}`);
  console.log(`links in proposal: ${links.length}`);
  if (SKIP.size) console.log(`--skip: ${[...SKIP].sort((a, b) => a - b).join(', ')}`);

  const { pool, host, database } = resolveDb();
  if (CONFIRM && !isDevDb(host, database)) {
    throw new Error(`--confirm refused by dev guard — resolved host="${host}" db="${database}". This is dev-only (localhost + concept_hierarchy, no DATABASE_URL).`);
  }

  const resolved = await resolveAll(pool, links);
  const counts = printNumberedList(resolved);
  console.log(
    `\nSummary: ${counts.total} links · ${counts.willAdd} would add · ${counts.noop} already present (no-op) · ` +
      `${counts.unresolved} unresolved (skipped) · ${counts.skipped} skipped via --skip`);

  if (DRY_RUN) {
    console.log('\nDRY RUN COMPLETE — zero database operations performed (read-only resolution only).');
    console.log('To perform the real write (dev-only; apply.js takes a pg_dump backup first):');
    console.log('    node chaos/genesis/apply-links.js --confirm   [--skip n,…]');
    return;
  }

  // ---- CONFIRM path: delegate the additive link write (+ backup) to apply.js ----
  const applyProposals = buildApplyProposals(proposal, resolved);
  if (!applyProposals.links.length) {
    console.log('\nNothing to write (every link is skipped, unresolved, or already present). No backup, no write.');
    return;
  }
  console.log('\n================ COMMITTING (delegating to apply.js) ================');
  console.log(`DB: ${database} @ ${host}  (dev guard passed)`);
  console.log(`concept_links to add: ${applyProposals.links.length}  ·  concepts/papers in plan are existing → no-op (only links are net-new)`);
  try {
    writeTempProposals(applyProposals);
    // apply.js takes its OWN pg_dump backup BEFORE its transaction and aborts (non-zero exit, no
    // write) if the backup fails. Inherit stdio so its "Backup: <path>" line + per-table CREATED
    // counts stream through (expect concepts 0 · edges 0 · papers 0 · concept_links = added).
    const r = spawnSync('node', [APPLY_PATH, '--proposals', TEMP_PROPOSALS], { stdio: 'inherit', cwd: REPO_DIR });
    if (r.status !== 0) {
      throw new Error(`apply.js exited with status ${r.status}. Backup may have failed or the transaction rolled back; no rows were written.`);
    }
  } finally {
    cleanupTemp();
  }
  console.log('\nApply complete — additive concept_links materialized via apply.js (idempotent).');
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
    console.error('\napply-links.js failed:', err.message);
    try {
      const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
      if (pool && typeof pool.end === 'function') { pool.end().finally(() => { process.exitCode = 1; }); return; }
    } catch { /* ignore */ }
    process.exitCode = 1;
  });

module.exports = { loadLinks, isDevDb, buildApplyProposals };
