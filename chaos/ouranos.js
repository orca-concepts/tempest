#!/usr/bin/env node

/**
 * Chaos — Ouranos, the Categorizer (genesis mode).
 *
 * First engine of the category-first redesign (see chaos.md, v2.0). In GENESIS MODE
 * it authors the INITIAL research-values taxonomy from the scholarship (chaos.md §3)
 * into an empty graph: a hierarchy of BARE QUALITY-ADJECTIVES ("Honest", "Reproducible")
 * carved by respect-and-standard (§4), with pervasive context-differentiated MULTI-PARENT
 * placement (§5.3, §8) and a FRONTIER on every node (§5.5). There is no conduct / "lived"
 * face and no skeleton/hook role — nodes are one thing; meaning lives in the path (§7).
 *
 * READ-ONLY w.r.t. the Orca dev graph, and in fact it does not touch the graph at
 * all: it opens no Postgres connection, runs no migration, reads no snapshot, and
 * writes no row. Genesis authors fresh from the scholarship into an empty graph
 * (chaos.md §9, §11) — there is nothing to reconcile against. Its only inputs are
 * chaos.md (the governing brain, loaded at runtime and passed as the system prompt,
 * exactly as reason.js does) and the Anthropic Messages API. Its only outputs are
 * files under chaos/genesis/ — proposal.json (machine) and proposal.md (human),
 * plus a regenerable model-response cache. Proposals go to files for a human review
 * gate; instantiation and DB writes are later builds (the Instantiator, apply.js).
 *
 * The rubric is NOT hard-coded here — it travels in the prompt. This file is
 * plumbing only; all categorizing logic lives in chaos.md and the model. Structural
 * judgement of the OUTPUT (depth, multi-parent coverage, frontier coverage,
 * adjective-form) lives in the companion chaos/genesis/validate.js.
 *
 * Single attribute domain: every node is a quality-adjective describing good research
 * (the [value] domain, read broadly in v2.0 — chaos.md §9).
 *
 * Usage:
 *   set ANTHROPIC_API_KEY=sk-ant-...
 *   node chaos/ouranos.js                 # genesis pass at default effort
 *   node chaos/ouranos.js --effort=max
 *   node chaos/ouranos.js --force         # ignore the cache, re-call the model
 *
 * Then review the output:
 *   node chaos/genesis/validate.js
 */

const path = require('path');
const fs = require('fs');

// ----------------------------------------------------------------------------
// Config (mirrors reason.js)
// ----------------------------------------------------------------------------

const CHAOS_DIR = __dirname;
const RUBRIC_PATH = path.join(CHAOS_DIR, 'chaos.md');
const GENESIS_DIR = path.join(CHAOS_DIR, 'genesis');
const PROPOSAL_JSON = path.join(GENESIS_DIR, 'proposal.json');
const PROPOSAL_MD = path.join(GENESIS_DIR, 'proposal.md');
const CACHE_DIR = path.join(GENESIS_DIR, 'genesis_cache');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = argValue('--model') || 'claude-opus-4-8';
const EFFORT = argValue('--effort') || 'high'; // low | medium | high | xhigh | max
const MODE = argValue('--mode') || 'genesis';
const FORCE = process.argv.includes('--force');
const NO_CACHE = process.argv.includes('--no-cache');

// Bumped whenever the prompt TEMPLATE below changes in a way that should invalidate
// the cached genesis output. Folded into the cache key alongside rubricHash(), so a
// rubric edit OR a prompt change auto-invalidates a stale cached taxonomy instead of
// silently reusing it (same discipline as reason.js).
const PROMPT_VERSION = 'g2-adjective';

// Single attribute domain (chaos.md §9): every node Chaos graphs is a researcher value.
const ATTRIBUTES = ['value'];

// Output ceilings. Opus 4.8's hard max_tokens is 128000; these stay well under it
// while leaving generous headroom for adaptive-thinking tokens plus the JSON. A full
// genesis taxonomy (roots + differentiations + multi-parent placements + frontiers) is larger
// than one paper's candidate set, so the base is generous with a one-shot retry at
// double if the model still truncates.
const MAX_TOKENS_GENESIS = 40000;
const MAX_TOKENS_GENESIS_RETRY = 80000;
const HTTP_TIMEOUT_MS = 600000; // 10 min (a single large authoring call)
const MAX_RETRIES = 3;

