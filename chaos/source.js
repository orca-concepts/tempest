#!/usr/bin/env node

/**
 * Chaos — paper-sourcing layer (Stage 2).
 *
 * Fetches a batch of open-access cognitive-science papers across all six fields
 * (chaos.md §4: neuroscience, psychology, linguistics, AI, philosophy, anthropology),
 * with metadata, abstract, best-effort full text, citations (referenced_works), and
 * discipline tags. Stores each paper as chaos/papers/<id>.json plus an index manifest.
 *
 * This is the "Source" plumbing stage of the Chaos pipeline (chaos.md §8.2) and
 * satisfies §7 step 2 ("assemble the working set"): pull a small batch of new OA
 * papers spanning the cognitive sciences, preferring full text, valuing
 * cross-disciplinary work.
 *
 * READ-ONLY w.r.t. the Orca database: this script NEVER connects to Postgres. Its only
 * inputs are the OpenAlex HTTP API and chaos/snapshot.json (a file); its only outputs
 * are files under chaos/papers/. No DB writes, no migrations, no reasoning, no proposals.
 *
 * Primary source: OpenAlex (https://api.openalex.org) — free, no API key. We send a
 * `mailto` param (and User-Agent) to use the polite pool.
 *
 * Usage:
 *   node chaos/source.js                      # default 5 papers/field (~30 total)
 *   node chaos/source.js --per-field=10       # 10/field
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

// Hosts we can pull readable HTML full text from (best-effort).
const FULLTEXT_MAX_CHARS = 100000;
const HTTP_TIMEOUT_MS = 20000;

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpGet(url, accept) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: accept || '*/*' },
      redirect: 'follow',
    });
    return res;
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

function doiToUrl(doi) {
  if (!doi) return null;
  // OpenAlex already returns DOIs as full https://doi.org/... URLs, but be safe.
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
  const m = String(url).match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(v\d+)?/i);
  return m ? m[1] : null;
}

