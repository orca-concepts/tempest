#!/usr/bin/env node

/**
 * Chaos — Krius, the Scout (chaos.md v2.0 §2, §5, §11 step 6).
 *
 * The third engine. Krius is a BOTTOM-UP channel: it reads the already-built graph
 * (chaos/genesis/proposal.json) and its grounding (gaia-proposal.json +
 * gaia-multiattach-proposal.json) and proposes FRONTIERS — gaps the top-down engines
 * (Ouranos, Gaia) missed — WITHIN the existing spine (never new roots, chaos.md §2).
 *
 * It upholds the promotion invariant (chaos.md §9): it writes a reviewable JSON
 * proposal and NOTHING to the database. It does not call apply.js. It does not modify
 * any existing proposal file. Any graph-growing output it produces is name-based so a
 * human could later route it through apply.js's existing name-based multi-parent path.
 *
 * THREE FRONTIER KINDS (chaos.md §5):
 *   1. missing_placement   — an existing concept whose grounded papers also exhibit a
 *                            quality belonging under a DIFFERENT existing parent →
 *                            propose adding that concept under that other parent
 *                            (additive multi-parent edge). The ONLY apply.js-writable
 *                            kind; marked "writable": true.
 *   2. missing_adjective   — a recurring quality across a parent's grounded papers that
 *                            NONE of its existing children name → propose a new sibling
 *                            adjective as a frontier ("someone find this"). Advisory.
 *   3. missing_abstraction — papers under two different parents sharing a quality with
 *                            no common ancestor → "what is the missing abstraction?"
 *                            frontier naming the two regions + the shared quality.
 *                            Advisory.
 *
 * TWO INPUT CHANNELS:
 *   - CORPUS (free, always on): mines the papers already grounded in the proposals /
 *     on disk. ZERO OpenAlex calls. Kinds 1 & 3 are derived structurally from the
 *     existing (already model-judged) link graph; kind 2 uses a cheap propose call +
 *     the SAME strict gaia.judgePaper confirm.
 *   - ANCHORED-RETRIEVAL (bold, costs OpenAlex, OFF by default behind --retrieve):
 *     for thin / high-traffic regions, retrieve a small batch of OpenAlex papers
 *     ANCHORED to that region's topic (never a blind/random sample — anchoring is what
 *     preserves §2's anti-blind-sampling stance) and feed them into kind 2.
 *
 * CHECKED DISCIPLINE (enforced in code, not just documented):
 *   - ABSTAIN GATE: no frontier is proposed unless ≥2 DISTINCT papers concretely
 *     exhibit the quality. A thesaurus pile of near-synonym adjectives is the §5
 *     failure mode this prevents. A zero abstain count means the gate isn't firing.
 *   - TWO-STAGE, like Gaia multi-attach: Stage A surfaces candidates (structurally for
 *     kinds 1 & 3; via a cheap propose call for kind 2), Stage B confirms (the ≥2
 *     distinct-paper gate for all; plus the SAME strict gaia.judgePaper for kind 2).
 *
 * REUSE (not reimplementation): the OpenAlex client + 429/budget handling, the
 * exhibits-not-discusses judge, paper-on-disk reads, and the JSON/cache helpers are
 * IMPORTED from chaos/gaia.js (which is require-safe — its main() is guarded). gaia.js
 * is NOT modified. Only the bottom-up Stage-A "propose" prompt + Krius's own cache are
 * new here, namespaced separately from Gaia's (KRIUS_PROMPT_VERSION, krius_cache/).
 *
 * Outputs (files only; no DB writes):
 *   - chaos/genesis/krius-proposal.json   — { ..., frontiers[], papers[] } (name-based)
 *   - chaos/genesis/krius-proposal.md     — human review, grouped by region
 *   - chaos/krius_cache/*.json            — regenerable propose cache (gitignored)
 *
 * Usage:
 *   node chaos/krius.js --dry-run                 # default-safe: summary only, NO network, writes nothing
 *   node chaos/krius.js                           # corpus channel only; writes the proposal
 *   node chaos/krius.js --retrieve --limit N      # adds anchored OpenAlex retrieval, capped at N/region
 *   node chaos/krius.js --region "Rigorous"       # restrict to one root's subtree
 *   (optional: --effort=max  --model=…  --mailto=you@example.com)
 *
 * Env: ANTHROPIC_API_KEY (kind 2, real runs), OPENALEX_API_KEY (--retrieve only),
 *      CHAOS_OPENALEX_DELAY_MS, CHAOS_MAILTO — same as Gaia. NEVER hardcode a key.
 */

const path = require('path');
const fs = require('fs');

// ----------------------------------------------------------------------------
// Reuse Gaia's proven building blocks (gaia.js is require-safe; not modified).
// ----------------------------------------------------------------------------
const gaia = require('./gaia.js');
const {
  judgePaper,          // Stage B — the SAME strict exhibits-not-discusses judge (caches in gaia_cache)
  retrieveCandidates,  // OpenAlex client + 429 / budget-exhaustion handling (anchored channel)
  buildPaperRecord,    // OpenAlex work -> paper record (abstract-level; anchored channel)
  loadPaperRecordById, // chaos/papers/<id>.json reads (kind-2 Stage B needs full text)
  extractJson,         // tolerant JSON extraction
  fnv1a,               // content-addressed cache hashing
  sanitizeQuery,       // strip commas/pipes for OpenAlex free-text search
} = gaia;

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const CHAOS_DIR = __dirname;
const RUBRIC_PATH = path.join(CHAOS_DIR, 'chaos.md');
const GENESIS_DIR = path.join(CHAOS_DIR, 'genesis');
const PROPOSAL_PATH = path.join(GENESIS_DIR, 'proposal.json');
const GAIA_PRIMARY_PATH = path.join(GENESIS_DIR, 'gaia-proposal.json');
const GAIA_MULTIATTACH_PATH = path.join(GENESIS_DIR, 'gaia-multiattach-proposal.json');
const OUT_JSON = path.join(GENESIS_DIR, 'krius-proposal.json');
const OUT_MD = path.join(GENESIS_DIR, 'krius-proposal.md');
// Krius's OWN cache namespace — deliberately SEPARATE from Gaia's gaia_cache/ and from
// GAIA_PROMPT_VERSION (the propose prompt below can change without touching any Gaia cache).
const CACHE_DIR = path.join(CHAOS_DIR, 'krius_cache');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = argValue('--model') || 'claude-opus-4-8';
const EFFORT = argValue('--effort') || 'high';
const MAILTO = argValue('--mailto') || process.env.CHAOS_MAILTO || '17willim@gmail.com';

// OpenAlex key — anchored channel only; sourced ONLY from env, NEVER hardcoded/logged
// (the repo is public). Keyless ≈ 100 searches/day; a free key ≈ 1000/day (chaos.md ops).
const OPENALEX_API_KEY = process.env.OPENALEX_API_KEY || null;

// Krius's prompt/cache version. Bumping it re-runs only Krius's propose cache and never
// touches Gaia's qplan/judge/leaf caches. NOT GAIA_PROMPT_VERSION (chaos.md cache rule).
// k2: all three kinds now pass a §5 model-judged gate (placement/abstraction were cheap
// co-occurrence counters in k1); bumping invalidates every k1 candidate/judgment.
const KRIUS_PROMPT_VERSION = 'k2';

// Checked-discipline knobs.
const MIN_PAPERS = 2;                 // the abstain gate: ≥2 distinct exhibiting papers, or abstain
const MAX_PROPOSE_PAPERS = 24;        // region papers sampled into a Stage-A propose call
const MAX_NEW_ADJECTIVES = 6;         // Stage-A propose cap per parent
const MAX_SEP_NEIGHBORS = 8;          // overlapping-evidence neighbors checked for adjective separability
const ANCHORED_PER_QUERY = 25;        // OpenAlex per_page (anchored channel)
const MODEL_TIMEOUT_MS = 420000;
const MAX_RETRIES = 3;
const MAX_TOKENS_PROPOSE = 8000;
const MAX_TOKENS_JUDGE = 4000;        // placement / abstraction / separability judges (small JSON)
const DEFAULT_CAP = 5;                // top-N surviving frontiers kept per kind per region (--cap)

