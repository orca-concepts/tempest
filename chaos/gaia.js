#!/usr/bin/env node

/**
 * Chaos — Gaia, the Instantiator (chaos.md v2.0 §2, §11 step 3).
 *
 * Grounds the genesis taxonomy. For each LEAF quality-adjective in
 * chaos/genesis/proposal.json, Gaia: plans plain scholarly search queries for the
 * (adjective, path) target, retrieves open-access candidate papers from OpenAlex,
 * reads each, and judges whether the paper's actual research EXHIBITS that quality
 * at that path — demonstrates it in what the researchers did — versus merely
 * DISCUSSES/studies it. For accepted papers it emits a concept→paper link whose
 * comment names, in plain cross-disciplinary language, the concrete feature of the
 * work that exhibits the quality (chaos.md §2).
 *
 * READ-ONLY w.r.t. the Orca database: this script NEVER connects to Postgres and
 * NEVER writes the graph. Its inputs are chaos.md (the governing brain, loaded at
 * runtime as the model's system prompt), chaos/genesis/proposal.json, OpenAlex, the
 * full-text sources, and the Anthropic Messages API. Its outputs are files only:
 *   - chaos/papers/<id>.json        — fetched paper records (same shape source.js uses)
 *   - chaos/genesis/gaia-proposal.json — { generated_by, papers[], links[] } (drops
 *                                        straight into apply.js's links[] at cutover)
 *   - chaos/genesis/gaia-proposal.md   — human review file
 *   - chaos/gaia_cache/*.json       — regenerable model-response cache (gitignore-worthy)
 *
 * This file is self-contained: the OpenAlex client, full-text subsystem, Anthropic
 * caller, and content-addressed cache are COPIED from the proven implementations in
 * source.js / reason.js / categorizer.js (not imported), so Gaia has no dependency on
 * the retired engines. The rubric is NOT hard-coded — it travels in the prompt.
 *
 * Cutover, multi-attach (one paper → many concepts), tunnels/predictions/precision,
 * and any DB write are explicitly OUT OF SCOPE here.
 *
 * Usage:
 *   set ANTHROPIC_API_KEY=sk-ant-...
 *   node chaos/gaia.js --plan                 # OFFLINE: list leaf targets, no network/model
 *   node chaos/gaia.js --node "Pre-registered"# ground one leaf (all its paths)
 *   node chaos/gaia.js --limit 5              # ground the first 5 leaf targets
 *   node chaos/gaia.js --all                  # ground every leaf target
 *   node chaos/gaia.js                        # usage + --plan summary, nothing else
 *   (optional: --effort=max  --model=claude-opus-4-8  --mailto=you@example.com)
 */

const path = require('path');
const fs = require('fs');

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const CHAOS_DIR = __dirname;
const RUBRIC_PATH = path.join(CHAOS_DIR, 'chaos.md');
const GENESIS_DIR = path.join(CHAOS_DIR, 'genesis');
const PROPOSAL_PATH = path.join(GENESIS_DIR, 'proposal.json');
const PAPERS_DIR = path.join(CHAOS_DIR, 'papers');
const CACHE_DIR = path.join(CHAOS_DIR, 'gaia_cache');
const OUT_JSON = path.join(GENESIS_DIR, 'gaia-proposal.json');
const OUT_MD = path.join(GENESIS_DIR, 'gaia-proposal.md');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = argValue('--model') || 'claude-opus-4-8';
const EFFORT = argValue('--effort') || 'high'; // low | medium | high | xhigh | max

const MAILTO = argValue('--mailto') || process.env.CHAOS_MAILTO || '17willim@gmail.com';
const USER_AGENT = `chaos-orca/0.1 (mailto:${MAILTO})`;

// Bumped whenever the Gaia prompt TEMPLATES below change in a way that should
// invalidate cached query-plans / judgments. Folded into the cache key alongside
// rubricHash(), so a rubric edit OR a prompt change auto-invalidates stale entries
// (same discipline as reason.js / categorizer.js).
const GAIA_PROMPT_VERSION = 'gaia3';

// Grounding budget knobs.
const TARGET_INSTANCES_PER_LEAF = 3; // stop a target once this many high/medium accepted
const MAX_QUERIES_PER_TARGET = 3;    // the planner returns 1–3 search strings
const CANDIDATES_PER_QUERY = 25;     // OpenAlex per_page per query
const MAX_CANDIDATES_PER_TARGET = 40; // candidates judged per target (after dedupe/rank)

// I/O caps (mirrors source.js / reason.js).
const FULLTEXT_MAX_CHARS = 120000;   // stored in the paper record (source.js parity)
const FULLTEXT_PROMPT_CAP = 60000;   // slice sent to the judge model (reason.js parity)
const HTTP_TIMEOUT_MS = 20000;       // OpenAlex + full-text fetches
const MODEL_TIMEOUT_MS = 420000;     // 7 min per model call
const MAX_RETRIES = 3;

