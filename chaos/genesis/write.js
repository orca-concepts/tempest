#!/usr/bin/env node

/**
 * Chaos — genesis WRITER (Build 2). Materializes the reviewed genesis taxonomy
 * (chaos/genesis/proposal.json) into the LOCAL DEV graph as concepts + parent edges,
 * including the headline capability the old pipeline never exercised: the SAME
 * value-kind under MULTIPLE parents as distinct contextual entities (path-dependent
 * identity, chaos.md §8).
 *
 * It is a faithful MATERIALIZER — it makes no content decisions (no adding, dropping,
 * renaming, or re-parenting; whatever is in proposal.json is what lands).
 *
 * REUSE, NOT REIMPLEMENTATION: the actual concept + multi-parent edge writing is done
 * by chaos/apply.js's proven, idempotent writers (getOrCreateConcept / materializeChain),
 * driven through apply.js's existing `--proposals <file>` override. This writer
 * transforms the genesis `nodes` shape into the proposals shape apply.js consumes
 * (adding the implied `attribute: "value"`, chaos.md §9), then delegates. apply.js is
 * NOT modified.
 *
 * Safety:
 *   - DRY RUN BY DEFAULT. With no flag it prints the full plan + an apply.js dry-run
 *     cross-check and performs ZERO database operations. The real write requires the
 *     explicit flag  --commit.
 *   - EMPTY-GRAPH PRECONDITION. Genesis assumes an empty graph (chaos.md §9, §11).
 *     --commit refuses if the graph already contains concepts/edges and tells you to
 *     snapshot + clear first (a separate, deliberate step — NOT this script's job).
 *   - DEV-DB GUARD. --commit refuses anything that isn't the local dev DB.
 *   - APPEND-ONLY. The genesis proposal carries no papers/links/tunnels/predictions,
 *     so apply.js only ever INSERTs concepts + edges (it never updates/deletes them).
 *     apply.js also takes a pg_dump backup before its transaction.
 *
 * NOT WRITTEN THIS BUILD (deliberately out of scope — see TODOs in the plan output):
 *   - conduct  → the concepts table has NO descriptive/body column (it is
 *     (id, name, created_by, created_at)); conduct has no destination field. It is
 *     reported, never silently dropped, and never shoehorned into a link comment.
 *   - frontiers / basis → carried in the proposal; first-class frontiers likely need
 *     schema and get their own build.
 *   - role (skeleton/hook) → no display field exists; deferred to a later display pass.
 *   - instantiation (papers, concept→paper links) → the Instantiator, a later build.
 *
 * Usage:
 *   node chaos/genesis/write.js                 # dry run (default) — no DB writes
 *   node chaos/genesis/write.js --commit        # real write (dev-only, empty graph only)
 *   node chaos/genesis/write.js --proposal=path/to/proposal.json
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
const TEMP_PROPOSALS = path.join(GENESIS_DIR, '.genesis-apply.tmp.json');

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + '='));
  return a ? a.split('=').slice(1).join('=') : null;
}
const COMMIT = process.argv.includes('--commit');
const PROPOSAL_PATH = argValue('--proposal') || path.join(GENESIS_DIR, 'proposal.json');

// The single attribute domain (chaos.md §9). Genesis nodes carry no `attribute` field;
// it is implied and added at transform time so apply.js can resolve the attribute id.
const ATTRIBUTE = 'value';

// dotenv + pool, same as apply.js. Requiring the pool does NOT open a connection — the
// first query does — so a pure dry-run plan still prints if the DB is down.
require(require.resolve('dotenv', { paths: [BACKEND_DIR] })).config({
  path: path.join(BACKEND_DIR, '.env'),
});

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function norm(s) {
  return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim();
}
function pathKey(arr) {
  return asArray(arr).map(norm).join(' > ');
}

// Normalize a proposal node to the shape this writer reasons about. parent_paths is
// coerced to string[][] (a single flat path is wrapped; root => []). Mirrors the
// normalization in categorizer.js / validate.js so a hand-edited proposal is tolerated.
function normalizeNodes(data) {
  return asArray(data.nodes)
    .filter((n) => n && typeof n.name === 'string' && n.name.trim())
    .map((n) => {
      let pp = n.parent_paths;
      if (pp == null) pp = [];
      else if (Array.isArray(pp) && pp.length && !Array.isArray(pp[0])) pp = [pp];
      pp = asArray(pp).map((p) => asArray(p).map(String)).filter((p) => p.length);
      return {
        name: n.name.trim(),
        role: n.role === 'skeleton' ? 'skeleton' : 'hook',
        conduct: typeof n.conduct === 'string' ? n.conduct.trim() : '',
        parent_paths: pp,
        basis: typeof n.basis === 'string' ? n.basis : '',
        frontiers: asArray(n.frontiers).map(String).filter((f) => f.trim()),
      };
    });
}

// ----------------------------------------------------------------------------
// Build the genesis-specific write plan (concepts + chains + edges), mirroring the
// chain/edge derivation in apply.js so the reported counts match what apply.js writes.
// ----------------------------------------------------------------------------

function buildPlan(nodes) {
  const nameSet = new Set(nodes.map((n) => norm(n.name)));

  // One chain per parent_path; a root (no parent_paths) yields one chain [name].
  // names = [...parentPath, leafName] — exactly apply.js's chain shape.
  const chains = [];
  const dangling = new Set(); // parent_path names that are not themselves nodes
  for (const n of nodes) {
    const paths = n.parent_paths.length ? n.parent_paths : [[]];
    for (const pp of paths) {
      chains.push({ leaf: n.name, names: [...pp, n.name] });
      for (const anc of pp) if (!nameSet.has(norm(anc))) dangling.add(anc);
    }
  }

  // Distinct concepts and distinct edges the chains imply (apply.js's edgeKey logic).
  const conceptNames = new Set();
  const edgeKeys = new Set();
  let rootEdges = 0;
  for (const ch of chains) {
    for (let j = 0; j < ch.names.length; j++) {
      conceptNames.add(norm(ch.names[j]));
      const parent = j === 0 ? '∅' : norm(ch.names[j - 1]);
      const pathNames = ch.names.slice(0, j).map(norm).join('>');
      const key = `${ATTRIBUTE}|${parent}|${norm(ch.names[j])}|${pathNames}`;
      if (!edgeKeys.has(key) && j === 0) rootEdges += 1;
      edgeKeys.add(key);
    }
  }

  const multiParent = nodes.filter((n) => n.parent_paths.length > 1);
  const withConduct = nodes.filter((n) => n.conduct);
  const withFrontiers = nodes.filter((n) => n.frontiers.length);

  return {
    nodes,
    chains,
    conceptNames,
    edgeKeys,
    rootEdges,
    childEdges: edgeKeys.size - rootEdges,
    multiParent,
    withConduct,
    withFrontiers,
    dangling: [...dangling],
  };
}

// Transform genesis nodes -> the proposals shape apply.js consumes. Faithful: adds the
// implied attribute, carries parent_paths (multi-parent) verbatim, and includes NOTHING
// else (no papers/links/tunnels/predictions => apply.js inserts only concepts + edges).
// conduct/basis/frontiers/role are intentionally omitted — apply.js has no destination
// for them (see the file header).
function toApplyProposals(nodes, proposal) {
  return {
    generated_by: 'chaos/genesis/write.js (transformed from genesis proposal.json)',
    rubric_version: proposal.rubric_version || '0',
    graph_state: 'empty (genesis)',
    papers: [],
    concepts: nodes.map((n) => ({
      attribute: ATTRIBUTE,
      name: n.name,
      // parent_paths drives apply.js's multi-parent chain materialization; parent_path
      // [] is the single-parent fallback apply.js reads for a root (parent_paths empty).
      parent_paths: n.parent_paths,
      parent_path: [],
    })),
    links: [],
    tunnels: [],
  };
}

// ----------------------------------------------------------------------------
// DB: dev guard + empty-graph precondition (read-only)
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
    } catch {
      host = '(unparseable)';
      database = '(unknown)';
    }
  } else {
    host = o.host || 'localhost';
    database = o.database || 'concept_hierarchy';
  }
  return { pool, host, database };
}

// Mirrors apply.js's assertDevDb — genesis must never touch production.
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

// Returns { concepts, edges } or null if the DB could not be read. Read-only.
async function readGraphState(pool) {
  try {
    const c = await pool.query('SELECT COUNT(*)::int AS n FROM concepts');
    const e = await pool.query('SELECT COUNT(*)::int AS n FROM edges');
    return { concepts: c.rows[0].n, edges: e.rows[0].n };
  } catch {
    return null;
  }
}

// ----------------------------------------------------------------------------
// Plan printing
// ----------------------------------------------------------------------------

function printPlan(plan, proposal, graphState) {
  console.log('================ CHAOS GENESIS WRITER — PLAN ================');
  console.log(`source: ${path.relative(REPO_DIR, PROPOSAL_PATH)}  ·  rubric v${proposal.rubric_version || '?'}  ·  domain [${ATTRIBUTE}]`);
  console.log(`mode: ${COMMIT ? 'COMMIT (real write)' : 'DRY RUN (no DB writes)'}`);
  console.log('');
  console.log('PLAN — rows that WOULD be inserted (concepts + edges only; append-only):');
  console.log(`  concepts (distinct value-kinds) ... ${plan.conceptNames.size}`);
  console.log(`  parent edges (distinct) ........... ${plan.edgeKeys.size}   (root edges ${plan.rootEdges} · child edges ${plan.childEdges})`);
  console.log(`  total placements (chains) ......... ${plan.chains.length}`);
  console.log(`  multi-parent nodes (>1 parent) .... ${plan.multiParent.length}   (each becomes that many path-dependent placements)`);
  console.log('');
  console.log('CONDUCT-FIELD MAPPING (chaos.md §1 lived rendering):');
  console.log(`  conduct → (NO DESTINATION FIELD)   ${plan.withConduct.length}/${plan.nodes.length} nodes carry conduct`);
  console.log('    The concepts table is (id, name, created_by, created_at) — no description/body column.');
  console.log('    Conduct is NOT written this build and is NOT shoehorned into a link comment. SCHEMA DECISION NEEDED.');
  console.log('');
  console.log('CARRIED BUT NOT WRITTEN (deliberately out of scope this build):');
  console.log(`  frontiers ... ${plan.withFrontiers.length} nodes carry ≥1 — TODO: first-class frontier objects (likely need schema; own build).`);
  console.log('  basis ....... carried per node — not written (citeability metadata; future).');
  console.log('  role ........ skeleton/hook — no display field exists; TODO: later display pass.');
  console.log('');
  console.log('CONSUMER SAFETY (investigated — readers handle this):');
  console.log('  multi-parent: SAFE. edges UNIQUE(parent_id,child_id,graph_path,attribute_id) allows the same');
  console.log('    child under many parents; getConceptParents returns all parent edges; FlipView renders them');
  console.log('    as first-class alternate contexts. No single-parent assumption found.');
  console.log('  name-only concepts: NORMAL. No reader expects a concept body; concept pages render by name.');
  console.log('');

  // Graph-state precondition
  console.log('EMPTY-GRAPH PRECONDITION (genesis assumes an empty graph — chaos.md §9/§11):');
  if (!graphState) {
    console.log('  graph state: UNAVAILABLE (could not read the DB).');
  } else {
    const empty = graphState.concepts === 0 && graphState.edges === 0;
    console.log(`  current graph: ${graphState.concepts} concepts · ${graphState.edges} edges → ${empty ? 'EMPTY ✓' : 'NON-EMPTY ✗'}`);
    if (!empty) {
      console.log('  A real write (--commit) will REFUSE until the graph is snapshotted and cleared');
      console.log('    (snapshot: node chaos/snapshot.js · clear: node chaos/clear.js — a separate, deliberate step).');
    }
  }
  console.log('');

  // Dangling parents (should be none — proposal validated). Surface if present.
  if (plan.dangling.length) {
    console.log('!! DANGLING PARENT REFERENCES (a parent_path names a node not in the proposal):');
    for (const d of plan.dangling) console.log(`   - ${d}`);
    console.log('   apply.js would auto-create these as concepts; investigate before committing.');
    console.log('');
  }

  // A few example multi-parent placements so path-dependent identity is visible.
  console.log('EXAMPLE MULTI-PARENT PLACEMENTS (same value-kind, distinct contextual entities):');
  for (const n of plan.multiParent.slice(0, 4)) {
    console.log(`  • "${n.name}"`);
    for (const pp of n.parent_paths) {
      console.log(`      under: ${pp.join(' › ')}`);
    }
  }
  console.log('============================================================');
}

// ----------------------------------------------------------------------------
// apply.js delegation
// ----------------------------------------------------------------------------

function writeTempProposals(nodes, proposal) {
  fs.writeFileSync(TEMP_PROPOSALS, JSON.stringify(toApplyProposals(nodes, proposal), null, 2), 'utf8');
}
function cleanupTemp() {
  try {
    if (fs.existsSync(TEMP_PROPOSALS)) fs.unlinkSync(TEMP_PROPOSALS);
  } catch {
    /* best effort */
  }
}