// CLI flags.
const DRY_RUN = process.argv.includes('--dry-run');
const RETRIEVE = process.argv.includes('--retrieve');
// --refresh: re-run the §5 judges for the active region IGNORING cached judgments, so
// already-judged candidates get their rationale recorded into the audit. Recording-only —
// it does NOT bump KRIUS_PROMPT_VERSION (the prompts/logic are unchanged) and does NOT
// re-propose adjective candidates (candidate generation is untouched).
const REFRESH = process.argv.includes('--refresh');
const REGION = argValue('--region');
const LIMIT = (() => {
  const v = argValue('--limit');
  if (v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
})();
const CAP = (() => {
  const v = argValue('--cap');
  if (v == null) return DEFAULT_CAP;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CAP;
})();

// ----------------------------------------------------------------------------
// Small helpers (trivial; gaia keeps private copies of the same — not "building blocks")
// ----------------------------------------------------------------------------

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const pre = process.argv.find((x) => x.startsWith(flag + '='));
  return pre ? pre.split('=').slice(1).join('=') : null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function asArray(v) { return Array.isArray(v) ? v : []; }
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function normName(s) { return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim(); }
// canonicalName: the SINGLE name-comparison key for name hygiene (the collision guard +
// abstraction/adjective consolidation all route through it). Stricter than normName — it also
// collapses internal whitespace AND treats hyphen/space variants as equal, so
// "Cross-checked" = "Cross-Checked" = "cross checked". Display always keeps the original casing
// of the first occurrence; only COMPARISON uses this canonical form (chaos.md §5.3, §7).
function canonicalName(s) { return String(s || '').toLowerCase().replace(/[’`]/g, "'").replace(/[-\s]+/g, ' ').trim(); }
// Strict path-prefix test (name-based, normName per element): is `a` shorter than `b` and a
// prefix of it on the same branch? Used to drop a broader adjective placement in favor of a
// more specific one nested under it (§5.3 — keep the most specific placement).
function isStrictPathPrefix(a, b) {
  const A = asArray(a).map(normName), B = asArray(b).map(normName);
  if (A.length >= B.length) return false;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
  return true;
}
// Length of the shared leading run of two strings (the conservative near-duplicate stem test).
function commonPrefixLen(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i++;
  return i;
}
// Levenshtein edit distance (short strings only) — the near-duplicate spelling-twin test.
function levenshtein(a, b) {
  a = String(a); b = String(b);
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}
// Conservative spelling-twin test: DISTINCT canonical names that share a real stem AND are within
// a small edit distance (e.g. "reconstructable" / "reconstructible"). Deliberately strict to
// avoid flagging coincidental short-word collisions — this only ADDS a reviewer note, never merges.
function isNearDuplicateName(a, b) {
  if (a === b) return false;
  if (Math.min(a.length, b.length) < 5) return false;
  return commonPrefixLen(a, b) >= 4 && levenshtein(a, b) <= 3;
}
function pathKey(arr) { return asArray(arr).map(normName).join(' > '); }
function pathLabel(pp) {
  const arr = asArray(pp).filter((x) => x != null && String(x).length);
  return arr.length ? `under: ${arr.join(' › ')}` : '(root)';
}
function loadRubric() { return fs.readFileSync(RUBRIC_PATH, 'utf8'); }
let _rubricMemo = null;
function rubric() { if (_rubricMemo === null) _rubricMemo = loadRubric(); return _rubricMemo; }
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
  } catch { return 'unknown'; }
}

// ----------------------------------------------------------------------------
// Inputs: the taxonomy graph + the grounding evidence (read from PROPOSALS, not the DB
// — the proposals are the source of truth, chaos.md §9; reading them keeps Krius
// independent of DB state).
// ----------------------------------------------------------------------------

function loadJson(p, what) {
  if (!fs.existsSync(p)) {
    throw new Error(`${what} not found at ${path.relative(CHAOS_DIR, p)} — Krius reads the proposals, not the DB.`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Normalize a genesis node to { name, parent_paths: string[][] } (tolerates a single flat path).
function normalizeNode(n) {
  let pp = n.parent_paths;
  if (pp == null) pp = [];
  else if (Array.isArray(pp) && pp.length && !Array.isArray(pp[0])) pp = [pp];
  pp = asArray(pp).map((p) => asArray(p).map(String)).filter((p) => p.length);
  return { name: String(n.name).trim(), parent_paths: pp };
}

// Build the structural model of the graph: node lookup, placements, parent→children, roots.
function buildGraph(proposal) {
  const nodes = asArray(proposal.nodes)
    .filter((n) => n && typeof n.name === 'string' && n.name.trim())
    .map(normalizeNode);

  const byName = new Map();              // norm name -> node
  for (const n of nodes) byName.set(normName(n.name), n);
  // canonical-name index (hyphen/case/whitespace-insensitive) — backs the collision guard so a
  // proposed name that already exists as a concept under ANY spelling variant is caught (§5.3).
  const byCanon = new Map();             // canonical name -> node (first occurrence)
  for (const n of nodes) if (!byCanon.has(canonicalName(n.name))) byCanon.set(canonicalName(n.name), n);

  // children: norm(parent) -> Set<norm(child)>, derived from every placement's immediate parent.
  const children = new Map();
  // parentsOf: norm(child) -> Set<norm(parent)> (immediate parents across placements).
  const parentsOf = new Map();
  const addChild = (parent, child) => {
    if (!children.has(parent)) children.set(parent, new Set());
    children.get(parent).add(child);
    if (!parentsOf.has(child)) parentsOf.set(child, new Set());
    parentsOf.get(child).add(parent);
  };
  for (const n of nodes) {
    for (const pp of n.parent_paths) {
      const immediate = normName(pp[pp.length - 1]);
      addChild(immediate, normName(n.name));
    }
  }

  const roots = nodes.filter((n) => !n.parent_paths.length).map((n) => normName(n.name));
  const rootSet = new Set(roots);

  // Existing-name collision guard + current-parent index (§5.3 review context). All three
  // channels share these so a proposed "new" name that already exists as a concept is never
  // emitted as new (it is rerouted to a placement candidate or dropped).
  const EMPTY = new Set();
  // Collision guard routes through canonicalName: a proposed name colliding with an existing
  // concept under ANY hyphen/case/whitespace variant counts as existing (rerouted, not new).
  const nameExists = (name) => byCanon.has(canonicalName(name));
  // Resolve a (possibly variant-spelled) name to its node — norm match first, then canonical.
  const lookupNode = (name) => byName.get(normName(name)) || byCanon.get(canonicalName(name)) || null;
  const edgeExists = (parentName, childName) =>
    (parentsOf.get(normName(childName)) || EMPTY).has(normName(parentName));
  const currentParents = (childName) =>
    [...(parentsOf.get(normName(childName)) || EMPTY)].map((p) => (byName.get(p) ? byName.get(p).name : p));
  const currentParentLabel = (childName) => {
    const ps = currentParents(childName);
    if (ps.length) return `currently under: ${ps.join(', ')}`;
    if (rootSet.has(normName(childName))) return 'currently a root (no parent)';
    return 'currently unplaced';
  };

  return {
    nodes, byName, byCanon, children, parentsOf, roots, rootSet,
    nameExists, lookupNode, edgeExists, currentParents, currentParentLabel,
  };
}

// The region of a placement path = its root (path[0]); for a root concept, itself.
function regionOfPath(parentPath, conceptName) {
  const pp = asArray(parentPath);
  return pp.length ? normName(pp[0]) : normName(conceptName);
}

// Merge both grounding proposals into the evidence model. Each link already encodes a
// model judgment (a confirmed exhibits-not-discusses verdict), so the corpus channel
// treats links as pre-judged data — no model call needed for kinds 1 & 3.
function buildEvidence() {
  const primary = loadJson(GAIA_PRIMARY_PATH, 'primary grounding proposal');
  const multi = loadJson(GAIA_MULTIATTACH_PATH, 'multi-attach grounding proposal');
  const links = [...asArray(primary.links), ...asArray(multi.links)];

  // paperMeta: id -> { title, url } (from the proposals' papers[] records).
  const paperMeta = new Map();
  for (const p of [...asArray(primary.papers), ...asArray(multi.papers)]) {
    if (p && p.id != null && !paperMeta.has(p.id)) {
      paperMeta.set(p.id, { title: p.title || null, url: p.best_oa_url || p.doi || p.openalex_id || null });
    }
  }

  // paperToQualities: paper_id -> [{ concept(norm), conceptName, path(names), region, feature }]
  // qualityPapers: norm(concept) -> Set<paper_id>   (papers exhibiting this concept anywhere)
  // featureOf: `${norm concept}|${paper_id}` -> feature string (the link comment)
  const paperToQualities = new Map();
  const qualityPapers = new Map();
  const featureOf = new Map();
  for (const l of links) {
    const c = normName(l.concept_name);
    const pid = l.paper_id;
    if (!c || !pid) continue;
    const ppath = asArray(l.parent_path).map(String);
    const region = regionOfPath(ppath, l.concept_name);
    if (!paperToQualities.has(pid)) paperToQualities.set(pid, []);
    paperToQualities.get(pid).push({ concept: c, conceptName: l.concept_name, path: ppath, region, feature: l.claim || '' });
    if (!qualityPapers.has(c)) qualityPapers.set(c, new Set());
    qualityPapers.get(c).add(pid);
    const fk = `${c}|${pid}`;
    if (!featureOf.has(fk)) featureOf.set(fk, l.claim || '');
  }

  return { links, paperMeta, paperToQualities, qualityPapers, featureOf };
}

// ----------------------------------------------------------------------------
// Anthropic caller (Stage-A "propose" only — a NEW Krius prompt). Stage B reuses
// gaia.judgePaper (and Gaia's caller) verbatim. Generic Messages-API fetch.
// ----------------------------------------------------------------------------

const usageTotals = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
let apiCallCount = 0;

async function callModel(systemText, userText, maxTokens) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set. Export it and re-run (kind-2 frontiers need it).');
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
        headers: { 'x-api-key': apiKey, 'anthropic-version': API_VERSION, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) { await sleep(1500 * attempt); continue; }
        throw lastErr;
      }
      const json = JSON.parse(text);
      apiCallCount += 1;
      if (json.usage) {
        usageTotals.input_tokens += json.usage.input_tokens || 0;
        usageTotals.output_tokens += json.usage.output_tokens || 0;
        usageTotals.cache_read_input_tokens += json.usage.cache_read_input_tokens || 0;
      }
      if (json.stop_reason === 'refusal') throw new Error('Model refused the request.');
      const out = asArray(json.content).filter((b) => b.type === 'text').map((b) => b.text).join('');
      return { text: out, stop_reason: json.stop_reason };
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES && /aborted|ECONNRESET|network|fetch failed/i.test(e.message)) { await sleep(1500 * attempt); continue; }
      throw lastErr;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('callModel failed');
}

// ----------------------------------------------------------------------------
// §5 model-judged gate (shared by all three kinds). Co-occurrence only GENERATES
// candidates; this is the gate that decides whether a candidate is a real frontier.
// Default posture is ABSTAIN: a verdict is required, and a null/unparseable/dry-run
// verdict is "pending" (neither emitted nor counted as a §5 abstain). Cached per
// (candidate, prompt version) under krius_cache/, same discipline as the propose cache.
// ----------------------------------------------------------------------------

function judgeCachePath(kind, sigParts) {
  const h = fnv1a(`${KRIUS_PROMPT_VERSION}|${kind}|${MODEL}|${EFFORT}|r${rubricHash()}|${sigParts.join('|')}`);
  return path.join(CACHE_DIR, `${kind}-${h}.json`);
}

// Returns a parsed verdict object, or null = "pending" (dry-run / call failed / truncated /
// unparseable). Null is never cached, so it retries on the next non-dry run.
async function cachedJudge(kind, sigParts, systemText, userText, parseFn) {
  const cp = judgeCachePath(kind, sigParts);
  // --refresh re-judges (skips the cache READ) so rationales get re-recorded; it still
  // WRITES the cache below. Cached verdicts already retain rationale for BOTH outcomes
  // (parsePlacement/parseAbstraction/parseSeparability keep it regardless of the verdict).
  if (!REFRESH && fs.existsSync(cp)) {
    try { return JSON.parse(fs.readFileSync(cp, 'utf8')); } catch { /* recompute */ }
  }
  if (DRY_RUN) return null; // judge-pending in dry-run — no network
  let resp;
  try { resp = await callModel(systemText, userText, MAX_TOKENS_JUDGE); }
  catch (e) { console.warn(`    (warn) ${kind} judge call failed — pending: ${e.message}`); return null; }
  if (resp.stop_reason === 'max_tokens') { console.warn(`    (warn) ${kind} judge truncated — not cached.`); return null; }
  const verdict = parseFn(extractJson(resp.text));
  if (!verdict) { console.warn(`    (warn) ${kind} judge unparseable — not cached.`); return null; }
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cp, JSON.stringify(verdict, null, 2), 'utf8');
  return verdict;
}

const RUBRIC_HEADER = ['================ BEGIN chaos.md ================'];
const RUBRIC_FOOTER = ['================ END chaos.md ================'];

// ---- placement judge: the §5.4-DOWN test (a genuine kind-of / legible narrowing) ----
function placementJudgeSystem(r) {
  return [
    'You are Chaos, the SCOUT (Krius), in PLACEMENT-JUDGE mode (chaos.md v2.0 §5, §8).',
    'Your governing brain is the rubric below. Obey it exactly; invent no rules it does not state.',
    '', ...RUBRIC_HEADER, r, ...RUBRIC_FOOTER, '',
    'The graph is a pure KIND-OF hierarchy of bare quality-adjectives describing GOOD RESEARCH;',
    'meaning is compositional, read along the PATH (§1, §7, §8). You are given a candidate edge',
    '"{Parent} › {Concept}" generated because the same papers exhibit both. Apply the §5.4-DOWN',
    'test: a child must read as a genuine NARROWING of the parent-as-read-in-context — {Concept}',
    'must be ONE WAY OF BEING {Parent}, so the path is a legible composition.',
    '',
    'Answer YES only if the kind-of relation holds on the concepts\' MEANINGS. Do NOT answer YES',
    'merely because the same papers exhibit both, or because both are good-research qualities. If',
    '{Concept} belongs to a DIFFERENT FAMILY (e.g. it is about consent, collaboration, replication,',
    'or accuracy rather than about {Parent}), answer NO. Default to NO when unsure (abstain-by-default).',
    '',
    'OUTPUT CONTRACT: STRICT JSON ONLY — no prose, no fences. Exactly:',
    '{ "kind_of": boolean, "rationale": string }   // rationale: ONE short plain sentence, either way',
    'Return only the JSON object.',
  ].join('\n');
}
function placementJudgeUser(parentName, conceptName, chainNames, exampleFeatures) {
  const ex = exampleFeatures.length
    ? exampleFeatures.map((f) => `  - ${trunc(f, 200)}`).join('\n')
    : '  (none provided)';
  return [
    'CANDIDATE EDGE to judge:',
    `  parent:  ${parentName}`,
    `  concept: ${conceptName}`,
    `  chain (root → concept): ${chainNames.join(' › ')}`,
    '',
    `Is "${conceptName}" a KIND OF "${parentName}" — does "${parentName} › ${conceptName}" read as a`,
    `legible narrowing where "${conceptName}" is one way of being "${parentName}"?`,
    '',
    'For context, here is how some of the shared papers exhibited the concept (do NOT let mere',
    'co-occurrence sway you — judge the meanings):',
    ex,
    '',
    'Return { "kind_of": boolean, "rationale": string }. No prose.',
  ].join('\n');
}
function parsePlacement(p) {
  if (!p || typeof p.kind_of !== 'boolean') return null;
  return { kind_of: !!p.kind_of, rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '' };
}

// ---- abstraction judge: the §5.4-UP test (bridge previously-separate regions; do work) ----
function abstractionJudgeSystem(r) {
  return [
    'You are Chaos, the SCOUT (Krius), in ABSTRACTION-JUDGE mode (chaos.md v2.0 §5, §8).',
    'Your governing brain is the rubric below. Obey it exactly; invent no rules it does not state.',
    '', ...RUBRIC_HEADER, r, ...RUBRIC_FOOTER, '',
    'Two adjectives {A} (under region "{regionX}") and {B} (under region "{regionY}") co-occur in',
    'research. The §5.4-UP test: an abstraction must BRIDGE previously-separate regions AND do',
    'predictive work — naming it must change what you EXPECT of the instances (§4, §5). A label',
    'atop a single branch is not an abstraction. Choose exactly one:',
    '  (a) ABSTRACTION — {A} and {B} are two distinct aspects of a SINGLE UNNAMED HIGHER QUALITY that',
    '      would bridge the otherwise-separate regions "{regionX}" and "{regionY}". Name that quality.',
    '      Answer (a) only if naming the abstraction changes what you\'d expect of the instances.',
    '  (b) NEAR-SYNONYM — {A} and {B} are essentially the SAME quality under two labels.',
    '  (c) UNRELATED — they merely co-occur; there is no shared higher quality.',
    'Default to (c) when unsure (abstain-by-default).',
    '',
    'OUTPUT CONTRACT: STRICT JSON ONLY — no prose, no fences. Exactly:',
    '{ "verdict": "abstraction" | "near_synonym" | "unrelated",',
    '  "higher_quality": string | null,   // a bare quality-adjective; required for "abstraction", else null',
    '  "rationale": string }              // ONE short plain sentence',
    'Return only the JSON object.',
  ].join('\n');
}
function abstractionJudgeUser(aName, regionX, bName, regionY, exampleFeatures) {
  const ex = exampleFeatures.length
    ? exampleFeatures.map((f) => `  - ${trunc(f, 200)}`).join('\n')
    : '  (none provided)';
  return [
    'CO-OCCURRING PAIR to judge:',
    `  A: "${aName}"  (under region "${regionX}")`,
    `  B: "${bName}"  (under region "${regionY}")`,
    '',
    'How some shared papers exhibited these (judge the meanings, not the co-occurrence):',
    ex,
    '',
    'Is there a single unnamed higher quality bridging the two regions (a), are they near-synonyms (b),',
    'or do they merely co-occur (c)? Return { "verdict", "higher_quality", "rationale" }. No prose.',
  ].join('\n');
}
function parseAbstraction(p) {
  const v = p && p.verdict;
  if (!['abstraction', 'near_synonym', 'unrelated'].includes(v)) return null;
  return {
    verdict: v,
    higher_quality: typeof p.higher_quality === 'string' && p.higher_quality.trim() ? p.higher_quality.trim() : null,
    rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '',
  };
}

// ---- separability judge: a proposed adjective vs its overlapping-evidence neighbors ----
function separabilityJudgeSystem(r) {
  return [
    'You are Chaos, the SCOUT (Krius), in SEPARABILITY-JUDGE mode (chaos.md v2.0 §5.1 — the',
    'contrastive-separability / anti-thesaurus gate). Obey the rubric below; invent no rules.',
    '', ...RUBRIC_HEADER, r, ...RUBRIC_FOOTER, '',
    'A proposed new adjective {CANDIDATE} is grounded by papers that ALSO ground the NEIGHBOR',
    'adjectives listed (overlapping evidence, wherever they sit in the graph). §5.1 requires that',
    '{CANDIDATE} be PULL-APART-ABLE from each neighbor: research can be {CANDIDATE} but NOT {neighbor},',
    'and {neighbor} but NOT {CANDIDATE}. If {CANDIDATE} cannot be pulled apart from some neighbor — it',
    'is essentially the same quality under another label — it is NOT separable (it is a near-synonym).',
    '',
    'OUTPUT CONTRACT: STRICT JSON ONLY — no prose, no fences. Exactly:',
    '{ "separable": boolean,            // true only if pull-apart-able from EVERY neighbor',
    '  "synonym_of": string | null,     // if not separable, the neighbor it collapses into; else null',
    '  "rationale": string }            // ONE short plain sentence',
    'Return only the JSON object.',
  ].join('\n');
}
function separabilityJudgeUser(candName, candPath, contrast, neighbors) {
  const nb = neighbors.map((n) => `  - ${n.name}${n.path ? `  (path: ${n.path})` : ''}`).join('\n');
  return [
    'PROPOSED new adjective:',
    `  candidate: ${candName}`,
    `  intended path (root → parent): ${candPath.join(' › ')}`,
    contrast.parent_but_not_child ? `  {parent} but not {candidate}: ${contrast.parent_but_not_child}` : '',
    contrast.child_but_not_sibling ? `  {candidate} but not {nearest declared sibling}: ${contrast.child_but_not_sibling}` : '',
    '',
    'OVERLAPPING-EVIDENCE NEIGHBORS (grounded by ≥1 of the same papers; may sit under other parents):',
    nb || '  (none)',
    '',
    `Is "${candName}" pull-apart-able from EVERY neighbor, or is it a near-synonym of one of them?`,
    'Return { "separable", "synonym_of", "rationale" }. No prose.',
  ].filter((x) => x !== '').join('\n');
}
function parseSeparability(p) {
  if (!p || typeof p.separable !== 'boolean') return null;
  return {
    separable: !!p.separable,
    synonym_of: typeof p.synonym_of === 'string' && p.synonym_of.trim() ? p.synonym_of.trim() : null,
    rationale: typeof p.rationale === 'string' ? p.rationale.trim() : '',
  };
}

// ----------------------------------------------------------------------------
// Shared placement evaluator — the SINGLE §5.4-down judging path, used both by the native
// co-occurrence candidates AND by the §2/§3 reroutes (so a rerouted candidate is judged
// identically). req: { childNode, parentName, newParentPath (names root→parent incl), region,
// papers: [{id,title,feature}] (≥2), provenance, exampleFeatures? }. Excludes any candidate
// whose (parent, child) edge already exists (no-op duplicate) and records the child's current
// parent(s) so the reviewer sees the §5.3 delta.
// ----------------------------------------------------------------------------

async function evaluatePlacement(graph, req, systemText) {
  const { childNode, parentName, newParentPath, region, papers, provenance } = req;
  if (graph.edgeExists(parentName, childNode.name)) return { status: 'duplicate' };
  const chain = [...newParentPath, childNode.name];
  const curLabel = graph.currentParentLabel(childNode.name);
  const curParents = graph.currentParents(childNode.name);
  const provTag = provenance && provenance !== 'co-occurrence' ? `  (${provenance})` : '';
  const label = `${chain.join(' › ')}  [${curLabel}]${provTag}`;
  const paperIds = papers.map((p) => p.id);
  const exampleFeatures = (req.exampleFeatures && req.exampleFeatures.length
    ? req.exampleFeatures : papers.slice(0, 3).map((p) => p.feature)).filter(Boolean);
  const verdict = await cachedJudge(
    'placement', [normName(childNode.name), pathKey(newParentPath)], systemText,
    placementJudgeUser(parentName, childNode.name, chain, exampleFeatures), parsePlacement
  );
  if (verdict == null) {
    return { status: 'pending', audit: { kind: 'missing_placement', status: 'pending', region, label, paperIds, rationale: 'judge not run (dry-run / call failed)' } };
  }
  if (!verdict.kind_of) {
    return { status: 'abstained', audit: { kind: 'missing_placement', status: 'abstained', region, label, paperIds, rationale: verdict.rationale || `judged NOT a kind-of "${parentName}"` } };
  }
  const fObj = {
    kind: 'missing_placement', writable: true, attribute: 'value', region,
    concept_name: childNode.name,
    current_parents: curParents,            // existing parent name(s) — empty for a root/unplaced
    current_parents_label: curLabel,        // human-readable §5.3 delta context
    new_parent_path: newParentPath,
    proposed_chain: chain,
    apply_concept: { attribute: 'value', name: childNode.name, parent_paths: [newParentPath] },
    rationale: verdict.rationale || `Judged a genuine kind-of "${parentName}".`,
    provenance: provenance || 'co-occurrence',
    papers, rankScore: papers.length,
  };
  return { status: 'kept', frontier: fObj, audit: { kind: 'missing_placement', status: 'kept', region, label, paperIds, rationale: fObj.rationale, frontier: fObj } };
}

// Judge a batch of reroute requests (from §2/§3 collisions) through the placement judge.
// Dedupes by (parent, child); applies the region filter; drops duplicate-edge no-ops.
async function processReroutes(graph, reroutes, regionFilter) {
  const systemText = placementJudgeSystem(rubric());
  const confirmed = [];
  const audit = [];
  let abstained = 0;
  let pending = 0;
  let dropped = 0;
  const seen = new Set();
  for (const req of reroutes) {
    const key = `${normName(req.parentName)}|${normName(req.childNode.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (regionFilter && req.region !== regionFilter) continue; // out of scope: not counted
    const r = await evaluatePlacement(graph, req, systemText);
    if (r.status === 'duplicate') { dropped += 1; continue; }
    if (r.status === 'kept') confirmed.push(r.frontier);
    else if (r.status === 'abstained') abstained += 1;
    else if (r.status === 'pending') pending += 1;
    if (r.audit) audit.push(r.audit);
  }
  return { confirmed, abstained, pending, audit, dropped };
}

// ----------------------------------------------------------------------------
// KIND 1 — missing_placement (co-occurrence CANDIDATE → §5.4-down model gate; WRITABLE)
//
// CANDIDATE GENERATION (co-occurrence): concept C's grounded papers also exhibit children
// of a DIFFERENT existing parent B, C is not already under B, and adding C under B is
// acyclic. ≥2 such distinct papers clears the floor. THEN the §5.4-down model gate decides
// whether "{B} › {C}" is a genuine kind-of (abstain-by-default). All placement records carry
// the concept's current parent(s) (§5.3 delta). Native + reroutes share evaluatePlacement.
// ----------------------------------------------------------------------------

async function detectMissingPlacement(graph, ev, regionFilter) {
  const { byName, children, parentsOf } = graph;
  const { paperToQualities, qualityPapers, featureOf, paperMeta } = ev;

  const childrenOf = (b) => children.get(b) || new Set();
  function cIsAncestorOfB(c, bNode) {
    for (const pp of bNode.parent_paths) for (const anc of pp) if (normName(anc) === c) return true;
    return false;
  }
  // B's placement path (root→B inclusive), name-based; prefer the shallowest placement.
  function newParentPathFor(bNode) {
    const placements = bNode.parent_paths.length ? bNode.parent_paths : [[]];
    let best = placements[0];
    for (const pp of placements) if (pp.length < best.length) best = pp;
    return [...best, bNode.name];
  }

  // 1) Enumerate distinct (C, B) candidate pairs from co-exhibition.
  const pairKeys = new Set();
  for (const [, quals] of paperToQualities) {
    const concepts = [...new Set(quals.map((q) => q.concept))];
    for (const c of concepts) {
      for (const d of concepts) {
        if (d === c) continue;
        for (const b of parentsOf.get(d) || []) {
          if (b === c) continue;
          if ((parentsOf.get(c) || new Set()).has(b)) continue; // already under B
          const bNode = byName.get(b);
          if (!bNode) continue;
          if (cIsAncestorOfB(c, bNode)) continue; // would create a cycle
          pairKeys.add(`${c}|${b}`);
        }
      }
    }
  }

  // 2) Floor (≥2 papers) + region scope. Build the candidates to judge. Abstains here are
  //    structural (model-free) and counted ONLY when in the active region (fixes the
  //    region-scoped abstain tally) — out-of-region candidates are skipped, not counted.
  const candidates = [];
  const audit = []; // calibration trail: one entry per candidate (kept / abstained / pending)
  let abstained = 0;
  for (const key of pairKeys) {
    const [c, b] = key.split('|');
    const cNode = byName.get(c);
    const bNode = byName.get(b);
    if (!cNode || !bNode) continue;
    const newParentPath = newParentPathFor(bNode);
    const region = regionOfPath(bNode.parent_paths[0] || [], bNode.name);
    if (regionFilter && region !== regionFilter) continue; // out of scope: not counted
    const bChildren = childrenOf(b);
    const evid = new Set();
    for (const pid of qualityPapers.get(c) || new Set()) {
      const quals = paperToQualities.get(pid) || [];
      if (quals.some((q) => bChildren.has(q.concept))) evid.add(pid);
    }
    const chain = [...newParentPath, cNode.name];
    if (evid.size < MIN_PAPERS) {
      if (evid.size >= 1) {
        abstained += 1;
        audit.push({ kind: 'missing_placement', status: 'abstained', region, label: chain.join(' › '), paperIds: [...evid], rationale: `below the ≥${MIN_PAPERS} distinct exhibiting-paper floor (only ${evid.size})` });
      }
      continue;
    }
    candidates.push({ c, b, cNode, bNode, newParentPath, region, evid, chain });
  }
  candidates.sort((x, y) => y.evid.size - x.evid.size); // judge strongest-evidence first

  // 3) §5.4-down model gate via the shared evaluatePlacement (also excludes existing-edge
  //    duplicates and records current parent(s)). Every verdict is recorded into the audit.
  const systemText = placementJudgeSystem(rubric());
  const confirmed = [];
  let pending = 0;
  for (const cand of candidates) {
    const papers = [...cand.evid].map((pid) => ({
      id: pid, title: (paperMeta.get(pid) || {}).title || null, feature: featureOf.get(`${cand.c}|${pid}`) || '',
    }));
    const req = { childNode: cand.cNode, parentName: cand.bNode.name, newParentPath: cand.newParentPath, region: cand.region, papers, provenance: 'co-occurrence' };
    const r = await evaluatePlacement(graph, req, systemText);
    if (r.status === 'duplicate') continue; // native generation already excludes existing edges
    if (r.status === 'kept') confirmed.push(r.frontier);
    else if (r.status === 'abstained') abstained += 1;
    else if (r.status === 'pending') pending += 1;
    if (r.audit) audit.push(r.audit);
  }
  confirmed.sort((a, b) => b.rankScore - a.rankScore);
  return { confirmed, abstained, pending, audit };
}

// ----------------------------------------------------------------------------
// Consolidate kept abstractions by their normalized proposed higher-quality name. The judge
// evaluates each concept-pair in isolation, so the SAME invented name recurs across pairs and
// regions — that recurrence is signal (a stronger missing abstraction), but it must collapse to
// ONE frontier or it reads as duplication. Each consolidated frontier keeps every contributing
// BRIDGE (with its own per-pair judge rationale, so a reviewer can split an overloaded name),
// the union of regions and (deduped) papers, and a strength = distinct bridge count (secondary:
// distinct regions bridged). IDEMPOTENT: a record that already carries `bridges` is folded by
// its bridges, so running this on already-consolidated input is a no-op. Used as the cross-
// region assembly step too (a name invented in two regions becomes one frontier).
// ----------------------------------------------------------------------------

function consolidateAbstractions(records) {
  const byName = new Map(); // norm name -> accumulator
  for (const r of asArray(records)) {
    if (!r || r.kind !== 'missing_abstraction') continue;
    const name = r.proposed_abstraction || (asArray(r.concepts).length ? r.concepts.join('/') : '(unnamed)');
    const nkey = canonicalName(name);
    if (!byName.has(nkey)) byName.set(nkey, { name, bridgeKeys: new Set(), bridges: [], regionOrder: [], regionSeen: new Set(), regionCount: new Map(), papersById: new Map() });
    const acc = byName.get(nkey);
    // Bridges to fold: the record's own bridges (already consolidated) or one synthesized from
    // the raw pair. Dedup by (concepts | regions) so re-consolidation can't double-count.
    const incoming = asArray(r.bridges).length ? r.bridges : [{
      concepts: asArray(r.concepts), regions: asArray(r.regions),
      rationale: r.rationale || r.shared_quality_hint || '', paperIds: asArray(r.papers).map((p) => p.id),
    }];
    for (const br of incoming) {
      const bkey = `${asArray(br.concepts).map(normName).join('|')}@${asArray(br.regions).map(normName).join('|')}`;
      if (acc.bridgeKeys.has(bkey)) continue;
      acc.bridgeKeys.add(bkey);
      acc.bridges.push({ concepts: asArray(br.concepts), regions: asArray(br.regions), rationale: br.rationale || '', paperIds: asArray(br.paperIds) });
      for (const reg of asArray(br.regions)) {
        if (!acc.regionSeen.has(normName(reg))) { acc.regionSeen.add(normName(reg)); acc.regionOrder.push(reg); }
        acc.regionCount.set(normName(reg), (acc.regionCount.get(normName(reg)) || 0) + 1);
      }
    }
    for (const p of asArray(r.papers)) if (p && p.id != null && !acc.papersById.has(p.id)) acc.papersById.set(p.id, p);
  }

  const out = [];
  for (const acc of byName.values()) {
    // Dominant region (most bridge-contributions; tie → first seen) is the cap-group key.
    let domRegion = acc.regionOrder[0] || null;
    let domCount = -1;
    for (const reg of acc.regionOrder) { const c = acc.regionCount.get(normName(reg)) || 0; if (c > domCount) { domCount = c; domRegion = reg; } }
    const strength = acc.bridges.length;
    const distinctRegions = acc.regionOrder.length;
    const papers = [...acc.papersById.values()];
    out.push({
      kind: 'missing_abstraction', writable: false,
      proposed_abstraction: acc.name,
      region: domRegion,                 // cap-group key (applyCaps normalizes)
      regions: acc.regionOrder,          // union of bridged region display names
      strength,
      distinct_regions: distinctRegions,
      bridges: acc.bridges,
      shared_quality_hint: `"${acc.name}" bridges ${distinctRegions} region(s) via ${strength} pair(s).`,
      papers,
      rankScore: strength * 1000 + distinctRegions, // rank by strength (then distinct regions) before the cap
    });
  }
  out.sort((x, y) => y.rankScore - x.rankScore); // strongest first
  return out;
}

// ----------------------------------------------------------------------------
// Consolidate kept missing_adjective records by CANONICAL name (Change 2). The propose channel
// runs per-parent, so the SAME adjective surfaces under multiple parents ("Replicated" ×3) and
// as case/hyphen variants ("Cross-checked" / "Cross-Checked"). Merge each canonical group into
// ONE frontier that LISTS ALL proposed parents — a multi-parent adjective is path-dependent
// identity (chaos.md §5.3), so the parents are KEPT (each with its own separability rationale +
// papers), NOT collapsed away. Within a group, a parent whose path is a strict prefix of
// another's on the same branch (e.g. "Rigorous" vs "Rigorous › Warranted") is the broader/
// redundant placement — the more specific one is kept and the broader is recorded (noted, not
// emitted as its own frontier). Runs BEFORE the cap so the cap counts distinct adjective
// frontiers. Returns { frontiers, map } where map: originalRecord -> consolidated frontier, so
// the calibration audit's over-cap marking can follow the merge.
// ----------------------------------------------------------------------------

function consolidateAdjectives(records) {
  const groups = new Map(); // canonical name -> accumulator
  for (const r of asArray(records)) {
    if (!r || r.kind !== 'missing_adjective') continue;
    const display = r.proposed_adjective || '(unnamed)';
    const ckey = canonicalName(display);
    if (!groups.has(ckey)) groups.set(ckey, { name: display, sources: [], parentByPath: new Map(), papersById: new Map() });
    const acc = groups.get(ckey);
    acc.sources.push(r);
    // An already-consolidated record carries `parents`; a raw record is a single parent. Folding
    // a consolidated record makes this idempotent (re-running on consolidated input is a no-op).
    const incoming = asArray(r.parents).length ? r.parents : [{
      parent: r.parent, parent_path: asArray(r.parent_path), region: r.region,
      separability: r.separability || {}, rationale: r.rationale || '', papers: asArray(r.papers),
    }];
    for (const pr of incoming) {
      const pkey = pathKey(pr.parent_path);
      let entry = acc.parentByPath.get(pkey);
      if (!entry) {
        entry = { parent: pr.parent, parent_path: asArray(pr.parent_path).map(String), region: pr.region, separability: pr.separability || {}, rationale: pr.rationale || '', papers: [], _ids: new Set() };
        acc.parentByPath.set(pkey, entry);
      }
      for (const p of asArray(pr.papers)) if (p && p.id != null && !entry._ids.has(p.id)) { entry._ids.add(p.id); entry.papers.push(p); }
    }
    for (const p of asArray(r.papers)) if (p && p.id != null && !acc.papersById.has(p.id)) acc.papersById.set(p.id, p);
  }

  const frontiers = [];
  const map = new Map();
  for (const acc of groups.values()) {
    const allParents = [...acc.parentByPath.values()];
    // §5.3: keep the most specific placement; a parent whose path is a strict prefix of another
    // parent's path on the same branch is redundant (noted, not emitted as its own placement).
    const kept = [];
    const redundant = [];
    for (const pr of allParents) {
      const deeper = allParents.find((o) => o !== pr && isStrictPathPrefix(pr.parent_path, o.parent_path));
      if (deeper) redundant.push({ parent: pr.parent, parent_path: pr.parent_path, note: `redundant: also proposed more specifically under ${deeper.parent_path.join(' › ')}` });
      else kept.push(pr);
    }
    // Dominant region among kept parents (most placements; tie → first seen) = the cap-group key.
    const regionOrder = [];
    const regionSeen = new Set();
    const regionCount = new Map();
    for (const pr of kept) {
      const reg = pr.region;
      if (reg && !regionSeen.has(normName(reg))) { regionSeen.add(normName(reg)); regionOrder.push(reg); }
      if (reg) regionCount.set(normName(reg), (regionCount.get(normName(reg)) || 0) + 1);
    }
    let domRegion = regionOrder[0] || null;
    let domCount = -1;
    for (const reg of regionOrder) { const c = regionCount.get(normName(reg)) || 0; if (c > domCount) { domCount = c; domRegion = reg; } }
    const parentsOut = kept.map((pr) => ({ parent: pr.parent, parent_path: pr.parent_path, region: pr.region, separability: pr.separability, rationale: pr.rationale, papers: pr.papers }));
    const papers = [...acc.papersById.values()];
    const f = {
      kind: 'missing_adjective', writable: false,
      proposed_adjective: acc.name,
      region: domRegion,
      regions: regionOrder,
      multi_parent: parentsOut.length > 1,
      parents: parentsOut,
      strength: parentsOut.length,
      papers,
      // rank multi-parent (recurring) adjectives above single-parent; then by evidence breadth.
      rankScore: parentsOut.length * 1000 + papers.length,
    };
    if (redundant.length) f.redundant_placements = redundant;
    frontiers.push(f);
    for (const src of acc.sources) map.set(src, f);
  }
  frontiers.sort((a, b) => b.rankScore - a.rankScore);
  return { frontiers, map };
}

// Which proposed name(s) a frontier carries, by kind (used by the cross-channel flag).
function frontierNames(f) {
  const names = [];
  if (f.kind === 'missing_placement' && f.concept_name) names.push(f.concept_name);
  if (f.kind === 'missing_adjective' && f.proposed_adjective) names.push(f.proposed_adjective);
  if (f.kind === 'missing_abstraction' && f.proposed_abstraction) names.push(f.proposed_abstraction);
  if (f.kind === 'possible_merge') for (const c of asArray(f.concepts)) names.push(c);
  return names;
}

const KIND_LABEL = {
  missing_placement: 'placement', missing_adjective: 'adjective',
  missing_abstraction: 'abstraction', possible_merge: 'possible-merge',
};

// Cross-channel overlap flag (Change 3). If one canonical name surfaces in more than one channel
// across the assembled (post-cap) proposal — e.g. "Traceable" as both an adjective and an
// abstraction — that double-surfacing is SIGNAL; keep BOTH and cross-reference each with a
// one-line note rather than dropping either.
function flagCrossChannel(frontiers) {
  const kindsByName = new Map(); // canonical name -> Set<kind>
  for (const f of frontiers) {
    for (const nm of frontierNames(f)) {
      const ck = canonicalName(nm);
      if (!ck) continue;
      if (!kindsByName.has(ck)) kindsByName.set(ck, new Set());
      kindsByName.get(ck).add(f.kind);
    }
  }
  for (const f of frontiers) {
    const others = new Set();
    for (const nm of frontierNames(f)) {
      for (const k of kindsByName.get(canonicalName(nm)) || []) if (k !== f.kind) others.add(KIND_LABEL[k] || k);
    }
    if (others.size) f.cross_channel_note = `also proposed as ${[...others].sort().join(', ')}`;
  }
}

// Near-duplicate abstraction flag (Change 4). After canonicalization, two DISTINCT abstraction
// names that are spelling twins (shared stem + small edit distance, e.g. "Reconstructable" /
// "Reconstructible") may be intended as distinct — so this NEVER merges them. It only adds a
// "possible near-duplicate of <name>" note on the lower-strength one for reviewer attention.
function flagNearDuplicateAbstractions(frontiers) {
  const abs = frontiers.filter((f) => f.kind === 'missing_abstraction' && f.proposed_abstraction);
  const strengthOf = (f) => f.strength || asArray(f.bridges).length || asArray(f.papers).length;
  for (let i = 0; i < abs.length; i++) {
    for (let j = i + 1; j < abs.length; j++) {
      const A = abs[i], B = abs[j];
      if (!isNearDuplicateName(canonicalName(A.proposed_abstraction), canonicalName(B.proposed_abstraction))) continue;
      // Flag the lower-strength one (tie → the second, for determinism); reference the other.
      const lower = strengthOf(A) < strengthOf(B) ? A : B;
      const other = lower === A ? B : A;
      lower.near_duplicate_note = `possible near-duplicate of "${other.proposed_abstraction}"`;
    }
  }
}

// ----------------------------------------------------------------------------
// KIND 3 — missing_abstraction (co-occurrence CANDIDATE → §5.4-up model gate; ADVISORY)
//
// CANDIDATE GENERATION: a concept pair (X in region R1, Y in region R2), R1≠R2 (different
// roots ⇒ no common ancestor), co-exhibited by ≥2 distinct papers. THEN the §5.4-up judge
// chooses: (a) ABSTRACTION → kept (then CONSOLIDATED by proposed name into one frontier);
// (b) NEAR-SYNONYM → emit a lightweight `possible_merge` note instead (NOT padded into an
// abstraction); (c) UNRELATED → abstain. Default is abstain.
// ----------------------------------------------------------------------------

async function detectMissingAbstraction(graph, ev, regionFilter) {
  const { byName } = graph;
  const { paperToQualities, featureOf, paperMeta } = ev;

  // pair `${cx}@@${cy}` (sorted) -> Set<paper_id>, plus remember regions/names.
  const pairPapers = new Map();
  const pairMeta = new Map();
  for (const [pid, quals] of paperToQualities) {
    const seen = new Map(); // concept -> { region, name } (first occurrence)
    for (const q of quals) if (!seen.has(q.concept)) seen.set(q.concept, { region: q.region, name: q.conceptName });
    const entries = [...seen.entries()];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [cx, mx] = entries[i];
        const [cy, my] = entries[j];
        if (mx.region === my.region) continue; // same region — has a common ancestor
        const a = cx < cy ? { c: cx, m: mx } : { c: cy, m: my };
        const b = cx < cy ? { c: cy, m: my } : { c: cx, m: mx };
        const key = `${a.c}@@${b.c}`;
        if (!pairPapers.has(key)) { pairPapers.set(key, new Set()); pairMeta.set(key, { a, b }); }
        pairPapers.get(key).add(pid);
      }
    }
  }

  // Floor + region scope; judge strongest pairs first.
  const nameOf = (norm, fallback) => (byName.get(norm) ? byName.get(norm).name : fallback);
  const pairsSorted = [...pairPapers.entries()].sort((x, y) => y[1].size - x[1].size);
  const systemText = abstractionJudgeSystem(rubric());

  const keptPairs = [];  // raw kept pairs, consolidated by proposed name after the loop
  const merges = [];
  const reroutes = []; // §3 collisions: higher-quality already exists → placement candidates
  const audit = []; // calibration trail (kept / merge / abstained / pending), with rationale
  let abstained = 0;
  let pending = 0;
  for (const [key, pids] of pairsSorted) {
    const { a, b } = pairMeta.get(key);
    const r1 = a.m.region, r2 = b.m.region;
    if (regionFilter && r1 !== regionFilter && r2 !== regionFilter) continue; // out of scope: not counted

    const aName = nameOf(a.c, a.m.name), bName = nameOf(b.c, b.m.name);
    const R1 = nameOf(r1, r1), R2 = nameOf(r2, r2);
    const label = `${aName} / ${bName}  (${R1} ↔ ${R2})`;
    const paperIds = [...pids];
    if (pids.size < MIN_PAPERS) {
      if (pids.size >= 1) {
        abstained += 1;
        audit.push({ kind: 'missing_abstraction', status: 'abstained', region: r1, regions: [R1, R2], label, paperIds, rationale: `below the ≥${MIN_PAPERS} co-exhibiting-paper floor (only ${pids.size})` });
      }
      continue;
    }

    const exampleFeatures = [...pids].slice(0, 3)
      .map((pid) => featureOf.get(`${a.c}|${pid}`) || featureOf.get(`${b.c}|${pid}`) || '').filter(Boolean);
    const verdict = await cachedJudge(
      'abstraction', [a.c, b.c, r1, r2], systemText,
      abstractionJudgeUser(aName, R1, bName, R2, exampleFeatures), parseAbstraction
    );
    if (verdict == null) {
      pending += 1;
      audit.push({ kind: 'missing_abstraction', status: 'pending', region: r1, regions: [R1, R2], label, paperIds, rationale: 'judge not run (dry-run / call failed)' });
      continue;
    }

    const papers = [...pids].map((pid) => ({
      id: pid, title: (paperMeta.get(pid) || {}).title || null,
      feature: featureOf.get(`${a.c}|${pid}`) || featureOf.get(`${b.c}|${pid}`) || '',
    }));
    if (verdict.verdict === 'abstraction') {
      // §3 collision guard: a "new" higher quality that already exists as a concept is NOT a
      // newly-invented abstraction. Reroute — place each bridged concept under the existing
      // concept H (the placement judge + dup-edge guard decide). Do NOT emit as abstraction.
      if (verdict.higher_quality && graph.nameExists(verdict.higher_quality)) {
        const H = graph.lookupNode(verdict.higher_quality);
        const hPlacement = H.parent_paths && H.parent_paths.length ? H.parent_paths[0] : [];
        const hPath = [...hPlacement, H.name];
        const hRegion = regionOfPath(hPlacement, H.name);
        for (const bridged of [a, b]) {
          const childNode = byName.get(bridged.c);
          if (!childNode || normName(childNode.name) === normName(H.name)) continue;
          reroutes.push({ childNode, parentName: H.name, newParentPath: hPath, region: hRegion, papers, provenance: 'from abstraction collision' });
        }
        console.log(`    [reroute] abstraction higher-quality "${H.name}" already exists — placing "${aName}"/"${bName}" under it (judged as placement)`);
        continue;
      }
      // Kept pair — collected raw; consolidated by proposed name after the loop. The per-pair
      // judge rationale is preserved as this bridge's rationale so a reviewer can split a name.
      keptPairs.push({
        kind: 'missing_abstraction', writable: false,
        region: r1, regions: [R1, R2], concepts: [aName, bName],
        proposed_abstraction: verdict.higher_quality || null,
        rationale: verdict.rationale || (verdict.higher_quality
          ? `Candidate higher quality bridging "${R1}" and "${R2}": "${verdict.higher_quality}".`
          : `A single higher quality may bridge "${R1}" and "${R2}".`),
        papers, rankScore: papers.length,
      });
    } else if (verdict.verdict === 'near_synonym') {
      const fObj = {
        kind: 'possible_merge', writable: false,
        region: r1, regions: [R1, R2], concepts: [aName, bName],
        rationale: verdict.rationale || `"${aName}" and "${bName}" may be the same quality under two labels.`,
        papers, rankScore: papers.length,
      };
      merges.push(fObj);
      audit.push({ kind: 'possible_merge', status: 'merge', region: r1, regions: [R1, R2], label: `${aName} ≈ ${bName}  (${R1} ↔ ${R2})`, paperIds, rationale: fObj.rationale, frontier: fObj });
    } else {
      abstained += 1; // unrelated
      audit.push({ kind: 'missing_abstraction', status: 'abstained', region: r1, regions: [R1, R2], label, paperIds, rationale: verdict.rationale || 'judged UNRELATED (mere co-occurrence)' });
    }
  }
  // Consolidate kept pairs into one frontier per proposed name (cross-region within this run).
  // Each consolidated frontier is ranked by strength; the cap (applied later) now counts these
  // distinct frontiers, not raw pairs. One KEPT audit entry per consolidated frontier, carrying
  // its bridges (each with its own per-pair rationale).
  const confirmed = consolidateAbstractions(keptPairs);
  for (const f of confirmed) {
    audit.push({
      kind: 'missing_abstraction', status: 'kept',
      region: f.region, regions: f.regions,
      label: `${f.proposed_abstraction} · strength ${f.strength} · regions: ${asArray(f.regions).join(', ')}`,
      paperIds: f.papers.map((p) => p.id),
      rationale: f.shared_quality_hint,
      bridges: f.bridges,
      frontier: f,
    });
  }
  return { confirmed, merges, abstained, pending, audit, reroutes };
}

// ----------------------------------------------------------------------------
// KIND 2 — missing_adjective (MODEL, two-stage; ADVISORY)
//
// Stage A (propose, cheap, cached per parent in krius_cache): given a parent P (+ its
// path), its existing children, and a sample of its grounded papers, propose new SIBLING
// adjectives — each a bare quality-adjective, with contrastive-separability lines and ≥2
// candidate papers (by id) it claims the work exhibits.
// Stage B (confirm): the SAME strict gaia.judgePaper confirms each candidate paper against
// a synthetic target { name: <new adjective>, parentPath: <path to P> }. ≥2 confirmed → frontier.
//
// In --dry-run NO model call is made: Stage A reads cache only, Stage B is skipped, and
// abstains are counted structurally (cached candidates whose own candidate-paper list < 2).
// ----------------------------------------------------------------------------

function proposeSystem(rubric) {
  return [
    'You are Chaos, the SCOUT (Krius), in MISSING-ADJECTIVE PROPOSE mode (chaos.md v2.0 §2, §5).',
    'Your governing brain is the rubric below. Obey it exactly; invent no rules it does not state.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'CONTEXT: nodes are bare quality-adjectives describing GOOD RESEARCH; meaning is COMPOSITIONAL',
    '(read along the PATH, chaos.md §1, §7). You are given ONE existing PARENT adjective (with its',
    'root→parent path), its EXISTING CHILDREN, and a sample of papers already grounded in this',
    "parent's subtree (each with the concrete feature that grounded it). Your job (chaos.md §5):",
    'propose NEW SIBLING adjectives — recurring qualities these papers EXHIBIT that NONE of the',
    'existing children already name.',
    '',
    'THE TWO GATES (chaos.md §5 — binding):',
    '  1. CONTRASTIVE SEPARABILITY (anti-thesaurus). Propose a child only if:',
    '     - research can be {parent} but NOT {child} (the child names something the parent doesn\'t entail), AND',
    '     - research can be {child} but NOT {nearest existing sibling} (it is pull-apart-able, not a synonym).',
    '     If your candidate cannot be pulled apart from an existing child, DO NOT propose it.',
    '  2. INSTANTIABLE. Each candidate MUST be exhibited by ≥2 of the provided papers, and for each',
    '     you MUST point to a CONCRETE, LOCATABLE feature of that work (what the researchers DID / what',
    '     the work HAS). EXHIBITS, not DISCUSSES: if the quality is a paper\'s TOPIC not its METHOD, omit it.',
    '',
    'FORM (chaos.md §7): each name is a BARE quality-adjective ("Blinded", not "Blinding"); as short as',
    'the quality allows; adjective form, not noun form. No prose names.',
    '',
    'ABSTAIN BIAS: a thesaurus pile of near-synonyms is the §5 failure mode. Propose FEWER, STRONGER,',
    'pull-apart-able adjectives. An empty list is a valid, honorable answer.',
    '',
    'OUTPUT CONTRACT: STRICT JSON ONLY — no prose, no markdown fences. Exactly:',
    '{',
    '  "candidates": [',
    '    {',
    '      "name": string,                  // the new bare quality-adjective (the proposed sibling)',
    '      "parent_but_not_child": string,  // one line: research that is {parent} but not {this}',
    '      "child_but_not_sibling": string, // one line: {this} but not {nearest existing sibling} (name the sibling)',
    '      "papers": [ { "id": string, "feature": string } ]  // ≥2 provided-paper ids + the concrete feature',
    '    }',
    '  ]',
    '}',
    'Return only the JSON object. Use ONLY paper ids from the provided list.',
  ].join('\n');
}

function proposeUser(parentNode, parentPath, existingChildren, samplePapers) {
  const pp = parentPath.length ? parentPath.join(' > ') : '(root — no parent)';
  const kids = existingChildren.length ? existingChildren.map((c) => `  - ${c}`).join('\n') : '  (none yet)';
  const papers = samplePapers.map((p) =>
    `  - id ${p.id} :: ${trunc(p.title || '(untitled)', 80)}\n      exhibited "${p.via}" via: ${trunc(p.feature, 200)}`
  ).join('\n');
  return [
    'EXISTING PARENT adjective to find missing children under:',
    `  parent: ${parentNode.name}`,
    `  path (root → parent): ${pp}`,
    '',
    'EXISTING CHILDREN (do NOT re-propose these or a synonym of them):',
    kids,
    '',
    `PAPERS already grounded in this parent's subtree (id :: title; the feature that grounded each):`,
    papers,
    '',
    'Propose NEW SIBLING adjectives these papers EXHIBIT that no existing child names. For each, give',
    'the two contrastive-separability lines and ≥2 of the above paper ids with a concrete feature.',
    'Return { "candidates": [...] }. No prose.',
  ].join('\n');
}

function proposeCachePath(parentNorm, parentPath) {
  const h = fnv1a(`${KRIUS_PROMPT_VERSION}|propose|${MODEL}|${EFFORT}|r${rubricHash()}|${parentNorm}|${pathKey(parentPath)}`);
  return path.join(CACHE_DIR, `propose-${h}.json`);
}

function readProposeCache(parentNorm, parentPath) {
  const cp = proposeCachePath(parentNorm, parentPath);
  if (!fs.existsSync(cp)) return null;
  try { return asArray(JSON.parse(fs.readFileSync(cp, 'utf8')).candidates); }
  catch { return null; }
}

async function proposeNewAdjectives(parentNode, parentPath, existingChildren, samplePapers, systemText) {
  const cached = readProposeCache(normName(parentNode.name), parentPath);
  if (cached) return cached;
  if (DRY_RUN) return null; // dry-run never calls the model; null = "no cached propose available"

  const { text, stop_reason } = await callModel(systemText, proposeUser(parentNode, parentPath, existingChildren, samplePapers), MAX_TOKENS_PROPOSE);
  if (stop_reason === 'max_tokens') { console.warn(`    (warn) propose truncated for "${parentNode.name}" — not cached.`); return []; }
  const parsed = extractJson(text);
  if (!parsed || !Array.isArray(parsed.candidates)) { console.warn(`    (warn) propose unparseable for "${parentNode.name}" — not cached.`); return []; }
  const candidates = parsed.candidates
    .filter((c) => c && typeof c.name === 'string' && c.name.trim())
    .map((c) => ({
      name: c.name.trim(),
      parent_but_not_child: typeof c.parent_but_not_child === 'string' ? c.parent_but_not_child.trim() : '',
      child_but_not_sibling: typeof c.child_but_not_sibling === 'string' ? c.child_but_not_sibling.trim() : '',
      papers: asArray(c.papers)
        .filter((p) => p && typeof p.id === 'string')
        .map((p) => ({ id: p.id.trim(), feature: typeof p.feature === 'string' ? p.feature.trim() : '' })),
    }))
    .slice(0, MAX_NEW_ADJECTIVES);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(proposeCachePath(normName(parentNode.name), parentPath), JSON.stringify({ parent: parentNode.name, parentPath, candidates }, null, 2), 'utf8');
  return candidates;
}

// Run kind-2 over every interior parent (within the region filter). extraPapersByRegion
// adds anchored-retrieval papers (records) to a region's propose sample.
async function detectMissingAdjective(graph, ev, regionFilter, extraPapersByRegion) {
  const { nodes, byName, children } = graph;
  const { paperToQualities, paperMeta } = ev;

  const rubricText = rubric();
  const systemPropose = proposeSystem(rubricText);
  // Stage B uses gaia.judgePaper (the SAME strict gate, caching in gaia_cache). gaia.js does
  // not export its judge SYSTEM-prompt builder, so Krius passes an equivalent one rebuilt from
  // the rubric (the rubric travels in the prompt; judgePaper's strict JSON parse is the gate).
  const judgeSystemText = buildJudgeSystem(rubricText);
  // §5.1 contrastive-separability gate vs OVERLAPPING-EVIDENCE neighbors (concepts grounded by
  // ≥1 of the same justifying papers, wherever they sit) — catches cross-parent synonyms the
  // propose prompt never saw (e.g. "Jargon-free" vs "Accessible" under a different parent).
  const systemSep = separabilityJudgeSystem(rubricText);

  // Map a concept (norm) to the set of parent nodes whose subtree it sits in (for sampling).
  // For a parent P, its subtree papers = papers exhibiting any concept whose placement path
  // contains P, OR P itself.
  function subtreePapersFor(parentNorm) {
    const ids = new Set();
    for (const [pid, quals] of paperToQualities) {
      for (const q of quals) {
        if (q.concept === parentNorm || q.path.map(normName).includes(parentNorm)) { ids.add(pid); break; }
      }
    }
    return ids;
  }

  const interior = nodes.filter((n) => (children.get(normName(n.name)) || new Set()).size > 0);

  const confirmed = [];
  const merges = [];
  const reroutes = []; // §2 collisions: proposed sibling already exists → placement candidate
  const audit = []; // calibration trail (kept / merge / abstained / pending), with rationale
  let abstained = 0;
  let pending = 0;
  let proposedCached = 0;

  for (const P of interior) {
    const pNorm = normName(P.name);
    // pick a representative placement path for P (root→P inclusive) for the synthetic target
    const placement = P.parent_paths.length ? P.parent_paths[0] : [];
    const parentPath = [...placement, P.name]; // path to children of P would be this
    const region = regionOfPath(placement, P.name);
    if (regionFilter && region !== regionFilter) continue;

    const existingChildren = [...(children.get(pNorm) || new Set())].map((c) => (byName.get(c) ? byName.get(c).name : c));

    // Sample papers: corpus subtree + any anchored-retrieval papers for this region.
    const subtreeIds = [...subtreePapersFor(pNorm)];
    const samplePapers = [];
    for (const pid of subtreeIds.slice(0, MAX_PROPOSE_PAPERS)) {
      const meta = paperMeta.get(pid) || {};
      const quals = paperToQualities.get(pid) || [];
      const via = (quals.find((q) => q.path.map(normName).includes(pNorm) || q.concept === pNorm) || quals[0] || {}).conceptName || '';
      samplePapers.push({ id: pid, title: meta.title, feature: (quals[0] || {}).feature || '', via });
    }
    const extra = (extraPapersByRegion && extraPapersByRegion.get(region)) || [];
    for (const rec of extra.slice(0, MAX_PROPOSE_PAPERS)) {
      samplePapers.push({ id: rec.id, title: rec.title, feature: rec.abstract ? trunc(rec.abstract, 200) : '', via: '(retrieved)' });
    }
    if (samplePapers.length < MIN_PAPERS) continue; // nothing to reason over

    const candidates = await proposeNewAdjectives(P, parentPath, existingChildren, samplePapers, systemPropose);
    if (candidates == null) continue; // dry-run with no cache for this parent
    proposedCached += candidates.length;

    for (const cand of candidates) {
      // Skip if it duplicates an existing child name (or its norm).
      if ((children.get(pNorm) || new Set()).has(normName(cand.name))) { continue; }
      const label = `${cand.name} under ${parentPath.join(' › ')}`;
      const candPaperIds = [...new Set(cand.papers.map((p) => p.id))].filter((id) => id);
      const candPapersOut = (ids) => ids.map((pid) => ({ id: pid, title: (paperMeta.get(pid) || {}).title || null, feature: (cand.papers.find((p) => p.id === pid) || {}).feature || '' }));
      if (candPaperIds.length < MIN_PAPERS) {
        abstained += 1;
        audit.push({ kind: 'missing_adjective', status: 'abstained', region, label, paperIds: candPaperIds, rationale: `fewer than ${MIN_PAPERS} candidate papers (floor)` });
        continue;
      }

      // §2 collision guard: a proposed "new" sibling that already exists as a concept is NOT a
      // new adjective. The edge (P, name) cannot already exist here (existing children were
      // skipped above), so reroute it as a placement candidate under P (judged by placement).
      if (graph.nameExists(cand.name)) {
        const childNode = graph.lookupNode(cand.name);
        reroutes.push({ childNode, parentName: P.name, newParentPath: parentPath, region, papers: candPapersOut(candPaperIds), provenance: 'from adjective collision' });
        console.log(`    [reroute] proposed adjective "${cand.name}" already exists — rerouting to a placement candidate under "${P.name}"`);
        continue;
      }

      // §5.1 separability vs OVERLAPPING-EVIDENCE neighbors. Neighbors = concepts grounded by
      // the candidate's own justifying papers, excluding the parent, the candidate itself, and
      // the declared children the propose prompt already contrasted against.
      const declaredKids = children.get(pNorm) || new Set();
      const neighborCount = new Map(); // display name -> overlap count
      const neighborPath = new Map();  // display name -> a representative path label
      for (const pid of candPaperIds) {
        for (const q of paperToQualities.get(pid) || []) {
          if (q.concept === normName(cand.name) || q.concept === pNorm || declaredKids.has(q.concept)) continue;
          neighborCount.set(q.conceptName, (neighborCount.get(q.conceptName) || 0) + 1);
          if (!neighborPath.has(q.conceptName)) neighborPath.set(q.conceptName, q.path.length ? q.path.join(' › ') : '(root)');
        }
      }
      const neighbors = [...neighborCount.entries()]
        .sort((x, y) => y[1] - x[1]).slice(0, MAX_SEP_NEIGHBORS)
        .map(([name]) => ({ name, path: neighborPath.get(name) }));

      // In --dry-run we cannot run either the separability judge or Stage B — count pending.
      if (DRY_RUN) {
        pending += 1;
        audit.push({ kind: 'missing_adjective', status: 'pending', region, label, paperIds: candPaperIds, rationale: 'judge not run (dry-run)' });
        continue;
      }

      let keptRationale = neighbors.length ? '' : 'no overlapping-evidence neighbor to separate from';
      if (neighbors.length) {
        const sep = await cachedJudge(
          'separability', [pNorm, normName(cand.name), neighbors.map((n) => normName(n.name)).sort().join(',')],
          systemSep,
          separabilityJudgeUser(cand.name, parentPath, { parent_but_not_child: cand.parent_but_not_child, child_but_not_sibling: cand.child_but_not_sibling }, neighbors),
          parseSeparability
        );
        if (sep == null) {
          pending += 1;
          audit.push({ kind: 'missing_adjective', status: 'pending', region, label, paperIds: candPaperIds, rationale: 'separability judge not run (call failed)' });
          continue;
        }
        if (!sep.separable) {
          // A cross-parent near-synonym: emit a possible_merge note instead of an adjective.
          const synonym = sep.synonym_of || neighbors[0].name;
          const mObj = {
            kind: 'possible_merge', writable: false, region, parent: P.name,
            concepts: [cand.name, synonym],
            rationale: sep.rationale || `Proposed "${cand.name}" is not separable from "${synonym}" (overlapping evidence).`,
            papers: candPapersOut(candPaperIds),
            rankScore: candPaperIds.length,
          };
          merges.push(mObj);
          audit.push({ kind: 'possible_merge', status: 'merge', region, label: `${cand.name} ≈ ${synonym}`, paperIds: candPaperIds, rationale: mObj.rationale, frontier: mObj });
          continue;
        }
        keptRationale = sep.rationale ? `separable (${sep.rationale})` : 'separable from overlapping-evidence neighbors';
      }

      // Stage B — confirm each candidate paper with the SAME strict exhibits-not-discusses judge.
      const target = { name: cand.name, parentPath };
      const confirmedPapers = [];
      for (const pid of candPaperIds) {
        const rec = loadPaperRecordById(pid);
        if (!rec) continue; // need the paper on disk to judge
        let verdict = null;
        try { verdict = await judgePaper(target, rec, judgeSystemText); } catch { verdict = null; }
        if (verdict && verdict.exhibits && verdict.comment && (verdict.confidence === 'high' || verdict.confidence === 'medium')) {
          confirmedPapers.push({ id: pid, title: (paperMeta.get(pid) || rec).title || null, feature: verdict.comment });
        }
      }
      if (confirmedPapers.length < MIN_PAPERS) {
        abstained += 1;
        audit.push({ kind: 'missing_adjective', status: 'abstained', region, label, paperIds: candPaperIds, rationale: `only ${confirmedPapers.length}/${candPaperIds.length} candidate paper(s) confirmed by the exhibits judge` });
        continue;
      }

      const fObj = {
        kind: 'missing_adjective',
        writable: false,
        region,
        parent: P.name,
        parent_path: parentPath,                 // root → P inclusive (children of P would sit here)
        proposed_adjective: cand.name,
        separability: {
          parent_but_not_child: cand.parent_but_not_child,
          child_but_not_sibling: cand.child_but_not_sibling,
        },
        papers: confirmedPapers,
        rankScore: confirmedPapers.length,
      };
      confirmed.push(fObj);
      audit.push({ kind: 'missing_adjective', status: 'kept', region, label, paperIds: confirmedPapers.map((p) => p.id), rationale: `${keptRationale}; ${confirmedPapers.length} paper(s) confirmed exhibit it`, frontier: fObj });
    }
  }

  return { confirmed, merges, abstained, pending, proposedCached, audit, reroutes };
}

// The strict exhibits-not-discusses judge SYSTEM prompt. gaia.js does not export its
// builder, so Krius reconstructs the same contract here (the rubric travels in the prompt;
// judgePaper's strict JSON parsing is the real gate). Kept faithful to chaos.md §2.
function buildJudgeSystem(rubric) {
  return [
    'You are Chaos, the INSTANTIATOR judge (the SAME strict exhibits-not-discusses gate Gaia uses).',
    'Your governing brain is the rubric below (chaos.md, v2.0). Obey it exactly.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'You are given one TARGET (a quality-adjective + its root→parent path) and ONE paper. Judge whether',
    "the paper's ACTUAL RESEARCH EXHIBITS that quality at that path — the researchers DEMONSTRATE it in",
    'what they did/has/built — as opposed to merely DISCUSSING, studying, reviewing, or recommending it',
    '(chaos.md §2: "demonstrably exhibits — exhibits, not discusses").',
    '  - EXHIBITS = the work itself is an instance of the quality (it need not name it).',
    '  - DISCUSSES = the paper is ABOUT the quality / studies it in others — REJECT.',
    '  DECISIVE TEST: if the quality is the paper\'s SUBJECT MATTER (developed, characterized, measured,',
    '  reviewed), reject; accept only when the quality is a property of the study\'s OWN method/conduct.',
    '  ERR TOWARD REJECTING weak or merely-plausible matches. If unsure, exhibits=false.',
    '',
    'If and only if it exhibits, write `comment`: name the CONCRETE feature of the work that exhibits the',
    'quality, in PLAIN cross-disciplinary language (no jargon), ~1–2 sentences — not a paper summary.',
    'ALWAYS fill `reason` (one short plain sentence) for both accept and reject.',
    '',
    'OUTPUT CONTRACT: STRICT JSON ONLY — no prose, no fences. Exactly:',
    '{ "exhibits": boolean, "comment": string|null, "confidence": "high"|"medium"|"low", "reason": string }',
    'Return only the JSON object.',
  ].join('\n');
}

// ----------------------------------------------------------------------------
// Anchored-retrieval channel (--retrieve). Bold, costs OpenAlex, off by default.
// For each region (selected or thin), retrieve papers ANCHORED to the region's topic
// (region + child adjectives as the search anchor — never a blind/random sample), build
// abstract-level records, and return them per region to feed kind 2. Reuses gaia's
// retrieveCandidates (OpenAlex client + 429/budget handling). Never runs in --dry-run.
// ----------------------------------------------------------------------------

async function anchoredRetrieval(graph, regionFilter) {
  const byRegion = new Map();
  if (!RETRIEVE || DRY_RUN) return byRegion;

  const { byName, children, roots } = graph;
  const targetRoots = regionFilter ? roots.filter((r) => r === regionFilter) : roots;
  const perRegionCap = LIMIT || 10;

  if (!OPENALEX_API_KEY) {
    console.warn('  --retrieve: no OPENALEX_API_KEY set — using the keyless tier (~100 searches/day).');
  }

  for (const r of targetRoots) {
    const rNode = byName.get(r);
    if (!rNode) continue;
    // Anchor: the region adjective + a few of its child adjectives (concrete topic anchor,
    // NOT a blind sample). Plain words only; sanitizeQuery strips comma/pipe.
    const kids = [...(children.get(r) || new Set())].slice(0, 4).map((c) => (byName.get(c) ? byName.get(c).name : c));
    const queries = [sanitizeQuery(`${rNode.name} research practice`), ...kids.map((k) => sanitizeQuery(`${k} ${rNode.name}`))]
      .filter(Boolean)
      .slice(0, 3);
    console.log(`  [retrieve] region "${rNode.name}" — anchored queries: ${queries.map((q) => `"${q}"`).join(', ')}`);

    let candidates = [];
    try {
      const out = await retrieveCandidates(queries);
      candidates = out.candidates || [];
    } catch (e) {
      if (e && e.budgetExhausted) { console.error(`\n${e.message}`); break; } // stop the whole retrieval channel
      console.error(`  [retrieve] region "${rNode.name}" search failed: ${e.message}`);
      continue;
    }
    const recs = candidates.slice(0, perRegionCap).map((c) => buildPaperRecord(c.work, c.queries));
    byRegion.set(r, recs);
    console.log(`  [retrieve] region "${rNode.name}" — ${recs.length} anchored candidate paper(s) (abstract-level)`);
    await sleep(Number(process.env.CHAOS_OPENALEX_DELAY_MS || 250));
  }
  return byRegion;
}

// ----------------------------------------------------------------------------
// Rank + cap surviving frontiers (incl. possible_merge) per KIND per REGION. Dropped
// survivors are recorded ONLY as an overflow count (chaos.md review is per-region + legible),
// never as full records. Region key: f.region (placement/adjective/merge) or regions[0]
// (abstraction). rankScore = judge-affirmed + distinct exhibiting-paper count.
// ----------------------------------------------------------------------------

function applyCaps(records, cap) {
  const groups = new Map(); // `${region}|${kind}` -> records[]
  for (const f of records) {
    const region = f.region || asArray(f.regions)[0] || '(none)';
    const gk = `${normName(region)}|${f.kind}`;
    if (!groups.has(gk)) groups.set(gk, []);
    groups.get(gk).push(f);
  }
  const capped = [];
  const overflowByGroup = new Map();
  let overflowTotal = 0;
  for (const [gk, list] of groups) {
    list.sort((a, b) => (b.rankScore || asArray(b.papers).length) - (a.rankScore || asArray(a.papers).length));
    capped.push(...list.slice(0, cap));
    const over = Math.max(0, list.length - cap);
    if (over > 0) { overflowByGroup.set(gk, over); overflowTotal += over; }
  }
  return { capped, overflowTotal, overflowByGroup };
}

// ----------------------------------------------------------------------------
// Output
// ----------------------------------------------------------------------------

function citedPapersFromFrontiers(frontiers, ev) {
  const ids = new Set();
  for (const f of frontiers) for (const p of asArray(f.papers)) if (p.id) ids.add(p.id);
  const out = [];
  for (const id of ids) {
    const meta = ev.paperMeta.get(id) || {};
    out.push({ id, title: meta.title || null, url: meta.url || null });
  }
  return out;
}

function writeProposalJson(frontiers, ev, summary, regionFilter) {
  const out = {
    generated_by: 'chaos/krius.js',
    model: MODEL,
    effort: EFFORT,
    rubric_version: rubricVersion(),
    krius_prompt_version: KRIUS_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    channels: { corpus: true, anchored_retrieval: RETRIEVE },
    region: regionFilter ? (ev._regionLabel || regionFilter) : null,
    summary,
    frontiers,
    papers: citedPapersFromFrontiers(frontiers, ev),
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2), 'utf8');
}

function writeProposalMd(frontiers, summary, regionFilter) {
  const L = [];
  L.push('# Chaos — Krius scouting proposal (the Scout)');
  L.push('');
  L.push(`**Generated by:** chaos/krius.js · model ${MODEL} · effort ${EFFORT} · rubric v${rubricVersion()} · prompt ${KRIUS_PROMPT_VERSION}`);
  L.push('**Write target:** this file + chaos/genesis/krius-proposal.json. NO DB writes, NO apply.js call, NO existing proposal modified.');
  L.push(`**Channels:** corpus${RETRIEVE ? ' + anchored-retrieval' : ''}${regionFilter ? ` · region "${regionFilter}"` : ''}`);
  L.push(
    `**Totals (post-cap, --cap ${summary.cap}):** ${summary.by_kind.missing_placement} placement · ` +
    `${summary.by_kind.missing_adjective} adjective · ${summary.by_kind.missing_abstraction} abstraction · ` +
    `${summary.by_kind.possible_merge} possible-merge` +
    `${summary.overflow_below_cap ? ` · +${summary.overflow_below_cap} more below the cap` : ''}.`
  );
  L.push(
    `**Gate:** every record passed a §5 model judge (abstain-by-default). ` +
    `${summary.abstains.total} abstained (judge NO / failed the ≥${MIN_PAPERS}-paper floor)` +
    `${summary.pending && summary.pending.total ? ` · ${summary.pending.total} pending (judge not yet run)` : ''}.`
  );
  L.push('');
  L.push('Only `missing_placement` is apply.js-writable (additive multi-parent edge). `missing_adjective`, `missing_abstraction`, and `possible_merge` are advisory (chaos.md §5, §8).');
  L.push('');

  // group by region
  const byRegion = new Map();
  for (const f of frontiers) {
    const reg = f.region || (f.regions ? f.regions.join(' + ') : '(cross-region)');
    if (!byRegion.has(reg)) byRegion.set(reg, []);
    byRegion.get(reg).push(f);
  }
  for (const [reg, list] of byRegion) {
    L.push(`## Region: ${reg}`);
    L.push('');
    for (const f of list) {
      if (f.kind === 'missing_placement') {
        const parentDisp = f.new_parent_path[f.new_parent_path.length - 1];
        const cur = f.current_parents_label || (asArray(f.current_parents).length ? `currently under: ${f.current_parents.join(', ')}` : 'currently unplaced');
        L.push(`- **[placement · writable]** adds **${parentDisp}** as an alternate parent to **${f.concept_name}** (${cur})`);
        L.push(`  chain: ${f.proposed_chain.join(' › ')}`);
        if (f.provenance && f.provenance !== 'co-occurrence') L.push(`  provenance: ${f.provenance}`);
        L.push(`  judge (kind-of? YES): ${f.rationale}`);
      } else if (f.kind === 'missing_adjective') {
        const parents = asArray(f.parents);
        if (parents.length) {
          const tag = parents.length > 1 ? ` (multi-parent · ${parents.length} placements)` : '';
          L.push(`- **[adjective · advisory]** new sibling **${f.proposed_adjective}**${tag}`);
          for (const p of parents) {
            L.push(`  • under **${asArray(p.parent_path).join(' › ')}**`);
            if (p.separability && p.separability.parent_but_not_child) L.push(`    {parent} not {child}: ${p.separability.parent_but_not_child}`);
            if (p.separability && p.separability.child_but_not_sibling) L.push(`    {child} not {sibling}: ${p.separability.child_but_not_sibling}`);
          }
        } else {
          // legacy single-parent shape (defensive — consolidation always emits `parents`)
          L.push(`- **[adjective · advisory]** new sibling **${f.proposed_adjective}** under **${asArray(f.parent_path).join(' › ')}**`);
          if (f.separability) {
            L.push(`  {parent} not {child}: ${f.separability.parent_but_not_child}`);
            L.push(`  {child} not {sibling}: ${f.separability.child_but_not_sibling}`);
          }
        }
        for (const rp of asArray(f.redundant_placements)) L.push(`  ~ ${rp.note}`);
      } else if (f.kind === 'missing_abstraction') {
        L.push(`- **[abstraction · advisory]** **${f.proposed_abstraction || '(unnamed)'}** · strength ${f.strength || asArray(f.bridges).length} · regions: ${asArray(f.regions).join(', ')}`);
        for (const br of asArray(f.bridges)) {
          L.push(`  · ${asArray(br.concepts).join(' ↔ ')}  (${asArray(br.regions).join(' / ')}) — ${br.rationale}`);
        }
      } else if (f.kind === 'possible_merge') {
        L.push(`- **[possible-merge · advisory]** ${f.concepts.join(' ≈ ')}${f.regions ? `  (${f.regions.join(' ↔ ')})` : ''}`);
        L.push(`  judge (near-synonym): ${f.rationale}`);
      }
      if (f.cross_channel_note) L.push(`  note: ${f.cross_channel_note}`);
      if (f.near_duplicate_note) L.push(`  note: ${f.near_duplicate_note}`);
      for (const p of f.papers) L.push(`    · ${p.id}  ${trunc(p.title || '', 70)}${p.feature ? ` — ${trunc(p.feature, 140)}` : ''}`);
      L.push('');
    }
  }
  L.push('---');
  L.push('');
  L.push('**END — frontiers only; no dev-graph writes, no cutover.**');
  L.push('');
  fs.writeFileSync(OUT_MD, L.join('\n'), 'utf8');
}

// ----------------------------------------------------------------------------
// Calibration audit (a SEPARATE file from the clean proposal). Records every §5 judge
// verdict — KEPT and ABSTAINED — with its one-line rationale, so we can see WHY each
// candidate was rejected and confirm the placement (kind-of) judge isn't over-rejecting
// legitimate multi-parent placements (§5.3). Post-cap drops are marked KEPT-but-over-cap
// so they aren't mistaken for abstentions.
// ----------------------------------------------------------------------------

function auditPath(regionLabel) {
  const slug = String(regionLabel || 'all').replace(/[^\w.-]+/g, '_');
  return path.join(GENESIS_DIR, `krius-audit-${slug}.md`);
}

function renderAuditEntry(L, e) {
  const over = e.overCap ? '  _(over --cap — KEPT by the judge, dropped from the proposal)_' : '';
  L.push(`- **${e.label}**${over}`);
  L.push(`  why: ${e.rationale || '(no rationale recorded)'}`);
  // Consolidated abstractions carry per-pair bridges (each with its own judge rationale).
  for (const br of asArray(e.bridges)) {
    L.push(`  · ${asArray(br.concepts).join(' ↔ ')}  (${asArray(br.regions).join(' / ')}) — ${br.rationale}`);
  }
  if (asArray(e.paperIds).length) L.push(`  papers: ${e.paperIds.join(', ')}`);
}

const AUDIT_KINDS = ['missing_placement', 'missing_adjective', 'missing_abstraction', 'possible_merge'];

function writeAuditMd(audit, regionLabel) {
  const L = [];
  L.push(`# Chaos — Krius calibration audit · region "${regionLabel || 'all'}"`);
  L.push('');
  L.push(`**Generated by:** chaos/krius.js${REFRESH ? ' --refresh' : ''} · model ${MODEL} · effort ${EFFORT} · rubric v${rubricVersion()} · prompt ${KRIUS_PROMPT_VERSION}`);
  L.push('**Purpose:** every §5 judge verdict — KEPT and ABSTAINED — with its one-line rationale, to check the judges (especially the placement / kind-of judge) are not over-rejecting legitimate multi-parent placements (chaos.md §5.3). Recording only — no judge prompt, threshold, or candidate-generation logic was changed.');
  L.push('**This is NOT the proposal.** See chaos/genesis/krius-proposal.md for the clean output.');
  L.push('');

  for (const kind of AUDIT_KINDS) {
    const entries = audit.filter((e) => e.kind === kind);
    if (!entries.length) continue;
    const kept = entries.filter((e) => e.status === 'kept' || e.status === 'merge');
    const abst = entries.filter((e) => e.status === 'abstained');
    const pend = entries.filter((e) => e.status === 'pending');
    const overCapCount = kept.filter((e) => e.overCap).length;

    L.push(`## ${kind}`);
    L.push('');
    L.push(`### KEPT — ${kept.length}${overCapCount ? ` (${overCapCount} over --cap)` : ''}`);
    if (!kept.length) L.push('_(none)_');
    for (const e of kept) renderAuditEntry(L, e);
    L.push('');
    L.push(`### ABSTAINED — ${abst.length}`);
    if (!abst.length) L.push('_(none)_');
    for (const e of abst) renderAuditEntry(L, e);
    if (pend.length) {
      L.push('');
      L.push(`### PENDING (judge not run) — ${pend.length}`);
      for (const e of pend) renderAuditEntry(L, e);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('**END — calibration audit; no dev-graph writes, no cutover.**');
  L.push('');
  fs.writeFileSync(auditPath(regionLabel), L.join('\n'), 'utf8');
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const proposal = loadJson(PROPOSAL_PATH, 'genesis taxonomy proposal');
  const graph = buildGraph(proposal);
  const ev = buildEvidence();

  // Resolve region filter to a real root (case-insensitive); keep its display label.
  let regionFilter = null;
  let regionLabel = null;
  if (REGION) {
    const rn = normName(REGION);
    if (!graph.rootSet.has(rn)) {
      const known = graph.roots.map((r) => graph.byName.get(r).name).join(', ');
      throw new Error(`--region "${REGION}" is not a root. Krius scouts within existing regions; roots are: ${known}.`);
    }
    regionFilter = rn;
    regionLabel = graph.byName.get(rn).name;
    ev._regionLabel = regionLabel;
  }

  console.log('================ CHAOS KRIUS — SCOUT ================');
  console.log(`rubric v${rubricVersion()} · prompt ${KRIUS_PROMPT_VERSION} · model ${MODEL} · effort ${EFFORT}`);
  console.log(`mode: ${DRY_RUN ? 'DRY RUN (no network, writes nothing)' : 'WRITE (corpus channel)'}` +
    `${RETRIEVE ? ' · +anchored-retrieval' : ''}${REFRESH ? ' · --refresh (re-judging, ignoring cached judgments)' : ''}${regionLabel ? ` · region "${regionLabel}"` : ''}`);
  console.log(`graph: ${graph.nodes.length} concepts · ${graph.roots.length} roots · evidence: ${ev.links.length} grounding links over ${ev.paperMeta.size} papers`);
  console.log('');

  // Anchored retrieval (off by default; never in dry-run) — feeds kind 2 per region.
  const extraPapersByRegion = await anchoredRetrieval(graph, regionFilter);

  // CORPUS CHANNEL — co-occurrence GENERATES candidates; every kind now passes a §5 model
  // judge (abstain-by-default). kinds 1 & 3: candidate-gen + judge; kind 2: propose +
  // separability + exhibits-confirm. Each returns confirmed / (merges) / abstained / pending.
  const mp = await detectMissingPlacement(graph, ev, regionFilter);
  const ma = await detectMissingAbstraction(graph, ev, regionFilter);
  const mj = await detectMissingAdjective(graph, ev, regionFilter, extraPapersByRegion);

  // Existing-name collisions (§2 adjective + §3 abstraction) are rerouted to placement
  // candidates and judged FRESH by the same placement judge; merge them into the placement
  // results so they share the cap, summary, and audit. Duplicate edges are dropped (no-op).
  const reroutes = [...asArray(ma.reroutes), ...asArray(mj.reroutes)];
  const rr = await processReroutes(graph, reroutes, regionFilter);
  // Merge reroute placements, de-duping against native placements by (concept, new parent path)
  // so a reroute that restates a native candidate doesn't double-emit.
  const placeKey = (f) => `${normName(f.concept_name)}|${pathKey(f.new_parent_path)}`;
  const haveP = new Set(mp.confirmed.map(placeKey));
  for (const f of rr.confirmed) { if (!haveP.has(placeKey(f))) { haveP.add(placeKey(f)); mp.confirmed.push(f); } }
  mp.confirmed.sort((a, b) => b.rankScore - a.rankScore);
  mp.abstained += rr.abstained;
  mp.pending += rr.pending;
  mp.audit.push(...rr.audit);
  if (reroutes.length) {
    console.log(`  [reroute] ${reroutes.length} existing-name candidate(s) judged as placements: ${rr.confirmed.length} kept · ${rr.abstained} abstained · ${rr.dropped} dropped (duplicate edge)${rr.pending ? ` · ${rr.pending} pending` : ''}`);
  }

  // Consolidate kept adjectives by CANONICAL name BEFORE the cap (Change 2) — repeated and
  // case/hyphen-variant adjectives collapse to ONE multi-parent frontier each (parents kept,
  // not collapsed; broader-of-same-branch placements noted as redundant), so the cap counts
  // distinct adjective frontiers. adjMap re-points the calibration audit through the merge.
  const { frontiers: adjConfirmed, map: adjMap } = consolidateAdjectives(mj.confirmed);

  // possible_merge notes come from the abstraction (near-synonym) + adjective (cross-parent
  // synonym) gates. ma.confirmed is ALREADY consolidated by proposed name (the assembly step —
  // detectMissingAbstraction runs cross-region when no --region is set), so the cap below counts
  // distinct consolidated abstraction frontiers, not raw pairs. Rank + cap per kind per region.
  const allRecords = [
    ...mp.confirmed, ...adjConfirmed, ...ma.confirmed,
    ...asArray(ma.merges), ...asArray(mj.merges),
  ];
  const { capped: frontiers, overflowTotal } = applyCaps(allRecords, CAP);

  // Name-hygiene flags on the assembled proposal (Changes 3 & 4) — cross-reference the same
  // canonical name surfacing in two channels, and flag (never merge) near-duplicate abstraction
  // spellings. Both only ADD notes; neither drops or merges a record.
  flagCrossChannel(frontiers);
  flagNearDuplicateAbstractions(frontiers);

  const countKind = (k) => frontiers.filter((f) => f.kind === k).length;
  const summary = {
    cap: CAP,
    by_kind: {
      missing_placement: countKind('missing_placement'),
      missing_adjective: countKind('missing_adjective'),
      missing_abstraction: countKind('missing_abstraction'),
      possible_merge: countKind('possible_merge'),
    },
    abstains: {
      missing_placement: mp.abstained,
      missing_adjective: mj.abstained,
      missing_abstraction: ma.abstained,
      total: mp.abstained + mj.abstained + ma.abstained,
    },
    pending: {
      missing_placement: mp.pending || 0,
      missing_adjective: mj.pending || 0,
      missing_abstraction: ma.pending || 0,
      total: (mp.pending || 0) + (mj.pending || 0) + (ma.pending || 0),
    },
    overflow_below_cap: overflowTotal,
    kind2_proposed_candidates: mj.proposedCached,
  };

  // Per-region summary print. A record is "in region r" if r is its region or among its
  // regions[] (abstraction/merge span two). Counts are post-cap.
  const inRegion = (f, r) => {
    const regs = asArray(f.regions);
    return regs.length ? regs.map(normName).includes(r) : normName(f.region) === r;
  };
  console.log('---- PER-REGION SUMMARY (post-cap; §5 judge-gated) ----');
  const regions = regionFilter ? [regionFilter] : graph.roots;
  for (const r of regions) {
    const label = graph.byName.get(r).name;
    const p = frontiers.filter((f) => f.kind === 'missing_placement' && inRegion(f, r)).length;
    const a = frontiers.filter((f) => f.kind === 'missing_adjective' && inRegion(f, r)).length;
    const x = frontiers.filter((f) => f.kind === 'missing_abstraction' && inRegion(f, r)).length;
    const m = frontiers.filter((f) => f.kind === 'possible_merge' && inRegion(f, r)).length;
    if (p + a + x + m === 0) continue;
    console.log(`  ${label.padEnd(14)} placement ${p} · adjective ${a} · abstraction ${x} · merge ${m}`);
  }
  console.log('');
  console.log(`TOTAL frontiers (post-cap): ${frontiers.length}  (placement ${summary.by_kind.missing_placement} · adjective ${summary.by_kind.missing_adjective} · abstraction ${summary.by_kind.missing_abstraction} · merge ${summary.by_kind.possible_merge})`);
  if (overflowTotal > 0) console.log(`  (+${overflowTotal} survivor(s) dropped below the --cap ${CAP}; counts only, see the .md header)`);
  console.log(`ABSTAINED${regionFilter ? ` in "${regionLabel}"` : ''} (judge said NO / failed the ≥${MIN_PAPERS}-paper floor): ${summary.abstains.total}  ` +
    `(placement ${summary.abstains.missing_placement} · adjective ${summary.abstains.missing_adjective} · abstraction ${summary.abstains.missing_abstraction})`);
  console.log(`PENDING (judge not yet run — dry-run / call failed): ${summary.pending.total}  ` +
    `(placement ${summary.pending.missing_placement} · adjective ${summary.pending.missing_adjective} · abstraction ${summary.pending.missing_abstraction})`);
  if (summary.abstains.total === 0) {
    console.warn('  (!) abstain count is ZERO — the ≥2-paper / §5 gate may not be firing. Investigate before trusting this run.');
  }
  if (DRY_RUN) {
    console.log(`\nAll three kinds are now §5 MODEL-judged; in --dry-run every judge ran cache-only ` +
      `(${summary.pending.total} candidate(s) pending, 0 confirmed — re-run without --dry-run to judge them).`);
    console.log('DRY RUN COMPLETE — no network calls, nothing written.');
    console.log('Run `node chaos/krius.js` to write krius-proposal.json (corpus channel), or add --retrieve.');
    return;
  }

  writeProposalJson(frontiers, ev, summary, regionFilter);
  writeProposalMd(frontiers, summary, regionFilter);

  // Calibration audit (separate file). Combine every kind's per-candidate audit trail and
  // flag KEPT records the cap dropped from the proposal (by frontier-object identity).
  const audit = [...asArray(mp.audit), ...asArray(ma.audit), ...asArray(mj.audit)];
  const cappedSet = new Set(frontiers);
  // Adjective audit entries reference the pre-consolidation frontier object; follow adjMap to the
  // consolidated frontier so over-cap marking reflects the merged output.
  for (const e of audit) {
    if (!e.frontier) continue;
    const mapped = adjMap.get(e.frontier) || e.frontier;
    e.overCap = !cappedSet.has(mapped);
  }
  writeAuditMd(audit, regionLabel);

  console.log('\nAPI usage this run (Krius judge + propose calls; Stage-B exhibit judge counted in Gaia\'s cache):');
  console.log(`  Krius API calls: ${apiCallCount} · output tokens: ${usageTotals.output_tokens}`);
  console.log(`\nWrote ${path.relative(CHAOS_DIR, OUT_JSON)} and ${path.relative(CHAOS_DIR, OUT_MD)}`);
  console.log(`Wrote ${path.relative(CHAOS_DIR, auditPath(regionLabel))} (calibration audit — KEPT + ABSTAINED rationales).`);
  console.log('Review next. Only missing_placement frontiers are apply.js-writable (additive, name-based).');
  console.log('====================================================');
}

async function closeHttp() {
  try {
    const sym = Object.getOwnPropertySymbols(globalThis).find((s) => s.description === 'undici.globalDispatcher.1');
    const d = sym && globalThis[sym];
    if (d && typeof d.close === 'function') await d.close();
  } catch { /* best effort */ }
}

if (require.main === module) {
  main()
    .then(async () => { await closeHttp(); process.exitCode = 0; })
    .catch(async (err) => { console.error('\nkrius.js failed:', err.message); await closeHttp(); process.exitCode = 1; });
}

module.exports = {
  buildGraph,
  buildEvidence,
  detectMissingPlacement,
  detectMissingAbstraction,
  consolidateAbstractions,
  consolidateAdjectives,
  KRIUS_PROMPT_VERSION,
  OUT_JSON,
  OUT_MD,
};