// ----------------------------------------------------------------------------
// Small helpers (mirrors reason.js)
// ----------------------------------------------------------------------------

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + '='));
  return a ? a.split('=').slice(1).join('=') : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// Tolerant JSON extraction — strips markdown fences and grabs the outermost object,
// so a stray sentence around the JSON does not break the run.
function extractJson(text) {
  if (!text) return null;
  let s = text.trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) return null;
  const slice = s.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// Dependency-free FNV-1a hash (32-bit), keys the cache.
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

function rubricVersion() {
  try {
    const txt = fs.readFileSync(RUBRIC_PATH, 'utf8');
    // chaos.md headers its version on the "**Status:**" line, e.g. "**Status:** v1.0 design".
    const m = txt.match(/\*\*Status:\*\*\s*v?([0-9][0-9.]*)/i) || txt.match(/^\*\*Version:\*\*\s*([0-9.]+)/m);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

// ----------------------------------------------------------------------------
// The genesis prompt (the rubric travels here; no categorizing logic is hard-coded)
// ----------------------------------------------------------------------------

function genesisSystem(rubric) {
  return [
    'You are Chaos, the CATEGORIZER (Ouranos), running in GENESIS MODE.',
    'Your governing brain — the principles, the architecture, and the targets — is the',
    'rubric below (chaos.md, v2.0). Obey it exactly. Do not invent rules it does not state.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'YOUR TASK THIS CALL: author the INITIAL research-values taxonomy from the',
    'scholarship (chaos.md §3) into an EMPTY graph (§9, §11). This is genesis — a single',
    'authoring pass. The graph has one attribute domain: value, read in v2.0 as',
    'QUALITY-ADJECTIVES describing good research (§9), NOT dispositions of the researcher.',
    '',
    'THE NODE — what every node IS (§7):',
    '  - A BARE QUALITY-ADJECTIVE: a predicate the user applies to research under the',
    '    implicit frame "good research is ___". "Good" is the implicit unifying predicate —',
    '    it is NOT a stored node, just the frame.',
    '  - ADJECTIVE FORM, never noun form: "Honest" not "Honesty", "Reproducible" not',
    '    "Reproducibility", "Transparent" not "Transparency". This reinforces the predicate',
    '    reading and the fill-in-the-blank stance.',
    '  - AS SHORT AS THE QUALITY ALLOWS: prefer a single adjective; allow a tight adjectival',
    '    phrase ONLY when no single word names the quality. Shorter = more reusable = more',
    '    multi-parentable, which is the whole integration engine.',
    '  - ONE THING ONLY. There is NO second "lived" / conduct face, NO if-then or situated',
    '    string, NO skeleton/hook role, NO per-node gloss or description. Comprehension comes',
    '    later from the research that aggregates beneath a node (§2, §7); you do NOT author it.',
    '    Meaning is COMPOSITIONAL — it lives in the PATH, not the node.',
    '',
    'HOW TO DIFFERENTIATE — respect and standard (§4):',
    '  Your one move is "good in WHAT RESPECT, by WHAT STANDARD?". Each child is a quality-',
    '  DIMENSION along which the parent quality is realized — e.g. "Rigorous" → rigorous in',
    '  control of confounds ("Controlled"), in measurement ("Calibrated"), in inference',
    '  ("Warranted"). The differentiating context IS THE PARENT ADJECTIVE itself: "Careful"',
    '  means one thing under "Honest", another under "Rigorous" — so context lives in the',
    '  path, never baked into the node. A path reads as a near-sentence ("good research that',
    '  is Rigorous, by way of Controlled, by way of Blinded").',
    '',
    'THE FORCING FUNCTIONS — hard targets, not aspirations (§5):',
    '  1. CONTRASTIVE-SEPARABILITY gate (§5.1) — the PRIMARY discipline. Bare adjectives',
    '     invite a thesaurus (Honest / Truthful / Candid / Forthright piling up as synonyms).',
    '     Admit a child ONLY if BOTH hold:',
    '       - research can be {parent} BUT NOT {child}  (the child names something the parent',
    '         does not entail), AND',
    '       - research can be {child} BUT NOT {sibling}  (the child is pull-apart-able from',
    '         each of its siblings).',
    '     If two siblings cannot be pulled apart, they are ONE node — merge them. This synonym',
    '     guardrail is the v2.0 analog of the old flattening problem and is more acute, because',
    '     evaluative adjectives are dense with near-synonyms.',
    '  2. CHANGES-EXPECTATIONS (§4, §5.1): carve a sub-adjective only if having the distinction',
    '     changes what you expect of the instances. No padding, no decorative splits.',
    '  3. DEPTH BEYOND TWO LAYERS (§0, §1): the old tool failed by producing a flat two-layer',
    '     tree. Genesis MUST exceed two layers wherever the distinctions are real; a deep',
    '     composed path is what makes a leaf specific enough to ground later.',
    '  4. PERVASIVE CONTEXT-DIFFERENTIATED MULTI-PARENT (§5.3, §8): multi-parenthood is the',
    '     PRIMARY integration mechanism, central to your work from the start. MOST concepts',
    '     should end up with at least one child that ALSO has an alternate parent. This is',
    '     natural for bare adjectives: the same word expresses several qualities at once —',
    '     e.g. "reporting null results" is a kind-of Honest, Courageous, AND Rigorous. A node',
    '     counts as genuinely integrative only when it has ≥2 parents AND DIFFERENTIATES',
    '     DIFFERENTLY under each (different children per parent context) — two parents with the',
    '     same children is duplication, not integration. The context-differentiation is the',
    '     demanding part; do it deliberately.',
    '  5. ABSTRACTION MUST BRIDGE; SPECIALIZATION MUST COMPOSE (§5.4): a new abstract node must',
    '     connect ≥2 previously-separate regions (an abstraction atop a single branch is a',
    '     branch label). A child must read as a genuine NARROWING of the parent-as-read-in-',
    '     context, keeping the path a legible composition.',
    '  6. FRONTIER OBLIGATION (§5.5): EVERY node must emit at least one frontier — a short',
    '     string naming what could be differentiated or grounded next here. The graph cannot',
    '     close into a finished catalog; productive incompleteness is structural. Frontier',
    '     kinds (§5): "differentiate further"; an ungroundable proposed distinction held as',
    '     "someone find this"; or a resemblance with no shared parent ("what is the missing',
    '     abstraction?").',
    '',
    'BE BOLD (§2): differentiate AHEAD of the documented literature — carve distinctions the',
    'values scholarship implies but has not named — held honest by the gates (§5: separability',
    '+ changes-expectations). Productive incompleteness over a tidy mirror of consensus. Do',
    'NOT aim for any fixed node count; let real, separable distinctions and the gates determine',
    'the size. Boldness is calibrated later by review of the real graph (§2, §10).',
    '',
    'KEEP THE ABSTRACT ADJECTIVES for orientation (§7 caution): the top-level virtue-words',
    '(Honest, Rigorous, Careful, Open, …) are the de-emphasized navigational skeleton — the',
    'multi-parent ceilings things sit UNDER. They are the SAME kind of node as everything',
    'else, just the top layers; do not delete them and do not feature them. Do not let every',
    'node become a deep specific, or the top level becomes a pile of micro-distinctions with',
    'no map.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no markdown fences, no commentary.',
    'A single JSON object with exactly this shape:',
    '{',
    '  "nodes": [',
    '    {',
    '      "name": string,            // a BARE QUALITY-ADJECTIVE in adjective form ("Honest",',
    '                                 //   "Reproducible", "Pre-registered"). NEVER a noun',
    '                                 //   ("Honesty"), NEVER a proposition / full sentence,',
    '                                 //   NEVER a conduct or if-then phrase.',
    '      "parent_paths": string[][],// MULTI-PARENT from the start, ALWAYS plural. Each inner',
    '                                 //   array is one root-to-parent path of ANCESTOR NAMES',
    '                                 //   (e.g. ["Honest"] or ["Rigorous","Controlled"]). []',
    '                                 //   (empty outer array) = a root. Every name used in a',
    '                                 //   path MUST itself be a node in this output.',
    '      "frontiers": string[],     // ≥1 per node (the §5.5 frontier obligation): short',
    '                                 //   strings, each naming a differentiation or grounding',
    '                                 //   invited here.',
    '      "basis": string            // the scholarship tradition / source informing the node',
    '                                 //   (§3), for REVIEW citeability only — NOT written to the',
    '                                 //   database (e.g. "Merton CUDOS", "Kuhn theory-choice',
    '                                 //   virtues", "Fricker, epistemic injustice",',
    '                                 //   "Gärdenfors conceptual spaces").',
    '    }',
    '  ]',
    '}',
    '',
    'Order "nodes" so that every name referenced in a parent_path appears as its own node',
    'somewhere in the array (order within the array is otherwise free). Return only the JSON',
    'object.',
  ].join('\n');
}

function genesisUser() {
  return [
    'Author the genesis taxonomy now.',
    '',
    'Targets to clear (the validator will check the structural ones):',
    '  - ADJECTIVE FORM — every node is a bare quality-adjective ("Honest", not "Honesty");',
    '  - depth EXCEEDS two layers wherever the distinctions are real;',
    '  - SUBSTANTIAL multi-parent coverage — most concepts that have children should have at',
    '    least one child with an alternate parent — and multi-parented nodes that differentiate',
    '    must differentiate DIFFERENTLY under each parent;',
    '  - every child passes the CONTRASTIVE-SEPARABILITY gate (pull-apart-able from its parent',
    '    AND from each sibling); collapse near-synonyms into one node;',
    '  - a FRONTIER on every node.',
    '',
    'Return the single JSON object specified in the contract. No prose.',
  ].join('\n');
}

// ----------------------------------------------------------------------------
// Anthropic Messages API (raw fetch, prompt caching on the constant system prefix)
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
    // Adaptive thinking is the only on-mode for Opus 4.8 / Fable 5; effort controls depth.
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    // Cache the constant system prefix (rubric + genesis instructions) so a retry at
    // the higher ceiling re-reads it from cache rather than re-billing it.
    system: [{ type: 'text', text: systemText, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: userText }],
  };

  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
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

// Indirection so offline tests can stub the model (no network/key needed) — mirrors
// reason.js's __setCallModelForTest.
let _callModel = callModel;
function __setCallModelForTest(fn) {
  _callModel = fn;
}

// ----------------------------------------------------------------------------
// Genesis pass (cached by rubric + prompt version => resumable / re-billable-free)
// ----------------------------------------------------------------------------

let _rubricHash = null;
function rubricHash() {
  if (_rubricHash === null) _rubricHash = fnv1a(fs.readFileSync(RUBRIC_PATH, 'utf8'));
  return _rubricHash;
}

function genesisCachePath() {
  const h = fnv1a(`${PROMPT_VERSION}|${MODEL}|${EFFORT}|r${rubricHash()}`);
  return path.join(CACHE_DIR, `genesis-${h}.json`);
}

async function runGenesis(rubric) {
  const cp = genesisCachePath();
  if (!FORCE && !NO_CACHE && fs.existsSync(cp)) {
    console.log(`  [cache] genesis  (${path.basename(cp)})  — use --force to re-call the model`);
    try {
      return JSON.parse(fs.readFileSync(cp, 'utf8'));
    } catch {
      // fall through and re-call on a corrupt cache file
    }
  }

  const system = genesisSystem(rubric);
  const user = genesisUser();

  console.log('  [author] synthesizing the genesis taxonomy from the scholarship…');
  let res = await _callModel(system, user, MAX_TOKENS_GENESIS);
  let parsed = res.stop_reason === 'max_tokens' ? null : extractJson(res.text);

  if (!parsed) {
    const why =
      res.stop_reason === 'max_tokens'
        ? `hit max_tokens at ${MAX_TOKENS_GENESIS}`
        : 'returned unparseable JSON';
    console.warn(`    (warn) genesis ${why}; retrying once at ${MAX_TOKENS_GENESIS_RETRY} tokens…`);
    res = await _callModel(system, user, MAX_TOKENS_GENESIS_RETRY);
    if (res.stop_reason === 'max_tokens') {
      throw new Error(
        `Genesis pass still truncated at ${MAX_TOKENS_GENESIS_RETRY} tokens. ` +
          'Lower the scope (the model can be asked for a shallower taxonomy) and re-run.'
      );
    }
    parsed = extractJson(res.text);
    if (!parsed) {
      throw new Error('Genesis pass returned unparseable JSON after the retry.');
    }
  }

  if (!NO_CACHE) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cp, JSON.stringify(parsed, null, 2), 'utf8');
  }
  return parsed;
}

