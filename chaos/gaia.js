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
 * source.js / reason.js / ouranos.js (not imported), so Gaia has no dependency on
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
const zlib = require('zlib');

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
// --multiattach writes a SEPARATE proposal; the two primary outputs above are never touched.
const OUT_MA_JSON = path.join(GENESIS_DIR, 'gaia-multiattach-proposal.json');
const OUT_MA_MD = path.join(GENESIS_DIR, 'gaia-multiattach-proposal.md');
// --coverage-probe (STEP 1): low-confidence/quarantine extractions land here for human review
// (gitignored, regenerable). The clean-upgrade work-list for STEP 2's force-re-judge lives here.
const COVERAGE_REVIEW_DIR = path.join(CHAOS_DIR, 'coverage-review');
const COVERAGE_UPGRADES_PATH = path.join(CHAOS_DIR, 'coverage-upgrades.json');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = argValue('--model') || 'claude-opus-4-8';
const EFFORT = argValue('--effort') || 'high'; // low | medium | high | xhigh | max

const MAILTO = argValue('--mailto') || process.env.CHAOS_MAILTO || '17willim@gmail.com';
const USER_AGENT = `chaos-orca/0.1 (mailto:${MAILTO})`;

// OpenAlex API key (Feb 2026: a key is required; the mailto polite-pool is no longer
// honored). Keyless ≈ 100 searches/day; a free key ≈ 1000/day. Sourced ONLY from the
// env var — never hardcode it, never write it to any file, and redact it from any log.
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || null;

// Strip the api_key value from any string before it is logged or thrown.
function redactApiKey(s) {
  return String(s).replace(/([?&]api_key=)[^&\s]+/gi, '$1REDACTED');
}

// Bumped whenever the Gaia prompt TEMPLATES below change in a way that should
// invalidate cached query-plans / judgments. Folded into the cache key alongside
// rubricHash(), so a rubric edit OR a prompt change auto-invalidates stale entries
// (same discipline as reason.js / ouranos.js).
const GAIA_PROMPT_VERSION = 'gaia3';

// Versions the --multiattach Stage-A "propose" prompt + its cache (gaia_cache/propose-*.json).
// DELIBERATELY SEPARATE from GAIA_PROMPT_VERSION: bumping this re-runs only multi-attach
// proposals and never invalidates the primary qplan/judge/leaf caches. Never fold it into
// those keys. Stage B reuses the existing judge (and its existing judge cache), unaffected.
const GAIA_MULTIATTACH_VERSION = 'ma1';

// Grounding budget knobs.
const TARGET_INSTANCES_PER_LEAF = 3; // stop a target once this many high/medium accepted
const MAX_QUERIES_PER_TARGET = 3;    // the planner returns 1–3 search strings
const CANDIDATES_PER_QUERY = 25;     // OpenAlex per_page per query
const MAX_CANDIDATES_PER_TARGET = 40; // candidates judged per target (after dedupe/rank)

// I/O caps (mirrors source.js / reason.js).
const FULLTEXT_MAX_CHARS = 120000;   // stored in the paper record (source.js parity)
const FULLTEXT_PROMPT_CAP = 60000;   // slice sent to the judge model (reason.js parity)
// Coverage-probe cleanliness gate: an extraction counts as CLEAN full text only above this
// char floor AND alphabetic-content ratio (rejects mostly-markup/garbage). PDF text is always
// treated as low-confidence regardless (flagged 'pdf-uncertain'), never written to papers/.
const CLEAN_MIN_CHARS = 3000;
const CLEAN_MIN_ALPHA = 0.6;
const HTTP_TIMEOUT_MS = 20000;       // OpenAlex + full-text fetches
const MODEL_TIMEOUT_MS = 420000;     // 7 min per model call
const MAX_RETRIES = 3;

// Output token ceilings for the two model calls (small JSON; generous thinking headroom).
const MAX_TOKENS_QPLAN = 6000;
const MAX_TOKENS_JUDGE = 8000;
const MAX_TOKENS_MA_PROPOSE = 8000; // Stage-A propose: up to 8 candidates, each with a feature string

// ----------------------------------------------------------------------------
// Small helpers (copied from reason.js / ouranos.js)
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
// (reason.js:119-132 / ouranos.js).
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

// Stronger ENVELOPE recovery for a malformed model response — recovers the JSON wrapper, never
// the verdict logic. Walks to the first BALANCED {…} object (tolerating markdown fences anywhere,
// leading preamble, and trailing prose/garbage), and repairs a recoverable truncation (an
// unterminated trailing string and/or unclosed braces). Returns a parsed object or null; field
// validation is the CALLER's job (salvage never fabricates a verdict from a half-object).
function salvageJson(text) {
  if (!text) return null;
  let s = String(text).replace(/```(?:json)?/gi, '');
  const start = s.indexOf('{');
  if (start === -1) return null;
  s = s.slice(start);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  // A clean balanced object was found → parse it, ignoring any trailing garbage.
  if (end !== -1) {
    try { return JSON.parse(s.slice(0, end + 1)); } catch { /* fall through to repair */ }
  }
  // Truncation repair: close a dangling string, then any still-open objects, and drop a
  // trailing comma before the synthetic closers. Only succeeds if the prefix was well-formed
  // up to the cut — a truncation before a required field stays unparseable (→ caller retries).
  let repaired = s;
  if (inStr) repaired += '"';
  if (depth > 0) repaired += '}'.repeat(depth);
  repaired = repaired.replace(/,(\s*\}+\s*)$/g, '$1');
  try { return JSON.parse(repaired); } catch { return null; }
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

// ----------------------------------------------------------------------------
// Broadened full-text fetchers (STEP 1). These run as FALLBACKS, AFTER the existing
// host-specific plan above. Used by --coverage-probe only — the live grounding path
// (tryFetchFullText) is unchanged. All HTTP goes through the existing httpGet client and
// respects the existing timeouts; no OpenAlex search, no model calls.
// ----------------------------------------------------------------------------

function isPdfUrl(u) {
  return /\.pdf($|\?)/i.test(String(u || '')) || /\/pdf($|\?|\/)/i.test(String(u || ''));
}

// Generic readability extractor for an OA landing/article HTML page: drop nav/boilerplate,
// prefer <article>/<main> if present, then strip a trailing references list when it is safely
// past the body (so methods/results prose survives). Returns clean prose.
function extractReadableHtml(html) {
  if (!html) return '';
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[\s\S]*?<\/form>/gi, ' ');
  const pick = (re) => { const m = s.match(re); return m ? m[1] : null; };
  const main = pick(/<article[^>]*>([\s\S]*?)<\/article>/i) || pick(/<main[^>]*>([\s\S]*?)<\/main>/i);
  let text = markupToText(main || s);
  // Trim a trailing references/bibliography list, but only when it sits in the back half and
  // leaves a substantial body — avoids cutting an early in-prose "references" mention.
  const refMatch = /\b(References|Bibliography|Literature Cited)\b/i.exec(text);
  if (refMatch && refMatch.index > Math.max(CLEAN_MIN_CHARS, text.length * 0.5)) {
    text = text.slice(0, refMatch.index).trim();
  }
  return text.slice(0, FULLTEXT_MAX_CHARS);
}

// Best-effort, dependency-free PDF text extraction (LOWER-TRUST). Inflates FlateDecode
// streams with the built-in zlib, then pulls parenthesized text from PDF text operators.
// Custom-encoded PDFs yield garbage — that is exactly why the result is flagged
// 'pdf-uncertain' and quarantined to coverage-review, never written to the paper cache.
function extractPdfTextOps(s) {
  let out = '';
  const re = /\((?:\\[\s\S]|[^()\\])*\)/g;
  const esc = { n: '\n', r: '\r', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };
  let m;
  while ((m = re.exec(s))) {
    out += m[0].slice(1, -1).replace(/\\([\s\S])/g, (_, c) => (c in esc ? esc[c] : c)) + ' ';
  }
  return out;
}
function extractPdfText(buf) {
  if (!buf || !buf.length) return '';
  const str = buf.toString('latin1');
  let collected = '';
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m;
  while ((m = streamRe.exec(str))) {
    const rawStream = Buffer.from(m[1], 'latin1');
    let data = null;
    try { data = zlib.inflateSync(rawStream); }
    catch { try { data = zlib.inflateRawSync(rawStream); } catch { data = null; } }
    if (data) collected += extractPdfTextOps(data.toString('latin1'));
  }
  // Also scan the raw file for any uncompressed text operators.
  collected += extractPdfTextOps(str);
  return collected
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/[^\x20-\x7E\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, FULLTEXT_MAX_CHARS);
}

// Unpaywall lookup by DOI (free; requires the email param). Returns the parsed JSON (with
// best_oa_location: { url, url_for_pdf, url_for_landing_page }) or null. Not an OpenAlex call.
async function fetchUnpaywall(doi) {
  const bare = doiBare(doi);
  if (!bare) return null;
  try {
    const res = await httpGet(
      `https://api.unpaywall.org/v2/${encodeURIComponent(bare)}?email=${encodeURIComponent(MAILTO)}`,
      'application/json'
    );
    if (!res.ok) return null;
    return JSON.parse(await res.text());
  } catch {
    return null;
  }
}

