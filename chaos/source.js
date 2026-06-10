#!/usr/bin/env node

/**
 * Chaos — paper-sourcing layer (Stage 2, full-text-yield upgrade).
 *
 * Fetches a batch of open-access cognitive-science papers across all six fields
 * (chaos.md §4: neuroscience, psychology, linguistics, AI, philosophy, anthropology),
 * with metadata, abstract, full text, citations (referenced_works), and discipline
 * tags. Stores each paper as chaos/papers/<id>.json plus an index manifest.
 *
 * Design (chaos.md §8.2, §7 step 2; P14 bias guard):
 *   - OpenAlex stays the DISCOVERY backbone — it gives citations, discipline tags, and
 *     the cross-field balance the P14 bias guard requires. We do NOT switch to an
 *     arXiv-only strategy (that would skew the corpus toward computational fields).
 *   - Full text is retrieved by SOURCE-NATIVE fetchers, chosen by where each work's OA
 *     copy actually lives (resolved from OpenAlex best-OA-location / DOI / external ids):
 *       * arXiv         — native HTML (arxiv.org/html), ar5iv HTML fallback.
 *       * Europe PMC    — OA REST full-text XML (clean JATS).
 *       * bioRxiv/medRxiv — the preprint's .full HTML page.
 *       * PMC / PLOS / eLife / Frontiers / MDPI — clean publisher HTML.
 *   - Discovery is BIASED toward retrievable full text: each field is over-sampled, then
 *     ranked retrievable-first, but each field still fills its quota (balance preserved).
 *   - Truthful quality gate: store full_text only when it is clean article text
 *     (content-type + natural-language check); full_text_available stays honest.
 *
 * READ-ONLY w.r.t. the Orca database: this script NEVER connects to Postgres. Its only
 * inputs are HTTP APIs (OpenAlex + the full-text sources) and chaos/snapshot.json; its
 * only outputs are files under chaos/papers/. No DB writes, no reasoning, no proposals.
 *
 * Not yet done (future levers, deliberately out of scope here): GROBID / PDF binary
 * extraction for the publisher-PDF majority, and arXiv LaTeX e-print (tar.gz) source
 * extraction as an arXiv fallback below the HTML paths.
 *
 * Usage:
 *   node chaos/source.js                      # default 5 papers/field (~30 total)
 *   node chaos/source.js --per-field=15       # 15/field
 *   set CHAOS_PER_FIELD=8 && node chaos/source.js
 *   set CHAOS_MAILTO=you@example.com && node chaos/source.js
 */

const path = require('path');
const fs = require('fs');

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const PAPERS_DIR = path.join(__dirname, 'papers');
const SNAPSHOT_PATH = path.join(__dirname, 'snapshot.json');

const MAILTO = process.env.CHAOS_MAILTO || '17willim@gmail.com';
const USER_AGENT = `chaos-orca/0.1 (mailto:${MAILTO})`;

function getPerField() {
  const arg = process.argv.find((a) => a.startsWith('--per-field='));
  if (arg) return Math.max(1, parseInt(arg.split('=')[1], 10) || 5);
  if (process.env.CHAOS_PER_FIELD) {
    return Math.max(1, parseInt(process.env.CHAOS_PER_FIELD, 10) || 5);
  }
  return 5;
}

const PER_FIELD = getPerField();

// Over-sample the discovery pool per field so we can rank retrievable-first and still
// fill each field's quota (P14 balance guard). Only the selected PER_FIELD per field
// ever trigger a full-text fetch; ranking itself is free (uses metadata already pulled).
const CANDIDATE_PER_FIELD = Math.min(50, Math.max(PER_FIELD * 4, PER_FIELD + 10));

// OpenAlex source IDs for repositories whose OA copies we can fetch as clean full text.
// A per-field backfill query filtered to these injects retrievable papers into the pool,
// since the strict newest-first slice is dominated by gold-OA publishers and surfaces
// almost no arXiv/PMC/bioRxiv (those copies appear with an ingest lag). This is the
// "oversample retrievable sources, still fill every field" half of the P14 bias guard.
const RETRIEVABLE_SOURCE_IDS = [
  'S4306400194', // arXiv
  'S2764455111', // PubMed Central
  'S4306400806', // Europe PMC (PubMed Central)
  'S4306402567', // bioRxiv
];

