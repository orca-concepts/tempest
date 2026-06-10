#!/usr/bin/env node

/**
 * Chaos — reasoning layer (Stage 3, productized).
 *
 * The "hands" for the manual Run-1 reasoning: reads the sourced papers through
 * chaos.md (the governing brain, loaded at runtime and passed as the model's
 * system prompt) and writes a proposals review file in the chaos.md §10 formats.
 *
 * READ-ONLY w.r.t. the Orca dev graph. This script NEVER opens a Postgres
 * connection, runs a migration, or writes a row. Its only inputs are the local
 * chaos/ files (rubric, snapshot, sourced papers) and the Anthropic Messages
 * API; its only outputs are files under chaos/ (the review file, the structured
 * proposals file, and a per-paper reasoning cache). Proposals go to files for a
 * human review gate (chaos.md §8 step 7), never to the dev graph.
 *
 * Two phases (chaos.md §8 pipeline steps 3 and 4-5):
 *   a. Per-paper pass  — one model call per paper. System prompt = chaos.md +
 *      the current graph state (the snapshot). Input = the paper (full text if
 *      present, else abstract). The model does the move-step read of BOTH ends
 *      of the arc (P10 v0.5: intro CARS moves for the early phases + questions;
 *      methods/results for the mid-to-late phases) and returns STRICT JSON:
 *      candidate concepts, links, tunnels, and the per-article prediction test.
 *      Each paper's JSON is cached to chaos/reason_cache/<id>.json and SKIPPED
 *      on re-run (resumable, cost-saving).
 *   b. Integration pass — one model call over the ACCUMULATED candidates
 *      (compact: names/paths/groundings, not the full texts). Merges
 *      near-duplicate concepts and tallies recurrence (P13), composes situations
 *      (§5), finalizes co-grounded tunnels (P8 + P2 directness), phi-ranks the
 *      set (P12), and flags single-grounded items (S).
 *
 * The rubric is NOT hard-coded here — it travels in the prompt. This file is
 * plumbing only; all reasoning logic lives in chaos.md and the model.
 *
 * Usage:
 *   set ANTHROPIC_API_KEY=sk-ant-...
 *   node chaos/reason.js --max=5
 *   node chaos/reason.js --max=8 --field=neuroscience
 *   node chaos/reason.js --max=5 --effort=medium
 */

const path = require('path');
const fs = require('fs');

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------

const CHAOS_DIR = __dirname;
const RUBRIC_PATH = path.join(CHAOS_DIR, 'chaos.md');
const SNAPSHOT_PATH = path.join(CHAOS_DIR, 'snapshot.json');
const PAPERS_DIR = path.join(CHAOS_DIR, 'papers');
const MANIFEST_PATH = path.join(PAPERS_DIR, 'index.json');
const CACHE_DIR = path.join(CHAOS_DIR, 'reason_cache');
const PROPOSALS_MD = path.join(CHAOS_DIR, 'proposals.md');
const PROPOSALS_JSON = path.join(CHAOS_DIR, 'proposals.json');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = argValue('--model') || 'claude-opus-4-8';
const EFFORT = argValue('--effort') || 'high'; // low | medium | high | xhigh | max
const MAX_PAPERS = parseInt(argValue('--max') || '8', 10);
const FIELD_FILTER = argValue('--field') || null;

const FULLTEXT_CHAR_CAP = 60000; // bound per-paper input tokens

// Output ceilings. Opus 4.8's hard max_tokens is 128000; these stay well under it
// (so they never 400) while giving generous headroom for adaptive-thinking tokens
// plus the JSON. Per-paper output is one paper's small candidate set; 24000 is
// ample. Integration output grows with corpus size, so it gets a larger base and a
// one-shot retry at double if the model still hits the cap.
const MAX_TOKENS_PAPER = 24000;
const MAX_TOKENS_INTEGRATION = 32000;
const MAX_TOKENS_INTEGRATION_RETRY = 64000;
const HTTP_TIMEOUT_MS = 420000; // 7 min per call (headroom for the large integration retry)
const MAX_RETRIES = 3;

// The lifecycle phases (chaos.md §6, provisional). Questions are NOT phase-mapped.
const PHASES = [
  'Sensing the gap',
  'Committing to a question',
  'Designing the approach',
  'Executing and wrestling with data',
  'Interpreting',
  'Reporting and returning',
];

const ATTRIBUTES = ['value', 'action', 'tool', 'question'];

// ----------------------------------------------------------------------------
// Small helpers
// ----------------------------------------------------------------------------

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + '='));
  return a ? a.split('=').slice(1).join('=') : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shortId(openalexId) {
  return String(openalexId || '').split('/').pop();
}

// Tolerant JSON extraction — strips markdown fences and grabs the outermost
// object, so a stray sentence around the JSON does not break the run.
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