// Fetch one HTML URL and extract readable prose (or '' on any failure / non-HTML / too-short).
async function fetchHtmlReadable(url) {
  try {
    const res = await httpGet(url, 'text/html');
    if (!res.ok) return '';
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    if (!ctype.includes('html') && !ctype.includes('xml') && ctype) return '';
    return extractReadableHtml(await res.text());
  } catch {
    return '';
  }
}

// Fetch one PDF URL and extract lower-trust text (or '' on failure).
async function fetchPdfText(url) {
  try {
    const res = await httpGet(url, 'application/pdf');
    if (!res.ok) return '';
    const buf = Buffer.from(await res.arrayBuffer());
    return extractPdfText(buf);
  } catch {
    return '';
  }
}

// Broadened full-text fetch for a CACHED paper record. Order: existing host-specific plan →
// generic OA-landing HTML → Unpaywall (HTML, then PDF) → direct OA PDF. Returns
// { full_text, full_text_available, full_text_source, full_text_method, source_quality }
// where source_quality is 'clean' for HTML/XML prose or 'pdf-uncertain' for PDF text.
async function fetchFullTextBroadened(rec) {
  // Reconstruct a minimal work-like object so the existing host-specific fetchers get a shot.
  const oaUrl = (rec.open_access && rec.open_access.oa_url) || null;
  const locs = [];
  if (rec.best_oa_url) {
    locs.push({ is_oa: true, landing_page_url: isPdfUrl(rec.best_oa_url) ? null : rec.best_oa_url, pdf_url: isPdfUrl(rec.best_oa_url) ? rec.best_oa_url : null });
  }
  if (oaUrl && oaUrl !== rec.best_oa_url) {
    locs.push({ is_oa: true, landing_page_url: isPdfUrl(oaUrl) ? null : oaUrl, pdf_url: isPdfUrl(oaUrl) ? oaUrl : null });
  }
  const work = {
    doi: rec.doi || null,
    ids: rec.ids || {},
    best_oa_location: locs[0] || null,
    primary_location: null,
    locations: locs,
    open_access: rec.open_access || null,
  };

  // 1) existing host-specific plan (Europe PMC / arXiv / PMC / PLOS / eLife / etc.)
  const hs = await tryFetchFullText(work);
  if (hs.full_text_available && hs.full_text) return { ...hs, source_quality: 'clean' };

  // 2) generic OA-landing HTML (unknown publishers the host plan doesn't match)
  for (const u of [rec.best_oa_url, oaUrl].filter((x) => x && !isPdfUrl(x))) {
    const text = await fetchHtmlReadable(u);
    if (looksLikeArticleText(text)) {
      return { full_text: text, full_text_available: true, full_text_source: u, full_text_method: 'oa-html', source_quality: 'clean' };
    }
  }

  // 3) Unpaywall by DOI → best OA location (HTML first, then remember a PDF url)
  let pdfCandidates = [rec.best_oa_url, oaUrl].filter((x) => x && isPdfUrl(x));
  const up = await fetchUnpaywall(rec.doi);
  const upLoc = up && up.best_oa_location;
  if (upLoc) {
    const upLanding = upLoc.url_for_landing_page || upLoc.url;
    if (upLanding && !isPdfUrl(upLanding)) {
      const text = await fetchHtmlReadable(upLanding);
      if (looksLikeArticleText(text)) {
        return { full_text: text, full_text_available: true, full_text_source: upLanding, full_text_method: 'unpaywall-html', source_quality: 'clean' };
      }
    }
    if (upLoc.url_for_pdf) pdfCandidates.push(upLoc.url_for_pdf);
    if (upLoc.url && isPdfUrl(upLoc.url)) pdfCandidates.push(upLoc.url);
  }

  // 4) PDF (LOWER-TRUST) — extract but flag as pdf-uncertain (quarantined by the probe)
  pdfCandidates = [...new Set(pdfCandidates.filter(Boolean))];
  for (const u of pdfCandidates) {
    const text = await fetchPdfText(u);
    if (text && text.length >= 500) {
      return { full_text: text, full_text_available: true, full_text_source: u, full_text_method: 'pdf', source_quality: 'pdf-uncertain' };
    }
  }

  return { ...NO_FULLTEXT, source_quality: 'none' };
}

// Cleanliness gate: an extraction is CLEAN full text only above the char floor AND alphabetic
// ratio. PDF-uncertain text never qualifies (gated by source_quality at the call site).
function isCleanFullText(text) {
  if (!text || text.length < CLEAN_MIN_CHARS) return false;
  const letters = (text.match(/[A-Za-z]/g) || []).length;
  return letters / text.length >= CLEAN_MIN_ALPHA;
}