// ----------------------------------------------------------------------------
// Normalize + light structural sanity (deep judgement lives in validate.js)
// ----------------------------------------------------------------------------

// Coerce the model's nodes into the canonical output shape, dropping anything that
// cannot be a node (no name). parent_paths is normalized to string[][] always; a
// stray flat string[] (single path) is wrapped, and "" / null become a root ([]).
function normalizeNodes(raw) {
  const nodes = asArray(raw && raw.nodes);
  const out = [];
  for (const n of nodes) {
    if (!n || typeof n.name !== 'string' || !n.name.trim()) continue;
    let pp = n.parent_paths;
    if (pp == null) pp = [];
    else if (Array.isArray(pp) && pp.length && !Array.isArray(pp[0])) pp = [pp]; // single flat path
    pp = asArray(pp)
      .map((p) => asArray(p).map((x) => String(x)))
      .filter((p) => p.length); // drop empty inner paths (a root is the OUTER array being empty)
    out.push({
      name: n.name.trim(),
      parent_paths: pp,
      basis: typeof n.basis === 'string' ? n.basis : '',
      frontiers: asArray(n.frontiers).map((f) => String(f)).filter((f) => f.trim()),
    });
  }
  return out;
}

// ----------------------------------------------------------------------------
// Markdown writer — the taxonomy as an indented tree
// ----------------------------------------------------------------------------