function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function pathLabel(parentPath) {
  const arr = asArray(parentPath).filter((x) => x !== null && x !== undefined && String(x).length);
  return arr.length ? arr.join(' › ') : '— (root edge)';
}

// ----------------------------------------------------------------------------
// Load rubric + snapshot + manifest
// ----------------------------------------------------------------------------

function loadRubric() {
  return fs.readFileSync(RUBRIC_PATH, 'utf8');
}

// Compact, human-readable view of the current dev-graph state, derived from the
// snapshot. Deliberately omits the snapshot meta block (connection details) so
// nothing graph-internal leaks into the prompt or the cached outputs.
function loadGraphState() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const c = snap.counts || {};
  const attrs = asArray(snap.attributes).map((a) => a.name).join(', ');
  const lines = [
    'CURRENT GRAPH STATE (the dev snapshot you are reasoning against):',
    `  attributes: ${attrs || '(none)'}`,
    `  concepts: ${c.concepts ?? 0}`,
    `  edges: ${c.edges ?? 0}`,
    `  concept_links: ${c.concept_links ?? 0}`,
    `  situations (combos): ${c.combos ?? 0}`,
    `  tunnel_links: ${c.tunnel_links ?? 0}`,
  ];
  const isEmpty = (c.concepts ?? 0) === 0 && (c.edges ?? 0) === 0;
  if (isEmpty) {
    lines.push('');
    lines.push(
      'The graph is EMPTY — this is the bootstrapping seed run. Every concept an ' +
        'article instantiates is therefore a GAP under P14 (there is nothing yet to ' +
        'non-confirm or mis-structure). Be conservative with the concept budget.'
    );
  }
  return { text: lines.join('\n'), isEmpty };
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch {
    return null;
  }
}

// Select the working set: prefer full text, spread across fields (round-robin by
// primary field for cross-disciplinary coverage — the P14 balance guard), honor
// an optional --field filter, cap at --max.
function selectPapers() {
  const manifest = loadManifest();
  let entries;
  if (manifest && asArray(manifest.papers).length) {
    entries = manifest.papers.map((p) => ({
      id: p.id,
      fields: asArray(p.fields),
      full_text: !!p.full_text_available,
      title: p.title,
    }));
  } else {
    // Fall back to scanning the papers dir.
    entries = fs
      .readdirSync(PAPERS_DIR)
      .filter((f) => f.endsWith('.json') && f !== 'index.json')
      .map((f) => {
        const rec = JSON.parse(fs.readFileSync(path.join(PAPERS_DIR, f), 'utf8'));
        return {
          id: rec.id,
          fields: asArray(rec.discipline_tags && rec.discipline_tags.query_fields),
          full_text: !!rec.full_text_available,
          title: rec.title,
        };
      });
  }

  if (FIELD_FILTER) {
    entries = entries.filter((e) => e.fields.includes(FIELD_FILTER));
  }

  // Group by primary field, full-text first within each group, then round-robin.
  const groups = new Map();
  for (const e of entries) {
    const key = e.fields[0] || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (b.full_text ? 1 : 0) - (a.full_text ? 1 : 0));
  }
  const ordered = [];
  const keys = [...groups.keys()];
  let added = true;
  while (added) {
    added = false;
    for (const k of keys) {
      const list = groups.get(k);
      if (list.length) {
        ordered.push(list.shift());
        added = true;
      }
    }
  }
  // Prefer full-text papers globally, but keep the round-robin order within each tier.
  const ft = ordered.filter((e) => e.full_text);
  const ab = ordered.filter((e) => !e.full_text);
  return [...ft, ...ab].slice(0, Math.max(1, MAX_PAPERS));
}

function loadPaper(id) {
  return JSON.parse(fs.readFileSync(path.join(PAPERS_DIR, `${id}.json`), 'utf8'));
}

// The article content sent to the model. Full text when available (bounded),
// otherwise the abstract. The reference list is summarized to a count to save
// tokens; the URL is the paper's DOI/OA link for link proposals.
function paperPromptText(rec) {
  const url = rec.best_oa_url || rec.doi || rec.openalex_id || '';
  const body =
    rec.full_text_available && rec.full_text
      ? rec.full_text.slice(0, FULLTEXT_CHAR_CAP)
      : rec.abstract || '(no abstract available)';
  const kind = rec.full_text_available && rec.full_text ? 'FULL TEXT' : 'ABSTRACT ONLY';
  return [
    `PAPER_ID: ${rec.id}`,
    `TITLE: ${rec.title || ''}`,
    `FIELDS: ${asArray(rec.discipline_tags && rec.discipline_tags.query_fields).join(', ')}`,
    `VENUE: ${rec.host_venue || ''}  YEAR: ${rec.publication_year || ''}`,
    `URL (use this as the link url): ${url}`,
    `REFERENCED_WORKS_COUNT: ${asArray(rec.referenced_works).length}`,
    '',
    `ARTICLE (${kind}):`,
    body,
  ].join('\n');
}

