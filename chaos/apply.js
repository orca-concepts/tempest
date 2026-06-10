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
 *     errors (concepts/edges reused, links/tunnels deduped, combos upserted,
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
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const CHAOS_DIR = __dirname;
const REPO_DIR = path.join(CHAOS_DIR, '..');
const BACKEND_DIR = path.join(REPO_DIR, 'backend');
const PAPERS_DIR = path.join(CHAOS_DIR, 'papers');
const PROPOSALS_PATH = path.join(CHAOS_DIR, 'proposals.json');
const BACKUPS_DIR = path.join(REPO_DIR, 'backups');

const DRY_RUN = process.argv.includes('--dry-run');
const SEED_USERNAME = 'chaos-seed';

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
    const names = [...asArray(c.parent_path), c.name];
    chains.push({ attribute: c.attribute, names });
    for (const anc of asArray(c.parent_path)) {
      if (!conceptBySig.has(sig(c.attribute, anc))) ancestorAuto.add(sig(c.attribute, anc));
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
    links.push({ s, url: l.url, comment: l.claim, paperShort: l.paper_id });
  }

  // --- tunnels: both endpoints must resolve to a concept edge ---
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

  // --- situations: members resolve to edges; combos store only name+description,
  //     so phase/reading_list/core_spine/toggleable do NOT persist (reported). ---
  const situations = [];
  for (const st of asArray(proposals.situations)) {
    const members = [];
    for (const m of asArray(st.members)) {
      const s = sig(m.attribute, m.name);
      if (conceptBySig.has(s)) members.push(s);
      else unmapped.push(`situation "${st.name}" member not in concepts: ${m.attribute}:${m.name}`);
    }
    // reading_list is normalized to openalex work ids by reason.js (Stage-5). Old-shape
    // proposals.json may still hold DOI/URL strings — those resolve to no paper; report
    // rather than fail (regenerate proposals.json to get openalex-id reading lists).
    const readingRaw = asArray(st.reading_list);
    const readingWork = readingRaw.map(workIdOf).filter(Boolean);
    const readingNonOpenalex = readingRaw.filter((e) => !workIdOf(e));
    if (readingNonOpenalex.length) {
      unmapped.push(
        `situation "${st.name}" reading_list has ${readingNonOpenalex.length} non-openalex entr${readingNonOpenalex.length === 1 ? 'y' : 'ies'} ` +
          `(regenerate proposals.json for openalex-id reading lists): ${readingNonOpenalex.join(', ')}`
      );
    }
    situations.push({
      name: st.name,
      description: st.rationale || '',
      members,
      phase: st.phase || null,
      readingWork, // openalex work ids only
      coreSpine: asArray(st.core_spine),
      toggleable: asArray(st.toggleable),
      // standing prediction: situations carry no `prediction` field — use rationale.
      prediction: st.rationale || '',
    });
  }

  // --- predictions + events ---
  // concept target = its leaf edge; one 'confirmed' event per grounding paper.
  const conceptPredictions = asArray(proposals.concepts).map((c) => ({
    s: sig(c.attribute, c.name),
    prediction: c.prediction || '',
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
    situations,
    conceptPredictions,
    unmapped,
    counts_by_domain: proposals.counts_by_domain || {},
  };
}

// ----------------------------------------------------------------------------
// DRY-RUN reporting
// ----------------------------------------------------------------------------

function printPlan(plan) {
  const byDomain = { value: 0, action: 0, tool: 0, question: 0 };
  for (const [s] of plan.conceptBySig) {
    const a = s.split('|')[0];
    if (byDomain[a] !== undefined) byDomain[a] += 1;
  }
  // Corpus paper set, keyed by openalex work id (matches apply's resolvePaper).
  const corpusWork = new Set([...plan.byShort.keys()].map(workIdOf).filter(Boolean));
  const conceptPredCount = plan.conceptPredictions.filter((c) => (c.prediction || '').trim()).length;
  const situationPredCount = plan.situations.filter((s) => (s.prediction || '').trim()).length;
  const conceptEvents = plan.conceptPredictions.reduce(
    (n, c) => n + c.groundingShort.filter((g) => corpusWork.has(workIdOf(g))).length, 0);
  const situationEvents = plan.situations.reduce(
    (n, st) => n + st.readingWork.filter((w) => corpusWork.has(workIdOf(w))).length, 0);
  const eventCount = conceptEvents + situationEvents;

  console.log('================ CHAOS APPLY — DRY RUN (no writes) ================');
  console.log(`run_id: ${plan.runId}`);
  console.log('\nPLAN — rows that WOULD be created/ensured (idempotent):');
  console.log(`  papers ..................... ${plan.papers.length}  (upsert by openalex_id)`);
  console.log(`  paper_citations ............ ${plan.citations.length}  (within-corpus referenced_works pairs)`);
  console.log(`  concepts (distinct names) .. ${plan.conceptNames.size}`);
  console.log(`  edges (distinct) ........... ${plan.edgeKeys.size}`);
  const linkSkipped = plan.unmapped.filter((u) => u.startsWith('link →')).length;
  console.log(`  concept_links .............. ${plan.links.length}  (${plan.links.length + linkSkipped} proposed; ${linkSkipped} unmapped skipped)`);
  console.log(`  tunnel_links ............... ${plan.tunnels.length}`);
  console.log(`  combos (situations) ........ ${plan.situations.length}`);
  console.log(`  combo_edges ................ ${plan.situations.reduce((n, s) => n + s.members.length, 0)}`);
  console.log(`  chaos_situation_meta ....... ${plan.situations.length}  (phase + reading list + spine/toggleable per situation)`);
  console.log(`  chaos_predictions .......... ${conceptPredCount + situationPredCount}  (${conceptPredCount} concept + ${situationPredCount} situation; empty predictions skipped)`);
  console.log(`  chaos_prediction_events .... ${eventCount}  (one 'confirmed' per grounding paper per target; reading lists resolved by openalex id)`);

  console.log('\nConcepts by domain (proposed):', JSON.stringify(byDomain),
    '| proposals.counts_by_domain:', JSON.stringify(plan.counts_by_domain));

  console.log('\nPapers to upsert:');
  for (const r of plan.papers) console.log(`  - ${r.id}  ${(r.title || '').slice(0, 64)}`);

  console.log('\nTunnels (from ↔ to):');
  for (const t of plan.tunnels) console.log(`  - ${t.fromS}  ↔  ${t.toS}`);

  console.log('\nSituations (name → member count):');
  for (const s of plan.situations) console.log(`  - "${s.name}" → ${s.members.length} members`);

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
    tunnel_links: 0, combos: 0, combo_edges: 0, chaos_situation_meta: 0,
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

    // Materialize a full chain (root → leaf); return the LEAF edge id.
    const leafEdgeBySig = new Map(); // (attr,name) -> leaf edge id
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
      leafEdgeBySig.set(sig(attribute, names[names.length - 1]), leafEdge);
      return leafEdge;
    }

    // ---- b. concepts + edges (parents before children via chain order) ----
    for (const ch of plan.chains) {
      await materializeChain(ch.attribute, ch.names);
    }

    // ---- c. concept_links (comment = exemplification claim; paper_id = grounding) ----
    for (const l of plan.links) {
      const edgeId = leafEdgeBySig.get(l.s);
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
        [edgeId, l.url, null, l.comment || null, seedId, paperId]
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

    // ---- e. situations (combos + combo_edges) ----
    const comboIdByName = new Map();
    for (const st of plan.situations) {
      const key = norm(st.name);
      let comboId;
      const found = await client.query('SELECT id FROM combos WHERE LOWER(name) = $1 LIMIT 1', [key]);
      if (found.rows[0]) {
        comboId = found.rows[0].id;
      } else {
        const ins = await client.query(
          'INSERT INTO combos (name, description, created_by) VALUES ($1,$2,$3) RETURNING id',
          [st.name, st.description || null, seedId]
        );
        comboId = ins.rows[0].id;
        stats.combos += 1;
      }
      comboIdByName.set(key, comboId);
      for (const mSig of st.members) {
        const edgeId = leafEdgeBySig.get(mSig);
        if (!edgeId) continue;
        const res = await client.query(
          `INSERT INTO combo_edges (combo_id, edge_id) VALUES ($1,$2)
           ON CONFLICT (combo_id, edge_id) DO NOTHING RETURNING 1`,
          [comboId, edgeId]
        );
        if (res.rowCount) stats.combo_edges += 1;
      }
      // Situation metadata that combos can't hold (phase, reading list, spine split).
      const metaRes = await client.query(
        `INSERT INTO chaos_situation_meta (combo_id, lifecycle_phase, reading_list, core_spine, toggleable)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (combo_id) DO UPDATE SET
           lifecycle_phase = EXCLUDED.lifecycle_phase, reading_list = EXCLUDED.reading_list,
           core_spine = EXCLUDED.core_spine, toggleable = EXCLUDED.toggleable, updated_at = NOW()
           WHERE chaos_situation_meta.lifecycle_phase IS DISTINCT FROM EXCLUDED.lifecycle_phase
              OR chaos_situation_meta.reading_list IS DISTINCT FROM EXCLUDED.reading_list
              OR chaos_situation_meta.core_spine IS DISTINCT FROM EXCLUDED.core_spine
              OR chaos_situation_meta.toggleable IS DISTINCT FROM EXCLUDED.toggleable
         RETURNING (xmax = 0) AS inserted`,
        [comboId, st.phase, st.readingWork, st.coreSpine, st.toggleable]
      );
      if (metaRes.rows[0] && metaRes.rows[0].inserted) stats.chaos_situation_meta += 1;
    }

    // ---- f. prediction ledger ----
    // Append a 'confirmed' event idempotently per run_id (append-only table; a NEW
    // run_id appends a fresh observation round; the same run_id never duplicates).
    async function addEvent(targetType, targetId, paperId) {
      const exists = await client.query(
        `SELECT 1 FROM chaos_prediction_events
         WHERE target_type=$1 AND target_id=$2 AND run_id=$3 AND event='confirmed'
           AND paper_id IS NOT DISTINCT FROM $4 LIMIT 1`,
        [targetType, targetId, plan.runId, paperId]
      );
      if (exists.rows[0]) return;
      await client.query(
        `INSERT INTO chaos_prediction_events (target_type, target_id, run_id, event, paper_id)
         VALUES ($1,$2,$3,'confirmed',$4)`,
        [targetType, targetId, plan.runId, paperId]
      );
      stats.chaos_prediction_events += 1;
    }
    async function upsertPrediction(targetType, targetId, prediction) {
      const res = await client.query(
        `INSERT INTO chaos_predictions (target_type, target_id, prediction, run_id)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (target_type, target_id) DO UPDATE
           SET prediction = EXCLUDED.prediction, run_id = EXCLUDED.run_id, updated_at = NOW()
           WHERE chaos_predictions.prediction IS DISTINCT FROM EXCLUDED.prediction
         RETURNING (xmax = 0) AS inserted`,
        [targetType, targetId, prediction, plan.runId]
      );
      if (res.rows[0] && res.rows[0].inserted) stats.chaos_predictions += 1;
    }

    for (const cp of plan.conceptPredictions) {
      const edgeId = leafEdgeBySig.get(cp.s);
      if (!edgeId) continue;
      if ((cp.prediction || '').trim()) await upsertPrediction('concept', edgeId, cp.prediction);
      for (const g of cp.groundingShort) {
        const pid = resolvePaper(g);
        if (pid) await addEvent('concept', edgeId, pid);
      }
    }
    for (const st of plan.situations) {
      const comboId = comboIdByName.get(norm(st.name));
      if (!comboId) continue;
      if ((st.prediction || '').trim()) await upsertPrediction('situation', comboId, st.prediction);
      for (const w of st.readingWork) {
        const pid = resolvePaper(w);
        if (pid) await addEvent('situation', comboId, pid);
      }
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