// OpenAlex level-0/1 concept IDs for the six cognitive-science fields (chaos.md §4).
const FIELDS = [
  { field: 'neuroscience', conceptId: 'C169760540' },
  { field: 'psychology', conceptId: 'C15744967' },
  { field: 'linguistics', conceptId: 'C41895202' },
  { field: 'artificial_intelligence', conceptId: 'C154945302' },
  { field: 'philosophy', conceptId: 'C138885662' },
  { field: 'anthropology', conceptId: 'C19165224' },
];

// Recency window for "new" papers.
const FROM_DATE = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 3);
  return d.toISOString().slice(0, 10);
})();

const FULLTEXT_MAX_CHARS = 120000;
const HTTP_TIMEOUT_MS = 20000;

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpGet(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: accept || '*/*' },
      redirect: 'follow',
    });
  } finally {
    clearTimeout(t);
  }
}

function reconstructAbstract(inv) {
  if (!inv || typeof inv !== 'object') return null;
  const slots = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) slots[p] = word;
  }
  const text = slots.filter((w) => w !== undefined).join(' ').trim();
  return text.length ? text : null;
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

function doiBare(doi) {
  return String(doi || '')
    .toLowerCase()
    .replace(/^https?:\/\/doi\.org\//, '')
    .replace(/^doi:/, '');
}

function doiToUrl(doi) {
  if (!doi) return null;
  if (/^https?:\/\//i.test(doi)) return doi;
  return `https://doi.org/${doi.replace(/^doi:/i, '')}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function arxivIdFrom(url) {
  const m = String(url).match(/arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})(v\d+)?/i);
  return m ? m[1] : null;
}

// Strip markup (HTML or JATS XML) to plain text. Works for both: the script/style/head
// removals simply no-op on XML.
function markupToText(markup) {
  if (!markup) return '';
  let s = markup;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<head[\s\S]*?<\/head>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return s.replace(/\s+/g, ' ').trim();
}

const NO_FULLTEXT = {
  full_text: null,
  full_text_available: false,
  full_text_source: null,
  full_text_method: null,
};

function looksLikeArticleText(text) {
  if (!text || text.length < 1500) return false;
  // Guard against login/paywall chrome and stub pages: require mostly natural language.
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / text.length > 0.55;
}

// ----------------------------------------------------------------------------
// Source-native full-text plan
// ----------------------------------------------------------------------------

// Build an ordered list of full-text retrieval attempts for a work, each a
// { source, kind: 'html'|'xml', url }. Restricted to sources that serve OA full text
// cleanly (HTML article pages or JATS XML), so a tag-strip yields real article text,
// never a paywall/login wall, a bare record page, or a PDF blob. Order = cleanest /
// most-structured first. Empty array => not retrievable => abstract-only.
function fullTextPlan(work) {
  const out = [];
  const ids = work.ids || {};
  const bare = doiBare(work.doi);

  // arXiv id (from DOI or any OA-location URL).
  let arxivId = null;
  const am = bare.match(/^10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/);
  if (am) arxivId = am[1];

  // PMCID (from OpenAlex external ids; fall back to an OA-location URL below).
  let pmcid = null;
  if (ids.pmcid) {
    const m = String(ids.pmcid).match(/PMC\d+/i);
    if (m) pmcid = m[0].toUpperCase();
  }

  const locs = [work.best_oa_location, work.primary_location, ...(work.locations || [])]
    .filter((l) => l && l.is_oa);

  for (const loc of locs) {
    for (const u of [loc.landing_page_url, loc.pdf_url]) {
      if (!u) continue;
      const h = hostOf(u);
      if (h.includes('arxiv.org')) arxivId = arxivId || arxivIdFrom(u);
      if (!pmcid && (h.includes('ncbi.nlm.nih.gov') || h.includes('europepmc.org'))) {
        const m = String(u).match(/PMC\d+/i);
        if (m) pmcid = m[0].toUpperCase();
      }
    }
  }

  // 1. Europe PMC OA full-text XML (cleanest structured text). Needs a PMCID.
  // Endpoint is /rest/{PMCID}/fullTextXML (no /PMC/ source segment); 404s for articles
  // not in Europe PMC's OA-XML subset, which then falls through to the PMC HTML attempt.
  if (pmcid) {
    out.push({
      source: 'europepmc',
      kind: 'xml',
      url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
    });
  }

  // 2. arXiv HTML: ar5iv first (less page chrome than arXiv's native HTML), then the
  //    official arXiv HTML as fallback. (arXiv LaTeX e-print source is a future fallback.)
  if (arxivId) {
    out.push({ source: 'ar5iv', kind: 'html', url: `https://ar5iv.labs.arxiv.org/html/${arxivId}` });
    out.push({ source: 'arxiv-html', kind: 'html', url: `https://arxiv.org/html/${arxivId}` });
  }

  // 3. bioRxiv / medRxiv .full HTML (DOI prefix 10.1101).
  if (/^10\.1101\//.test(bare)) {
    for (const loc of locs) {
      const u = loc.landing_page_url || '';
      const h = hostOf(u);
      let server = null;
      if (h.includes('biorxiv.org')) server = 'biorxiv';
      else if (h.includes('medrxiv.org')) server = 'medrxiv';
      if (server) {
        const full = /\.full$/.test(u) ? u : `${u.replace(/\/$/, '')}.full`;
        out.push({ source: server, kind: 'html', url: full });
      }
    }
  }

  // 4. PMC HTML (after the Europe PMC XML attempt).
  if (pmcid) {
    out.push({
      source: 'pmc',
      kind: 'html',
      url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`,
    });
  }

  // 5. Clean publisher HTML handlers from the OA-location URLs.
  for (const loc of locs) {
    for (const u of [loc.landing_page_url, loc.pdf_url]) {
      if (!u) continue;
      const h = hostOf(u);
      if (h.includes('journals.plos.org') && /article\?id=/i.test(u)) {
        out.push({ source: 'plos', kind: 'html', url: u });
      } else if (h.includes('elifesciences.org')) {
        out.push({ source: 'elife', kind: 'html', url: u.replace(/\.pdf(\?.*)?$/i, '') });
      } else if (h.includes('frontiersin.org')) {
        out.push({ source: 'frontiers', kind: 'html', url: u.replace(/\/pdf(\?.*)?$/i, '/full') });
      } else if (h.includes('mdpi.com')) {
        out.push({ source: 'mdpi', kind: 'html', url: u.replace(/\/pdf(\?.*)?$/i, '') });
      }
    }
  }

  // Dedupe by URL, preserve order.
  const seen = new Set();
  return out.filter((o) => (o.url && !seen.has(o.url) ? (seen.add(o.url), true) : false));
}

function isRetrievable(work) {
  return fullTextPlan(work).length > 0;
}

async function tryFetchFullText(work) {
  for (const cand of fullTextPlan(work)) {
    try {
      const accept = cand.kind === 'xml' ? 'application/xml, text/xml' : 'text/html';
      const res = await httpGet(cand.url, accept);
      if (!res.ok) continue;
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      const body = await res.text();
      // HTML must declare html (blocks PDF blobs); XML is sniffed from the body since
      // some endpoints return application/octet-stream or no content-type for XML.
      const typeOk =
        cand.kind === 'xml'
          ? /xml/.test(ctype) || /^\s*<(\?xml|article|!doctype)/i.test(body)
          : ctype.includes('html');
      if (!typeOk) continue;
      const text = markupToText(body).slice(0, FULLTEXT_MAX_CHARS);
      if (!looksLikeArticleText(text)) continue;
      return {
        full_text: text,
        full_text_available: true,
        full_text_source: cand.url,
        full_text_method: cand.source,
      };
    } catch {
      // try next candidate
    }
  }
  return { ...NO_FULLTEXT };
}

// ----------------------------------------------------------------------------
// OpenAlex discovery
// ----------------------------------------------------------------------------

const OPENALEX_SELECT = [
  'id',
  'doi',
  'title',
  'display_name',
  'publication_year',
  'publication_date',
  'authorships',
  'primary_location',
  'best_oa_location',
  'locations',
  'open_access',
  'abstract_inverted_index',
  'referenced_works',
  'concepts',
  'topics',
  'ids',
].join(',');

async function fetchFieldWorks(conceptId, perPage, extraFilters = []) {
  const filter = [
    `concepts.id:${conceptId}`,
    'is_oa:true',
    'has_abstract:true',
    'has_doi:true',
    'has_fulltext:true', // OpenAlex has indexed full text — a real-full-text signal (chaos.md §4)
    `from_publication_date:${FROM_DATE}`,
    ...extraFilters,
  ].join(',');

  const url =
    `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
    `&sort=publication_date:desc&per_page=${perPage}` +
    `&select=${encodeURIComponent(OPENALEX_SELECT)}` +
    `&mailto=${encodeURIComponent(MAILTO)}`;

  const res = await httpGet(url, 'application/json');
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for concept ${conceptId}`);
  const json = await res.json();
  return json.results || [];
}

function shortId(openalexId) {
  return String(openalexId || '').split('/').pop();
}

function buildPaperRecord(work, queryFields) {
  const authors = (work.authorships || [])
    .map((a) => a.author && a.author.display_name)
    .filter(Boolean);

  const venue =
    (work.primary_location && work.primary_location.source && work.primary_location.source.display_name) ||
    (work.best_oa_location && work.best_oa_location.source && work.best_oa_location.source.display_name) ||
    null;

  const bestOaUrl =
    (work.best_oa_location &&
      (work.best_oa_location.landing_page_url || work.best_oa_location.pdf_url)) ||
    null;

  return {
    id: shortId(work.id),
    openalex_id: work.id,
    doi: work.doi || null,
    title: work.title || work.display_name || null,
    authors,
    publication_year: work.publication_year || null,
    publication_date: work.publication_date || null,
    host_venue: venue,
    abstract: reconstructAbstract(work.abstract_inverted_index),
    best_oa_url: bestOaUrl,
    referenced_works: work.referenced_works || [],
    discipline_tags: {
      query_fields: queryFields,
      concepts: (work.concepts || []).map((c) => ({
        id: c.id,
        display_name: c.display_name,
        level: c.level,
        score: c.score,
      })),
      topics: (work.topics || []).map((t) => ({
        id: t.id,
        display_name: t.display_name,
        field: t.field && t.field.display_name,
        domain: t.domain && t.domain.display_name,
      })),
    },
    open_access: work.open_access || null,
  };
}

// ----------------------------------------------------------------------------
// Dedupe against the existing graph (chaos/snapshot.json -> concept_links URLs)
// ----------------------------------------------------------------------------

function loadExistingLinkKeys() {
  const keys = new Set();
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.warn(`(warn) ${SNAPSHOT_PATH} not found — dedupe will skip nothing.`);
    return keys;
  }
  try {
    const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
    for (const link of snap.concept_links || []) {
      const n = normalizeUrl(link.url);
      if (n) keys.add(n);
    }
  } catch (e) {
    console.warn(`(warn) could not parse snapshot.json: ${e.message}`);
  }
  return keys;
}

function paperMatchesExisting(record, existingKeys) {
  const candidates = [
    normalizeUrl(doiToUrl(record.doi)),
    normalizeUrl(record.best_oa_url),
    normalizeUrl(record.openalex_id),
  ].filter(Boolean);
  return candidates.some((c) => existingKeys.has(c));
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('Chaos source — OpenAlex discovery + source-native full text.');
  console.log(
    `per_field=${PER_FIELD}  candidate_pool=${CANDIDATE_PER_FIELD}/field  ` +
      `mailto=${MAILTO}  from=${FROM_DATE}\n`
  );

  fs.mkdirSync(PAPERS_DIR, { recursive: true });
  const existingKeys = loadExistingLinkKeys();

  // 1. Discover per field: over-sample, rank retrievable-first, take PER_FIELD.
  const byField = {};
  const works = new Map(); // shortId -> { work, queryFields:Set }

  for (const { field, conceptId } of FIELDS) {
    byField[field] = {
      candidates: 0,
      selected: 0,
      retrievable_selected: 0,
      full_text: 0,
      abstract_only: 0,
      deduped_existing: 0,
      overlap_in_batch: 0,
    };

    // Two discovery queries per field, merged: (a) newest OA (preserves recency +
    // balance), (b) newest OA whose copy lives on a fetchable repository (injects
    // arXiv/PMC/bioRxiv that the newest-first slice misses). Retrievable-source works
    // are placed first so they survive the rank-and-slice below.
    let mainPool = [];
    let retrPool = [];
    try {
      mainPool = await fetchFieldWorks(conceptId, CANDIDATE_PER_FIELD);
    } catch (e) {
      console.error(`  ${field}: main query failed — ${e.message}`);
    }
    try {
      retrPool = await fetchFieldWorks(conceptId, CANDIDATE_PER_FIELD, [
        `locations.source.id:${RETRIEVABLE_SOURCE_IDS.join('|')}`,
      ]);
    } catch (e) {
      console.error(`  ${field}: retrievable query failed — ${e.message}`);
    }

    const mergedById = new Map();
    for (const w of [...retrPool, ...mainPool]) {
      const id = shortId(w.id);
      if (!mergedById.has(id)) mergedById.set(id, w);
    }
    const results = [...mergedById.values()];
    byField[field].candidates = results.length;

    // Stable sort retrievable-first (recency preserved within each bucket), keep quota.
    const ranked = [...results].sort((a, b) => (isRetrievable(a) ? 0 : 1) - (isRetrievable(b) ? 0 : 1));
    const selected = ranked.slice(0, PER_FIELD);
    byField[field].selected = selected.length;
    byField[field].retrievable_selected = selected.filter(isRetrievable).length;

    console.log(
      `  ${field.padEnd(24)} pool ${results.length}, selected ${selected.length}, ` +
        `retrievable ${byField[field].retrievable_selected}`
    );

    for (const work of selected) {
      const id = shortId(work.id);
      if (works.has(id)) {
        works.get(id).queryFields.add(field);
        byField[field].overlap_in_batch += 1;
      } else {
        works.set(id, { work, queryFields: new Set([field]) });
      }
    }
    await sleep(150); // be polite to OpenAlex
  }

  // 2. Build records, dedupe against existing links, fetch full text, write files.
  let totalWritten = 0;
  let totalFullText = 0;
  let totalAbstractOnly = 0;
  let totalDeduped = 0;
  const methodCounts = {};
  const manifestPapers = [];

  for (const { work, queryFields } of works.values()) {
    const fieldsArr = [...queryFields];
    const record = buildPaperRecord(work, fieldsArr);

    if (paperMatchesExisting(record, existingKeys)) {
      totalDeduped += 1;
      for (const f of fieldsArr) byField[f].deduped_existing += 1;
      continue;
    }

    const ft = await tryFetchFullText(work);
    record.full_text = ft.full_text;
    record.full_text_available = ft.full_text_available;
    record.full_text_source = ft.full_text_source;
    record.full_text_method = ft.full_text_method;
    record.fetched_at = new Date().toISOString();

    if (ft.full_text_available) {
      totalFullText += 1;
      methodCounts[ft.full_text_method] = (methodCounts[ft.full_text_method] || 0) + 1;
      for (const f of fieldsArr) byField[f].full_text += 1;
    } else {
      totalAbstractOnly += 1;
      for (const f of fieldsArr) byField[f].abstract_only += 1;
    }

    fs.writeFileSync(
      path.join(PAPERS_DIR, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      'utf8'
    );
    totalWritten += 1;

    manifestPapers.push({
      id: record.id,
      title: record.title,
      fields: fieldsArr,
      doi: record.doi,
      year: record.publication_year,
      full_text_available: record.full_text_available,
      full_text_method: record.full_text_method,
      referenced_works_count: record.referenced_works.length,
    });

    await sleep(150);
  }

  // 3. Write the manifest.
  const manifest = {
    generated_at: new Date().toISOString(),
    source: 'chaos/source.js',
    openalex_mailto: MAILTO,
    per_field: PER_FIELD,
    candidate_per_field: CANDIDATE_PER_FIELD,
    from_publication_date: FROM_DATE,
    totals: {
      unique_works: works.size,
      written: totalWritten,
      full_text: totalFullText,
      abstract_only: totalAbstractOnly,
      deduped_against_existing: totalDeduped,
    },
    full_text_by_method: methodCounts,
    by_field: byField,
    papers: manifestPapers,
  };
  fs.writeFileSync(path.join(PAPERS_DIR, 'index.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // 4. Report.
  console.log('\nPer-field (selected / full-text / abstract-only):');
  for (const { field } of FIELDS) {
    const s = byField[field];
    console.log(
      `  ${field.padEnd(24)} selected ${s.selected}, full-text ${s.full_text}, ` +
        `abstract-only ${s.abstract_only}` +
        (s.deduped_existing ? `, deduped ${s.deduped_existing}` : '')
    );
  }
  console.log('\nFull text by method:', JSON.stringify(methodCounts));
  console.log('\nTotals:');
  console.log(`  unique works           ${works.size}`);
  console.log(`  written                ${totalWritten}`);
  console.log(`  with full text         ${totalFullText}`);
  console.log(`  abstract only          ${totalAbstractOnly}`);
  console.log(`  deduped (existing)     ${totalDeduped}`);
  console.log(`\nWrote ${totalWritten} files + index.json to ${PAPERS_DIR}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Source failed:', err.message);
    process.exit(1);
  });