// ----------------------------------------------------------------------------
// Prompts (the rubric travels here; no rubric logic is hard-coded in the script)
// ----------------------------------------------------------------------------

const PHASE_ENUM = PHASES.map((p) => `"${p}"`).join(' | ');

function perPaperSystem(rubric, graphStateText) {
  return [
    'You are Chaos, a tool that proposes contributions to Orca’s concept graphs.',
    'Your governing brain — the principles, the run procedure, and the formats — is the',
    'rubric below (chaos.md). Obey it exactly. Do not invent rules it does not state.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    graphStateText,
    '',
    'YOUR TASK THIS CALL: move-step read ONE article (provided in the user turn).',
    'Per P10 (v0.5) read BOTH ENDS OF THE ARC:',
    '  - the introduction’s rhetorical moves (Swales CARS Move 1 = establish a',
    '    territory, Move 2 = establish the niche / the gap) for the EARLY phases',
    '    ("Sensing the gap", "Committing to a question") and for open QUESTIONS; and',
    '  - the conduct in methods/results/discussion for the MID-TO-LATE phases',
    '    ("Designing the approach", "Executing and wrestling with data",',
    '    "Interpreting", "Reporting and returning").',
    'Decompose into candidate concepts across the four domains: value = a disposition',
    '(who I am), action = what I do, tool = what I use, question = what I ask. Honor P2',
    '(a disposition is not the behavior that enacts it; when you propose a tunnel, pair',
    'the disposition with the action that MOST DIRECTLY enacts it), P3 (subtextual, not',
    'the article’s vocabulary), P9 (self-anchored, a short noun/gerund/imperative',
    'phrase, never a proposition). Apply the P5 hypothetical-researcher test and the P8',
    'co-grounding check. Be conservative with the concept budget.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no markdown fences, no',
    'commentary. A single JSON object with exactly these keys:',
    '{',
    '  "paper_id": string,',
    '  "fields": string[],',
    '  "conduct_phases": string[],   // which lifecycle phase(s) the paper’s own conduct sits in',
    '  "concepts": [',
    '    {',
    '      "attribute": "value" | "action" | "tool" | "question",',
    '      "name": string,                 // short, self-anchored, never a proposition',
    '      "parent_path": string[],        // ancestor concept names, [] for a root',
    `      "phase": ${PHASE_ENUM} | null,  // null for question concepts only`,
    '      "prediction": string,           // what research should keep instantiating',
    '      "grounding": "single" | "multi",// your read of whether THIS paper alone grounds it',
    '      "rationale": string             // general->specific, subtextual, self-anchored',
    '    }',
    '  ],',
    '  "links": [',
    '    { "attribute": string, "concept_name": string, "parent_path": string[],',
    '      "url": string, "claim": string }   // claim = how the conduct EXEMPLIFIES the concept (P5)',
    '  ],',
    '  "tunnels": [',
    '    { "from": { "attribute": string, "name": string },',
    '      "to":   { "attribute": string, "name": string },',
    '      "relation": string,            // a cost/benefit relation',
    '      "cogrounding_url": string,     // the paper URL when one doc grounds BOTH ends (P8), else ""',
    '      "directness_note": string }    // why this is the action that most directly enacts the disposition (P2)',
    '  ],',
    '  "prediction_test": {',
    '    "gaps": string[],              // concept names the article instantiates that the graph cannot hold',
    '    "non_confirmations": string[], // empty on an empty graph',
    '    "mis_structures": string[]     // empty on an empty graph',
    '  }',
    '}',
    'Use the EXACT phase strings listed above. Return only the JSON object.',
  ].join('\n');
}

