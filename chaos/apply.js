#!/usr/bin/env node

/**
 * Chaos — apply layer (Stage 5). Writes the reviewed proposals
 * (chaos/proposals.json) into the LOCAL DEV database, attributed to the
 * chaos-seed account. This is the FIRST Chaos stage that writes to the DB.
 *
 * Pure-hierarchy writer (chaos.md §8): it materializes concepts + parent edges and
 * their grounding (papers + concept_links). The dormant v0.x payload (tunnels,
 * prediction/precision ledger, restructure-mention addenda) is no longer written — the
 * tables remain in the schema, but apply.js does not touch them.
 *
 * Safety contract:
 *   - pg_dump backup to backups/ BEFORE any write; abort if it fails.
 *   - One transaction; rolls back on any error.
 *   - Idempotent: re-running creates zero new rows and raises no constraint
 *     errors (concepts/edges reused, links deduped, papers upserted by openalex_id).
 *   - --dry-run prints the complete write plan and exits WITHOUT a backup or a
 *     write transaction.
 *
 * Attribution: the seed account is resolved at runtime by username (NEVER hardcoded).
 * created_by / added_by point at that id.
 *
 * READ-ONLY w.r.t. production: connects only to the LOCAL dev DB via the backend
 * pool config (same as the other chaos scripts). No schema changes, no reasoning.
 *
 * Usage:
 *   node chaos/apply.js --dry-run
 *   node chaos/apply.js
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
  //     Ancestors named in a parent_path but absent from concepts[] are EXPECTED for an
  //     additive multi-parent plan (you propose only the child; its parents already exist).
  //     They are recorded as INFORMATIONAL ancestor refs — NOT a mapping failure. apply()
  //     reports loudly only if such an ancestor turns out NOT to resolve by name and is
  //     actually auto-created (the genuine concern). ---
  const chains = []; // {attribute, names: [...]}
  const ancestorAuto = new Map(); // sig -> { attribute, name } (first occurrence)
  for (const c of asArray(proposals.concepts)) {
    // Multi-parent placement (P15): one chain per parent path, so each parent
    // context becomes its own edge. Single-parent concepts yield exactly one chain.
    for (const pp of parentPathsOf(c)) {
      const names = [...pp, c.name];
      chains.push({ attribute: c.attribute, names });
      for (const anc of pp) {
        const s = sig(c.attribute, anc);
        if (!conceptBySig.has(s) && !ancestorAuto.has(s)) ancestorAuto.set(s, { attribute: c.attribute, name: anc });
      }
    }
  }
  const ancestorRefs = [...ancestorAuto.values()]; // informational; resolved/created decided at apply time

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
    ancestorRefs,
    unmapped,
  };
}

// ----------------------------------------------------------------------------
// DRY-RUN reporting
// ----------------------------------------------------------------------------

function printPlan(plan) {
  console.log('================ CHAOS APPLY — DRY RUN (no writes) ================');
  console.log(`run_id: ${plan.runId}`);
  console.log('\nPLAN — rows that WOULD be created/ensured (idempotent):');
  console.log(`  papers ..................... ${plan.papers.length}  (upsert by openalex_id)`);
  console.log(`  paper_citations ............ ${plan.citations.length}  (within-corpus referenced_works pairs)`);
  console.log(`  concepts (distinct names) .. ${plan.conceptNames.size}`);
  console.log(`  edges (distinct) ........... ${plan.edgeKeys.size}`);
  const linkSkipped = plan.unmapped.filter((u) => u.startsWith('link →')).length;
  console.log(`  concept_links .............. ${plan.links.length}  (${plan.links.length + linkSkipped} proposed; ${linkSkipped} unmapped skipped)`);

  console.log('\nPapers to upsert:');
  for (const r of plan.papers) console.log(`  - ${r.id}  ${(r.title || '').slice(0, 64)}`);

  // Informational — ancestors referenced by a parent_path but not separately proposed. For an
  // additive plan these resolve to existing concepts by name (nothing created); this is NOT a
  // mapping failure, so it stays OUT of "DID NOT MAP CLEANLY".
  if (asArray(plan.ancestorRefs).length) {
    console.log('\nAncestors referenced but not separately proposed (resolve to existing concepts by name; auto-created only if absent):');
    for (const a of plan.ancestorRefs) console.log(`  · ${a.attribute}:${a.name}`);
  }

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
  };
  const createdConceptNames = new Set(); // norm(name) for concepts actually INSERTed this run
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
        createdConceptNames.add(key); // record genuine creation (vs resolved-existing)
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
    // name: leafEdgeBySig records the PRIMARY (first) edge for name-only lookups,
    // while leafEdgeByPathSig records every edge
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

    await client.query('COMMIT');
    return { stats, seedId, createdConceptNames };
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
  const proposals = loadProposals();
  const plan = buildPlan(proposals);

  if (DRY_RUN) {
    printPlan(plan);
    return;
  }

  console.log('================ CHAOS APPLY (writing to local dev DB) ================');
  console.log(`run_id: ${plan.runId}`);
  backup(); // aborts on failure, before any write

  const { stats, seedId, createdConceptNames } = await apply(plan);

  console.log('\nApplied. Rows CREATED per table:');
  for (const [t, n] of Object.entries(stats)) console.log(`  ${t.padEnd(26)} ${n}`);
  console.log(`\nAttribution: created_by / added_by = chaos-seed id ${seedId}`);

  // Ancestor references not separately proposed: split by whether they were actually created.
  // Resolved-to-existing (the additive-plan norm) is INFORMATIONAL; a genuine auto-creation
  // (the ancestor did NOT resolve by name) is the real concern and joins the loud alarm below.
  const ancestorResolved = [];
  for (const a of asArray(plan.ancestorRefs)) {
    if (createdConceptNames.has(norm(a.name))) {
      plan.unmapped.push(`ancestor AUTO-CREATED — did not resolve by name: ${a.attribute}:${a.name}`);
    } else {
      ancestorResolved.push(a);
    }
  }
  if (ancestorResolved.length) {
    console.log('\nAncestors referenced but not separately proposed (resolved to existing concepts; nothing created):');
    for (const a of ancestorResolved) console.log(`  · ${a.attribute}:${a.name}`);
  }

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
