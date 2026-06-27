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
 * Single attribute domain (v0.12): every concept is a researcher VALUE (disposition).
 * Two stages:
 *   a. Per-paper pass  — one model call per paper. System prompt = chaos.md +
 *      the current graph state (the snapshot). Input = the paper (full text if
 *      present, else abstract). The model reads the paper for the dispositions its
 *      conduct and stance reveal (P10: stance/metadiscourse as the primary instrument)
 *      and returns STRICT JSON: candidate value dispositions, links, value↔value
 *      associative tunnels, and the per-article prediction test. Each paper's JSON is
 *      cached to chaos/reason_cache/<id>.json and SKIPPED on re-run (resumable, cost-saving).
 *   b. Integration pass — one model call over the ACCUMULATED candidates
 *      (compact: names/paths/groundings, not the full texts). Merges near-duplicate
 *      dispositions and tallies recurrence (P13), assigns edge character (P15),
 *      finalizes co-grounded value↔value associative tunnels (P8/P15), phi-ranks the
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
// Shared P16 precision math — one source of truth (also used by apply.js for the
// authoritative accumulated recompute). reason.js uses it for the per-run estimate.
const { TARGETED_WEIGHT, precisionFromEvidence } = require('./precision');

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
// Immutable pre-review baseline (an exact copy of proposals.json as reasoned, before
// any human review). chaos/record-run.js diffs the final proposals.json against this
// to derive episodic outcomes (accept / reject / modify).
const PROPOSALS_REASONED_JSON = path.join(CHAOS_DIR, 'proposals.reasoned.json');

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';
const MODEL = argValue('--model') || 'claude-opus-4-8';
const EFFORT = argValue('--effort') || 'high'; // low | medium | high | xhigh | max
const MAX_PAPERS = parseInt(argValue('--max') || '8', 10);
const FIELD_FILTER = argValue('--field') || null;

// Bumped whenever the prompt TEMPLATES below change in a way that should invalidate
// cached per-paper / integration results. It is folded into the cache key alongside
// rubricHash() and the graph-state hash, so a prompt change (like the graph-reconcile
// rework) auto-invalidates stale pre-change cache entries instead of silently reusing
// them. The graph-state text is ALSO hashed into the key (see main()), so a run against
// a grown graph re-reasons even at the same prompt version.
const PROMPT_VERSION = 'p3-value-only';

// Upper bound on inventory lines shown to the model (graph growth guard). Roots are
// always included; nested concepts fill the remainder shallow-first; the rest is noted
// as truncated rather than silently dropped.
const MAX_INVENTORY_LINES = 250;

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

// Single attribute domain (v0.12): every concept Chaos graphs is a researcher value
// (disposition). The action/tool/question domains and the lifecycle/phase map are retired.
const ATTRIBUTES = ['value'];

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

// Build the per-edge concept inventory from the snapshot. Each EDGE is one entry (a
// concept's contextual placement — the same concept under two parents is two entries,
// per the path-dependent-identity model, P15/P17), so the model can reconcile against
// the exact placements that already exist. Note: the snapshot carries no predictions /
// recurrence, so entries are attribute · name · path only and are prioritized by DEPTH
// (roots + shallow first), not by recurrence; if the snapshot ever carries the ledger,
// the selection can prefer low-recurrence / shaky nodes instead.
function buildInventory(snap) {
  const nameById = new Map(asArray(snap.concepts).map((c) => [c.id, c.name]));
  const eba = snap.edges_by_attribute || {};
  const entries = [];
  for (const attr of Object.keys(eba)) {
    for (const e of asArray(eba[attr])) {
      if (e.is_hidden) continue;
      entries.push({
        attribute: attr,
        name: nameById.get(e.child_id) || `#${e.child_id}`,
        pathNames: asArray(e.graph_path).map((id) => nameById.get(id) || `#${id}`),
        isRoot: e.parent_id == null,
        depth: asArray(e.graph_path).length,
      });
    }
  }
  return entries;
}

// Select a bounded slice: ALL roots always (most structurally load-bearing), then
// nested concepts shallow-first up to the cap. Returns { chosen, truncated }.
function selectInventory(entries) {
  const roots = entries.filter((e) => e.isRoot);
  const nested = entries
    .filter((e) => !e.isRoot)
    .sort((a, b) => a.depth - b.depth || a.attribute.localeCompare(b.attribute) || a.name.localeCompare(b.name));
  if (roots.length >= MAX_INVENTORY_LINES) {
    return { chosen: roots, truncated: nested.length };
  }
  const room = MAX_INVENTORY_LINES - roots.length;
  return { chosen: roots.concat(nested.slice(0, room)), truncated: Math.max(0, nested.length - room) };
}

// Render the selected inventory, roots first. Single domain (value) post-v0.12, so no
// per-attribute grouping — just a flat, root-first list of existing value dispositions.
function renderInventory(chosen) {
  const list = chosen.slice().sort(
    (a, b) => (b.isRoot ? 1 : 0) - (a.isRoot ? 1 : 0) || a.depth - b.depth || a.name.localeCompare(b.name)
  );
  return list.map((e) => {
    const where = e.isRoot ? '(root)' : `under: ${e.pathNames.join(' › ')}`;
    return `  · ${e.name}  ${where}`;
  });
}