function integrationSystem(rubric) {
  return [
    'You are Chaos. Your governing brain is the rubric below (chaos.md). Obey it exactly.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    'YOUR TASK THIS CALL: the INTEGRATION pass (chaos.md §8 steps 4–5) over the',
    'accumulated per-paper candidates (provided in the user turn). Do all of:',
    '  - Merge near-duplicate concepts across papers (same attribute + the same',
    '    underlying disposition/action/tool/question, even if worded differently).',
    '  - Tally RECURRENCE (P13): how many DISTINCT papers independently exemplify each',
    '    merged concept. recurrence >= 2 => confidence "C" (confirmed in-batch);',
    '    recurrence == 1 => confidence "S" (single-grounded, speculative).',
    '  - Finalize CO-GROUNDED cost/benefit tunnels (P8); keep the co-grounding doc URL;',
    '    ensure each pairs a disposition with the action that MOST DIRECTLY enacts it (P2).',
    '  - Compose SITUATIONS (§5) as cost/benefit moments: cluster member edges by shared',
    '    grounding documents and shared lifecycle phase; give each a name, a phase, a',
    '    domain-balance read-out, an intersection reading list (shared doc URLs), and a',
    '    core-spine vs toggleable split; apply the felt-context test.',
    '  - PHI-RANK (P12): order the concepts most-integrative-and-differentiated first',
    '    (bridges previously-separate regions while staying specific); add a short "phi" note.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no fences. Keep it COMPACT:',
    'return your MERGE DECISIONS, not a restatement of every input field. Do NOT echo',
    'each concept’s prediction or rationale — those are reconstructed locally from the',
    'per-paper cache via "source_refs". One object with keys:',
    '{',
    '  "concepts": [   // one entry per MERGED concept (deduplicated across papers)',
    '    { "attribute": string, "name": string, "parent_path": string[],',
    `      "phase": ${PHASE_ENUM} | null,`,
    '      "recurrence": number, "confidence": "C" | "S", "phi": string,',
    '      "source_refs": [ { "paper_id": string, "name": string } ]  // the per-paper concepts you merged into this one',
    '    }',
    '  ],',
    '  "tunnels": [',
    '    { "from": { "attribute": string, "name": string },',
    '      "to":   { "attribute": string, "name": string },',
    '      "relation": string, "cogrounding_url": string, "confidence": "C" | "S" }',
    '  ],',
    '  "situations": [',
    '    { "name": string, "phase": string,',
    '      "members": [ { "attribute": string, "name": string } ],',
    '      "domain_balance": { "value": number, "question": number, "action": number, "tool": number },',
    '      "reading_list": string[], "core_spine": string[], "toggleable": string[],',
    '      "rationale": string, "confidence": "C" | "S" }',
    '  ],',
    '  "recurrences": [ { "name": string, "count": number, "papers": string[] } ]',
    '}',
    'Order "concepts" best-phi-first. Return only the JSON object.',
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
    // Cache the constant system prefix (rubric + graph state / integration instructions)
    // so the per-paper calls re-read it from cache rather than re-billing it each time.
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
        // 429 / 500 / 529 are retryable; 4xx (other) are not.
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

// Indirection so offline tests can stub the model (no network/key needed).
let _callModel = callModel;
function __setCallModelForTest(fn) {
  _callModel = fn;
}

// ----------------------------------------------------------------------------
// Per-paper pass (resumable via on-disk cache)
// ----------------------------------------------------------------------------

// rubricHash() salts every cache key with a hash of chaos.md, so editing the rubric
// automatically invalidates stale per-paper AND integration cache entries — the
// rubric is the model's system prompt, so a different rubric is a different read and
// must not silently reuse an old result. Memoized per process.
let _rubricHash = null;
function rubricHash() {
  if (_rubricHash === null) _rubricHash = fnv1a(fs.readFileSync(RUBRIC_PATH, 'utf8'));
  return _rubricHash;
}

function cachePathFor(id) {
  return path.join(CACHE_DIR, `${id}-r${rubricHash()}.json`);
}

async function runPerPaper(selected, systemText) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const results = [];
  for (const entry of selected) {
    const cp = cachePathFor(entry.id);
    if (fs.existsSync(cp)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cp, 'utf8'));
        results.push(cached);
        console.log(`  [cache] ${entry.id}  ${trunc(entry.title, 60)}`);
        continue;
      } catch {
        // fall through and re-fetch on a corrupt cache file
      }
    }

    const rec = loadPaper(entry.id);
    console.log(`  [read ] ${entry.id}  ${trunc(entry.title, 60)}`);
    const { text, stop_reason } = await _callModel(
      systemText,
      paperPromptText(rec),
      MAX_TOKENS_PAPER
    );
    if (stop_reason === 'max_tokens') {
      console.warn(
        `    (warn) ${entry.id}: hit max_tokens — truncated; skipping (NOT cached, will retry on re-run).`
      );
      continue;
    }
    const parsed = extractJson(text);
    if (!parsed) {
      console.warn(`    (warn) ${entry.id}: could not parse JSON — skipping (not cached).`);
      continue;
    }
    parsed.paper_id = parsed.paper_id || entry.id;
    parsed._meta = {
      id: entry.id,
      title: rec.title,
      fields: asArray(rec.discipline_tags && rec.discipline_tags.query_fields),
      url: rec.best_oa_url || rec.doi || rec.openalex_id || '',
      full_text: !!rec.full_text_available,
    };
    fs.writeFileSync(cp, JSON.stringify(parsed, null, 2), 'utf8');
    results.push(parsed);
  }
  return results;
}