// Output token ceilings for the two model calls (small JSON; generous thinking headroom).
const MAX_TOKENS_QPLAN = 6000;
const MAX_TOKENS_JUDGE = 8000;

// ----------------------------------------------------------------------------
// Small helpers (copied from reason.js / categorizer.js)
// ----------------------------------------------------------------------------

function argValue(flag) {
  // supports both `--flag value` and `--flag=value`
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) {
    return process.argv[i + 1];
  }
  const pre = process.argv.find((x) => x.startsWith(flag + '='));
  return pre ? pre.split('=').slice(1).join('=') : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim();
}

function pathKey(arr) {
  return asArray(arr).map(normName).join(' > ');
}

function pathLabel(parentPath) {
  const arr = asArray(parentPath).filter((x) => x != null && String(x).length);
  return arr.length ? `under: ${arr.join(' › ')}` : '(root)';
}

// Tolerant JSON extraction — strips markdown fences and grabs the outermost object
// (reason.js:119-132 / categorizer.js).
function extractJson(text) {
  if (!text) return null;
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  try {
    return JSON.parse(s.slice(first, last + 1));
  } catch {
    return null;
  }
}

// Dependency-free FNV-1a (32-bit) — keys the content-addressed cache (reason.js:705-712).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function loadRubric() {
  return fs.readFileSync(RUBRIC_PATH, 'utf8');
}

// rubricHash salts every cache key with a hash of chaos.md, so editing the rubric
// invalidates stale query-plans / judgments (reason.js:604-608). Memoized per process.
let _rubricHash = null;
function rubricHash() {
  if (_rubricHash === null) _rubricHash = fnv1a(fs.readFileSync(RUBRIC_PATH, 'utf8'));
  return _rubricHash;
}