function normName(s) {
  return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim();
}
function pathKey(arr) {
  return asArray(arr).map(normName).join(' > ');
}

// Index children by their parent's full path. A node C with parent_path PP attaches to
// the node whose full path is PP (root-to-parent), so children-of-(parent-reached-by-PP)
// = nodes C with some C.parent_paths element === PP. Roots are nodes with no parent_paths.
function buildChildIndex(nodes) {
  const childrenByParentFullPath = new Map();
  const roots = [];
  for (const n of nodes) {
    if (!n.parent_paths.length) {
      roots.push(n);
      continue;
    }
    for (const pp of n.parent_paths) {
      const k = pathKey(pp);
      if (!childrenByParentFullPath.has(k)) childrenByParentFullPath.set(k, []);
      childrenByParentFullPath.get(k).push(n);
    }
  }
  return { childrenByParentFullPath, roots };
}

function writeMarkdown(nodes) {
  const L = [];
  const { childrenByParentFullPath, roots } = buildChildIndex(nodes);

  L.push('# Chaos — Genesis taxonomy proposal (the Categorizer)');
  L.push('');
  L.push(`**Generated by:** chaos/ouranos.js (genesis mode) · model ${MODEL} · effort ${EFFORT} · rubric v${rubricVersion()}`);
  L.push('**Write target:** this file + chaos/genesis/proposal.json. No Orca dev-graph access of any kind was performed; nothing was instantiated.');
  L.push(`**Totals:** ${nodes.length} quality-adjective nodes · ${roots.length} roots.`);
  L.push('**Review next:** `node chaos/genesis/validate.js`');
  L.push('');
  L.push('Each node is a bare quality-adjective; meaning is read along the path (chaos.md §7). ');
  L.push('`⇄ also under:` marks a multi-parent placement (the same adjective as a distinct contextual entity).');
  L.push('');
  L.push('---');
  L.push('');
  L.push('# Taxonomy');
  L.push('');

  const rendered = new Set(); // node names rendered at least once (for the orphan sweep)

  // Recursive renderer. `arrivedVia` is the parent path we descended through, so we can
  // mark the node's OTHER parents. `lineagePath` is the set of node names on the current
  // root-to-here chain, guarding against cycles (the graph is a DAG, but be safe).
  function render(node, depth, arrivedViaKey, lineageNames) {
    rendered.add(normName(node.name));
    const indent = '  '.repeat(depth);

    // Other parents (multi-parent marking): all parent paths except the one we arrived via.
    const others = node.parent_paths
      .filter((pp) => pathKey(pp) !== arrivedViaKey)
      .map((pp) => (pp.length ? pp.join(' › ') : '(root)'));
    const alsoUnder = others.length ? `  ⇄ also under: ${others.join(' | ')}` : '';

    L.push(`${indent}- **${node.name}**${alsoUnder}`);
    if (node.basis) L.push(`${indent}  · basis: ${node.basis}`);
    if (node.frontiers.length) L.push(`${indent}  · frontiers: ${node.frontiers.join(' ⌁ ')}`);

    // Descend. This node's full path (root-to-this) is arrivedVia + [name].
    const myFullPath = (arrivedViaKey ? arrivedViaKey.split(' > ') : []).concat(normName(node.name));
    const myKey = myFullPath.join(' > ');
    const kids = childrenByParentFullPath.get(myKey) || [];
    for (const kid of kids) {
      if (lineageNames.has(normName(kid.name)) || depth > 50) {
        L.push(`${indent}  - (… cycle/limit guard: ${kid.name})`);
        continue;
      }
      render(kid, depth + 1, myKey, new Set([...lineageNames, normName(node.name)]));
    }
  }

  // Roots alphabetical, for a stable read.
  const orderedRoots = roots.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const r of orderedRoots) {
    render(r, 0, '', new Set());
    L.push('');
  }

  // Orphan sweep — any node never reached from a root (e.g. its parent_path names a
  // non-existent node). Surface them rather than silently dropping.
  const orphans = nodes.filter((n) => !rendered.has(normName(n.name)));
  if (orphans.length) {
    L.push('---');
    L.push('');
    L.push(`# Unplaced nodes (${orphans.length}) — parent path references a name not present as a node`);
    L.push('');
    for (const n of orphans) {
      L.push(`- **${n.name}** — parent_paths: ${n.parent_paths.map((pp) => pp.join(' › ')).join(' | ') || '(none)'}`);
    }
    L.push('');
  }

  L.push('---');
  L.push('');
  L.push('**END OF GENESIS PROPOSAL — no dev-graph writes, no instantiation. Review gate is next.**');
  L.push('');

  fs.writeFileSync(PROPOSAL_MD, L.join('\n'), 'utf8');
}