// Spawn apply.js against the transformed temp proposals. extraArgs e.g. ['--dry-run'].
function runApply(extraArgs) {
  const args = [APPLY_PATH, '--proposals', TEMP_PROPOSALS, ...extraArgs];
  return spawnSync('node', args, { encoding: 'utf8', cwd: REPO_DIR });
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  if (!fs.existsSync(PROPOSAL_PATH)) {
    throw new Error(`proposal not found at ${PROPOSAL_PATH}. Run chaos/categorizer.js first.`);
  }
  const proposal = JSON.parse(fs.readFileSync(PROPOSAL_PATH, 'utf8'));
  const nodes = normalizeNodes(proposal);
  if (!nodes.length) throw new Error('proposal.json has no usable nodes.');
  const plan = buildPlan(nodes);

  // Read-only graph-state check (best effort in dry run; enforced in commit below).
  let graphState = null;
  let dbInfo = null;
  try {
    dbInfo = resolveDb();
    if (COMMIT && !isDevDb(dbInfo.host, dbInfo.database)) {
      throw new Error(
        `--commit refused by dev guard — resolved host="${dbInfo.host}" db="${dbInfo.database}". ` +
          'Genesis writes are dev-only (localhost + concept_hierarchy, no DATABASE_URL).'
      );
    }
    graphState = await readGraphState(dbInfo.pool);
  } catch (err) {
    if (COMMIT) throw err; // a commit must not proceed past a guard failure
    // dry run: tolerate a DB that is down / misconfigured; the plan is file-derived.
    console.warn(`(note) graph-state check skipped: ${err.message}\n`);
  }

  printPlan(plan, proposal, graphState);

  if (!COMMIT) {
    // Dry run: prove the apply.js reuse wiring with apply.js's OWN dry run (no DB writes).
    console.log('\n---- apply.js cross-check (its dry-run plan over the transformed proposal; no writes) ----');
    try {
      writeTempProposals(nodes, proposal);
      const r = runApply(['--dry-run']);
      process.stdout.write(r.stdout || '');
      if (r.status !== 0) {
        process.stderr.write(r.stderr || '');
        console.log('(cross-check could not complete — see stderr above; the genesis plan above stands.)');
      }
    } catch (e) {
      console.log(`(cross-check skipped: ${e.message})`);
    } finally {
      cleanupTemp();
    }

    console.log('\nDRY RUN COMPLETE — zero database operations performed.');
    console.log('To perform the real write (dev-only, requires an EMPTY graph):');
    console.log('    node chaos/genesis/write.js --commit');
    if (dbInfo) console.log('(First snapshot + clear the current graph if it is non-empty: node chaos/snapshot.js ; node chaos/clear.js)');
    return;
  }

  // ---- COMMIT path ----
  if (!graphState) {
    throw new Error('cannot verify the empty-graph precondition (DB unreadable) — refusing to write.');
  }
  if (graphState.concepts !== 0 || graphState.edges !== 0) {
    throw new Error(
      `empty-graph precondition FAILED — graph has ${graphState.concepts} concept(s) and ${graphState.edges} edge(s). ` +
        'Genesis requires an empty graph. Snapshot then clear first: node chaos/snapshot.js ; node chaos/clear.js — then re-run --commit.'
    );
  }

  console.log('\n================ COMMITTING (delegating to apply.js) ================');
  console.log(`DB: ${dbInfo.database} @ ${dbInfo.host}  (dev guard passed; graph empty)`);
  try {
    writeTempProposals(nodes, proposal);
    // apply.js takes its own pg_dump backup, writes in one transaction, and refreshes
    // the snapshot. Inherit stdio so its output streams through.
    const r = spawnSync('node', [APPLY_PATH, '--proposals', TEMP_PROPOSALS], {
      stdio: 'inherit',
      cwd: REPO_DIR,
    });
    if (r.status !== 0) {
      throw new Error(`apply.js exited with status ${r.status}. The transaction rolled back; no rows were written.`);
    }
  } finally {
    cleanupTemp();
  }
  console.log('\nGenesis write complete (concepts + edges materialized via apply.js).');
  console.log('NOTE: conduct, frontiers, basis, and role were NOT written (see plan above).');
}

main()
  .then(() => {
    // resolveDb() memoizes the backend pool; close it so the event loop drains.
    try {
      const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
      if (pool && typeof pool.end === 'function') return pool.end();
    } catch {
      /* ignore */
    }
  })
  .then(() => {
    process.exitCode = 0;
  })
  .catch((err) => {
    cleanupTemp();
    console.error('\nwrite.js failed:', err.message);
    try {
      const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
      if (pool && typeof pool.end === 'function') {
        pool.end().finally(() => {
          process.exitCode = 1;
        });
        return;
      }
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  });

module.exports = { normalizeNodes, buildPlan, toApplyProposals, isDevDb };