// STEP 1.5 — repository/portal HTML-stub detection. Many university Pure / DigitalCommons /
// Dagstuhl landing pages clear the char floor with abstract + fingerprint + citation/export
// blocks but carry NO article body. Returns the list of stub signatures present (empty = none).
function repositoryStubSignals(text) {
  const t = String(text || '');
  const sig = [];
  // Pure "Fingerprint" portal page. The PHRASE is the reliable tell — NOT a bare count of "%"
  // tokens, which genuine results sections (45%, 95% CI, p<.05) carry in abundance.
  if (/Dive into the research topics|Together they form a unique fingerprint/i.test(t)) sig.push('pure-fingerprint');
  const ris = ['U2 - ', 'DO - ', 'M3 - ', 'SP - ', 'EP - ', 'ER -'].filter((r) => t.includes(r));
  if (ris.length >= 2) sig.push(`ris-export(${ris.length})`);
  if (/author = "/.test(t) && (/abstract = "/.test(t) || /keywords = "/.test(t))) sig.push('bibtex-fields');
  if (/Skip to main content/i.test(t) && /(My Account|DOWNLOADS|Previous\s+Next|Digital Commons)/i.test(t)) sig.push('digitalcommons-chrome');
  if (/Export BibTeX|Export XML|Export ACM-XML|Schloss Dagstuhl|About DROPS/i.test(t)) sig.push('dagstuhl-drops');
  if (/Citation\/Publisher Attribution/i.test(t)) sig.push('citation-attribution');
  // DSpace / EPrints repository file-listing widget ("File(s) … Download <name>.pdf") — a
  // landing page for a deposited PDF, not the article body. "File(s)" with the parens is specific.
  if (/File\(s\)\s+Download|\bFile\(s\)\b/.test(t) || /\bFile\(s\)/.test(t)) sig.push('repo-file-listing');
  return [...new Set(sig)];
}

// At least 2 distinct article-body section headings — a weak positive signal that the text is a
// real body and not just an abstract page. (Structured abstracts can carry 1; require 2+.)
const BODY_SECTION_RE =
  /\b(Introduction|Methods?|Methodology|Materials and Methods|Results|Discussion|Conclusions?|Experimental|Findings|Related Work|Procedure|Participants|Data Collection|Statistical Analysis)\b/gi;
function hasBodySections(text) {
  const m = String(text || '').match(BODY_SECTION_RE) || [];
  return new Set(m.map((x) => x.toLowerCase())).size >= 2;
}

// Tightened gate for HTML/XML extractions: char/alpha floor AND no repository-stub signature AND
// (long enough OR shows body sections). A short oa-html page with no body markers is a stub.
function isCleanHtmlFullText(text) {
  if (!isCleanFullText(text)) return false;
  if (repositoryStubSignals(text).length) return false;
  if (text.length < 5000 && !hasBodySections(text)) return false;
  return true;
}

// STEP 1.5 — heuristic quality metrics for a PDF text extraction (no model, no rubric). Used to
// triage the quarantined PDF pile into failed / messy / borderline / clean before a human read.
function scorePdfText(text) {
  const t = String(text || '');
  const len = t.length;
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  const ws = (t.match(/\s/g) || []).length;
  const tokens = t.split(/\s+/).filter(Boolean);
  const longToks = tokens.filter((w) => w.length > 25).length; // column-merge / no-space tell
  const nonWord = (t.match(/[^A-Za-z0-9\s.,;:()\-'%/[\]]/g) || []).length; // garbage/ligature density
  const refIdx = (() => { const m = /\bReferences\b|\bBibliography\b/i.exec(t); return m ? m.index : -1; })();
  return {
    len,
    alpha: len ? letters / len : 0,
    wsRatio: len ? ws / len : 0,
    longRatio: tokens.length ? longToks / tokens.length : 1,
    garbageRatio: len ? nonWord / len : 1,
    refProp: refIdx >= 0 ? (len - refIdx) / len : 0,
    tokens: tokens.length,
  };
}

// Bucket a PDF extraction from its metrics: 'failed' (hard drop), 'messy', 'borderline', 'clean'.
function bucketPdf(m) {
  if (m.len < 2000 || m.alpha < 0.5 || m.wsRatio < 0.08 || m.garbageRatio > 0.15) return 'failed';
  if (m.alpha >= 0.62 && m.wsRatio >= 0.12 && m.wsRatio <= 0.25 && m.longRatio < 0.03 && m.garbageRatio < 0.05) return 'clean';
  if (m.alpha < 0.56 || m.longRatio >= 0.06 || m.garbageRatio >= 0.09) return 'messy';
  return 'borderline';
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

// OpenAlex 429 (rate-limit) backoff schedule: initial attempt + these retry waits.
// Honors a Retry-After response header when OpenAlex sends one; otherwise uses the
// fixed schedule. Only OpenAlex search requests use this — model calls are unaffected.
const OPENALEX_429_BACKOFF_MS = [2000, 5000, 15000, 30000];

// Parse an HTTP Retry-After header into milliseconds. It may be either an integer
// number of seconds or an HTTP-date; returns null if absent/unparseable.
function parseRetryAfterMs(res) {
  const h = res && res.headers && res.headers.get && res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const when = Date.parse(h);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

// Thrown when a 429 means the OpenAlex DAILY budget is gone (not a too-fast burst).
// Carries a flag so callers can re-raise it past the per-query catch and stop the run.
class OpenAlexBudgetExhaustedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OpenAlexBudgetExhaustedError';
    this.budgetExhausted = true;
  }
}

function readIntHeader(res, names) {
  for (const n of names) {
    const v = res && res.headers && res.headers.get && res.headers.get(n);
    if (v != null && v !== '') {
      const num = Number(v);
      if (Number.isFinite(num)) return num;
    }
  }
  return null;
}

// Classify a 429: daily-budget exhaustion (permanent until midnight UTC — pointless to
// retry) vs an ordinary too-fast burst (temporary — back off and retry). Exhaustion if a
// dedicated credits-remaining header is at/near zero, OR Retry-After is far longer than
// any per-second backoff (treat > 120s as exhaustion). Returns { exhausted, retryAfterMs }.
function classify429(res) {
  const retryAfterMs = parseRetryAfterMs(res);
  const creditsRemaining = readIntHeader(res, [
    'x-ratelimit-credits-remaining',
    'x-daily-credits-remaining',
    'x-credits-remaining',
  ]);
  const exhaustedByCredits = creditsRemaining != null && creditsRemaining <= 0;
  const exhaustedByRetryAfter = retryAfterMs != null && retryAfterMs > 120000;
  return { exhausted: exhaustedByCredits || exhaustedByRetryAfter, retryAfterMs };
}

// Whole hours+minutes until the next midnight UTC (when OpenAlex daily credits reset).
function msUntilMidnightUtc() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
  return next.getTime() - now.getTime();
}

function budgetExhaustedMessage(retryAfterMs) {
  const ms = retryAfterMs != null ? retryAfterMs : msUntilMidnightUtc();
  const totalMin = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return (
    `OpenAlex daily budget exhausted — resets at midnight UTC (~${h}h ${m}m from now). ` +
    `Re-run after reset; already-grounded leaves are cached and will skip.`
  );
}

// Targeted (per-node) retrieval: full-text search over title+abstract, OA + abstract +
// fulltext + DOI gated. NO recency/FROM_DATE bias — we want the best exhibit, not the
// newest paper (the bottom-up batch query in source.js is deliberately NOT carried over).
//
// On HTTP 429 we do NOT skip the search: we wait and retry the SAME request with
// exponential backoff (Retry-After honored when present). Only after the retries are
// exhausted do we give up on this search (throws, logged by the caller). Any other
// non-ok status throws immediately as before.
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
    `&mailto=${encodeURIComponent(MAILTO)}` +
    (OPENALEX_API_KEY ? `&api_key=${encodeURIComponent(OPENALEX_API_KEY)}` : '');

  // attempt 0 is the initial request; attempts 1..N are the backoff retries.
  for (let attempt = 0; attempt <= OPENALEX_429_BACKOFF_MS.length; attempt++) {
    const res = await httpGet(url, 'application/json');
    if (res.status === 429) {
      const { exhausted, retryAfterMs } = classify429(res);
      // Daily budget gone: retrying is pointless until midnight UTC. Throw a tagged
      // error so retrieveCandidates re-raises it and the whole run stops.
      if (exhausted) {
        throw new OpenAlexBudgetExhaustedError(budgetExhaustedMessage(retryAfterMs));
      }
      // Ordinary too-fast 429: capped backoff-and-retry (Retry-After honored).
      if (attempt < OPENALEX_429_BACKOFF_MS.length) {
        const waitMs = retryAfterMs != null ? retryAfterMs : OPENALEX_429_BACKOFF_MS[attempt];
        console.error(
          `    OpenAlex 429 (rate-limited) for "${query}" — waiting ${Math.round(waitMs / 1000)}s, ` +
          `retry ${attempt + 1}/${OPENALEX_429_BACKOFF_MS.length}`
        );
        await sleep(waitMs);
        continue;
      }
      throw new Error(`OpenAlex 429 (rate-limited) for search "${query}" — giving up after ${OPENALEX_429_BACKOFF_MS.length} retries`);
    }
    if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${redactApiKey(url)}`);
    const json = await res.json();
    return json.results || [];
  }
  // Unreachable (the loop either returns or throws), but keeps the function total.
  throw new Error(`OpenAlex retrieval failed for search "${query}"`);
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
// mirrors reason.js:521-588 / ouranos.js)
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
    throw new Error(`genesis proposal not found at ${PROPOSAL_PATH}. Run chaos/ouranos.js first.`);
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

// Returns { candidates, retrievalOk }. retrievalOk is false if ANY query failed
// (including a 429 that exhausted its retries in fetchWorksBySearch) — in that case
// the candidate set is incomplete/untrustworthy and the leaf must NOT be cached as
// done, so it retries on the next run.
async function retrieveCandidates(queries) {
  const byId = new Map(); // shortId -> work
  const querySetById = new Map(); // shortId -> Set<query> (which queries surfaced it)
  let retrievalOk = true;
  for (const q of queries) {
    let works = [];
    try {
      works = await fetchWorksBySearch(q, CANDIDATES_PER_QUERY);
    } catch (e) {
      // Daily-budget exhaustion is terminal — re-raise so the whole run stops here
      // (do NOT mark this leaf incomplete-and-continue; retrying is pointless).
      if (e && e.budgetExhausted) throw e;
      retrievalOk = false; // an ordinary failed search makes this leaf incomplete
      console.error(`    search failed "${q}": ${e.message}`);
    }
    for (const w of works) {
      const id = shortId(w.id);
      if (!byId.has(id)) byId.set(id, w);
      if (!querySetById.has(id)) querySetById.set(id, new Set());
      querySetById.get(id).add(q);
    }
    await sleep(250); // polite to OpenAlex (stay under the ~10 req/sec polite-pool ceiling)
  }
  // Rank retrievable (full-text-fetchable) first so we judge the strongest evidence first;
  // recency is intentionally NOT a factor (best exhibit, not newest).
  const works = [...byId.values()].sort((a, b) => (isRetrievable(a) ? 0 : 1) - (isRetrievable(b) ? 0 : 1));
  const capped = works.slice(0, MAX_CANDIDATES_PER_TARGET);
  const candidates = capped.map((w) => ({ work: w, queries: [...(querySetById.get(shortId(w.id)) || [])] }));
  return { candidates, retrievalOk };
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

// Load a previously-fetched paper record by id (no network). Used by the leaf-level
// cache to rehydrate a skipped leaf's accepted/rejected entries into full records so
// the proposal output is identical to a freshly-grounded leaf. Returns null if the
// record file is missing or corrupt.
function loadPaperRecordById(id) {
  const file = path.join(PAPERS_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
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

// Judgment-envelope recovery counters (process-wide; printed in the run summaries so the
// yield leak is visible/measurable). first-pass = parsed on the first try (the byte-identical
// existing path); salvaged = first response recovered by salvageJson; retried-ok = recovered
// after one reissued call; still-failed = warn-and-drop fallback (not cached).
const judgeRecovery = { firstPass: 0, salvaged: 0, retriedOk: 0, stillFailed: 0 };

// The REQUIRED judgment field the consumer reads (the verdict). A salvaged/partial object is
// acceptable only if it carries this; everything else is tolerated/defaulted in buildVerdict.
function isJudgment(p) {
  return !!p && typeof p.exhibits === 'boolean';
}
// Build the verdict object — identical coercion to the original judge path.
function buildVerdict(parsed) {
  return {
    exhibits: !!parsed.exhibits,
    comment: typeof parsed.comment === 'string' ? parsed.comment.trim() : null,
    confidence: ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low',
    reason: typeof parsed.reason === 'string' ? parsed.reason.trim() : '',
  };
}
// Recover a valid judgment object from a model response: primary extractJson FIRST (so a
// response that parses today is handled byte-identically as 'first'), then the stronger
// salvageJson. Returns { parsed, how: 'first' | 'salvaged' } or null. Never fabricates fields.
function recoverJudgment(text) {
  const p = extractJson(text);
  if (isJudgment(p)) return { parsed: p, how: 'first' };
  const s = salvageJson(text);
  if (isJudgment(s)) return { parsed: s, how: 'salvaged' };
  return null;
}
function cacheVerdict(cp, verdict) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cp, JSON.stringify(verdict, null, 2), 'utf8');
  return verdict;
}

// One terse line for the run summaries; null when no judgments ran this process.
function judgeRecoveryLine() {
  const j = judgeRecovery;
  if (j.firstPass + j.salvaged + j.retriedOk + j.stillFailed === 0) return null;
  return `judgment recovery: ${j.firstPass} first-pass · ${j.salvaged} salvaged · ${j.retriedOk} retried-ok · ${j.stillFailed} still-failed (dropped)`;
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

  // Attempt 1 — the existing request. extractJson-first keeps the valid path byte-identical;
  // salvageJson additionally recovers a malformed envelope or a recoverable truncation.
  const r1 = await _callModel(systemText, judgeUser(target, rec), MAX_TOKENS_JUDGE);
  const rec1 = recoverJudgment(r1.text);
  if (rec1) {
    if (rec1.how === 'first') judgeRecovery.firstPass += 1;
    else judgeRecovery.salvaged += 1;
    return cacheVerdict(cp, buildVerdict(rec1.parsed));
  }

  // One-shot retry — re-issue the SAME judgment request once, appending a terse envelope
  // reinforcement (NOT a template/rubric edit) to cut preamble/markdown/truncation. At most one.
  const retryUser = judgeUser(target, rec) +
    '\n\nRespond with ONLY the JSON object: no preamble, no markdown, no commentary.';
  const r2 = await _callModel(systemText, retryUser, MAX_TOKENS_JUDGE);
  const rec2 = recoverJudgment(r2.text);
  if (rec2) {
    judgeRecovery.retriedOk += 1;
    return cacheVerdict(cp, buildVerdict(rec2.parsed));
  }

  // Fallback — keep the original behavior: warn and DROP (not cached, so a later run can retry).
  judgeRecovery.stillFailed += 1;
  const truncated = r1.stop_reason === 'max_tokens' || r2.stop_reason === 'max_tokens';
  console.warn(
    `    (warn) judgment ${truncated ? 'truncated/unparseable' : 'unparseable'} for ${rec.id} ` +
      'after salvage + 1 retry — skipping (not cached).'
  );
  return null;
}

// ----------------------------------------------------------------------------
// Orchestration — ground one target
// ----------------------------------------------------------------------------

// Leaf-level "already grounded" cache. Keyed exactly like the qplan/judge caches
// (same GAIA_PROMPT_VERSION/MODEL/EFFORT/rubricHash/name/path inputs), so a rubric or
// prompt-version bump re-grounds every leaf — preserving the existing auto-invalidation
// discipline. A present file with complete===true means: retrieval succeeded with no
// failed/429 search and judging ran to its natural stop, so the leaf need not be
// re-searched. Accepted/rejected store paper ids only; full records are rehydrated from
// chaos/papers/<id>.json on read.
function leafCachePath(target) {
  const h = fnv1a(
    `${GAIA_PROMPT_VERSION}|leaf|${MODEL}|${EFFORT}|r${rubricHash()}|${normName(target.name)}|${pathKey(target.parentPath)}`
  );
  return path.join(CACHE_DIR, `leaf-${h}.json`);
}

// Returns { accepted, rejected } (full records rehydrated) for a completed cached leaf,
// or null on cache miss / corrupt / complete!==true / a missing accepted-paper record
// (in which case we fall through and re-ground so the proposal stays complete).
function readLeafCache(target) {
  const lp = leafCachePath(target);
  if (!fs.existsSync(lp)) return null;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(lp, 'utf8'));
  } catch {
    return null; // corrupt — re-ground
  }
  if (!data || data.complete !== true) return null;

  const accepted = [];
  for (const a of asArray(data.accepted)) {
    const rec = loadPaperRecordById(a.paper_id);
    if (!rec) {
      // Accepted papers feed the proposal links + cited records — if one can't be
      // reloaded, the skip would produce an incomplete proposal. Re-ground instead.
      console.warn(`    (leaf cache unusable — paper ${a.paper_id} record missing; re-grounding)`);
      return null;
    }
    accepted.push({ rec, claim: a.claim, confidence: a.confidence });
  }
  const rejected = [];
  for (const r of asArray(data.rejected)) {
    const rec = loadPaperRecordById(r.paper_id);
    if (!rec) continue; // rejected entries are audit-only; drop if the record is gone
    rejected.push({ rec, reason: r.reason });
  }
  return { accepted, rejected };
}

// Persist a completed leaf. Stores paper ids (not full records) — records live in
// chaos/papers/<id>.json and are rehydrated on read.
function writeLeafCache(target, accepted, rejected) {
  const lp = leafCachePath(target);
  const payload = {
    target: { name: target.name, parentPath: target.parentPath },
    accepted: accepted.map((a) => ({ paper_id: a.rec.id, claim: a.claim, confidence: a.confidence })),
    rejected: rejected.map((r) => ({ paper_id: r.rec.id, reason: r.reason })),
    complete: true,
    ts: new Date().toISOString(),
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(lp, JSON.stringify(payload, null, 2), 'utf8');
}

// Returns { accepted: [{ rec, claim, confidence }], rejected: [{ rec, reason }] } for the
// candidates actually judged. Accepted = exhibits && confidence in {high, medium} && a
// non-empty comment; every other judged candidate is recorded in rejected (with its
// reason) so the gate is auditable. Stops judging once the accept quota is met.
async function groundTarget(target, ctx) {
  // Skip guard — before any planning/retrieval/judging. A previously-completed leaf is
  // returned straight from cache: no model query-plan call, no OpenAlex search, no judging.
  const cached = readLeafCache(target);
  if (cached) {
    console.log(`    [skip] ${target.name} ${pathLabel(target.parentPath)} — already grounded (cache)`);
    return cached;
  }

  const queries = await planQueries(target, ctx.systemQueryPlan);
  console.log(`    queries: ${queries.map((q) => `"${q}"`).join(', ')}`);

  const { candidates, retrievalOk } = await retrieveCandidates(queries);
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

  // Cache ONLY a clean completion: retrieval trustworthy (no failed/429 search) AND
  // judging at its natural stop — the loop above breaks only on the accept quota or
  // after judging every retrieved candidate, so reaching here means it did. A complete
  // leaf is cached even with few/zero accepts (re-running identical queries won't find
  // more; thin leaves are handled later by multi-attach, not by re-searching). An
  // incomplete leaf (a failed search) is left uncached so it retries next run.
  if (retrievalOk) {
    writeLeafCache(target, accepted, rejected);
  } else {
    console.warn(`    (leaf not cached — a search failed/429'd after retries; will retry next run)`);
  }

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
// --multiattach — one paper → multiple concepts (Anthropic only; no OpenAlex)
// ----------------------------------------------------------------------------
//
// For every paper ACCEPTED in the primary pass, detect ADDITIONAL leaf qualities the
// paper's own research concretely EXHIBITS (chaos.md §2: "extract EVERY quality it
// exhibits; a paper linked to just one concept flags an under-utilized paper"). Works
// purely on the full text already on disk — NO OpenAlex, no retrieval, no rate limits.
// Two stages per paper:
//   A. PROPOSE (new prompt, cached per paper) — the model scans the full text against the
//      whole leaf menu and names additional (concept, path) it exhibits, each with a
//      concrete locatable feature. A generative shortlist only.
//   B. CONFIRM — the EXISTING strict judge (judgePaper) makes the real accept/reject and
//      reuses the existing per-(target,paper) judge cache. Stage A proposes; Stage B decides.
// Output is a SEPARATE reviewable proposal; nothing merges into the primary proposal here.

function multiAttachProposeSystem(rubric) {
  return [
    'You are Chaos, the INSTANTIATOR (Gaia), in MULTI-ATTACH PROPOSE mode.',
    'Your governing brain is the rubric below (chaos.md, v2.0). Obey it exactly.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'YOUR TASK THIS CALL: you are given ONE paper (its full text) and the COMPLETE MENU of',
    'leaf quality-adjectives (each as an adjective + its root→parent path). chaos.md §2:',
    '"Having read a paper, extract EVERY quality it exhibits; a paper linked to just one',
    'concept flags an under-utilized paper." Propose the ADDITIONAL menu leaves whose quality',
    "this paper's OWN RESEARCH CONCRETELY EXHIBITS — beyond the ones it is already linked to",
    '(listed under EXCLUDE).',
    '',
    'SAME DISCIPLINE AS THE JUDGE — non-negotiable:',
    '  - EXHIBITS, not DISCUSSES: the work itself must be an instance of the quality (the',
    '    researchers DID it / the work HAS it) — NOT a paper that is ABOUT, studies, reviews,',
    '    or recommends the quality. Apply the subject-matter-vs-method test: if the quality is',
    "    the paper's TOPIC rather than its METHOD, do NOT propose it.",
    '  - Meaning is COMPOSITIONAL: a leaf means what its PATH makes it mean. Read each menu',
    '    entry as its full path, and propose it only if the paper exhibits THAT path-meaning.',
    '',
    'THE FEATURE-OR-ABSTAIN GATE (bias toward OMITTING):',
    '  For EACH proposed quality you MUST point to a CONCRETE, LOCATABLE feature of the work —',
    '  what the researchers actually DID or what the work actually HAS. If a quality can only be',
    '  inferred from tone, framing, or stance with NO concrete feature to point at, OMIT it.',
    '  Fewer strong proposals beat more speculative ones.',
    '',
    'MENU DISCIPLINE:',
    '  - Choose ONLY from the menu provided. The (concept, path) you return MUST match a real',
    '    menu entry exactly — same adjective, same path. Do not invent concepts or paths.',
    '  - Do NOT propose any (concept, path) on the EXCLUDE list (already linked).',
    '  - Cap your answer at 8 candidates. Returning fewer, stronger ones is better.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no markdown fences. Exactly:',
    '{',
    '  "candidates": [',
    '    {',
    '      "concept": string,   // the menu adjective, exactly as listed',
    '      "path": [string],    // its root→parent path, exactly as listed ([] for a root leaf)',
    '      "feature": string    // the concrete, locatable feature of THIS work that exhibits it',
    '    }',
    '  ]',
    '}',
    'Return only the JSON object. An empty candidates array is valid (propose nothing).',
  ].join('\n');
}

function multiAttachProposeUser(rec, menuTargets, alreadyLinked) {
  const url = rec.best_oa_url || rec.doi || rec.openalex_id || '';
  const body =
    rec.full_text_available && rec.full_text
      ? String(rec.full_text).slice(0, FULLTEXT_PROMPT_CAP)
      : rec.abstract || '(no abstract available)';
  const kind = rec.full_text_available && rec.full_text ? 'FULL TEXT' : 'ABSTRACT ONLY';
  const fmt = (t) =>
    `  - ${t.name}  ::  ${asArray(t.parentPath).length ? t.parentPath.join(' > ') : '(root — no parent)'}`;
  const menu = menuTargets.map(fmt).join('\n');
  const excl = alreadyLinked.length ? alreadyLinked.map(fmt).join('\n') : '  (none)';
  return [
    'PAPER:',
    `  TITLE: ${rec.title || ''}`,
    `  VENUE: ${rec.host_venue || ''}   YEAR: ${rec.publication_year || ''}`,
    `  URL: ${url}`,
    '',
    `ARTICLE (${kind}):`,
    body,
    '',
    'COMPLETE MENU of leaf quality-adjectives (choose ONLY from these; match name + path exactly):',
    menu,
    '',
    'EXCLUDE — this paper is ALREADY linked to these (do NOT propose them again):',
    excl,
    '',
    "Which ADDITIONAL menu leaves does this paper's OWN research CONCRETELY EXHIBIT? For each,",
    'name the concrete locatable feature. Return the JSON { candidates: [...] }. No prose.',
  ].join('\n');
}

function multiAttachProposeCachePath(paperId) {
  const h = fnv1a(
    `${GAIA_MULTIATTACH_VERSION}|propose|${MODEL}|${EFFORT}|r${rubricHash()}|${paperId}`
  );
  return path.join(CACHE_DIR, `propose-${h}.json`);
}

// Stage A. Returns an array of { concept, path, feature } (≤8), cached per paper. Mirrors
// judgePaper's caching discipline: a successful parse (even with zero candidates) is cached;
// a truncated/unparseable response is NOT cached (so it retries on the next run).
async function proposeMultiAttach(rec, menuTargets, alreadyLinked, systemText) {
  const cp = multiAttachProposeCachePath(rec.id);
  if (fs.existsSync(cp)) {
    try {
      return asArray(JSON.parse(fs.readFileSync(cp, 'utf8')).candidates);
    } catch {
      // corrupt — recompute
    }
  }
  const { text, stop_reason } = await _callModel(
    systemText,
    multiAttachProposeUser(rec, menuTargets, alreadyLinked),
    MAX_TOKENS_MA_PROPOSE
  );
  if (stop_reason === 'max_tokens') {
    console.warn(`    (warn) propose truncated for ${rec.id} — skipping (not cached).`);
    return [];
  }
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.candidates)) {
    console.warn(`    (warn) propose unparseable for ${rec.id} — skipping (not cached).`);
    return [];
  }
  const candidates = parsed.candidates
    .filter((c) => c && typeof c.concept === 'string' && c.concept.trim())
    .map((c) => ({
      concept: c.concept.trim(),
      path: asArray(c.path).map(String),
      feature: typeof c.feature === 'string' ? c.feature.trim() : '',
    }))
    .slice(0, 8);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cp, JSON.stringify({ paper_id: rec.id, candidates }, null, 2), 'utf8');
  return candidates;
}

// Distinct paper ids accepted in the primary proposal, in first-appearance order.
function distinctAcceptedPaperIds(primaryLinks) {
  const seen = new Set();
  const order = [];
  for (const l of asArray(primaryLinks)) {
    const id = l && l.paper_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
}

function writeMultiAttachJson(citedRecords, links) {
  const out = {
    generated_by: 'chaos/gaia.js --multiattach',
    model: MODEL,
    effort: EFFORT,
    rubric_version: rubricVersion(),
    gaia_prompt_version: GAIA_PROMPT_VERSION,
    gaia_multiattach_version: GAIA_MULTIATTACH_VERSION,
    generated_at: new Date().toISOString(),
    // Trimmed to match the primary writer (apply.js loads full records from
    // chaos/papers/<id>.json by id at cutover); every cited paper is included.
    papers: citedRecords.map(trimPaperForProposal),
    links,
  };
  fs.writeFileSync(OUT_MA_JSON, JSON.stringify(out, null, 2), 'utf8');
}

function writeMultiAttachMd({ perGroup, buriedWins, scanned, skippedNoText, newLinkCount }) {
  const L = [];
  L.push('# Chaos — Gaia MULTI-ATTACH proposal (one paper → multiple concepts)');
  L.push('');
  L.push(`**Generated by:** chaos/gaia.js --multiattach · model ${MODEL} · effort ${EFFORT} · rubric v${rubricVersion()}`);
  L.push('**Write target:** this file + chaos/genesis/gaia-multiattach-proposal.json. The PRIMARY proposal is NOT touched. No DB writes, no cutover.');
  L.push(
    `**Totals:** ${scanned} paper(s) scanned${skippedNoText ? ` (+${skippedNoText} skipped, no full_text)` : ''} · ` +
    `${newLinkCount} new instance link(s) · ${perGroup.size} concept(s) gained instances.`
  );
  L.push('');
  L.push('Additional links found by re-reading each accepted paper against the full leaf menu and confirming with the SAME strict exhibits-not-discusses judge (chaos.md §2).');
  L.push('');

  // Buried-leaf wins up top — the high-value result.
  L.push('## Buried-leaf wins (had ZERO primary instances, now grounded by multi-attach)');
  L.push('');
  if (!buriedWins.length) {
    L.push('_(none — every concept grounded here already had at least one primary instance.)_');
  } else {
    for (const g of buriedWins) {
      L.push(
        `- **${g.name}** — *path:* ${g.parentPath.length ? g.parentPath.join(' › ') : '(root)'} — ` +
        `${g.instances.length} instance(s)`
      );
    }
  }
  L.push('');
  L.push('---');
  L.push('');

  if (!perGroup.size) {
    L.push('_(no new instances accepted.)_');
    L.push('');
  } else {
    for (const [, g] of perGroup) {
      L.push(`## ${g.name}`);
      L.push(`*path:* ${g.parentPath.length ? g.parentPath.join(' › ') : '(root)'}`);
      L.push('');
      for (const inst of g.instances) {
        const url = inst.rec.best_oa_url || inst.rec.doi || inst.rec.openalex_id || '';
        L.push(`- **${inst.rec.title || inst.rec.id}** _(${inst.confidence})_`);
        L.push(`  ${inst.claim}`);
        L.push(`  ${url}`);
      }
      L.push('');
    }
  }

  L.push('---');
  L.push('');
  L.push('**END OF MULTI-ATTACH PROPOSAL — primary proposal untouched, no dev-graph writes, no cutover.**');
  L.push('');
  fs.writeFileSync(OUT_MA_MD, L.join('\n'), 'utf8');
}

// Orchestrate the whole --multiattach run. Reads the primary proposal for the accepted-paper
// set, scans each paper's full text on disk, and writes the separate multi-attach proposal.
async function runMultiAttach() {
  if (!fs.existsSync(OUT_JSON)) {
    throw new Error(
      `primary proposal not found at ${OUT_JSON} — run primary grounding first ` +
      `(e.g. node chaos/gaia.js --all), then re-run --multiattach.`
    );
  }
  let primary;
  try {
    primary = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  } catch (e) {
    throw new Error(`could not read primary proposal ${OUT_JSON}: ${e.message}`);
  }
  const primaryLinks = asArray(primary.links);

  // The candidate menu: every leaf TARGET (name × path). Index by (normName|pathKey).
  const { targets: menuTargets } = loadTargets();
  const menuByKey = new Map();
  for (const t of menuTargets) menuByKey.set(`${normName(t.name)}|${pathKey(t.parentPath)}`, t);

  const rubric = loadRubric();
  const ctx = {
    systemJudge: judgeSystem(rubric),               // Stage B reuses the EXISTING judge verbatim
    systemPropose: multiAttachProposeSystem(rubric), // Stage A propose
  };

  // From the primary links: the DEDUPE set (concept|path|paper already grounded), the
  // per-paper already-linked targets (Stage-A exclude list), and the set of (concept|path)
  // tuples that have ≥1 primary instance (to detect buried-leaf wins).
  const dedupe = new Set();
  const linkedByPaper = new Map();
  const primaryGroundedTuples = new Set();
  for (const l of primaryLinks) {
    const pairKey = `${normName(l.concept_name)}|${pathKey(l.parent_path)}`;
    dedupe.add(`${pairKey}|${l.paper_id}`);
    primaryGroundedTuples.add(pairKey);
    if (!linkedByPaper.has(l.paper_id)) linkedByPaper.set(l.paper_id, []);
    linkedByPaper.get(l.paper_id).push({ name: l.concept_name, parentPath: asArray(l.parent_path) });
  }

  // Accepted papers (distinct, first-appearance order). For --multiattach, --limit caps PAPERS.
  let paperIds = distinctAcceptedPaperIds(primaryLinks);
  const totalAccepted = paperIds.length;
  const limit = argValue('--limit');
  if (limit) {
    const n = Math.max(1, parseInt(limit, 10) || 1);
    paperIds = paperIds.slice(0, n);
  }

  console.log('================ CHAOS GAIA — MULTI-ATTACH ================');
  console.log(`model=${MODEL}  effort=${EFFORT}  (Anthropic only — no OpenAlex)`);
  console.log(
    `accepted papers in primary proposal: ${totalAccepted}` +
    (limit ? `  ·  scanning first ${paperIds.length} (--limit ${limit})` : '  ·  scanning all')
  );
  console.log('');

  const newLinks = [];
  const citedRecords = new Map();        // id -> full rec
  const perGroup = new Map();            // "concept|path" -> { name, parentPath, instances: [] }
  let scanned = 0;
  let skippedNoText = 0;

  for (const pid of paperIds) {
    const rec = loadPaperRecordById(pid);
    if (!rec) {
      console.warn(`  [skip] ${pid} — paper record missing on disk`);
      continue;
    }
    if (!(rec.full_text_available && rec.full_text)) {
      console.warn(`  [skip] ${pid} — no full_text (cannot detect without text)`);
      skippedNoText++;
      continue;
    }
    scanned++;
    console.log(`[scan] ${rec.id}  ${trunc(rec.title, 60)}`);

    const alreadyLinked = linkedByPaper.get(pid) || [];
    const candidates = await proposeMultiAttach(rec, menuTargets, alreadyLinked, ctx.systemPropose);

    const seenPair = new Set(); // de-dup candidates within this paper by (concept|path)
    for (const cand of candidates) {
      const pairKey = `${normName(cand.concept)}|${pathKey(cand.path)}`;
      if (seenPair.has(pairKey)) continue;
      seenPair.add(pairKey);

      const target = menuByKey.get(pairKey);
      if (!target) continue; // not a real menu target — drop

      const tupleKey = `${pairKey}|${pid}`;
      if (dedupe.has(tupleKey)) continue; // already grounded in the primary pass

      // Stage B — the EXISTING strict judge makes the real accept/reject (cache-reused).
      const verdict = await judgePaper(target, rec, ctx.systemJudge);
      if (!verdict) continue;
      if (!(verdict.exhibits && verdict.comment && (verdict.confidence === 'high' || verdict.confidence === 'medium'))) {
        continue;
      }

      const url = rec.best_oa_url || rec.doi || rec.openalex_id || '';
      newLinks.push({
        attribute: 'value',
        concept_name: target.name,
        parent_path: target.parentPath,
        url,
        // The confirm verdict's comment becomes `claim`, exactly as in the primary path.
        claim: verdict.comment,
        paper_id: rec.id,
      });
      citedRecords.set(rec.id, rec);
      dedupe.add(tupleKey); // guard against any later duplicate
      const g = perGroup.get(pairKey) || { name: target.name, parentPath: target.parentPath, instances: [] };
      g.instances.push({ rec, claim: verdict.comment, confidence: verdict.confidence });
      perGroup.set(pairKey, g);
      console.log(`      [+attach ${verdict.confidence}] ${target.name}  ${pathLabel(target.parentPath)}`);
    }
  }

  // Buried-leaf wins: concepts that gained an instance here but had ZERO primary instances.
  const buriedWins = [];
  for (const [pairKey, g] of perGroup) {
    if (!primaryGroundedTuples.has(pairKey)) buriedWins.push(g);
  }

  writeMultiAttachJson([...citedRecords.values()], newLinks);
  writeMultiAttachMd({ perGroup, buriedWins, scanned, skippedNoText, newLinkCount: newLinks.length });

  console.log('\n================ MULTI-ATTACH SUMMARY ================');
  console.log(`papers scanned: ${scanned}` + (skippedNoText ? `  (skipped ${skippedNoText} with no full_text)` : ''));
  console.log(`new instance links emitted: ${newLinks.length}`);
  console.log(`buried-leaf wins (0 primary → now grounded): ${buriedWins.length}`);
  console.log(`papers cited: ${citedRecords.size}`);
  const maRecovery = judgeRecoveryLine();
  if (maRecovery) console.log(maRecovery);
  console.log(`\nWrote ${path.relative(CHAOS_DIR, OUT_MA_JSON)} and ${path.relative(CHAOS_DIR, OUT_MA_MD)}`);
  console.log('Primary proposal untouched. Review next.');
  console.log('=====================================================');
}

// ----------------------------------------------------------------------------
// --coverage-probe (STEP 1): read-only full-text coverage probe. Re-fetches the currently
// abstract-only papers through the BROADENED fetchers and reports what would be upgraded.
// NO judging, NO Anthropic API, NO OpenAlex search. Clean upgrades are written into
// chaos/papers/<id>.json (so STEP 2 reuses them without re-fetching); low-confidence /
// pdf-uncertain extractions go to chaos/coverage-review/<id>.txt for human eyeballing and are
// NEVER put in the paper cache. Papers that already had full text are not touched.
// ----------------------------------------------------------------------------

function pct(n, d) { return d ? `${Math.round((n / d) * 100)}%` : '0%'; }

function listPaperRecords() {
  if (!fs.existsSync(PAPERS_DIR)) return [];
  return fs.readdirSync(PAPERS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(PAPERS_DIR, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

function writeCoverageReview(id, rec, r, reason) {
  fs.mkdirSync(COVERAGE_REVIEW_DIR, { recursive: true });
  const header = [
    `# coverage-review · ${id}`,
    `title: ${rec.title || ''}`,
    `doi: ${rec.doi || ''}`,
    `source: ${r.full_text_source || ''}`,
    `method: ${r.full_text_method || ''}   source_quality: ${r.source_quality || ''}`,
    `chars: ${(r.full_text || '').length}   reason: ${reason}`,
    '----------------------------------------------------------------',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(COVERAGE_REVIEW_DIR, `${id}.txt`), header + (r.full_text || ''), 'utf8');
}

async function runCoverageProbe() {
  const delay = Number(process.env.CHAOS_OPENALEX_DELAY_MS || 1000);
  const idsArg = argValue('--ids');
  const limitArg = argValue('--limit');
  const all = listPaperRecords();
  const total = all.length;
  const fullBefore = all.filter((r) => r.full_text_available && r.full_text).length;

  // Target set: explicit --ids, else every abstract-only record.
  let targets;
  if (idsArg) {
    const wanted = new Set(idsArg.split(',').map((s) => s.trim()).filter(Boolean));
    targets = all.filter((r) => wanted.has(r.id));
  } else {
    targets = all.filter((r) => !(r.full_text_available && r.full_text));
  }
  if (limitArg) {
    const n = Math.max(1, parseInt(limitArg, 10) || 1);
    targets = targets.slice(0, n);
  }

  console.log('================ CHAOS GAIA — COVERAGE PROBE (read-only; no judging) ================');
  console.log(`papers on disk: ${total}  ·  full-text now: ${fullBefore}  ·  abstract-only: ${total - fullBefore}`);
  console.log(`probing ${targets.length} target(s)${idsArg ? ' (explicit --ids)' : ' (abstract-only set)'}${limitArg ? ` (--limit ${limitArg})` : ''}`);
  console.log(`fetchers: host-specific → OA-html → Unpaywall → PDF(lower-trust)  ·  mailto=${MAILTO}`);
  console.log('');

  const upgraded = [];   // ids upgraded to clean full text (written to papers/)
  const lowConf = [];    // ids with low-confidence / pdf-uncertain text (→ coverage-review)
  const stillFailed = [];
  let sampled = 0;

  for (const rec of targets) {
    const id = rec.id;
    let r;
    try { r = await fetchFullTextBroadened(rec); }
    catch { r = { ...NO_FULLTEXT, source_quality: 'none' }; }

    const clean = r.full_text_available && r.source_quality === 'clean' && isCleanHtmlFullText(r.full_text);
    if (clean) {
      // Upgrade the paper cache in place (preserve every other field).
      rec.full_text = r.full_text;
      rec.full_text_available = true;
      rec.full_text_source = r.full_text_source;
      rec.full_text_method = r.full_text_method;
      rec.full_text_source_quality = 'clean';
      rec.refetched_at = new Date().toISOString();
      fs.writeFileSync(path.join(PAPERS_DIR, `${id}.json`), JSON.stringify(rec, null, 2), 'utf8');
      upgraded.push({ id, method: r.full_text_method, chars: r.full_text.length, source: r.full_text_source });
      if (sampled < 5) { writeCoverageReview(id, rec, r, 'CLEAN SAMPLE (also upgraded into papers/)'); sampled += 1; }
      console.log(`  [upgrade] ${id}  ${r.full_text_method}  ${r.full_text.length} chars`);
    } else if (r.full_text && r.full_text.length) {
      const why = r.source_quality === 'pdf-uncertain'
        ? 'pdf-uncertain (lower-trust)'
        : `failed clean gate (${r.full_text.length} chars / alpha ratio)`;
      writeCoverageReview(id, rec, r, why);
      lowConf.push({ id, method: r.full_text_method, chars: r.full_text.length, why });
      console.log(`  [low-conf] ${id}  ${r.full_text_method}  ${r.full_text.length} chars → coverage-review`);
    } else {
      stillFailed.push(id);
    }
    if (delay) await sleep(delay);
  }

  // Work-list for STEP 2's force-re-judge (exactly the clean-upgraded ids).
  const upgradePayload = {
    generated_by: 'chaos/gaia.js --coverage-probe',
    generated_at: new Date().toISOString(),
    note: 'STEP 2 must force-re-judge these ids: the judgment cache is keyed by paper id + version, '
      + 'not content, so an upgraded paper would otherwise hit its stale abstract-only judgment.',
    upgraded_ids: upgraded.map((u) => u.id),
    upgraded,
  };
  fs.writeFileSync(COVERAGE_UPGRADES_PATH, JSON.stringify(upgradePayload, null, 2), 'utf8');

  const fullAfter = fullBefore + upgraded.length;
  console.log('\n================ COVERAGE PROBE SUMMARY ================');
  console.log(`coverage: ${fullBefore}/${total} (${pct(fullBefore, total)}) → projected ${fullAfter}/${total} (${pct(fullAfter, total)})`);
  console.log(`upgraded to CLEAN full text: ${upgraded.length}  (written into chaos/papers/)`);
  console.log(`low-confidence / pdf-uncertain: ${lowConf.length}  (→ chaos/coverage-review/, NOT cached)`);
  console.log(`still abstract-only / no text: ${stillFailed.length}`);
  console.log(`\nAnthropic judge calls this run: ${apiCallCount}  (must be 0 — the probe never judges)`);
  console.log('OpenAlex search calls this run: 0  (probe makes none — only Unpaywall/publisher HTTP)');
  console.log(`\nWrote ${path.relative(CHAOS_DIR, COVERAGE_UPGRADES_PATH)} (STEP 2 force-re-judge work-list).`);
  console.log(`coverage-review samples/low-conf under ${path.relative(CHAOS_DIR, COVERAGE_REVIEW_DIR)}/ (gitignored).`);
  console.log('No judging done. Review coverage-review/, then run STEP 2 to force-re-judge upgraded ids.');
  console.log('=======================================================');
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
  console.log('  node chaos/gaia.js --multiattach     # extra concepts per accepted paper (no OpenAlex)');
  console.log('  node chaos/gaia.js --multiattach --limit N   # only the first N accepted papers');
  console.log('  node chaos/gaia.js --coverage-probe  # STEP 1: re-fetch abstract-only papers (no judging/OpenAlex)');
  console.log('  node chaos/gaia.js --coverage-probe --ids W1,W2   # probe specific paper ids');
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
  // STEP 1 coverage probe — read-only, no proposal/targets/keys needed; checked first.
  if (process.argv.includes('--coverage-probe')) {
    await runCoverageProbe();
    return;
  }

  const { targets } = loadTargets();

  if (process.argv.includes('--plan')) {
    printPlan(targets);
    return;
  }

  // Multi-attach is a distinct mode: it ignores the target selection flags and instead
  // scans the accepted papers from the primary proposal (Anthropic only, no OpenAlex).
  if (process.argv.includes('--multiattach')) {
    await runMultiAttach();
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
  if (!OPENALEX_API_KEY) {
    console.warn(
      'No OPENALEX_API_KEY set — using keyless tier (~100 searches/day). ' +
      'Set OPENALEX_API_KEY for ~1000/day.'
    );
  }
  console.log(`targets: ${selected.length} (of ${targets.length} total leaf targets)\n`);

  const links = [];
  const citedRecords = new Map(); // id -> full rec (dedup across targets)
  const perLeaf = [];

  for (const target of selected) {
    console.log(`[ground] ${target.name}  ${pathLabel(target.parentPath)}`);
    let accepted, rejected;
    try {
      ({ accepted, rejected } = await groundTarget(target, ctx));
    } catch (e) {
      // Daily-budget exhaustion stops the run immediately. Leaves not yet grounded stay
      // uncached (they retry next run); the proposal is still written below from the
      // leaves grounded/cached so far, so a re-run after reset completes it.
      if (e && e.budgetExhausted) {
        console.error(`\n${e.message}`);
        break;
      }
      throw e;
    }
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
  const groundRecovery = judgeRecoveryLine();
  if (groundRecovery) console.log(groundRecovery);
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
// (same as ouranos.js / reason.js).
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
  salvageJson,
  extractReadableHtml,
  extractPdfText,
  fetchFullTextBroadened,
  isCleanFullText,
  isCleanHtmlFullText,
  repositoryStubSignals,
  hasBodySections,
  scorePdfText,
  bucketPdf,
  fnv1a,
  planQueries,
  retrieveCandidates,
  judgePaper,
  groundTarget,
  trimPaperForProposal,
  __setCallModelForTest,
  GAIA_PROMPT_VERSION,
  GAIA_MULTIATTACH_VERSION,
  OUT_JSON,
  OUT_MD,
  runMultiAttach,
  proposeMultiAttach,
  multiAttachProposeSystem,
  loadPaperRecordById,
  OUT_MA_JSON,
  OUT_MA_MD,
};