function writeJson(nodes) {
  const out = {
    generated_by: 'chaos/ouranos.js',
    mode: MODE,
    model: MODEL,
    effort: EFFORT,
    prompt_version: PROMPT_VERSION,
    rubric_version: rubricVersion(),
    graph_state: 'empty (genesis — authored fresh from scholarship, no DB access)',
    domain: ATTRIBUTES,
    node_count: nodes.length,
    nodes,
  };
  fs.writeFileSync(PROPOSAL_JSON, JSON.stringify(out, null, 2), 'utf8');
}

// ----------------------------------------------------------------------------
// Run summary
// ----------------------------------------------------------------------------

function printSummary(nodes) {
  console.log('\n================ GENESIS SUMMARY ================');
  console.log(`model ${MODEL}  effort ${EFFORT}  rubric v${rubricVersion()}`);
  console.log(`\nNodes: ${nodes.length}  (bare quality-adjectives)`);
  console.log('\nAPI usage this run:');
  console.log(`  API calls made:               ${apiCallCount}`);
  console.log(`  input tokens (uncached):      ${usageTotals.input_tokens}`);
  console.log(`  cache write tokens:           ${usageTotals.cache_creation_input_tokens}`);
  console.log(`  cache read tokens:            ${usageTotals.cache_read_input_tokens}`);
  console.log(`  output tokens:                ${usageTotals.output_tokens}`);
  console.log('\nWrote chaos/genesis/proposal.json and chaos/genesis/proposal.md');
  console.log('Next: node chaos/genesis/validate.js');
  console.log('================================================\n');
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  if (MODE !== 'genesis') {
    throw new Error(
      `mode "${MODE}" is not implemented. Only genesis mode exists in this build ` +
        '(frontier-driven mode is a later build — chaos.md §2, §11).'
    );
  }
  console.log('Chaos Ouranos (the Categorizer) — GENESIS MODE: authoring the initial research-values taxonomy from scholarship.');
  console.log(`model=${MODEL}  effort=${EFFORT}${FORCE ? '  --force' : ''}${NO_CACHE ? '  --no-cache' : ''}\n`);

  fs.mkdirSync(GENESIS_DIR, { recursive: true });
  const rubric = loadRubric();
  const raw = await runGenesis(rubric);
  const nodes = normalizeNodes(raw);
  if (!nodes.length) {
    throw new Error('Genesis produced zero usable nodes. The model response had no valid "nodes" array.');
  }

  writeJson(nodes);
  writeMarkdown(nodes);
  printSummary(nodes);
}

// Best-effort drain of undici keep-alive sockets so Node exits on its own without
// tripping the Windows libuv shutdown race (same as reason.js).
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
      console.error('\nouranos.js failed:', err.message);
      await closeHttp();
      process.exitCode = 1;
    });
}

// Exported for offline testing of the emit pipeline (no API key required).
module.exports = {
  extractJson,
  fnv1a,
  normalizeNodes,
  buildChildIndex,
  pathKey,
  normName,
  writeJson,
  writeMarkdown,
  runGenesis,
  genesisSystem,
  genesisUser,
  rubricVersion,
  __setCallModelForTest,
  ATTRIBUTES,
  PROPOSAL_JSON,
  PROPOSAL_MD,
};
