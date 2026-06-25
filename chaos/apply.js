#!/usr/bin/env node

/**
 * Chaos — apply layer (Stage 5). Writes the reviewed proposals
 * (chaos/proposals.json) into the LOCAL DEV database, attributed to the
 * chaos-seed account. This is the FIRST Chaos stage that writes to the DB.
 *
 * Safety contract:
 *   - pg_dump backup to backups/ BEFORE any write; abort if it fails.
 *   - One transaction; rolls back on any error.
 *   - Idempotent: re-running creates zero new rows and raises no constraint
 *     errors (concepts/edges reused, links/tunnels deduped,
 *     predictions upserted-if-changed, ledger events guarded per run_id).
 *   - --dry-run prints the complete write plan and exits WITHOUT a backup or a
 *     write transaction.
 *
 * Attribution: the seed account is resolved at runtime by username='chaos-seed'
 * (NEVER hardcoded). created_by / added_by point at that id.
 *
 * READ-ONLY w.r.t. production: connects only to the LOCAL dev DB via the backend
 * pool config (same as the other chaos scripts). No schema changes, no reasoning.
 *
 * Usage:
 *   node chaos/apply.js --dry-run
 *   node chaos/apply.js
 *   node chaos/apply.js --recompute-precision   # dev-only guarded precision backfill
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const CHAOS_DIR = __dirname;
const REPO_DIR = path.join(CHAOS_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PAPERS_DIR = path.join(CHAOS_DIR, 'papers');
const BACKUPS_DIR = path.join(REPO_DIR, 'backups');
// Run-identity sidecar written after a successful apply so chaos/record-run.js can link
// the episodic record to the DB rows this run wrote (apply's hash run_id + applied counts).
const LAST_APPLY_PATH = path.join(CHAOS_DIR, 'last-apply.json');

const DRY_RUN = process.argv.includes('--dry-run');
const SEED_USERNAME = 'chaos-seed-data';

// Optional fixture override: `--proposals <path>` (or `--proposals=<path>`) lets a
// test run a small self-contained apply without disturbing chaos/proposals.json.
function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  const pre = process.argv.find((a) => a.startsWith(`${flag}=`));
  return pre ? pre.slice(flag.length + 1) : null;
}
const PROPOSALS_PATH = argValue('--proposals') || path.join(CHAOS_DIR, 'proposals.json');

require(require.resolve('dotenv', { paths: [BACKEND_DIR] })).config({
  path: path.join(BACKEND_DIR, '.env'),
});
const pool = require(path.join(BACKEND_DIR, 'src', 'config', 'database'));
// Reuse the backend's mention parser so Chaos-written restructure-mention addenda
// are indexed exactly like user-written ones (Phase 65b). Same grammar, one source.
const { parseMentions } = require(path.join(BACKEND_DIR, 'src', 'utils', 'parseMentions'));
// Shared P16 precision curve — same source of truth reason.js uses. apply.js feeds it
// the ACCUMULATED evidence (all runs) so the stored precision is authoritative.
const { TARGETED_WEIGHT, precisionFromEvidence } = require(path.join(CHAOS_DIR, 'precision'));

// --recompute-precision: dev-only guarded backfill that recomputes precision for ALL
// existing targets from their accumulated events (repairs values clobbered by the old
// per-run overwrite). Runs instead of a normal apply. See recomputeAllPrecision().
const RECOMPUTE_PRECISION = process.argv.includes('--recompute-precision');

// Accumulated precision (Option A / P16): a target's precision computed from its FULL
// confirmation-event history (chaos_prediction_events), not just the current run's
// proposal. Distinct grounding papers each weighted by provenance (independent/unknown
// = 1.0, targeted = TARGETED_WEIGHT), scaled by discipline diversity from
// papers.discipline_tags. Same curve as reason.js (shared precision module), so this
// value rises monotonically with recurrence (both read the same accumulated events).
async function accumulatedPrecisionFromEvents(client, targetType, targetId) {
  const { rows } = await client.query(
    `SELECT e.paper_id, e.provenance, pp.discipline_tags
       FROM chaos_prediction_events e
       LEFT JOIN papers pp ON pp.id = e.paper_id
      WHERE e.target_type = $1 AND e.target_id = $2 AND e.event = 'confirmed'`,
    [targetType, targetId]
  );
  const byPaper = new Map(); // distinct grounding paper_id -> { nonTargeted }
  const disciplines = new Set();
  let confirmedCount = 0;
  for (const r of rows) {
    confirmedCount += 1;
    for (const d of asArray(r.discipline_tags)) disciplines.add(d);
    if (r.paper_id == null) continue;
    if (!byPaper.has(r.paper_id)) byPaper.set(r.paper_id, { nonTargeted: false });
    // A paper confirmed independently (or unknown-provenance) in ANY run is full weight.
    if (r.provenance !== 'targeted') byPaper.get(r.paper_id).nonTargeted = true;
  }
  let weighted = 0;
  for (const rec of byPaper.values()) weighted += rec.nonTargeted ? 1.0 : TARGETED_WEIGHT;
  // Confirmed events with no paper_id still attest the target; fall back to the event
  // count so precision never under-reports (mirrors reason.js's recurrence fallback).
  if (weighted === 0) weighted = confirmedCount;
  return precisionFromEvidence(weighted, disciplines.size);
}

// Dev guard for the destructive backfill — refuse anything that isn't the local dev DB
// (mirrors the reset/check scripts: localhost + concept_hierarchy, no DATABASE_URL, no
// production markers). Returns { host, database } or throws to abort.
function assertDevDb(action) {
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
  const PROD = ['switchback.proxy.rlwy.net', 'rlwy.net', 'railway'];
  const marked = (s) => PROD.some((m) => String(s || '').toLowerCase().includes(m));
  if (
    process.env.DATABASE_URL ||
    marked(host) ||
    !['localhost', '127.0.0.1'].includes(String(host)) ||
    String(database) !== 'concept_hierarchy'
  ) {
    throw new Error(
      `${action} refused by dev guard — resolved host="${host}" db="${database}". ` +
        'This is dev-only: requires localhost/127.0.0.1 + concept_hierarchy via discrete DB_* vars (no DATABASE_URL, no production markers).'
    );
  }
  return { host, database };
}

// Part C — historical correction. Recompute precision for EVERY existing target from its
// accumulated events (same computation as the live apply pass), repairing values the old
// per-run overwrite clobbered. Guarded (dev-only), idempotent, backed up before writing.
async function recomputeAllPrecision() {
  const { host, database } = assertDevDb('--recompute-precision');
  console.log('============ CHAOS — RECOMPUTE PRECISION (dev backfill, Option A) ============');
  console.log(`DB: ${database} @ ${host}`);
  backup(); // pg_dump before any write; aborts on failure
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const concepts = (await client.query(
      `SELECT target_id FROM chaos_predictions WHERE target_type = 'concept'`
    )).rows;
    let cChanged = 0;
    for (const r of concepts) {
      const acc = await accumulatedPrecisionFromEvents(client, 'concept', r.target_id);
      const u = await client.query(
        `UPDATE chaos_predictions SET precision = $1, updated_at = NOW()
          WHERE target_type = 'concept' AND target_id = $2 AND precision IS DISTINCT FROM $1`,
        [acc, r.target_id]
      );
      cChanged += u.rowCount;
    }
    await client.query('COMMIT');
    console.log(`Recomputed: ${concepts.length} concept target(s), ${cChanged} changed.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------------
// Helpers (URL/identity normalization mirrors chaos/source.js)
// ----------------------------------------------------------------------------

function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function norm(s) {
  return String(s || '').toLowerCase().trim();
}
function sig(attribute, name) {
  return `${attribute}|${norm(name)}`;
}
// Normalized parent-path key (root-to-parent), used to address a specific edge of
// a multi-parent concept (P15) — mirrors reason.js normPathKey.
function pathKeyOf(names) {
  return asArray(names).map(norm).join(' > ');
}
// A concept may carry a single parent_path (string[]) or, for multi-parent
// placement (P15), parent_paths (string[][]) — one path per parent context, each
// materialized as its own edge. Normalize to a list of paths (always >= 1).
function parentPathsOf(c) {
  if (Array.isArray(c.parent_paths) && c.parent_paths.length) return c.parent_paths.map(asArray);
  return [asArray(c.parent_path)];
}
function normalizeUrl(u) {
  if (!u) return null;
  try {
    let s = String(u).trim().toLowerCase();
    s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
    return s || null;
  } catch {
    return null;
  }
}
function arxivIdFromDoi(doi) {
  const m = String(doi || '').toLowerCase().match(/10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/);
  return m ? m[1] : null;
}
// The OpenAlex work id (the 'W…' token), extracted from a short id, a full
// openalex URL, or a proposals reference. Returns null for non-openalex strings
// (e.g. a DOI URL) — used so apply resolves every paper reference by openalex_id only.
function workIdOf(s) {
  const m = String(s || '').match(/W\d+/);
  return m ? m[0] : null;
}
// FNV-1a — derive a stable run_id from the proposals content so re-running the
// SAME file is idempotent (same run_id → ledger events are not re-appended), while
// a regenerated proposals.json is a genuinely new observation round.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// ----------------------------------------------------------------------------
// Load proposals + the referenced paper files; build the pure write PLAN
// ----------------------------------------------------------------------------

function loadProposals() {
  return JSON.parse(fs.readFileSync(PROPOSALS_PATH, 'utf8'));
}

function loadPaperRec(shortId) {
  const p = path.join(PAPERS_DIR, `${shortId}.json`);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function buildPlan(proposals) {
  const runId = `reason-v${proposals.rubric_version || '0'}-${fnv1a(JSON.stringify(proposals))}`;
  const unmapped = [];

  // --- papers (every paper the run used) ---
  const papers = [];
  const byShort = new Map(); // shortId -> rec
  const openalexInCorpus = new Set(); // full openalex urls present in the corpus
  for (const p of asArray(proposals.papers)) {
    const rec = loadPaperRec(p.id);
    if (!rec) {
      unmapped.push(`paper file missing for ${p.id} (referenced in proposals.papers)`);
      continue;
    }
    papers.push(rec);
    byShort.set(p.id, rec);
    if (rec.openalex_id) openalexInCorpus.add(rec.openalex_id);
  }

  // --- paper_citations: within-corpus (citing → cited) pairs ---
  const citations = [];
  for (const rec of papers) {
    for (const ref of asArray(rec.referenced_works)) {
      if (openalexInCorpus.has(ref) && ref !== rec.openalex_id) {
        citations.push({ citing: rec.openalex_id, cited: ref });
      }
    }
  }

  // --- concept index (attr,name) -> concept proposal (with parent_path) ---
  const conceptBySig = new Map();
  for (const c of asArray(proposals.concepts)) conceptBySig.set(sig(c.attribute, c.name), c);

  // --- concept chains: every (attribute, [..ancestors, leaf]) to materialize.
  //     Ancestors named in a parent_path but absent from concepts[] are auto-created
  //     (e.g. 'generative model'); flag them as feedback. ---
  const chains = []; // {attribute, names: [...]}
  const ancestorAuto = new Set();
  for (const c of asArray(proposals.concepts)) {
    // Multi-parent placement (P15): one chain per parent path, so each parent
    // context becomes its own edge. Single-parent concepts yield exactly one chain.
    for (const pp of parentPathsOf(c)) {
      const names = [...pp, c.name];
      chains.push({ attribute: c.attribute, names });
      for (const anc of pp) {
        if (!conceptBySig.has(sig(c.attribute, anc))) ancestorAuto.add(sig(c.attribute, anc));
      }
    }
  }
  for (const k of ancestorAuto) unmapped.push(`ancestor auto-created (not its own proposal): ${k}`);

  // Count distinct concepts (names) and distinct edges the chains imply.
  const conceptNames = new Set();
  const edgeKeys = new Set();
  for (const ch of chains) {
    for (let j = 0; j < ch.names.length; j++) {
      conceptNames.add(norm(ch.names[j]));
      const parent = j === 0 ? '∅' : norm(ch.names[j - 1]);
      const pathNames = ch.names.slice(0, j).map(norm).join('>');
      edgeKeys.add(`${ch.attribute}|${parent}|${norm(ch.names[j])}|${pathNames}`);
    }
  }

  // Every path-key materializeChain WILL register (leafEdgeByPathSig), precomputed so a
  // link can be checked for a clean path-specific resolution BEFORE apply time. A leaf
  // chain registers `${sig(attr,leaf)}|${pathKeyOf(ancestors)}` (see materializeChain).
  const chainPathKeys = new Set();
  for (const ch of chains) {
    const leaf = ch.names[ch.names.length - 1];
    chainPathKeys.add(`${sig(ch.attribute, leaf)}|${pathKeyOf(ch.names.slice(0, -1))}`);
  }

  // --- links: attach only to edges that exist in the merged concept set.
  //     Links naming a pre-merge concept (not in concepts[]) are reported, not created. ---
  const links = [];
  const linkSeen = new Set(); // (sig + normurl) dedupe within the plan
  for (const l of asArray(proposals.links)) {
    const s = sig(l.attribute, l.concept_name);
    if (!conceptBySig.has(s)) {
      unmapped.push(`link → concept not in merged set: ${l.attribute}:${l.concept_name} (paper ${l.paper_id})`);
      continue;
    }
    const dedupeKey = `${s}|${normalizeUrl(l.url)}`;
    if (linkSeen.has(dedupeKey)) continue;
    linkSeen.add(dedupeKey);
    // Detection-only safety net: a link with a parent_path that does NOT correspond to
    // any materialized chain would silently fall back to the primary placement in
    // resolveLeafEdge — mis-placing it. Surface it as feedback so --dry-run flags it.
    // (resolveLeafEdge's runtime behavior is unchanged; this only reports.)
    const parentPath = asArray(l.parent_path);
    if (parentPath.length && !chainPathKeys.has(`${s}|${pathKeyOf(parentPath)}`)) {
      unmapped.push(
        `link path-key fallback: ${l.attribute}:${l.concept_name} @ ${pathKeyOf(parentPath)} ` +
          `(no matching chain — would attach to the primary placement; paper ${l.paper_id})`
      );
    }
    // Carry the link's parent_path so a link to a multi-parent concept attaches to
    // the right edge (path-specific), falling back to the primary edge otherwise.
    // title comes from the resolved paper record (byShort), so seed links carry the
    // real article title instead of null (matches the app's store-on-write behavior).
    links.push({
      s,
      url: l.url,
      comment: l.claim,
      paperShort: l.paper_id,
      parentPath,
      title: (byShort.get(l.paper_id) || {}).title || null,
    });
  }

  // --- tunnels: value↔value associative links (P8/P15). Both endpoints must resolve to
  //     a concept edge; `relation` is the association kind (similarity | thematic |
  //     analogy | metaphor | affective), stored as the tunnel comment. ---
  const tunnels = [];
  for (const t of asArray(proposals.tunnels)) {
    const fromS = sig(t.from.attribute, t.from.name);
    const toS = sig(t.to.attribute, t.to.name);
    if (!conceptBySig.has(fromS) || !conceptBySig.has(toS)) {
      unmapped.push(`tunnel endpoint not in concepts: ${t.from.attribute}:${t.from.name} ↔ ${t.to.attribute}:${t.to.name}`);
      continue;
    }
    tunnels.push({ fromS, toS, comment: t.relation });
  }

  // --- restructure-mentions (P6/P7): an addendum posted on a superseded concept's
  //     link, pointing (via an in-orca URL in the body) at the new location, so the
  //     Phase 65b mention parser backreferences it. Forward-compatible: the current
  //     reasoning contract emits none, so this is empty today. Shape consumed:
  //       { target: { attribute, name }, body }   (body should contain the in-orca URL)
  //     Concept-level c.restructure_mentions[] are folded in with their concept as
  //     the implicit target. ---
  const restructureMentions = [];
  const pushRM = (rm, fallbackTarget) => {
    const target = rm.target || fallbackTarget || null;
    const body = String(rm.body || '').trim();
    if (!target || !body) {
      unmapped.push(`restructure_mention missing target or body: ${JSON.stringify(rm).slice(0, 80)}`);
      return;
    }
    const s = sig(target.attribute, target.name);
    if (!conceptBySig.has(s)) {
      unmapped.push(`restructure_mention target not in concepts: ${target.attribute}:${target.name}`);
      return;
    }
    restructureMentions.push({ s, body });
  };
  for (const rm of asArray(proposals.restructure_mentions)) pushRM(rm, null);
  for (const c of asArray(proposals.concepts)) {
    for (const rm of asArray(c.restructure_mentions)) pushRM(rm, { attribute: c.attribute, name: c.name });
  }

  // --- predictions + events ---
  // concept target = its leaf edge; one 'confirmed' event per grounding paper.
  const conceptPredictions = asArray(proposals.concepts).map((c) => ({
    s: sig(c.attribute, c.name),
    prediction: c.prediction || '',
    // v0.9/v0.10 ledger fields. precision → chaos_predictions; the rest → each
    // confirmation event. provenance/severe come from a sampling plan (null/false
    // in a bootstrapping run); surprise_level is the concept's structural property.
    precision: c.precision == null ? null : Number(c.precision),
    surpriseLevel: c.surprise_level || null,
    provenance: c.provenance || null,
    severe: c.severe === true,
    groundingShort: asArray(c.grounding_papers),
  }));

  return {
    runId,
    papers,
    byShort,
    citations,
    conceptBySig,
    chains,
    conceptNames,
    edgeKeys,
    links,
    tunnels,
    restructureMentions,
    conceptPredictions,
    unmapped,
  };
}

// ----------------------------------------------------------------------------
// DRY-RUN reporting
// ----------------------------------------------------------------------------

function printPlan(plan) {
  // Corpus paper set, keyed by openalex work id (matches apply's resolvePaper).
  const corpusWork = new Set([...plan.byShort.keys()].map(workIdOf).filter(Boolean));
  const conceptPredCount = plan.conceptPredictions.filter((c) => (c.prediction || '').trim()).length;
  const eventCount = plan.conceptPredictions.reduce(
    (n, c) => n + c.groundingShort.filter((g) => corpusWork.has(workIdOf(g))).length, 0);

  console.log('================ CHAOS APPLY — DRY RUN (no writes) ================');
  console.log(`run_id: ${plan.runId}`);
  console.log('\nPLAN — rows that WOULD be created/ensured (idempotent):');
  console.log(`  papers ..................... ${plan.papers.length}  (upsert by openalex_id)`);
  console.log(`  paper_citations ............ ${plan.citations.length}  (within-corpus referenced_works pairs)`);
  console.log(`  concepts (value dispositions, distinct names) .. ${plan.conceptNames.size}`);
  console.log(`  edges (distinct) ........... ${plan.edgeKeys.size}`);
  const linkSkipped = plan.unmapped.filter((u) => u.startsWith('link →')).length;
  console.log(`  concept_links .............. ${plan.links.length}  (${plan.links.length + linkSkipped} proposed; ${linkSkipped} unmapped skipped)`);
  console.log(`  tunnel_links ............... ${plan.tunnels.length}  (value↔value associative)`);
  console.log(`  restructure addenda ........ ${plan.restructureMentions.length}  (seed-authored concept_link addenda + indexed mentions)`);
  console.log(`  chaos_predictions .......... ${conceptPredCount}  (concept/disposition; empty predictions skipped)`);
  console.log(`  chaos_prediction_events .... ${eventCount}  (one 'confirmed' per grounding paper per target)`);

  console.log(`\nValue dispositions (distinct): ${plan.conceptBySig.size}`);

  console.log('\nPapers to upsert:');
  for (const r of plan.papers) console.log(`  - ${r.id}  ${(r.title || '').slice(0, 64)}`);

  console.log('\nTunnels (from ↔ to):');
  for (const t of plan.tunnels) console.log(`  - ${t.fromS}  ↔  ${t.toS}`);

  console.log('\n---- DID NOT MAP CLEANLY (design feedback) ----');
  if (!plan.unmapped.length) console.log('  (none)');
  for (const u of plan.unmapped) console.log(`  ! ${u}`);
  console.log('\n(Use without --dry-run to apply.)');
}

// ----------------------------------------------------------------------------
// Backup (real apply only)
// ----------------------------------------------------------------------------

function backup() {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const env = Object.assign({}, process.env, {
    PGHOST: process.env.DB_HOST || 'localhost',
    PGPORT: String(process.env.DB_PORT || 5432),
    PGDATABASE: process.env.DB_NAME || 'concept_hierarchy',
    PGUSER: process.env.DB_USER || 'postgres',
    PGPASSWORD: process.env.DB_PASSWORD || 'postgres',
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(BACKUPS_DIR, `concept_hierarchy-preapply-${stamp}.sql`);
  const r = spawnSync('pg_dump', ['-d', env.PGDATABASE, '-f', out], { env, encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`pg_dump backup failed: ${(r.stderr || (r.error && r.error.message) || 'unknown').trim()}`);
  }
  const size = fs.statSync(out).size;
  if (size < 1000) throw new Error(`backup suspiciously small (${size} bytes): ${out}`);
  console.log(`Backup: ${out} (${size} bytes)`);
  return out;
}

// ----------------------------------------------------------------------------
// Apply (one transaction)
// ----------------------------------------------------------------------------

async function apply(plan) {
  const client = await pool.connect();
  const stats = {
    papers: 0, paper_citations: 0, concepts: 0, edges: 0, concept_links: 0,
    tunnel_links: 0,
    concept_link_addenda: 0, comment_mentions: 0,
    chaos_predictions: 0, chaos_prediction_events: 0,
  };
  try {
    await client.query('BEGIN');

    // Resolve seed account (never hardcoded).
    const seedRes = await client.query('SELECT id FROM users WHERE username = $1', [SEED_USERNAME]);
    if (!seedRes.rows[0]) {
      throw new Error(`seed account "${SEED_USERNAME}" not found — run chaos/migrate-chaos.js first.`);
    }
    const seedId = seedRes.rows[0].id;
    console.log(`Seed account: ${SEED_USERNAME} = id ${seedId}`);

    // Attribute name -> id.
    const attrRows = (await client.query('SELECT id, name FROM attributes')).rows;
    const attrId = new Map(attrRows.map((a) => [a.name, a.id]));

    // ---- a. papers + paper_citations ----
    const paperIdByOpenalex = new Map(); // full openalex url -> papers.id (for citations)
    const paperIdByWork = new Map(); // openalex work id 'W…' -> papers.id (for all proposal refs)
    // Resolve any proposal paper reference (short id, full url) by openalex_id only.
    const resolvePaper = (ref) => paperIdByWork.get(workIdOf(ref)) || null;
    for (const rec of plan.papers) {
      const disc = (rec.discipline_tags && rec.discipline_tags.query_fields) || [];
      const res = await client.query(
        `INSERT INTO papers
           (openalex_id, doi, arxiv_id, url_normalized, title, publication_year,
            host_venue, authors, abstract, discipline_tags, full_text_available, referenced_works_count)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (openalex_id) DO UPDATE SET
            doi = EXCLUDED.doi, arxiv_id = EXCLUDED.arxiv_id, url_normalized = EXCLUDED.url_normalized,
            title = EXCLUDED.title, publication_year = EXCLUDED.publication_year,
            host_venue = EXCLUDED.host_venue, authors = EXCLUDED.authors, abstract = EXCLUDED.abstract,
            discipline_tags = EXCLUDED.discipline_tags, full_text_available = EXCLUDED.full_text_available,
            referenced_works_count = EXCLUDED.referenced_works_count
         RETURNING id, (xmax = 0) AS inserted`,
        [
          rec.openalex_id, rec.doi || null, arxivIdFromDoi(rec.doi), normalizeUrl(rec.best_oa_url),
          rec.title || null, rec.publication_year || null, rec.host_venue || null,
          asArray(rec.authors), rec.abstract || null, disc,
          !!rec.full_text_available, asArray(rec.referenced_works).length,
        ]
      );
      const pid = res.rows[0].id;
      if (res.rows[0].inserted) stats.papers += 1;
      paperIdByOpenalex.set(rec.openalex_id, pid);
      const w = workIdOf(rec.openalex_id);
      if (w) paperIdByWork.set(w, pid);
    }

    for (const c of plan.citations) {
      const citing = paperIdByOpenalex.get(c.citing);
      const cited = paperIdByOpenalex.get(c.cited);
      if (!citing || !cited) continue;
      const res = await client.query(
        `INSERT INTO paper_citations (citing_paper_id, cited_paper_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING 1`,
        [citing, cited]
      );
      if (res.rowCount) stats.paper_citations += 1;
    }

    // ---- concept + edge helpers (idempotent) ----
    const conceptIdByName = new Map(); // norm(name) -> concepts.id
    async function getOrCreateConcept(name) {
      const key = norm(name);
      if (conceptIdByName.has(key)) return conceptIdByName.get(key);
      const found = await client.query('SELECT id FROM concepts WHERE LOWER(name) = $1 LIMIT 1', [key]);
      let id;
      if (found.rows[0]) {
        id = found.rows[0].id;
      } else {
        const ins = await client.query(
          'INSERT INTO concepts (name, created_by) VALUES ($1,$2) RETURNING id',
          [name, seedId]
        );
        id = ins.rows[0].id;
        stats.concepts += 1;
      }
      conceptIdByName.set(key, id);
      return id;
    }

    const edgeIdByKey = new Map();
    async function getOrCreateEdge(parentId, childId, graphPath, attribute_id) {
      const key = `${parentId == null ? '∅' : parentId}|${childId}|${graphPath.join(',')}|${attribute_id}`;
      if (edgeIdByKey.has(key)) return edgeIdByKey.get(key);
      let found;
      if (parentId == null) {
        found = await client.query(
          `SELECT id FROM edges WHERE parent_id IS NULL AND child_id=$1 AND attribute_id=$2 AND graph_path=$3::int[] LIMIT 1`,
          [childId, attribute_id, graphPath]
        );
      } else {
        found = await client.query(
          `SELECT id FROM edges WHERE parent_id=$1 AND child_id=$2 AND attribute_id=$3 AND graph_path=$4::int[] LIMIT 1`,
          [parentId, childId, attribute_id, graphPath]
        );
      }
      let id;
      if (found.rows[0]) {
        id = found.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO edges (parent_id, child_id, graph_path, attribute_id, created_by)
           VALUES ($1,$2,$3::int[],$4,$5) RETURNING id`,
          [parentId, childId, graphPath, attribute_id, seedId]
        );
        id = ins.rows[0].id;
        stats.edges += 1;
      }
      edgeIdByKey.set(key, id);
      return id;
    }

    // Materialize a full chain (root → leaf); return the LEAF edge id. A concept
    // placed under multiple parents (P15) produces multiple chains sharing the leaf
    // name: leafEdgeBySig records the PRIMARY (first) edge for name-only lookups
    // (members, tunnels, predictions), while leafEdgeByPathSig records every edge
    // keyed by its parent path so a path-bearing reference resolves precisely.
    const leafEdgeBySig = new Map(); // (attr,name) -> primary leaf edge id
    const leafEdgeByPathSig = new Map(); // (attr,name)|pathKey -> that edge id
    async function materializeChain(attribute, names) {
      const aId = attrId.get(attribute);
      if (!aId) throw new Error(`unknown attribute "${attribute}"`);
      const pathIds = [];
      let parentId = null;
      let leafEdge = null;
      for (let j = 0; j < names.length; j++) {
        const childId = await getOrCreateConcept(names[j]);
        leafEdge = await getOrCreateEdge(parentId, childId, pathIds.slice(), aId);
        pathIds.push(childId);
        parentId = childId;
      }
      const s = sig(attribute, names[names.length - 1]);
      if (!leafEdgeBySig.has(s)) leafEdgeBySig.set(s, leafEdge); // first path = primary
      leafEdgeByPathSig.set(`${s}|${pathKeyOf(names.slice(0, -1))}`, leafEdge);
      return leafEdge;
    }
    // Resolve a concept reference to an edge, preferring the path-specific edge when
    // the reference carries a parent path (multi-parent), else the primary edge.
    const resolveLeafEdge = (s, parentPath) => {
      if (parentPath && asArray(parentPath).length >= 0) {
        const hit = leafEdgeByPathSig.get(`${s}|${pathKeyOf(parentPath)}`);
        if (hit) return hit;
      }
      return leafEdgeBySig.get(s) || null;
    };

    // ---- b. concepts + edges (parents before children via chain order) ----
    for (const ch of plan.chains) {
      await materializeChain(ch.attribute, ch.names);
    }

    // ---- c. concept_links (comment = exemplification claim; paper_id = grounding) ----
    for (const l of plan.links) {
      const edgeId = resolveLeafEdge(l.s, l.parentPath);
      if (!edgeId) continue; // resolved during plan; guard anyway
      const paperId = resolvePaper(l.paperShort);
      const exists = await client.query(
        'SELECT id FROM concept_links WHERE edge_id=$1 AND LOWER(url)=LOWER($2) LIMIT 1',
        [edgeId, l.url]
      );
      if (exists.rows[0]) continue;
      await client.query(
        `INSERT INTO concept_links (edge_id, url, title, comment, added_by, paper_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [edgeId, l.url, l.title || null, l.comment || null, seedId, paperId]
      );
      stats.concept_links += 1;
    }

    // ---- d. tunnels (directed from→to; dedupe by origin+linked+comment) ----
    for (const t of plan.tunnels) {
      const origin = leafEdgeBySig.get(t.fromS);
      const linked = leafEdgeBySig.get(t.toS);
      if (!origin || !linked) continue;
      const exists = await client.query(
        `SELECT id FROM tunnel_links
         WHERE origin_edge_id=$1 AND linked_edge_id=$2 AND comment IS NOT DISTINCT FROM $3 LIMIT 1`,
        [origin, linked, t.comment || null]
      );
      if (exists.rows[0]) continue;
      await client.query(
        `INSERT INTO tunnel_links (origin_edge_id, linked_edge_id, comment, created_by)
         VALUES ($1,$2,$3,$4)`,
        [origin, linked, t.comment || null, seedId]
      );
      stats.tunnel_links += 1;
    }

    // ---- e. restructure-mention addenda (P6/P7). Post an addendum (seed-authored)
    //      on a concept_link of the superseded concept, then index its in-orca URLs
    //      via the Phase 65b parser into comment_mentions. Idempotent: an identical
    //      (link, body) addendum is not re-posted. Forward-compatible: empty today. ----
    for (const rm of asArray(plan.restructureMentions)) {
      const edgeId = leafEdgeBySig.get(rm.s);
      if (!edgeId) continue;
      const linkRow = await client.query(
        'SELECT id FROM concept_links WHERE edge_id=$1 ORDER BY id LIMIT 1',
        [edgeId]
      );
      if (!linkRow.rows[0]) {
        plan.unmapped.push(`restructure_mention: no concept_link on edge for ${rm.s} to attach an addendum`);
        continue;
      }
      const linkId = linkRow.rows[0].id;
      const dup = await client.query(
        'SELECT id FROM concept_link_addenda WHERE concept_link_id=$1 AND body=$2 LIMIT 1',
        [linkId, rm.body]
      );
      if (dup.rows[0]) continue;
      const addRes = await client.query(
        `INSERT INTO concept_link_addenda (concept_link_id, author_id, body)
         VALUES ($1,$2,$3) RETURNING id`,
        [linkId, seedId, rm.body]
      );
      const addendumId = addRes.rows[0].id;
      stats.concept_link_addenda += 1;
      for (const m of parseMentions(rm.body)) {
        await client.query(
          `INSERT INTO comment_mentions (source_type, source_id, target_type, target_id, target_path)
           VALUES ('concept_link_addendum',$1,$2,$3,$4)`,
          [addendumId, m.targetType, m.targetId, m.targetPath]
        );
        stats.comment_mentions += 1;
      }
    }

    // ---- f. prediction ledger ----
    // Append a 'confirmed' event idempotently per run_id (append-only table; a NEW
    // run_id appends a fresh observation round; the same run_id never duplicates).
    // opts carries the v0.9/v0.10 event fields (all null-tolerant): a confirmation
    // event records the concept's structural surprise_level and, from the sampling
    // plan, its provenance/severe (null/false when there is no plan).
    async function addEvent(targetType, targetId, paperId, opts = {}) {
      const { surpriseLevel = null, provenance = null, severe = false } = opts;
      const exists = await client.query(
        `SELECT 1 FROM chaos_prediction_events
         WHERE target_type=$1 AND target_id=$2 AND run_id=$3 AND event='confirmed'
           AND paper_id IS NOT DISTINCT FROM $4 LIMIT 1`,
        [targetType, targetId, plan.runId, paperId]
      );
      if (exists.rows[0]) return;
      await client.query(
        `INSERT INTO chaos_prediction_events
           (target_type, target_id, run_id, event, paper_id, surprise_level, provenance, severe)
         VALUES ($1,$2,$3,'confirmed',$4,$5,$6,$7)`,
        [targetType, targetId, plan.runId, paperId, surpriseLevel, provenance, severe]
      );
      stats.chaos_prediction_events += 1;
    }
    async function upsertPrediction(targetType, targetId, prediction, precision = null) {
      const res = await client.query(
        `INSERT INTO chaos_predictions (target_type, target_id, prediction, run_id, precision)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (target_type, target_id) DO UPDATE
           SET prediction = EXCLUDED.prediction, run_id = EXCLUDED.run_id,
               precision = EXCLUDED.precision, updated_at = NOW()
           WHERE chaos_predictions.prediction IS DISTINCT FROM EXCLUDED.prediction
              OR chaos_predictions.precision IS DISTINCT FROM EXCLUDED.precision
         RETURNING (xmax = 0) AS inserted`,
        [targetType, targetId, prediction, plan.runId, precision]
      );
      if (res.rows[0] && res.rows[0].inserted) stats.chaos_predictions += 1;
    }

    // The per-run estimate from cp.precision is written here so the prediction row
    // exists; the accumulated value below (computed AFTER events) overwrites it.
    const conceptTargets = new Set();
    for (const cp of plan.conceptPredictions) {
      const edgeId = leafEdgeBySig.get(cp.s);
      if (!edgeId) continue;
      if ((cp.prediction || '').trim()) await upsertPrediction('concept', edgeId, cp.prediction, cp.precision);
      for (const g of cp.groundingShort) {
        const pid = resolvePaper(g);
        if (pid) {
          await addEvent('concept', edgeId, pid, {
            surpriseLevel: cp.surpriseLevel,
            provenance: cp.provenance,
            severe: cp.severe,
          });
          conceptTargets.add(edgeId);
        }
      }
    }

    // --- Accumulated precision (Option A) — MUST run AFTER addEvent above ----------
    // For every concept target whose evidence changed this run, recompute precision from
    // the FULL accumulated event history and overwrite the per-run estimate, so stored
    // precision rises with recurrence (both now derive from the same events).
    for (const edgeId of conceptTargets) {
      const acc = await accumulatedPrecisionFromEvents(client, 'concept', edgeId);
      await client.query(
        `UPDATE chaos_predictions SET precision = $1, updated_at = NOW()
          WHERE target_type = 'concept' AND target_id = $2 AND precision IS DISTINCT FROM $1`,
        [acc, edgeId]
      );
    }

    await client.query('COMMIT');
    return { stats, seedId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  // Part C backfill path: recompute accumulated precision for all targets, then stop.
  // Independent of proposals.json — runs the dev-guarded historical correction only.
  if (RECOMPUTE_PRECISION) {
    await recomputeAllPrecision();
    return;
  }

  const proposals = loadProposals();
  const plan = buildPlan(proposals);

  if (DRY_RUN) {
    printPlan(plan);
    return;
  }

  console.log('================ CHAOS APPLY (writing to local dev DB) ================');
  console.log(`run_id: ${plan.runId}`);
  backup(); // aborts on failure, before any write

  const { stats, seedId } = await apply(plan);

  console.log('\nApplied. Rows CREATED per table:');
  for (const [t, n] of Object.entries(stats)) console.log(`  ${t.padEnd(26)} ${n}`);
  console.log(`\nAttribution: created_by / added_by = chaos-seed id ${seedId}`);

  // Persist the run identity (additive — apply already computed plan.runId; we only
  // record it). record-run.js reads this to populate the episodic record's db_run_id,
  // rubric_version, and applied counts. Written only on a successful apply.
  const lastApply = {
    run_id: plan.runId,
    rubric_version: proposals.rubric_version || null,
    applied_at: new Date().toISOString(),
    counts: stats,
  };
  fs.writeFileSync(LAST_APPLY_PATH, JSON.stringify(lastApply, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${path.relative(REPO_DIR, LAST_APPLY_PATH)} (run_id ${plan.runId}).`);

  if (plan.unmapped.length) {
    console.log('\n---- DID NOT MAP CLEANLY (design feedback) ----');
    for (const u of plan.unmapped) console.log(`  ! ${u}`);
  }

  // Refresh the read snapshot so it reflects the populated graph.
  console.log('\nRefreshing chaos/snapshot.json ...');
  const r = spawnSync('node', [path.join(CHAOS_DIR, 'snapshot.js')], { encoding: 'utf8' });
  process.stdout.write(r.stdout || '');
  if (r.status !== 0) process.stderr.write(r.stderr || '');
}

main()
  .then(() => pool.end())
  .then(() => {
    console.log('\nDone.');
    process.exitCode = 0;
  })
  .catch((err) => {
    console.error('\napply.js failed:', err.message);
    pool.end().finally(() => {
      process.exitCode = 1;
    });
  });