function trunc(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ----------------------------------------------------------------------------
// Integration pass (cached by a hash of the per-paper outputs => resumable)
// ----------------------------------------------------------------------------

// Compact projection of the per-paper candidates for the integration prompt:
// names/paths/groundings only, never the full texts. Predictions and rationales
// are deliberately OMITTED here — the model doesn't need them to merge, and they
// are reconstructed locally from the per-paper cache afterward (less input + less
// output the model must echo back).
function compactCandidates(perPaper) {
  return perPaper.map((p) => ({
    paper_id: p.paper_id,
    title: (p._meta && p._meta.title) || '',
    fields: asArray(p.fields).length ? p.fields : (p._meta && p._meta.fields) || [],
    url: (p._meta && p._meta.url) || '',
    conduct_phases: asArray(p.conduct_phases),
    concepts: asArray(p.concepts).map((c) => ({
      attribute: c.attribute,
      name: c.name,
      parent_path: asArray(c.parent_path),
      phase: c.phase ?? null,
      grounding: c.grounding || '',
    })),
    links: asArray(p.links).map((l) => ({
      concept_name: l.concept_name,
      attribute: l.attribute,
      url: l.url,
    })),
    tunnels: asArray(p.tunnels),
    prediction_test: p.prediction_test || { gaps: [], non_confirmations: [], mis_structures: [] },
  }));
}

// Dependency-free FNV-1a hash (32-bit) — keys the integration cache by the exact
// per-paper inputs so an unchanged re-run resolves from cache (no model call).
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function integrationCachePath(compact) {
  const h = fnv1a(JSON.stringify(compact) + `|${MODEL}|${EFFORT}|r${rubricHash()}`);
  return path.join(CACHE_DIR, `integration-${h}.json`);
}

async function runIntegration(perPaper, rubric) {
  const compact = compactCandidates(perPaper);
  const cp = integrationCachePath(compact);
  if (fs.existsSync(cp)) {
    console.log(`  [cache] integration  (${path.basename(cp)})`);
    try {
      return JSON.parse(fs.readFileSync(cp, 'utf8'));
    } catch {
      // re-run on corrupt cache
    }
  }
  console.log('  [integrate] merging candidates, tallying recurrence, composing situations…');
  const system = integrationSystem(rubric);
  const userText =
    'ACCUMULATED PER-PAPER CANDIDATES (compact JSON; reason over these, not full texts):\n\n' +
    JSON.stringify(compact, null, 2);

  // First attempt at the base ceiling.
  let res = await _callModel(system, userText, MAX_TOKENS_INTEGRATION);
  // Truncation is detected explicitly — never try to parse a known-truncated string.
  let parsed = res.stop_reason === 'max_tokens' ? null : extractJson(res.text);

  // One-shot retry at a higher ceiling if it truncated OR came back unparseable.
  if (!parsed) {
    const why = res.stop_reason === 'max_tokens' ? `hit max_tokens at ${MAX_TOKENS_INTEGRATION}` : 'returned unparseable JSON';
    console.warn(`    (warn) integration ${why}; retrying once at ${MAX_TOKENS_INTEGRATION_RETRY} tokens…`);
    res = await _callModel(system, userText, MAX_TOKENS_INTEGRATION_RETRY);
    if (res.stop_reason === 'max_tokens') {
      throw new Error(
        `Integration pass still truncated at ${MAX_TOKENS_INTEGRATION_RETRY} tokens. ` +
          'Per-paper caches are preserved — re-run (they will be reused, only the integration call repeats), ' +
          'or lower --max to shrink the candidate set.'
      );
    }
    parsed = extractJson(res.text);
    if (!parsed) {
      throw new Error(
        'Integration pass returned unparseable JSON after the retry. ' +
          'Per-paper caches are preserved — re-run to reuse them (only the integration call repeats).'
      );
    }
  }

  fs.writeFileSync(cp, JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}

// ----------------------------------------------------------------------------
// Emit proposals.json + proposals.md (chaos.md §10 formats)
// ----------------------------------------------------------------------------

// Rebuild the full concept objects locally from the integration merge decisions +
// the per-paper cache. The integration call returns compact concepts (no prediction)
// plus "source_refs"; we pull each merged concept's prediction from the per-paper
// concept it was merged from. This keeps the model's echo small while losing nothing.
function normName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .trim();
}

function reconstructConcepts(integration, perPaper) {
  // Index per-paper concepts two ways: by (paper_id, attribute, name) and by
  // (attribute, name) for a fallback when source_refs are missing/mismatched.
  const byRef = new Map();
  const byAttrName = new Map();
  for (const p of perPaper) {
    for (const c of asArray(p.concepts)) {
      byRef.set(`${p.paper_id}|${c.attribute}|${normName(c.name)}`, c);
      const k = `${c.attribute}|${normName(c.name)}`;
      if (!byAttrName.has(k)) byAttrName.set(k, c);
    }
  }

  return asArray(integration.concepts).map((c) => {
    const refs = asArray(c.source_refs);
    let src = null;
    for (const r of refs) {
      const hit = byRef.get(`${r.paper_id}|${c.attribute}|${normName(r.name)}`);
      if (hit) {
        src = hit;
        break;
      }
    }
    if (!src) src = byAttrName.get(`${c.attribute}|${normName(c.name)}`) || null;

    const groundingPapers =
      asArray(c.grounding_papers).length > 0
        ? c.grounding_papers
        : [...new Set(refs.map((r) => r.paper_id).filter(Boolean))];

    return {
      attribute: c.attribute,
      name: c.name,
      parent_path: asArray(c.parent_path),
      phase: c.phase ?? (src && src.phase) ?? null,
      prediction: c.prediction || (src && src.prediction) || '',
      recurrence: c.recurrence != null ? c.recurrence : groundingPapers.length,
      grounding_papers: groundingPapers,
      confidence: c.confidence || (groundingPapers.length >= 2 ? 'C' : 'S'),
      phi: c.phi || '',
    };
  });
}

function computeDistributions(integration) {
  const concepts = asArray(integration.concepts);
  const domain = { value: 0, action: 0, tool: 0, question: 0 };
  const phase = {};
  for (const p of PHASES) phase[p] = 0;
  let questionsUnphased = 0;
  for (const c of concepts) {
    if (domain[c.attribute] !== undefined) domain[c.attribute] += 1;
    if (c.attribute === 'question') {
      questionsUnphased += 1;
    } else if (c.phase && phase[c.phase] !== undefined) {
      phase[c.phase] += 1;
    }
  }
  return { domain, phase, questionsUnphased };
}

function writeJson(integration, perPaper, selected, dist) {
  const out = {
    generated_by: 'chaos/reason.js',
    model: MODEL,
    effort: EFFORT,
    rubric_version: rubricVersion(),
    graph_state: 'empty (bootstrapping seed)',
    papers: selected.map((s) => ({ id: s.id, title: s.title, fields: s.fields, full_text: s.full_text })),
    counts_by_domain: dist.domain,
    phase_distribution: dist.phase,
    questions_unphased: dist.questionsUnphased,
    concepts: asArray(integration.concepts),
    tunnels: asArray(integration.tunnels),
    situations: asArray(integration.situations),
    recurrences: asArray(integration.recurrences),
    per_article_prediction_test: perPaper.map((p) => ({
      paper_id: p.paper_id,
      conduct_phases: asArray(p.conduct_phases),
      gaps: asArray(p.prediction_test && p.prediction_test.gaps),
      non_confirmations: asArray(p.prediction_test && p.prediction_test.non_confirmations),
      mis_structures: asArray(p.prediction_test && p.prediction_test.mis_structures),
    })),
    links: perPaper.flatMap((p) =>
      asArray(p.links).map((l) => ({ paper_id: p.paper_id, ...l }))
    ),
  };
  fs.writeFileSync(PROPOSALS_JSON, JSON.stringify(out, null, 2), 'utf8');
}

function rubricVersion() {
  try {
    const m = fs.readFileSync(RUBRIC_PATH, 'utf8').match(/^\*\*Version:\*\*\s*([0-9.]+)/m);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeMarkdown(integration, perPaper, selected, dist) {
  const L = [];
  const concepts = asArray(integration.concepts);
  const byAttr = (a) => concepts.filter((c) => c.attribute === a);

  L.push('# Chaos — Proposals (productized run)');
  L.push('');
  L.push(`**Generated by:** chaos/reason.js · model ${MODEL} · effort ${EFFORT} · rubric v${rubricVersion()}`);
  L.push('**Graph state:** empty (bootstrapping seed). Every concept is a GAP (P14) — no non-confirmations or mis-structures possible yet.');
  L.push('**Write target:** this file + chaos/proposals.json. No Orca dev-graph access of any kind was performed.');
  L.push('');
  L.push('---');
  L.push('');

  // Papers chosen
  L.push('## Papers read');
  L.push('');
  L.push('| # | id | fields | full text | title |');
  L.push('|---|----|--------|-----------|-------|');
  selected.forEach((s, i) => {
    L.push(`| ${i + 1} | ${s.id} | ${s.fields.join(', ')} | ${s.full_text ? '✓' : 'abstract'} | ${trunc(s.title, 70)} |`);
  });
  L.push('');
  L.push('---');
  L.push('');

  // Concept proposals
  L.push('# 1. Concept proposals');
  L.push('');
  L.push('Format (§10): domain + attribute · parent path · new child · lifecycle phase · prediction · recurrence/confidence. **C** = confirmed in-batch (recurs ≥ 2 papers); **S** = single-grounded.');
  L.push('');
  for (const attr of ATTRIBUTES) {
    const list = byAttr(attr);
    L.push(`## ${attr[0].toUpperCase() + attr.slice(1)}s — ${list.length}`);
    L.push('');
    if (!list.length) {
      L.push('_(none this run)_');
      L.push('');
      continue;
    }
    for (const c of list) {
      const phase = attr === 'question' ? '(not phase-mapped)' : c.phase || '(unsorted)';
      const conf = c.confidence === 'C' ? 'C' : 'S';
      const rec = c.recurrence != null ? `recurrence ${c.recurrence}` : '';
      const papers = asArray(c.grounding_papers).join(', ');
      L.push(`**[${conf}] ${attr} · ${pathLabel(c.parent_path)} › ${c.name}** — phase: ${phase} · ${rec}${papers ? ` · papers: ${papers}` : ''}`);
      if (c.prediction) L.push(`- Prediction: ${c.prediction}`);
      if (c.phi) L.push(`- Phi: ${c.phi}`);
      L.push('');
    }
  }
  L.push('---');
  L.push('');

  // Link proposals
  L.push('# 2. Link proposals');
  L.push('');
  L.push('Format (§10): target edge · URL · comment = the exemplification claim (P5). Grouped by paper.');
  L.push('');
  for (const p of perPaper) {
    const links = asArray(p.links);
    if (!links.length) continue;
    L.push(`**${p.paper_id}** — ${(p._meta && p._meta.url) || ''}`);
    for (const l of links) {
      L.push(`- → ${l.attribute || ''} · ${pathLabel(l.parent_path)} › ${l.concept_name}: ${l.claim || ''}`);
    }
    L.push('');
  }
  L.push('---');
  L.push('');

  // Tunnels
  L.push('# 3. Cost/benefit tunnel proposals');
  L.push('');
  L.push('Format (§10): from-edge ↔ to-edge · cost/benefit relation · co-grounding document (P8) · directness (P2).');
  L.push('');
  const tunnels = asArray(integration.tunnels);
  if (!tunnels.length) L.push('_(none this run)_');
  tunnels.forEach((t, i) => {
    const from = t.from || {};
    const to = t.to || {};
    const cg = t.cogrounding_url ? `co-grounded: ${t.cogrounding_url}` : 'not co-grounded (speculative)';
    L.push(`**TUN-${i + 1} [${t.confidence === 'C' ? 'C' : 'S'}]** · ${from.attribute || ''} "${from.name || ''}" ↔ ${to.attribute || ''} "${to.name || ''}"`);
    L.push(`- ${t.relation || ''} · ${cg}`);
    L.push('');
  });
  L.push('---');
  L.push('');

  // Situations
  L.push('# 4. Situation proposals');
  L.push('');
  L.push('Format (§10): member edges · name · phase · domain-balance read-out · intersection reading list · core spine vs toggleable · cost/benefit-moment rationale.');
  L.push('');
  const sits = asArray(integration.situations);
  if (!sits.length) L.push('_(none this run)_');
  sits.forEach((s, i) => {
    const b = s.domain_balance || {};
    const members = asArray(s.members).map((m) => `${m.attribute} "${m.name}"`).join(' · ');
    L.push(`**SIT-${i + 1} [${s.confidence === 'C' ? 'C' : 'S'}] · "${s.name || ''}"** · phase: ${s.phase || ''}`);
    L.push(`- Members: ${members}`);
    L.push(`- Domain balance: value ${b.value || 0}, question ${b.question || 0}, action ${b.action || 0}, tool ${b.tool || 0}`);
    if (asArray(s.reading_list).length) L.push(`- Reading list (shared docs): ${s.reading_list.join(', ')}`);
    if (asArray(s.core_spine).length) L.push(`- Core spine: ${s.core_spine.join(', ')}`);
    if (asArray(s.toggleable).length) L.push(`- Toggleable: ${s.toggleable.join(', ')}`);
    if (s.rationale) L.push(`- Cost/benefit moment: ${s.rationale}`);
    L.push('');
  });
  L.push('---');
  L.push('');

  // Per-article prediction test
  L.push('# 5. Per-article prediction-test outcomes (P14)');
  L.push('');
  L.push('Graph was empty, so every concept is a **gap (add)**; no non-confirmations and no mis-structures are possible.');
  L.push('');
  for (const p of perPaper) {
    const gaps = asArray(p.prediction_test && p.prediction_test.gaps);
    L.push(`- **${p.paper_id}** — conduct phase(s): ${asArray(p.conduct_phases).join(', ') || '(unspecified)'}. Gaps: ${gaps.join('; ') || '(none reported)'}`);
  }
  L.push('');
  // Recurrences
  const recs = asArray(integration.recurrences).filter((r) => (r.count || 0) >= 2);
  if (recs.length) {
    L.push('**First confirmations (P13, in-batch recurrence — the corpus’s first votes):**');
    for (const r of recs) {
      L.push(`- ${r.name} — ${r.count} papers (${asArray(r.papers).join(', ')})`);
    }
    L.push('');
  }
  L.push('---');
  L.push('');

  // Counts
  L.push('# 6. Counts');
  L.push('');
  const d = dist.domain;
  L.push(`**Concepts by domain (${d.value + d.action + d.tool + d.question} total):** Values ${d.value} · Actions ${d.action} · Tools ${d.tool} · Questions ${d.question}`);
  L.push('');
  L.push('**Phase-mapped concepts (questions excepted):**');
  for (const ph of PHASES) L.push(`- ${ph}: ${dist.phase[ph]}`);
  L.push(`- (questions, not phase-mapped: ${dist.questionsUnphased})`);
  L.push('');
  L.push(`**Other artifacts:** ${tunnels.length} tunnels · ${sits.length} situations · ${perPaper.reduce((n, p) => n + asArray(p.links).length, 0)} link proposals.`);
  L.push('');
  const cCount = concepts.filter((c) => c.confidence === 'C').length;
  const sCount = concepts.length - cCount;
  L.push(`**Confidence split:** confirmed-in-batch (C): ${cCount} · single-grounded (S): ${sCount}.`);
  L.push('');
  L.push('**END OF PROPOSALS — no dev-graph writes performed; review gate is next (chaos.md §8 step 7).**');
  L.push('');

  fs.writeFileSync(PROPOSALS_MD, L.join('\n'), 'utf8');
}

// ----------------------------------------------------------------------------
// Run summary
// ----------------------------------------------------------------------------

function printSummary(integration, dist) {
  const d = dist.domain;
  console.log('\n================ RUN SUMMARY ================');
  console.log(`model ${MODEL}  effort ${EFFORT}  rubric v${rubricVersion()}`);
  console.log(`\nConcepts by domain: value ${d.value}, action ${d.action}, tool ${d.tool}, question ${d.question}  (total ${d.value + d.action + d.tool + d.question})`);
  console.log('\nLifecycle phase distribution (questions excepted):');
  for (const ph of PHASES) console.log(`  ${ph.padEnd(34)} ${dist.phase[ph]}`);
  console.log(`  ${'(questions, not phase-mapped)'.padEnd(34)} ${dist.questionsUnphased}`);
  const recs = asArray(integration.recurrences).filter((r) => (r.count || 0) >= 2);
  console.log(`\nRecurrences (>= 2 papers): ${recs.length}`);
  for (const r of recs) console.log(`  ${r.name} — ${r.count} (${asArray(r.papers).join(', ')})`);
  console.log(`\nTunnels: ${asArray(integration.tunnels).length}   Situations: ${asArray(integration.situations).length}`);
  console.log('\nAPI usage this run:');
  console.log(`  API calls made:               ${apiCallCount}`);
  console.log(`  input tokens (uncached):      ${usageTotals.input_tokens}`);
  console.log(`  cache write tokens:           ${usageTotals.cache_creation_input_tokens}`);
  console.log(`  cache read tokens:            ${usageTotals.cache_read_input_tokens}`);
  console.log(`  output tokens:                ${usageTotals.output_tokens}`);
  console.log('\nWrote chaos/proposals.md and chaos/proposals.json');
  console.log('=============================================\n');
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('Chaos reason — move-step read of sourced papers through chaos.md.');
  console.log(`max=${MAX_PAPERS}${FIELD_FILTER ? `  field=${FIELD_FILTER}` : ''}  model=${MODEL}  effort=${EFFORT}\n`);

  const rubric = loadRubric();
  const { text: graphStateText } = loadGraphState();
  const selected = selectPapers();
  if (!selected.length) {
    console.error('No papers selected. Check chaos/papers/ and any --field filter.');
    process.exit(1);
  }
  console.log(`Selected ${selected.length} paper(s):`);

  // Phase a: per-paper.
  const systemText = perPaperSystem(rubric, graphStateText);
  const perPaper = await runPerPaper(selected, systemText);
  if (!perPaper.length) {
    console.error('No per-paper candidates produced. Aborting before integration.');
    process.exit(1);
  }

  // Phase b: integration.
  console.log('\nIntegration pass:');
  const integration = await runIntegration(perPaper, rubric);

  // Rebuild full concept objects locally from the compact merge decisions + caches.
  integration.concepts = reconstructConcepts(integration, perPaper);

  // Emit.
  const dist = computeDistributions(integration);
  writeJson(integration, perPaper, selected, dist);
  writeMarkdown(integration, perPaper, selected, dist);
  printSummary(integration, dist);
}

// Best-effort: close global fetch (undici) keep-alive sockets so the event loop
// drains and Node exits on its own. This lets us avoid calling process.exit() while
// sockets are still mid-close — that race trips a harmless libuv assertion on
// Windows at shutdown. Setting process.exitCode instead of process.exit() means the
// process ends cleanly once the loop is empty.
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
      console.error('\nreason.js failed:', err.message);
      await closeHttp();
      process.exitCode = 1;
    });
}

// Exported for offline testing of the emit pipeline (no API key required).
module.exports = {
  extractJson,
  fnv1a,
  pathLabel,
  rubricHash,
  cachePathFor,
  computeDistributions,
  writeJson,
  writeMarkdown,
  selectPapers,
  compactCandidates,
  reconstructConcepts,
  runIntegration,
  __setCallModelForTest,
  PHASES,
  ATTRIBUTES,
};