function rubricVersion() {
  try {
    const txt = fs.readFileSync(RUBRIC_PATH, 'utf8');
    const m = txt.match(/\*\*Status:\*\*\s*v?([0-9][0-9.]*)/i) || txt.match(/^\*\*Version:\*\*\s*([0-9.]+)/m);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ----------------------------------------------------------------------------
// OpenAlex client + full-text subsystem (copied from source.js:154-488)
// ----------------------------------------------------------------------------

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
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / text.length > 0.55;
}

// Ordered list of clean full-text retrieval attempts for a work (source.js:264-358).
function fullTextPlan(work) {
  const out = [];
  const ids = work.ids || {};
  const bare = doiBare(work.doi);

  let arxivId = null;
  const am = bare.match(/^10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/);
  if (am) arxivId = am[1];

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

  if (pmcid) {
    out.push({
      source: 'europepmc',
      kind: 'xml',
      url: `https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`,
    });
  }
  if (arxivId) {
    out.push({ source: 'ar5iv', kind: 'html', url: `https://ar5iv.labs.arxiv.org/html/${arxivId}` });
    out.push({ source: 'arxiv-html', kind: 'html', url: `https://arxiv.org/html/${arxivId}` });
  }
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
  if (pmcid) {
    out.push({
      source: 'pmc',
      kind: 'html',
      url: `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`,
    });
  }
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

const OPENALEX_SELECT = [
  'id', 'doi', 'title', 'display_name', 'publication_year', 'publication_date',
  'authorships', 'primary_location', 'best_oa_location', 'locations', 'open_access',
  'abstract_inverted_index', 'referenced_works', 'concepts', 'topics', 'ids',
].join(',');

function shortId(openalexId) {
  return String(openalexId || '').split('/').pop();
}

// OpenAlex commas/pipes are filter delimiters; strip them from a free-text query.
function sanitizeQuery(q) {
  return String(q || '').replace(/[,|]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Targeted (per-node) retrieval: full-text search over title+abstract, OA + abstract +
// fulltext + DOI gated. NO recency/FROM_DATE bias — we want the best exhibit, not the
// newest paper (the bottom-up batch query in source.js is deliberately NOT carried over).
async function fetchWorksBySearch(query, perPage) {
  const filter = [
    `title_and_abstract.search:${sanitizeQuery(query)}`,
    'is_oa:true',
    'has_abstract:true',
    'has_fulltext:true',
    'has_doi:true',
  ].join(',');
  const url =
    `https://api.openalex.org/works?filter=${encodeURIComponent(filter)}` +
    `&per_page=${perPage}` +
    `&select=${encodeURIComponent(OPENALEX_SELECT)}` +
    `&mailto=${encodeURIComponent(MAILTO)}`;
  const res = await httpGet(url, 'application/json');
  if (!res.ok) throw new Error(`OpenAlex ${res.status} for search "${query}"`);
  const json = await res.json();
  return json.results || [];
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
      // For Gaia, query_fields records the search phrases that surfaced this paper
      // (source.js stores the discipline labels that surfaced it — same slot, same role).
      query_fields: queryFields,
      concepts: (work.concepts || []).map((c) => ({
        id: c.id, display_name: c.display_name, level: c.level, score: c.score,
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
// Anthropic Messages API (raw fetch, prompt caching on the constant system prefix;
// mirrors reason.js:521-588 / categorizer.js)
// ----------------------------------------------------------------------------

const usageTotals = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};
let apiCallCount = 0;

function recordUsage(u) {
  if (!u) return;
  usageTotals.input_tokens += u.input_tokens || 0;
  usageTotals.output_tokens += u.output_tokens || 0;
  usageTotals.cache_creation_input_tokens += u.cache_creation_input_tokens || 0;
  usageTotals.cache_read_input_tokens += u.cache_read_input_tokens || 0;
}

async function callModel(systemText, userText, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Export it and re-run.');
  }
  const body = {
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), MODEL_TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': API_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
        if (retryable && attempt < MAX_RETRIES) {
          await sleep(1500 * attempt);
          continue;
        }
        throw lastErr;
      }
      const json = JSON.parse(text);
      apiCallCount += 1;
      recordUsage(json.usage);
      if (json.stop_reason === 'refusal') {
        throw new Error('Model refused the request.');
      }
      const out = asArray(json.content)
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text: out, usage: json.usage, stop_reason: json.stop_reason };
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES && /aborted|ECONNRESET|network|fetch failed/i.test(e.message)) {
        await sleep(1500 * attempt);
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('callModel failed');
}

// Indirection so offline tests can stub the model (no network/key) — mirrors reason.js.
let _callModel = callModel;
function __setCallModelForTest(fn) {
  _callModel = fn;
}

// ----------------------------------------------------------------------------
// Targets: parse chaos/genesis/proposal.json, compute leaf targets
// ----------------------------------------------------------------------------

// Normalize a proposal node to { name, parent_paths: string[][] }. Tolerates the v1.0
// shape (extra role/conduct/basis fields are ignored) and a single flat parent_path.
function normalizeNodes(data) {
  return asArray(data && data.nodes)
    .filter((n) => n && typeof n.name === 'string' && n.name.trim())
    .map((n) => {
      let pp = n.parent_paths;
      if (pp == null) pp = [];
      else if (Array.isArray(pp) && pp.length && !Array.isArray(pp[0])) pp = [pp];
      pp = asArray(pp).map((p) => asArray(p).map(String)).filter((p) => p.length);
      return { name: n.name.trim(), parent_paths: pp };
    });
}

function loadTargets() {
  if (!fs.existsSync(PROPOSAL_PATH)) {
    throw new Error(`genesis proposal not found at ${PROPOSAL_PATH}. Run chaos/categorizer.js first.`);
  }
  const data = JSON.parse(fs.readFileSync(PROPOSAL_PATH, 'utf8'));
  const nodes = normalizeNodes(data);
  if (!nodes.length) throw new Error('proposal.json has no usable nodes.');

  // A LEAF is a node never named as an ancestor in any node's parent_paths (no children).
  const ancestorNames = new Set();
  for (const n of nodes) {
    for (const pp of n.parent_paths) {
      for (const anc of pp) ancestorNames.add(normName(anc));
    }
  }
  const leaves = nodes.filter((n) => !ancestorNames.has(normName(n.name)));

  // A TARGET is a (name, parent_path) pair. A multi-parent leaf yields one target per
  // path (path-dependent identity); a root leaf (no parents) yields one target, path [].
  const targets = [];
  for (const n of leaves) {
    const paths = n.parent_paths.length ? n.parent_paths : [[]];
    for (const pp of paths) targets.push({ name: n.name, parentPath: pp });
  }
  return { nodes, leaves, targets };
}

// ----------------------------------------------------------------------------
// Stage 1 — per-node query planning (model call, cached)
// ----------------------------------------------------------------------------

function queryPlanSystem(rubric) {
  return [
    'You are Chaos, the INSTANTIATOR (Gaia), in QUERY-PLANNING mode.',
    'Your governing brain — the principles and the architecture — is the rubric below',
    '(chaos.md, v2.0). Obey it exactly. Do not invent rules it does not state.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'CONTEXT: nodes are bare quality-adjectives describing GOOD RESEARCH; meaning is',
    'COMPOSITIONAL — a node means what it means by its PATH (chaos.md §1, §7). You will be',
    'given one LEAF target: an adjective and its root-to-parent PATH. The bare adjective is',
    'a poor search term on its own — your job is to translate the (adjective, path) into',
    '1–3 PLAIN, scholarly OpenAlex full-text search strings that would surface open-access',
    'papers whose actual research EXHIBITS this quality (demonstrates it in what the',
    'researchers DID), so the next stage can read and judge them.',
    '',
    'GUIDANCE:',
    '  - Use the PATH as the disambiguating context: "Powered" under Rigorous › Warranted is',
    '    statistical power, not electrical power.',
    '  - Prefer the established scholarly phrase for the practice (e.g. "statistical power',
    '    analysis", "sample size justification", "pre-registration", "blinded assessment").',
    '  - Plain words, no booleans, no field operators, no quotes, NO commas or pipe',
    '    characters (they break the search). 2–5 words each. Cross-disciplinary if possible.',
    '  - 1–3 strings, most-precise first. Fewer good strings beat many vague ones.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no markdown fences. Exactly:',
    '{ "queries": [ string, ... ] }   // 1–3 plain search strings',
    'Return only the JSON object.',
  ].join('\n');
}

function queryPlanUser(target) {
  const p = target.parentPath.length ? target.parentPath.join(' > ') : '(root — no parent context)';
  return [
    'LEAF TARGET to plan search queries for:',
    `  adjective: ${target.name}`,
    `  path (root → parent): ${p}`,
    '',
    'Return { "queries": [ … ] } — 1–3 plain scholarly OpenAlex search strings whose',
    'results would EXHIBIT this quality at this path. No prose.',
  ].join('\n');
}

function qplanCachePath(target) {
  const h = fnv1a(
    `${GAIA_PROMPT_VERSION}|qplan|${MODEL}|${EFFORT}|r${rubricHash()}|${normName(target.name)}|${pathKey(target.parentPath)}`
  );
  return path.join(CACHE_DIR, `qplan-${h}.json`);
}

async function planQueries(target, systemText) {
  const cp = qplanCachePath(target);
  if (fs.existsSync(cp)) {
    try {
      const q = asArray(JSON.parse(fs.readFileSync(cp, 'utf8')).queries);
      if (q.length) return q;
    } catch {
      // fall through and re-call on a corrupt cache file
    }
  }
  const { text, stop_reason } = await _callModel(systemText, queryPlanUser(target), MAX_TOKENS_QPLAN);
  const parsed = stop_reason === 'max_tokens' ? null : extractJson(text);
  let queries =
    parsed && Array.isArray(parsed.queries)
      ? parsed.queries.map((q) => sanitizeQuery(q)).filter(Boolean).slice(0, MAX_QUERIES_PER_TARGET)
      : [];
  // Fallback (never cached): if the model truncated / returned nothing usable, search the
  // adjective + nearest parent so the run still proceeds.
  if (!queries.length) {
    const near = target.parentPath[target.parentPath.length - 1];
    const fb = sanitizeQuery(near ? `${near} ${target.name}` : target.name);
    console.warn(`    (warn) query-plan empty/truncated for "${target.name}" — fallback: "${fb}"`);
    return [fb];
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    cp,
    JSON.stringify({ target: { name: target.name, parentPath: target.parentPath }, queries }, null, 2),
    'utf8'
  );
  return queries;
}

// ----------------------------------------------------------------------------
// Stage 2 — retrieval (OpenAlex; reuse full-text subsystem for the record)
// ----------------------------------------------------------------------------

async function retrieveCandidates(queries) {
  const byId = new Map(); // shortId -> work
  const querySetById = new Map(); // shortId -> Set<query> (which queries surfaced it)
  for (const q of queries) {
    let works = [];
    try {
      works = await fetchWorksBySearch(q, CANDIDATES_PER_QUERY);
    } catch (e) {
      console.error(`    search failed "${q}": ${e.message}`);
    }
    for (const w of works) {
      const id = shortId(w.id);
      if (!byId.has(id)) byId.set(id, w);
      if (!querySetById.has(id)) querySetById.set(id, new Set());
      querySetById.get(id).add(q);
    }
    await sleep(150); // polite to OpenAlex
  }
  // Rank retrievable (full-text-fetchable) first so we judge the strongest evidence first;
  // recency is intentionally NOT a factor (best exhibit, not newest).
  const works = [...byId.values()].sort((a, b) => (isRetrievable(a) ? 0 : 1) - (isRetrievable(b) ? 0 : 1));
  const capped = works.slice(0, MAX_CANDIDATES_PER_TARGET);
  return capped.map((w) => ({ work: w, queries: [...(querySetById.get(shortId(w.id)) || [])] }));
}

// Load an existing chaos/papers/<id>.json if present (avoids re-fetch), else build the
// record + fetch full text + write it. Merges the surfacing queries into query_fields.
async function ensurePaperRecord(work, queries) {
  const id = shortId(work.id);
  const file = path.join(PAPERS_DIR, `${id}.json`);
  if (fs.existsSync(file)) {
    try {
      const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
      rec.discipline_tags = rec.discipline_tags || {};
      const merged = new Set([...asArray(rec.discipline_tags.query_fields), ...queries]);
      rec.discipline_tags.query_fields = [...merged];
      fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
      return rec;
    } catch {
      // corrupt file — fall through and re-fetch
    }
  }
  const rec = buildPaperRecord(work, queries);
  const ft = await tryFetchFullText(work);
  rec.full_text = ft.full_text;
  rec.full_text_available = ft.full_text_available;
  rec.full_text_source = ft.full_text_source;
  rec.full_text_method = ft.full_text_method;
  rec.fetched_at = new Date().toISOString();
  fs.mkdirSync(PAPERS_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rec, null, 2), 'utf8');
  await sleep(150);
  return rec;
}

// ----------------------------------------------------------------------------
// Stage 3 — exhibits judgment (model call, cached)
// ----------------------------------------------------------------------------

function judgeSystem(rubric) {
  return [
    'You are Chaos, the INSTANTIATOR (Gaia), in EXHIBITS-JUDGMENT mode.',
    'Your governing brain is the rubric below (chaos.md, v2.0). Obey it exactly.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'YOUR TASK THIS CALL: you are given one LEAF target (a quality-adjective + its path)',
    'and ONE paper. Judge whether the paper\'s ACTUAL RESEARCH EXHIBITS that quality at',
    'that path — i.e. the researchers DEMONSTRATE it in what they actually did, has, or',
    'built — as opposed to merely DISCUSSING, studying, reviewing, or recommending it',
    '(chaos.md §2: "demonstrably exhibits — exhibits, not discusses").',
    '',
    '  - EXHIBITS = the work itself is an instance of the quality (e.g. for "Pre-registered":',
    '    the study WAS pre-registered; for "Powered": the authors DID a sample-size/power',
    '    justification). The paper need not name the quality.',
    '  - DISCUSSES = the paper is ABOUT the quality, argues for it, surveys it, or studies it',
    '    in others, without the work itself being an instance. Reject these.',
    '  - Use the PATH as context: the quality means what its path makes it mean.',
    '',
    'THE DECISIVE TEST — subject matter vs. method (apply this first):',
    '  REJECT papers whose SUBJECT MATTER IS the quality itself — papers that develop,',
    '  characterize, simulate, measure, or review the quality. There the quality is the',
    '  OBJECT of study, not a property of the study.',
    '    Reject-example for "Powered": a paper that runs simulations to characterize the',
    '    statistical power of some tests and produces sample-size guidelines — that paper',
    '    STUDIES power; it is not a study that WAS powered.',
    '  ACCEPT only papers that ENACTED the quality in conducting their OWN substantive',
    '  research, such that the quality warrants THAT study\'s own conclusion.',
    '    Accept-example for "Powered": an empirical study that justified its own sample',
    '    size with an a-priori power calculation, so its finding is warranted.',
    '  GENERAL RULE: A paper ABOUT the quality is "discusses"; a study that PRACTICED the',
    '  quality in service of its own substantive inference is "exhibits." When the quality',
    '  is the paper\'s TOPIC rather than its METHOD, reject.',
    '',
    '  - ERR TOWARD REJECTING weak or merely-plausible matches. A few strong instances beat',
    '    many weak ones. If unsure whether it exhibits or only discusses, set exhibits=false.',
    '',
    'IF AND ONLY IF it exhibits, write the `comment` — this is load-bearing (chaos.md §2).',
    'The comment MUST:',
    '  - name the CONCRETE feature of the work that exhibits the quality — what the',
    '    researchers actually DID or what the work HAS — never a summary of the paper;',
    '  - be readable by ANY researcher in ANY field: NO disciplinary jargon. Translate any',
    '    necessary technical term into plain words.',
    '  - read as a genuine invitation to open the paper, through concreteness and clarity —',
    '    NOT a stock tagline. ~1–2 sentences.',
    "  DON'T: \"Applies IPTW to control time-varying confounding in an MSM.\"",
    '  DO:   "The researchers re-weighted their data so the groups they compared were alike',
    '         on the factors that could otherwise have skewed the result — a concrete look',
    '         at how that\'s done."',
    '',
    'ALWAYS fill `reason` (one short plain sentence) for BOTH accept and reject — it makes',
    'the gate auditable.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no markdown fences. Exactly:',
    '{',
    '  "exhibits": boolean,                       // true only if the work itself instantiates it',
    '  "comment": string | null,                  // the plain-language exhibits claim; null if exhibits=false',
    '  "confidence": "high" | "medium" | "low",   // your confidence that it genuinely exhibits',
    '  "reason": string                           // REQUIRED whether exhibits is true or false: ONE short',
    '                                             //   plain sentence. On REJECTION, why (e.g. "studies/',
    '                                             //   characterizes the quality rather than practicing it",',
    '                                             //   "doesn\'t engage the quality", "discusses it only").',
    '                                             //   On ACCEPTANCE, a brief restatement of the exhibiting feature.',
    '}',
    'Return only the JSON object.',
  ].join('\n');
}

function judgeUser(target, rec) {
  const url = rec.best_oa_url || rec.doi || rec.openalex_id || '';
  const body =
    rec.full_text_available && rec.full_text
      ? String(rec.full_text).slice(0, FULLTEXT_PROMPT_CAP)
      : rec.abstract || '(no abstract available)';
  const kind = rec.full_text_available && rec.full_text ? 'FULL TEXT' : 'ABSTRACT ONLY';
  const p = target.parentPath.length ? target.parentPath.join(' > ') : '(root — no parent context)';
  return [
    'LEAF TARGET:',
    `  adjective: ${target.name}`,
    `  path (root → parent): ${p}`,
    '',
    'PAPER:',
    `  TITLE: ${rec.title || ''}`,
    `  VENUE: ${rec.host_venue || ''}   YEAR: ${rec.publication_year || ''}`,
    `  URL: ${url}`,
    '',
    `ARTICLE (${kind}):`,
    body,
    '',
    'Does this paper\'s actual research EXHIBIT the target quality at this path? Return the',
    'JSON verdict { exhibits, comment, confidence, reason }. No prose.',
  ].join('\n');
}

function judgeCachePath(target, paperId) {
  const h = fnv1a(
    `${GAIA_PROMPT_VERSION}|judge|${MODEL}|${EFFORT}|r${rubricHash()}|${normName(target.name)}|${pathKey(target.parentPath)}|${paperId}`
  );
  return path.join(CACHE_DIR, `judge-${h}.json`);
}

async function judgePaper(target, rec, systemText) {
  const cp = judgeCachePath(target, rec.id);
  if (fs.existsSync(cp)) {
    try {
      return JSON.parse(fs.readFileSync(cp, 'utf8'));
    } catch {
      // corrupt — recompute
    }
  }
  const { text, stop_reason } = await _callModel(systemText, judgeUser(target, rec), MAX_TOKENS_JUDGE);
  if (stop_reason === 'max_tokens') {
    console.warn(`    (warn) judgment truncated for ${rec.id} — skipping (not cached).`);
    return null;
  }
  const parsed = extractJson(text);
  if (!parsed || typeof parsed.exhibits !== 'boolean') {
    console.warn(`    (warn) judgment unparseable for ${rec.id} — skipping (not cached).`);
    return null;
  }
  const verdict = {
    exhibits: !!parsed.exhibits,
    comment: typeof parsed.comment === 'string' ? parsed.comment.trim() : null,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cp, JSON.stringify(verdict, null, 2), 'utf8');
  return verdict;
}

// ----------------------------------------------------------------------------
// Orchestration — ground one target
// ----------------------------------------------------------------------------

// Returns { accepted: [{ rec, claim, confidence }], rejected: [{ rec, reason }] } for the
// candidates actually judged. Accepted = exhibits && confidence in {high, medium} && a
// non-empty comment; every other judged candidate is recorded in rejected (with its
// reason) so the gate is auditable. Stops judging once the accept quota is met.
async function groundTarget(target, ctx) {
  const queries = await planQueries(target, ctx.systemQueryPlan);
  console.log(`    queries: ${queries.map((q) => `"${q}"`).join(', ')}`);

  const candidates = await retrieveCandidates(queries);
  console.log(`    candidates: ${candidates.length}`);

  const accepted = [];
  const rejected = [];
  for (const cand of candidates) {
    if (accepted.length >= TARGET_INSTANCES_PER_LEAF) break;
    const rec = await ensurePaperRecord(cand.work, cand.queries);
    const verdict = await judgePaper(target, rec, ctx.systemJudge);
    if (!verdict) {
      rejected.push({ rec, reason: 'judgment unavailable (truncated or unparseable response)' });
      continue;
    }
    if (verdict.exhibits && verdict.comment && (verdict.confidence === 'high' || verdict.confidence === 'medium')) {
      // Judgment returns its text as "comment"; the accepted/emitted representation uses
      // "claim" to match apply.js's link contract (the .md writer reads this same key).
      accepted.push({ rec, claim: verdict.comment, confidence: verdict.confidence });
      console.log(`      [accept ${verdict.confidence}] ${rec.id}  ${trunc(rec.title, 56)}`);
    } else {
      const why = verdict.reason || (verdict.exhibits ? 'exhibits but low confidence' : 'does not exhibit');
      rejected.push({ rec, reason: why });
    }
  }
  if (!accepted.length) console.log('      (no instances accepted)');
  return { accepted, rejected };
}

// ----------------------------------------------------------------------------
// Emit gaia-proposal.json + gaia-proposal.md
// ----------------------------------------------------------------------------

// Trimmed paper record for the proposal artifact (the full record, incl. full_text,
// lives in chaos/papers/<id>.json, which apply.js loads by id at cutover).
function trimPaperForProposal(rec) {
  return {
    id: rec.id,
    openalex_id: rec.openalex_id,
    doi: rec.doi || null,
    title: rec.title || null,
    authors: asArray(rec.authors),
    publication_year: rec.publication_year || null,
    host_venue: rec.host_venue || null,
    best_oa_url: rec.best_oa_url || null,
    full_text_available: !!rec.full_text_available,
    full_text_method: rec.full_text_method || null,
    referenced_works_count: asArray(rec.referenced_works).length,
  };
}

function writeProposalJson(citedRecords, links) {
  const out = {
    generated_by: 'chaos/gaia.js',
    model: MODEL,
    effort: EFFORT,
    rubric_version: rubricVersion(),
    gaia_prompt_version: GAIA_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    papers: citedRecords.map(trimPaperForProposal),
    links,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
}

function writeProposalMd(perLeaf) {
  const L = [];
  const totalInstances = perLeaf.reduce((n, e) => n + e.accepted.length, 0);
  const grounded = perLeaf.filter((e) => e.accepted.length > 0).length;

  L.push('# Chaos — Gaia instantiation proposal (the Instantiator)');
  L.push('');
  L.push(`**Generated by:** chaos/gaia.js · model ${MODEL} · effort ${EFFORT} · rubric v${rubricVersion()}`);
  L.push('**Write target:** this file + chaos/genesis/gaia-proposal.json + chaos/papers/<id>.json. No DB writes, no cutover.');
  L.push(`**Totals:** ${perLeaf.length} leaf target(s) attempted · ${grounded} grounded · ${totalInstances} instance link(s).`);
  L.push('');
  L.push('Each instance comment names the concrete feature of the work that exhibits the quality, in plain cross-disciplinary language (chaos.md §2).');
  L.push('');
  L.push('---');
  L.push('');

  for (const { target, accepted, rejected } of perLeaf) {
    L.push(`## ${target.name}`);
    L.push(`*path:* ${target.parentPath.length ? target.parentPath.join(' › ') : '(root)'}`);
    L.push('');
    if (!accepted.length) {
      L.push('_(no instances accepted)_');
      L.push('');
    } else {
      for (const a of accepted) {
        const url = a.rec.best_oa_url || a.rec.doi || a.rec.openalex_id || '';
        L.push(`- **${a.rec.title || a.rec.id}** _(${a.confidence})_`);
        L.push(`  ${a.claim}`);
        L.push(`  ${url}`);
      }
      L.push('');
    }
    // Auditable gate: every candidate that was judged but not accepted, with its reason.
    if (asArray(rejected).length) {
      L.push('**Considered but not accepted:**');
      for (const r of rejected) {
        const url = r.rec.best_oa_url || r.rec.doi || r.rec.openalex_id || '';
        L.push(`- ${r.rec.title || r.rec.id} — ${r.reason || '(no reason given)'} — ${url}`);
      }
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push('**END OF GAIA PROPOSAL — no dev-graph writes, no cutover. Review gate is next.**');
  L.push('');
  fs.writeFileSync(OUT_MD, L.join('\n'), 'utf8');
}

// ----------------------------------------------------------------------------
// CLI / main
// ----------------------------------------------------------------------------

function printPlan(targets) {
  console.log('================ CHAOS GAIA — PLAN (offline; no network, no model) ================');
  console.log(`source: ${path.relative(CHAOS_DIR, PROPOSAL_PATH)}  ·  rubric v${rubricVersion()}`);
  console.log(`\nLEAF TARGETS to ground (a multi-parent leaf appears once per path):\n`);
  for (const t of targets) {
    console.log(`  · ${t.name.padEnd(48)} ${pathLabel(t.parentPath)}`);
  }
  const leafNames = new Set(targets.map((t) => normName(t.name)));
  console.log(`\nleaf concepts: ${leafNames.size}   ·   leaf TARGETS (name×path): ${targets.length}`);
  console.log('================================================================================');
}

function printUsage(targets) {
  console.log('chaos/gaia.js — the Instantiator (Gaia). Grounds LEAF adjectives in the genesis proposal.');
  console.log('');
  console.log('Usage:');
  console.log('  node chaos/gaia.js --plan            # offline: list leaf targets (no network/model)');
  console.log('  node chaos/gaia.js --node "<Name>"   # ground one leaf (all its paths)');
  console.log('  node chaos/gaia.js --limit N         # ground the first N leaf targets');
  console.log('  node chaos/gaia.js --all             # ground every leaf target');
  console.log('  (optional: --effort=max  --model=…  --mailto=you@example.com)');
  console.log('');
  printPlan(targets);
  console.log('\n(No grounding flag given — nothing was grounded. Use --plan, --node, --limit, or --all.)');
}

function selectTargets(targets) {
  const node = argValue('--node');
  if (node) {
    const sel = targets.filter((t) => normName(t.name) === normName(node));
    if (!sel.length) throw new Error(`--node "${node}" matched no leaf target. Run --plan to see the list.`);
    return sel;
  }
  const limit = argValue('--limit');
  if (limit) {
    const n = Math.max(1, parseInt(limit, 10) || 1);
    return targets.slice(0, n);
  }
  if (process.argv.includes('--all')) return targets;
  return null; // no grounding flag
}

async function main() {
  const { targets } = loadTargets();

  if (process.argv.includes('--plan')) {
    printPlan(targets);
    return;
  }

  const selected = selectTargets(targets);
  if (!selected) {
    printUsage(targets);
    return;
  }

  // --- live grounding (requires ANTHROPIC_API_KEY + network) ---
  const rubric = loadRubric();
  const ctx = {
    systemQueryPlan: queryPlanSystem(rubric),
    systemJudge: judgeSystem(rubric),
  };

  console.log('================ CHAOS GAIA — GROUNDING ================');
  console.log(`model=${MODEL}  effort=${EFFORT}  mailto=${MAILTO}`);
  console.log(`targets: ${selected.length} (of ${targets.length} total leaf targets)\n`);

  const links = [];
  const citedRecords = new Map(); // id -> full rec (dedup across targets)
  const perLeaf = [];

  for (const target of selected) {
    console.log(`[ground] ${target.name}  ${pathLabel(target.parentPath)}`);
    const { accepted, rejected } = await groundTarget(target, ctx);
    for (const a of accepted) {
      const url = a.rec.best_oa_url || a.rec.doi || a.rec.openalex_id || '';
      links.push({
        attribute: 'value',
        concept_name: target.name,
        parent_path: target.parentPath,
        url,
        // Field name is "claim" to match apply.js's link contract (apply.js:324 reads
        // l.claim into the stored concept_links.comment) — drops into cutover with no glue.
        claim: a.claim,
        paper_id: a.rec.id,
      });
      citedRecords.set(a.rec.id, a.rec);
    }
    perLeaf.push({ target, accepted, rejected });
  }

  writeProposalJson([...citedRecords.values()], links);
  writeProposalMd(perLeaf);

  console.log('\n================ GAIA SUMMARY ================');
  console.log(`leaf targets grounded: ${perLeaf.filter((e) => e.accepted.length).length} / ${selected.length}`);
  console.log(`instance links emitted: ${links.length}`);
  console.log(`papers cited: ${citedRecords.size}`);
  console.log('\nAPI usage this run:');
  console.log(`  API calls made:          ${apiCallCount}`);
  console.log(`  input tokens (uncached): ${usageTotals.input_tokens}`);
  console.log(`  cache read tokens:       ${usageTotals.cache_read_input_tokens}`);
  console.log(`  output tokens:           ${usageTotals.output_tokens}`);
  console.log(`\nWrote ${path.relative(CHAOS_DIR, OUT_JSON)} and ${path.relative(CHAOS_DIR, OUT_MD)}`);
  console.log('Review next, then combine links[] into the cutover proposal (apply.js).');
  console.log('=============================================');
}

// Best-effort drain of undici keep-alive sockets so Node exits cleanly on Windows
// (same as categorizer.js / reason.js).
async function closeHttp() {
  try {
    const sym = Object.getOwnPropertySymbols(globalThis).find(
      (s) => s.description === 'undici.globalDispatcher.1'
    );
    const d = sym && globalThis[sym];
    if (d && typeof d.close === 'function') await d.close();
  } catch {
    /* ignore — best effort */
  }
}

if (require.main === module) {
  main()
    .then(async () => {
      await closeHttp();
      process.exitCode = 0;
    })
    .catch(async (err) => {
      console.error('\ngaia.js failed:', err.message);
      await closeHttp();
      process.exitCode = 1;
    });
}

module.exports = {
  normalizeNodes,
  loadTargets,
  fullTextPlan,
  isRetrievable,
  buildPaperRecord,
  sanitizeQuery,
  extractJson,
  fnv1a,
  planQueries,
  retrieveCandidates,
  judgePaper,
  groundTarget,
  trimPaperForProposal,
  __setCallModelForTest,
  GAIA_PROMPT_VERSION,
  OUT_JSON,
  OUT_MD,
};