// Compact, human-readable view of the current dev-graph state, derived from the
// snapshot. Deliberately omits the snapshot meta block (connection details) so
// nothing graph-internal leaks into the prompt or the cached outputs. Now includes the
// actual concept INVENTORY (names + paths), not just counts, so the model reconciles
// against what exists instead of re-bootstrapping.
function loadGraphState() {
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, 'utf8'));
  const c = snap.counts || {};
  // Derive the displayed domain list from the same ATTRIBUTES constant that governs
  // emission (value-only, v0.12) — NOT from snap.attributes, which mirrors every row
  // still seeded in the DB (action/tool/question included) and would otherwise feed the
  // model a four-domain line that contradicts the rest of this value-only prompt.
  const attrs = ATTRIBUTES.join(', ');
  const lines = [
    'CURRENT GRAPH STATE (the dev snapshot you are reasoning against):',
    `  attributes: ${attrs || '(none)'}`,
    `  concepts: ${c.concepts ?? 0}`,
    `  edges: ${c.edges ?? 0}`,
    `  concept_links: ${c.concept_links ?? 0}`,
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
    return { text: lines.join('\n'), isEmpty };
  }

  const { chosen, truncated } = selectInventory(buildInventory(snap));
  lines.push('');
  lines.push(
    'EXISTING CONCEPTS — reconcile against these (do NOT re-bootstrap). Each line is one ' +
      'existing contextual placement: `· name  (root)` or `· name  under: <ancestor path>`.'
  );
  lines.push(...renderInventory(chosen));
  if (truncated > 0) {
    lines.push(`  … (${truncated} more nested concept(s) not shown — cap ${MAX_INVENTORY_LINES})`);
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

function perPaperSystem(rubric, graphStateText, isEmpty) {
  return [
    'You are Chaos, a tool that proposes contributions to Orca’s concept graph.',
    'Your governing brain — the principles, the run procedure, and the formats — is the',
    'rubric below (chaos.md). Obey it exactly. Do not invent rules it does not state.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    graphStateText,
    '',
    'YOUR TASK THIS CALL: read ONE article (provided in the user turn) for the researcher',
    'VALUES — the dispositions — its conduct and stance reveal (P10). The graph has a single',
    'attribute domain: value = a disposition (who the researcher IS). Do NOT graph what the',
    'researcher does/uses/asks — actions, tools, and questions are retired (P2, v0.12).',
    'Read for disposition via:',
    '  - the STANCE / METADISCOURSE profile as the PRIMARY instrument (P10): hedges, boosters,',
    '    attitude markers, self-mention — how the researcher positions themself toward the claim;',
    '  - corroborated by the CONDUCT itself: what they tested, disclosed, or refused to overclaim.',
    'Honor P2 (a disposition is who the researcher is, NEVER the behavior/method that enacts it —',
    'do not name an action as a value), P3 (subtextual, not the article’s vocabulary), P9',
    '(self-anchored: a short noun/gerund phrase naming the disposition, NEVER a proposition).',
    'Apply the P5 hypothetical-researcher test and the P8 co-grounding check. Be conservative',
    'with the concept budget.',
    '',
    'RECONCILE AGAINST THE EXISTING GRAPH (operationalizes P1/P6/P13/P17 — the graph above is',
    'what already exists; do NOT reason as if it were empty):',
    '  - EXACT re-instantiation → CONFIRM. If a disposition you extract is the SAME as one',
    '    already in the graph (same disposition in the same context), re-emit it at the SAME',
    '    name + parent_path as the existing entry, with this paper as grounding. This is a',
    '    confirmation (it lets recurrence accrue across runs). Do NOT mint a near-variant name',
    '    for a disposition that already exists.',
    '  - RELATED-BUT-DISTINCT variant → NEST, do not collapse. Keep it distinct from the',
    '    existing disposition (anti-essentialism, P17 — never merge two genuinely different',
    '    contextual concepts into one), and do NOT add it as a new top-level root. Place it',
    '    under the most appropriate EXISTING parent, or, if several new siblings belong',
    '    together, propose a new INTERMEDIATE root to cluster them (integrate by connection,',
    '    not by collapse).',
    '  - GENUINELY NEW region → a new root, ONLY when no existing parent fits.',
    isEmpty
      ? 'The graph is empty this run, so prediction_test.non_confirmations and .mis_structures are []'
        + ' (nothing exists yet to disconfirm or mis-structure).'
      : 'Because the graph is NON-EMPTY, actively TEST it: populate prediction_test.non_confirmations'
        + ' with existing dispositions/predictions listed above that THIS paper fails to confirm, and'
        + ' .mis_structures with existing placements this paper suggests are wrong (P6). They are not'
        + ' automatically empty — only an empty graph yields empty lists.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no markdown fences, no',
    'commentary. A single JSON object with exactly these keys:',
    '{',
    '  "paper_id": string,',
    '  "fields": string[],',
    '  "concepts": [   // each is a researcher VALUE (disposition); attribute is always "value"',
    '    {',
    '      "attribute": "value",            // the only domain (v0.12)',
    '      "name": string,                 // short, self-anchored disposition; never a proposition',
    '      "parent_path": string[],        // ancestor disposition names, [] for a root',
    '      "edge_character": {             // P15 — how this child relates to its parent (omit/null for a root)',
    '        "kind": "analytic" | "associative",        // analytic = decomposition; associative = a leap',
    '        "association": "similarity" | "thematic" | "analogy" | "metaphor" | "affective" | null,  // only when associative',
    '        "remoteness": "near" | "remote" | null      // only when associative; prize remote (P15)',
    '      },',
    '      "prediction": string,           // what research should keep instantiating',
    '      "grounding": "single" | "multi",// your read of whether THIS paper alone grounds it',
    '      "rationale": string             // general->specific, subtextual, self-anchored',
    '    }',
    '  ],',
    '  "links": [',
    '    { "attribute": "value", "concept_name": string, "parent_path": string[],',
    '      "url": string, "claim": string }   // claim = how the conduct EXEMPLIFIES the disposition (P5)',
    '  ],',
    '  "tunnels": [   // value↔value ASSOCIATIVE links between dispositions (P8/P15)',
    '    { "from": { "attribute": "value", "name": string },',
    '      "to":   { "attribute": "value", "name": string },',
    '      "relation": "similarity" | "thematic" | "analogy" | "metaphor" | "affective",  // the association KIND (P15), not cost/benefit',
    '      "cogrounding_url": string }    // the paper URL when one doc grounds BOTH ends (P8), else ""',
    '  ],',
    '  "prediction_test": {',
    '    "gaps": string[],              // disposition names the article instantiates that the graph cannot hold',
    '    "non_confirmations": string[], // existing predictions this paper fails to confirm ([] only if the graph is empty)',
    '    "mis_structures": string[]     // existing placements this paper suggests are wrong, P6 ([] only if the graph is empty)',
    '  }',
    '}',
    'Return only the JSON object.',
  ].join('\n');
}

function integrationSystem(rubric, graphStateText) {
  return [
    'You are Chaos. Your governing brain is the rubric below (chaos.md). Obey it exactly.',
    '',
    '================ BEGIN chaos.md ================',
    rubric,
    '================ END chaos.md ================',
    '',
    graphStateText,
    '',
    'YOUR TASK THIS CALL: the INTEGRATION pass (chaos.md §5 steps 4–8) over the accumulated',
    'per-paper VALUE (disposition) candidates (provided in the user turn). The graph has a',
    'single attribute domain: value. Do all of:',
    '  - RECONCILE AGAINST THE EXISTING GRAPH FIRST (P1/P6/P13/P17): for each merged',
    '    disposition, decide whether it is the SAME as one already in CURRENT GRAPH STATE',
    '    (re-emit at the existing name + parent_path — a cross-run confirmation),',
    '    a RELATED-BUT-DISTINCT variant (keep it distinct — never collapse into the existing',
    '    one, P17 — and place it under an existing parent or a NEW intermediate root rather',
    '    than as a flat new root), or GENUINELY NEW (a new root only if no existing parent',
    '    fits). Prefer nesting/clustering over minting top-level roots.',
    '  - Merge near-duplicate dispositions across papers (the same underlying disposition,',
    '    even if worded differently) — but only merge WITHIN this batch; do not merge a new',
    '    disposition INTO an existing graph concept (confirm it instead, per the reconcile step).',
    '  - Assign each child’s EDGE CHARACTER to its parent (P15): analytic (decomposition) or',
    '    associative (a leap); for associative, name the association kind (similarity, thematic,',
    '    analogy, metaphor, affective) and its remoteness (prize remote, cross-region).',
    '  - Tally RECURRENCE (P13): how many DISTINCT papers independently exemplify each',
    '    merged disposition. recurrence >= 2 => confidence "C" (confirmed in-batch);',
    '    recurrence == 1 => confidence "S" (single-grounded, speculative).',
    '  - Finalize CO-GROUNDED value↔value ASSOCIATIVE tunnels (P8/P15): each links two',
    '    dispositions; its relation is the association KIND (similarity | thematic | analogy |',
    '    metaphor | affective), NOT a cost/benefit relation; keep the co-grounding doc URL.',
    '  - PHI-RANK (P12): order the dispositions most-integrative-and-differentiated first',
    '    (bridge previously-separate regions while staying specific); add a short "phi" note.',
    '',
    'OUTPUT CONTRACT: return STRICT JSON ONLY — no prose, no fences. Keep it COMPACT:',
    'return your MERGE DECISIONS, not a restatement of every input field. Do NOT echo',
    'each disposition’s prediction or rationale — those are reconstructed locally from the',
    'per-paper cache via "source_refs". One object with keys:',
    '{',
    '  "concepts": [   // one entry per MERGED disposition (deduplicated across papers)',
    '    { "attribute": "value", "name": string, "parent_path": string[],',
    '      "edge_character": {            // P15; omit/null for a root',
    '        "kind": "analytic" | "associative",',
    '        "association": "similarity" | "thematic" | "analogy" | "metaphor" | "affective" | null,',
    '        "remoteness": "near" | "remote" | null',
    '      },',
    '      "recurrence": number, "confidence": "C" | "S", "phi": string,',
    '      "source_refs": [ { "paper_id": string, "name": string } ]  // the per-paper dispositions you merged into this one',
    '    }',
    '  ],',
    '  "tunnels": [   // value↔value associative links',
    '    { "from": { "attribute": "value", "name": string },',
    '      "to":   { "attribute": "value", "name": string },',
    '      "relation": "similarity" | "thematic" | "analogy" | "metaphor" | "affective",',
    '      "cogrounding_url": string, "confidence": "C" | "S" }',
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

// stateHash salts the cache key with PROMPT_VERSION + the graph-state text, so a prompt
// template change OR a changed existing-graph inventory invalidates stale per-paper /
// integration cache entries (the prompt now embeds the inventory, so a result reasoned
// against a different graph must not be reused). Combined with rubricHash() in the key.
function cachePathFor(id, stateHash) {
  return path.join(CACHE_DIR, `${id}-r${rubricHash()}-s${stateHash}.json`);
}

async function runPerPaper(selected, systemText, stateHash) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const results = [];
  for (const entry of selected) {
    const cp = cachePathFor(entry.id, stateHash);
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
    concepts: asArray(p.concepts).map((c) => ({
      attribute: c.attribute,
      name: c.name,
      parent_path: asArray(c.parent_path),
      edge_character: c.edge_character ?? null,
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

function integrationCachePath(compact, stateHash) {
  const h = fnv1a(JSON.stringify(compact) + `|${MODEL}|${EFFORT}|r${rubricHash()}|s${stateHash}`);
  return path.join(CACHE_DIR, `integration-${h}.json`);
}

async function runIntegration(perPaper, rubric, graphStateText, stateHash) {
  const compact = compactCandidates(perPaper);
  const cp = integrationCachePath(compact, stateHash);
  if (fs.existsSync(cp)) {
    console.log(`  [cache] integration  (${path.basename(cp)})`);
    try {
      return JSON.parse(fs.readFileSync(cp, 'utf8'));
    } catch {
      // re-run on corrupt cache
    }
  }
  console.log('  [integrate] merging dispositions, tallying recurrence, finalizing tunnels…');
  const system = integrationSystem(rubric, graphStateText);
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
      prediction: c.prediction || (src && src.prediction) || '',
      recurrence: c.recurrence != null ? c.recurrence : groundingPapers.length,
      grounding_papers: groundingPapers,
      confidence: c.confidence || (groundingPapers.length >= 2 ? 'C' : 'S'),
      phi: c.phi || '',
      // Forward-compatible pass-through of the v0.8 reasoning fields (analytic/
      // associative edge_character, P15 multi-parent placements, P6/P7 restructure
      // mentions). The current reasoning contract does not emit these, so they are
      // absent today and these spreads are no-ops; when a later reasoning phase
      // emits them they flow through to proposals.json (and apply.js) unchanged.
      ...(c.edge_character != null ? { edge_character: c.edge_character } : {}),
      ...(asArray(c.parent_paths).length ? { parent_paths: c.parent_paths.map(asArray) } : {}),
      ...(asArray(c.restructure_mentions).length ? { restructure_mentions: c.restructure_mentions } : {}),
    };
  });
}

// ============================================================================
// Stage-5 feedback fixes: merge-rewrite of references, explicit ancestors, and
// openalex-id normalization of all paper references. These run in main() AFTER
// reconstructConcepts and rewrite links/tunnels so they follow their
// (possibly renamed) canonical concepts.
// ============================================================================

function normalizeUrl(u) {
  if (!u) return null;
  try {
    return String(u).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '') || null;
  } catch {
    return null;
  }
}
function workIdOf(s) {
  const m = String(s || '').match(/W\d+/);
  return m ? m[0] : null;
}

// Normalized key for a parent path (root-to-parent concept names). Identity in
// Orca is path-dependent (P1): the same name under different parents is a distinct
// CONTEXTUAL entity (multi-parent placement, P15). The merge resolver therefore
// keys on path, not just (attribute, name), so it never silently collapses two
// legitimately-distinct same-name placements into one.
function normPathKey(pp) {
  return asArray(pp).map(normName).join(' > ');
}

// Build a resolver from the RAW integration concepts (which carry source_refs):
// (attribute, [paper_id], [parent_path], any per-paper name the concept was merged
// from) → the canonical merged concept {attribute, name, parent_path}.
//
// Lookups go most-specific → least-specific: (paper+path) → (paper) → (path) →
// (name only). A bucket that holds two DISTINCT canonical concepts (differing by
// path) is marked AMBIGUOUS; a lookup that lands on an ambiguous bucket WITHOUT a
// disambiguating path returns null (do not rewrite) rather than guess — this is the
// "must NOT collapse multi-parent instances" guarantee. With single-parent data
// every bucket has exactly one canonical, so behavior is unchanged.
function buildAliasResolver(rawConcepts) {
  const AMBIGUOUS = Symbol('ambiguous');
  const byPaperPath = new Map(); // attr|paperId|pathKey|name -> canon
  const byPaper = new Map();     // attr|paperId|name        -> canon | AMBIGUOUS
  const byPath = new Map();      // attr|pathKey|name         -> canon | AMBIGUOUS
  const byName = new Map();      // attr|name                 -> canon | AMBIGUOUS

  // Register, marking a bucket AMBIGUOUS if a second, path-distinct canonical lands in it.
  const put = (map, k, canon) => {
    const prev = map.get(k);
    if (prev === undefined) map.set(k, canon);
    else if (prev !== AMBIGUOUS && prev !== canon &&
             normPathKey(prev.parent_path) !== normPathKey(canon.parent_path)) {
      map.set(k, AMBIGUOUS);
    }
  };

  for (const c of asArray(rawConcepts)) {
    const canon = { attribute: c.attribute, name: c.name, parent_path: asArray(c.parent_path) };
    const pk = normPathKey(canon.parent_path);
    put(byPath, `${c.attribute}|${pk}|${normName(c.name)}`, canon);
    put(byName, `${c.attribute}|${normName(c.name)}`, canon);
    for (const r of asArray(c.source_refs)) {
      // source_refs carry {paper_id, name}; if a per-paper ref also carries a path,
      // key on it, else inherit the canonical's path.
      const rpk = r.parent_path != null ? normPathKey(r.parent_path) : pk;
      byPaperPath.set(`${c.attribute}|${r.paper_id}|${rpk}|${normName(r.name)}`, canon);
      put(byPaper, `${c.attribute}|${r.paper_id}|${normName(r.name)}`, canon);
    }
  }

  const hit = (map, k) => {
    const v = map.get(k);
    return v && v !== AMBIGUOUS ? v : null;
  };

  return function resolve(attribute, paperId, name, parentPath) {
    const nm = normName(name);
    const pk = parentPath != null ? normPathKey(parentPath) : null;
    if (paperId != null && pk != null) {
      const h = byPaperPath.get(`${attribute}|${paperId}|${pk}|${nm}`);
      if (h) return h;
    }
    if (paperId != null) {
      const h = hit(byPaper, `${attribute}|${paperId}|${nm}`);
      if (h) return h;
    }
    if (pk != null) {
      const h = hit(byPath, `${attribute}|${pk}|${nm}`);
      if (h) return h;
    }
    return hit(byName, `${attribute}|${nm}`); // null if ambiguous or absent
  };
}

// 1b: ensure every concept named in a parent_path is itself a concept proposal,
// so apply.js never silently auto-creates an unreported root. Mutates integration.
function addAncestorConcepts(integration) {
  const concepts = asArray(integration.concepts);
  const have = new Set(concepts.map((c) => `${c.attribute}|${normName(c.name)}`));
  const added = [];
  for (const c of concepts) {
    const pp = asArray(c.parent_path);
    for (let i = 0; i < pp.length; i++) {
      const key = `${c.attribute}|${normName(pp[i])}`;
      if (have.has(key)) continue;
      have.add(key);
      added.push({
        attribute: c.attribute,
        name: pp[i],
        parent_path: pp.slice(0, i),
        prediction: '',
        recurrence: 0,
        grounding_papers: [],
        confidence: 'S',
        phi: '',
        ancestor_of: c.name,
      });
    }
  }
  integration.concepts = concepts.concat(added);
  return added.length;
}

// 1a: rewrite per-paper links to the canonical merged concept (attribute, name,
// parent_path). Returns the flat finalLinks array used by the emitters.
function rewriteLinks(perPaper, resolve) {
  const out = [];
  for (const p of asArray(perPaper)) {
    for (const l of asArray(p.links)) {
      // Links carry their own parent_path — use it so a link to a multi-parent
      // name resolves to the right contextual concept, not an arbitrary one.
      const canon = resolve(l.attribute, p.paper_id, l.concept_name, l.parent_path);
      out.push({
        paper_id: p.paper_id,
        attribute: canon ? canon.attribute : l.attribute,
        concept_name: canon ? canon.name : l.concept_name,
        parent_path: canon ? canon.parent_path : asArray(l.parent_path),
        url: l.url,
        claim: l.claim,
      });
    }
  }
  return out;
}

// 1a (cont.): rewrite tunnel endpoints to canonical names. Mutates integration.
function rewriteTunnels(integration, resolve) {
  for (const t of asArray(integration.tunnels)) {
    for (const end of [t && t.from, t && t.to]) {
      if (!end) continue;
      const canon = resolve(end.attribute, null, end.name);
      if (canon) {
        end.attribute = canon.attribute;
        end.name = canon.name;
      }
    }
  }
}

// ============================================================================
// Integration/orchestration-ASSIGNABLE fields. These are COMPUTED at integration (from
// recurrence / graph structure) or KNOWN from the run/sampling plan — they are NOT
// reasoning-generated (edge character IS reasoned now, in the prompts above; precision,
// surprise level, and provenance are computed here). The exact policies below (precision
// curve, surprise heuristic, bootstrapping provenance) are deliberately simple and tunable.
// ============================================================================

// P16 precision: monotonic in recurrence, low for a one-off, 0 for ungrounded.
// Kept as the no-discipline-data fallback for precisionFor() and for tests.
function precisionFromRecurrence(rec) {
  const r = Number(rec) || 0;
  if (r <= 0) return 0;
  return Math.round((r / (r + 1)) * 100) / 100; // 1→0.5, 2→0.67, 3→0.75, …
}

// --- precision_weighting knob (PROVISIONAL — to be calibrated; see chaos.md P16) ---
// A node's standing confidence grows with how much INDEPENDENT, DISCIPLINARILY-DIVERSE
// evidence grounds it:
//   weightedEvidence = Σ over grounding papers of a per-confirmation weight, where an
//     INDEPENDENT (or unknown-provenance) confirmation counts 1.0 and a TARGETED one
//     counts TARGETED_WEIGHT (< 1 — a sample aimed at the node is weaker evidence of
//     its generality than one that hit it unprompted, P16). Bootstrapping runs have no
//     sampling plan, so every confirmation is treated as independent (weight 1.0).
//   diversityMult = 1 + DIVERSITY_BONUS·(distinctDisciplines − 1) — cross-field
//     corroboration is rewarded; single-field grounding gets ×1.
//   precision = 1 − 1/(1 + weightedEvidence·diversityMult), rounded to 2 dp; 0 if ungrounded.
// The constants and the final curve live in chaos/precision.js (shared with apply.js);
// this function only assembles THIS RUN's evidence (weighted papers + disciplines) and
// hands it to precisionFromEvidence. apply.js assembles the ACCUMULATED evidence and
// calls the same curve, so its value is authoritative and overwrites this estimate.

// fieldsByPaper: Map<workId, string[] disciplines>. concept.grounding_papers are
// openalex ids. targetedSet (optional): Set<workId> of papers that TARGETED this node
// (none in a bootstrapping run). Falls back to recurrence-only if no discipline data.
function precisionFor(concept, fieldsByPaper, targetedSet) {
  const papers = asArray(concept.grounding_papers);
  const rec = papers.length || Number(concept.recurrence) || 0;
  if (rec <= 0) return 0;
  if (!fieldsByPaper || fieldsByPaper.size === 0) return precisionFromRecurrence(rec);

  let weighted = 0;
  const disciplines = new Set();
  for (const pid of papers) {
    const w = workIdOf(pid) || pid;
    weighted += targetedSet && targetedSet.has(w) ? TARGETED_WEIGHT : 1.0;
    for (const f of asArray(fieldsByPaper.get(w))) disciplines.add(f);
  }
  // Concepts can carry recurrence without an enumerated grounding-paper list; fall back
  // to recurrence as the confirmation count so precision never under-reports.
  if (weighted === 0) weighted = rec;
  return precisionFromEvidence(weighted, disciplines.size);
}

// P1/P6 surprise: 'parent_unabsorbed' when a concept had to be hung under an
// ancestor that isn't itself independently grounded (the structure was invented
// just to place it — the parent could not "absorb" it); otherwise 'local'. Roots
// (empty parent_path) are 'local'.
function surpriseLevelOfConcept(c, recByKey) {
  const pp = asArray(c.parent_path);
  if (!pp.length) return 'local';
  const parent = pp[pp.length - 1];
  const parentRec = recByKey.get(`${c.attribute}|${normName(parent)}`) || 0;
  return parentRec > 0 ? 'local' : 'parent_unabsorbed';
}

// Bootstrapping seed runs source papers INDEPENDENTLY (not sampled to confirm a
// standing prediction), so confirmations are 'independent' and not 'severe', and
// gaps on an empty graph are 'local'. A later active-sampling (P14) run derives
// these from its sampling plan instead. Single source of truth for the defaults.
function runOutcomeDefaults() {
  return { provenance: 'independent', severe: false, surprise_level: 'local' };
}

// Mutates integration: annotate concepts (precision, surprise_level, provenance,
// severe). Idempotent — only fills fields left unset, so a future reasoning phase that
// emits any of these wins.
function assignIntegrationFields(integration, fieldsByPaper) {
  const concepts = asArray(integration.concepts);
  // Confirmation-event defaults live on the CONCEPT object because apply.js reads
  // c.provenance / c.severe off each concept (not off prediction_test). Without this,
  // every chaos_prediction_events.provenance was null. No sampling plan in this phase →
  // confirmations are 'independent' and not 'severe' (targeted sampling is future work).
  const { provenance: defProvenance, severe: defSevere } = runOutcomeDefaults();
  const recByKey = new Map();
  for (const c of concepts) recByKey.set(`${c.attribute}|${normName(c.name)}`, Number(c.recurrence) || 0);
  for (const c of concepts) {
    // No sampling plan in bootstrapping → no targeted confirmations (targetedSet omitted).
    if (c.precision == null) c.precision = precisionFor(c, fieldsByPaper);
    if (c.surprise_level == null) c.surprise_level = surpriseLevelOfConcept(c, recByKey);
    if (c.provenance == null) c.provenance = defProvenance; // 'independent'
    if (c.severe == null) c.severe = defSevere;             // false
  }
}

// Orchestrates the Stage-5 fixes + v0.9/v0.10 field assignment in dependency
// order. resolve is built from RAW integration concepts (before reconstruction
// strips source_refs). Returns finalLinks.
function finalizeProposals(integration, perPaper, selected) {
  const resolve = buildAliasResolver(integration.concepts); // raw concepts carry source_refs
  integration.concepts = reconstructConcepts(integration, perPaper);
  addAncestorConcepts(integration);
  rewriteTunnels(integration, resolve);
  // discipline tags per grounding paper, for the precision diversity multiplier.
  const fieldsByPaper = new Map(
    asArray(selected).map((s) => [workIdOf(s.id) || s.id, asArray(s.fields)])
  );
  assignIntegrationFields(integration, fieldsByPaper); // v0.9/v0.10 computed/known fields
  return rewriteLinks(perPaper, resolve);
}

function computeDistributions(integration) {
  const concepts = asArray(integration.concepts);
  // Single domain (value) post-v0.12: the only distribution is the total disposition count.
  return { total: concepts.length };
}

function writeJson(integration, perPaper, selected, dist, finalLinks) {
  const out = {
    generated_by: 'chaos/reason.js',
    model: MODEL,
    effort: EFFORT,
    rubric_version: rubricVersion(),
    graph_state: 'empty (bootstrapping seed)',
    papers: selected.map((s) => ({ id: s.id, title: s.title, fields: s.fields, full_text: s.full_text })),
    concept_count: dist.total,
    concepts: asArray(integration.concepts),
    tunnels: asArray(integration.tunnels),
    recurrences: asArray(integration.recurrences),
    per_article_prediction_test: perPaper.map((p) => ({
      paper_id: p.paper_id,
      gaps: asArray(p.prediction_test && p.prediction_test.gaps),
      non_confirmations: asArray(p.prediction_test && p.prediction_test.non_confirmations),
      mis_structures: asArray(p.prediction_test && p.prediction_test.mis_structures),
      // v0.9/v0.10 outcome annotations, KNOWN from the (bootstrapping) sampling
      // plan rather than reasoned: provenance/severe on confirmations, surprise on
      // outcomes. See runOutcomeDefaults().
      ...runOutcomeDefaults(),
    })),
    links: asArray(finalLinks),
    // Forward-compatible pass-through: a top-level restructure_mentions array if a
    // later reasoning phase emits one (absent today → omitted).
    ...(asArray(integration.restructure_mentions).length
      ? { restructure_mentions: integration.restructure_mentions }
      : {}),
  };
  fs.writeFileSync(PROPOSALS_JSON, JSON.stringify(out, null, 2), 'utf8');
  // Also write the immutable baseline. `out` is the full integration result for the
  // run, so this reflects the complete reasoned set regardless of per-paper cache
  // reuse. record-run.js compares the (human-edited) proposals.json against this.
  fs.writeFileSync(PROPOSALS_REASONED_JSON, JSON.stringify(out, null, 2), 'utf8');
}

function rubricVersion() {
  try {
    const m = fs.readFileSync(RUBRIC_PATH, 'utf8').match(/^\*\*Version:\*\*\s*([0-9.]+)/m);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

function writeMarkdown(integration, perPaper, selected, dist, finalLinks) {
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
  L.push('Format (§8): parent path · new child (disposition) · edge character (P15) · prediction · recurrence/confidence. **C** = confirmed in-batch (recurs ≥ 2 papers); **S** = single-grounded.');
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
      const conf = c.confidence === 'C' ? 'C' : 'S';
      const rec = c.recurrence != null ? `recurrence ${c.recurrence}` : '';
      const papers = asArray(c.grounding_papers).join(', ');
      const ec = c.edge_character && c.edge_character.kind
        ? ` · edge: ${c.edge_character.kind}${c.edge_character.association ? `/${c.edge_character.association}` : ''}`
        : '';
      L.push(`**[${conf}] ${pathLabel(c.parent_path)} › ${c.name}** — ${rec}${ec}${papers ? ` · papers: ${papers}` : ''}`);
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
  L.push('Format (§10): target edge · URL · comment = the exemplification claim (P5). Grouped by paper. References rewritten to canonical merged concepts.');
  L.push('');
  const linksByPaper = new Map();
  for (const l of asArray(finalLinks)) {
    if (!linksByPaper.has(l.paper_id)) linksByPaper.set(l.paper_id, []);
    linksByPaper.get(l.paper_id).push(l);
  }
  for (const [pid, links] of linksByPaper) {
    L.push(`**${pid}**`);
    for (const l of links) {
      L.push(`- → ${l.attribute || ''} · ${pathLabel(l.parent_path)} › ${l.concept_name}: ${l.claim || ''}`);
    }
    L.push('');
  }
  L.push('---');
  L.push('');

  // Tunnels (value↔value associative)
  L.push('# 3. Tunnel proposals (value↔value associative)');
  L.push('');
  L.push('Format (§8): disposition ↔ disposition · association kind (similarity | thematic | analogy | metaphor | affective, P15) · co-grounding document (P8).');
  L.push('');
  const tunnels = asArray(integration.tunnels);
  if (!tunnels.length) L.push('_(none this run)_');
  tunnels.forEach((t, i) => {
    const from = t.from || {};
    const to = t.to || {};
    const cg = t.cogrounding_url ? `co-grounded: ${t.cogrounding_url}` : 'not co-grounded (speculative)';
    L.push(`**TUN-${i + 1} [${t.confidence === 'C' ? 'C' : 'S'}]** · "${from.name || ''}" ↔ "${to.name || ''}"`);
    L.push(`- association: ${t.relation || ''} · ${cg}`);
    L.push('');
  });
  L.push('---');
  L.push('');

  // Per-article prediction test
  L.push('# 4. Per-article prediction-test outcomes (P14)');
  L.push('');
  L.push('Each paper scored against what the graph predicted: gaps (add), non-confirmations (decay), mis-structures (restructure).');
  L.push('');
  for (const p of perPaper) {
    const gaps = asArray(p.prediction_test && p.prediction_test.gaps);
    L.push(`- **${p.paper_id}** — Gaps: ${gaps.join('; ') || '(none reported)'}`);
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
  L.push('# 5. Counts');
  L.push('');
  L.push(`**Value dispositions (total):** ${dist.total}`);
  L.push('');
  L.push(`**Other artifacts:** ${tunnels.length} tunnels · ${perPaper.reduce((n, p) => n + asArray(p.links).length, 0)} link proposals.`);
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
  console.log('\n================ RUN SUMMARY ================');
  console.log(`model ${MODEL}  effort ${EFFORT}  rubric v${rubricVersion()}`);
  console.log(`\nValue dispositions (total): ${dist.total}`);
  const recs = asArray(integration.recurrences).filter((r) => (r.count || 0) >= 2);
  console.log(`\nRecurrences (>= 2 papers): ${recs.length}`);
  for (const r of recs) console.log(`  ${r.name} — ${r.count} (${asArray(r.papers).join(', ')})`);
  console.log(`\nTunnels: ${asArray(integration.tunnels).length}`);
  console.log('\nAPI usage this run:');
  console.log(`  API calls made:               ${apiCallCount}`);
  console.log(`  input tokens (uncached):      ${usageTotals.input_tokens}`);
  console.log(`  cache write tokens:           ${usageTotals.cache_creation_input_tokens}`);
  console.log(`  cache read tokens:            ${usageTotals.cache_read_input_tokens}`);
  console.log(`  output tokens:                ${usageTotals.output_tokens}`);
  console.log('\nWrote chaos/proposals.md, chaos/proposals.json, and chaos/proposals.reasoned.json (baseline)');
  console.log('=============================================\n');
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  console.log('Chaos reason — move-step read of sourced papers through chaos.md.');
  console.log(`max=${MAX_PAPERS}${FIELD_FILTER ? `  field=${FIELD_FILTER}` : ''}  model=${MODEL}  effort=${EFFORT}\n`);

  const rubric = loadRubric();
  const { text: graphStateText, isEmpty } = loadGraphState();
  // Salts both cache layers: PROMPT_VERSION (prompt-template changes) + the graph-state
  // text (the inventory the prompt now embeds). A grown graph or a bumped prompt version
  // yields a new stateHash, so stale pre-change cache entries are never reused.
  const stateHash = fnv1a(`${PROMPT_VERSION}|${graphStateText}`);
  const selected = selectPapers();
  if (!selected.length) {
    console.error('No papers selected. Check chaos/papers/ and any --field filter.');
    process.exit(1);
  }
  console.log(`Selected ${selected.length} paper(s):`);

  // Phase a: per-paper.
  const systemText = perPaperSystem(rubric, graphStateText, isEmpty);
  const perPaper = await runPerPaper(selected, systemText, stateHash);
  if (!perPaper.length) {
    console.error('No per-paper candidates produced. Aborting before integration.');
    process.exit(1);
  }

  // Phase b: integration.
  console.log('\nIntegration pass:');
  const integration = await runIntegration(perPaper, rubric, graphStateText, stateHash);

  // Rebuild concepts locally + apply the Stage-5 fixes: merge-rewrite links/tunnels to
  // canonical names and emit ancestors explicitly. Returns the rewritten flat links array.
  const finalLinks = finalizeProposals(integration, perPaper, selected);

  // Emit.
  const dist = computeDistributions(integration);
  writeJson(integration, perPaper, selected, dist, finalLinks);
  writeMarkdown(integration, perPaper, selected, dist, finalLinks);
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
  // Stage-5 merge-rewrite / ancestor fixes (exported for tests):
  buildAliasResolver,
  addAncestorConcepts,
  rewriteLinks,
  rewriteTunnels,
  workIdOf,
  normalizeUrl,
  // v0.9/v0.10 integration-assignable field helpers (exported for tests):
  normPathKey,
  precisionFromRecurrence,
  precisionFor,
  surpriseLevelOfConcept,
  runOutcomeDefaults,
  assignIntegrationFields,
  finalizeProposals,
  // Graph-reconciliation surface (exported for tests / inspection):
  loadGraphState,
  buildInventory,
  selectInventory,
  perPaperSystem,
  integrationSystem,
  ATTRIBUTES,
};