// Build an ordered list of candidate HTML full-text URLs for a work, restricted to
// hosts that reliably serve open-access full text AS HTML (so a tag-strip yields real
// article text, not a paywall/login wall or a bare record page). Publisher sites that
// only expose a paywalled landing page or a PDF are intentionally NOT included — those
// papers fall back to abstract-only with full_text_available=false, which keeps the
// flag honest. Returns [{ url, source }] (possibly empty).
function fullTextCandidates(work) {
  const out = [];
  const ids = work.ids || {};
  const doi = (work.doi || '').toLowerCase();

  // arXiv id, from the DOI (10.48550/arXiv.<id>) if present.
  let arxivId = null;
  const am = doi.match(/10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/);
  if (am) arxivId = am[1];

  // PMC, from the pmcid OpenAlex returns in ids.
  if (ids.pmcid) {
    const m = String(ids.pmcid).match(/PMC\d+/i);
    if (m) {
      out.push({
        url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${m[0].toUpperCase()}/`,
        source: 'pmc',
      });
    }
  }

  const locs = [work.best_oa_location, work.primary_location, ...(work.locations || [])]
    .filter((l) => l && l.is_oa);

  for (const loc of locs) {
    for (const u of [loc.landing_page_url, loc.pdf_url]) {
      if (!u) continue;
      const host = hostOf(u);

      if (host.includes('arxiv.org')) {
        const id = arxivIdFrom(u) || arxivId;
        if (id) out.push({ url: `https://ar5iv.labs.arxiv.org/html/${id}`, source: 'ar5iv' });
      } else if (
        (host.includes('ncbi.nlm.nih.gov') && /\/pmc\//i.test(u)) ||
        host.includes('pmc.ncbi.nlm.nih.gov')
      ) {
        out.push({ url: u, source: 'pmc' });
      } else if (host.includes('journals.plos.org') && /article\?id=/i.test(u)) {
        out.push({ url: u, source: 'plos' }); // landing page = full HTML; skip /article/file PDFs
      } else if (host.includes('elifesciences.org')) {
        out.push({ url: u.replace(/\.pdf(\?.*)?$/i, ''), source: 'elife' });
      } else if (host.includes('frontiersin.org')) {
        // pdf_url .../pdf -> full HTML at .../full
        out.push({ url: u.replace(/\/pdf(\?.*)?$/i, '/full'), source: 'frontiers' });
      } else if (host.includes('mdpi.com')) {
        out.push({ url: u.replace(/\/pdf(\?.*)?$/i, ''), source: 'mdpi' }); // .../pdf -> HTML
      }
    }
  }

  if (arxivId && !out.some((o) => o.source === 'ar5iv')) {
    out.push({ url: `https://ar5iv.labs.arxiv.org/html/${arxivId}`, source: 'ar5iv' });
  }

  // Dedupe by url, preserve order.
  const seen = new Set();
  return out.filter((o) => (seen.has(o.url) ? false : (seen.add(o.url), true)));
}

function htmlToText(html) {
  if (!html) return '';
  let s = html;
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
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

const NO_FULLTEXT = { full_text: null, full_text_available: false, full_text_source: null };

function looksLikeArticleText(text) {
  if (!text || text.length < 1500) return false;
  // Guard against login/paywall chrome: require mostly natural-language content.
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / text.length > 0.55;
}

async function tryFetchFullText(work) {
  const candidates = fullTextCandidates(work);
  for (const cand of candidates) {
    try {
      const res = await httpGet(cand.url, 'text/html');
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (!res.ok || !ctype.includes('html')) continue;
      const text = htmlToText(await res.text()).slice(0, FULLTEXT_MAX_CHARS);
      if (!looksLikeArticleText(text)) continue;
      return { full_text: text, full_text_available: true, full_text_source: cand.url };
    } catch {
      // try next candidate
    }
  }
  return { ...NO_FULLTEXT };
}

// ----------------------------------------------------------------------------
// OpenAlex query
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

async function fetchFieldWorks(conceptId) {
  const filter = [
    `concepts.id:${conceptId}`,
    'is_oa:true',
    'has_abstract:true',
    'has_doi:true',
    'has_fulltext:true', // bias toward papers that genuinely have full text (chaos.md §4 "prefer full text")
    `from_publication_date:${FROM_DATE}`,
  ].join(',');

  const url =
    `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
    `&sort=publication_date:desc&per_page=${PER_FIELD}` +
    `&select=${encodeURIComponent(OPENALEX_SELECT)}` +
    `&mailto=${encodeURIComponent(MAILTO)}`;

  const res = await httpGet(url, 'application/json');
  if (!res.ok) {
    throw new Error(`OpenAlex ${res.status} for concept ${conceptId}`);
  }
  const json = await res.json();
  return json.results || [];
}

function shortId(openalexId) {
  // "https://openalex.org/W1234" -> "W1234"
  return String(openalexId || '').split('/').pop();
}

function buildPaperRecord(work, queryFields) {
  const authors = (work.authorships || [])
    .map((a) => a.author && a.author.display_name)
    .filter(Boolean);

  const venue =
    (work.primary_location &&
      work.primary_location.source &&
      work.primary_location.source.display_name) ||
    (work.best_oa_location &&
      work.best_oa_location.source &&
      work.best_oa_location.source.display_name) ||
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
  console.log('Chaos source — fetching OA cognitive-science papers from OpenAlex.');
  console.log(`per_field=${PER_FIELD}  mailto=${MAILTO}  from=${FROM_DATE}\n`);

  fs.mkdirSync(PAPERS_DIR, { recursive: true });
  const existingKeys = loadExistingLinkKeys();

  // 1. Query each field, accumulate unique works (cross-disciplinary overlap merges).
  const byField = {};
  const works = new Map(); // shortId -> { work, queryFields:Set }

  for (const { field, conceptId } of FIELDS) {
    byField[field] = { returned: 0, deduped_existing: 0, overlap_in_batch: 0 };
    let results = [];
    try {
      results = await fetchFieldWorks(conceptId);
    } catch (e) {
      console.error(`  ${field}: query failed — ${e.message}`);
    }
    byField[field].returned = results.length;
    console.log(`  ${field.padEnd(24)} returned ${results.length}`);

    for (const work of results) {
      const id = shortId(work.id);
      if (works.has(id)) {
        works.get(id).queryFields.add(field);
        byField[field].overlap_in_batch += 1;
      } else {
        works.set(id, { work, queryFields: new Set([field]) });
      }
    }
    await sleep(150); // be polite
  }

  // 2. Build records, dedupe against existing links, fetch full text, write files.
  let totalWritten = 0;
  let totalFullText = 0;
  let totalAbstractOnly = 0;
  let totalDeduped = 0;
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
    record.fetched_at = new Date().toISOString();

    if (ft.full_text_available) totalFullText += 1;
    else totalAbstractOnly += 1;

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
    from_publication_date: FROM_DATE,
    totals: {
      unique_works: works.size,
      written: totalWritten,
      full_text: totalFullText,
      abstract_only: totalAbstractOnly,
      deduped_against_existing: totalDeduped,
    },
    by_field: byField,
    papers: manifestPapers,
  };
  fs.writeFileSync(
    path.join(PAPERS_DIR, 'index.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  // 4. Report.
  console.log('\nPer-field:');
  for (const { field } of FIELDS) {
    const s = byField[field];
    console.log(
      `  ${field.padEnd(24)} returned ${s.returned}, ` +
        `deduped-existing ${s.deduped_existing}, in-batch-overlap ${s.overlap_in_batch}`
    );
  }
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
