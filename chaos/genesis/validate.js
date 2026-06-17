#!/usr/bin/env node

/**
 * Chaos — genesis proposal validator.
 *
 * Reads chaos/genesis/proposal.json (the Categorizer's genesis output) and reports
 * whether it meets the STRUCTURAL targets in chaos.md §5–§7. It judges shape, not
 * content: it does not call the model, touch the DB, or change the proposal. It is a
 * review aid — run it, read it, decide.
 *
 * Checks (chaos.md references in parens):
 *   - depth distribution (§0/§1: must EXCEED two layers — the old flat-tree failure);
 *   - multi-parent coverage (§5.3 quota: most concepts-with-children should have ≥1
 *     child with an alternate parent) + the context-differentiation check (a
 *     multi-parented node must differentiate DIFFERENTLY under each parent, not share
 *     one child set — that is duplication, not integration);
 *   - frontier coverage (§5.5: every carve emits ≥1 frontier);
 *   - obviousness flags (§6/§7: any hook whose conduct is a bare virtue-word or too
 *     generic — "too obvious = non-generative");
 *   - skeleton-vs-hook counts (§7);
 *   - structural integrity (dangling parent references, duplicate names, cycles).
 *
 * Usage:
 *   node chaos/genesis/validate.js
 *   node chaos/genesis/validate.js --file=path/to/proposal.json
 *
 * Exit code is 0 always (this is a report, not a gate); the structural-targets
 * verdict at the end says PASS / CONCERN per target.
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_PROPOSAL = path.join(__dirname, 'proposal.json');

function argValue(flag) {
  const a = process.argv.find((x) => x.startsWith(flag + '='));
  return a ? a.split('=').slice(1).join('=') : null;
}

function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function normName(s) {
  return String(s || '').toLowerCase().replace(/[’`]/g, "'").trim();
}
function pathKey(arr) {
  return asArray(arr).map(normName).join(' > ');
}
function pct(n, d) {
  if (!d) return '—';
  return `${Math.round((n / d) * 1000) / 10}%`;
}

// ----------------------------------------------------------------------------
// Heuristic obviousness lexicon (§6/§7). A hook's conduct must be lived and
// non-obvious; a bare virtue-word is non-generative. This list is the "abstract
// virtue word" set the SKELETON is allowed to be named with but a HOOK's conduct
// must not collapse to. Heuristic, intentionally tunable — it flags for human review,
// it does not auto-reject.
// ----------------------------------------------------------------------------
const VIRTUE_WORDS = new Set([
  'honesty', 'honest', 'rigor', 'rigour', 'rigorous', 'care', 'careful', 'caring',
  'integrity', 'transparency', 'transparent', 'openness', 'open', 'humility', 'humble',
  'courage', 'courageous', 'brave', 'bravery', 'curiosity', 'curious', 'skepticism',
  'scepticism', 'skeptical', 'objectivity', 'objective', 'fairness', 'fair', 'accuracy',
  'accurate', 'precision', 'precise', 'diligence', 'diligent', 'prudence', 'prudent',
  'creativity', 'creative', 'originality', 'original', 'reproducibility', 'reproducible',
  'accountability', 'accountable', 'responsibility', 'responsible', 'trustworthiness',
  'trustworthy', 'modesty', 'modest', 'charity', 'charitable', 'autonomy', 'autonomous',
  'collegiality', 'collegial', 'generosity', 'generous', 'patience', 'patient',
  'thoroughness', 'thorough', 'conscientiousness', 'conscientious', 'impartiality',
  'impartial', 'sincerity', 'sincere', 'wisdom', 'wise', 'discipline', 'disciplined',
  'perseverance', 'persistence', 'persistent', 'tenacity', 'reflexivity', 'reflexive',
]);
const STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'to', 'and', 'or', 'in', 'on', 'with', 'for', 'be', 'being',
  'is', 'as', 'your', 'you', 'their', 'its', 'that', 'this', 'about', 'toward', 'towards',
]);

function words(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Returns a reason string if the hook's conduct fails the obviousness bar, else null.
function obviousnessReason(node) {
  const conduct = String(node.conduct || '').trim();
  if (!conduct) return 'no conduct rendering (a hook must have lived conduct)';
  const w = words(conduct);
  const content = w.filter((x) => !STOPWORDS.has(x));
  if (normName(conduct) === normName(node.name)) {
    return 'conduct merely restates the name';
  }
  if (content.length <= 1 || (content.length === 1 && VIRTUE_WORDS.has(content[0]))) {
    return `bare/near-bare: reduces to "${content.join(' ') || conduct}"`;
  }
  if (content.every((x) => VIRTUE_WORDS.has(x))) {
    return `only virtue-words ("${content.join(' ')}") — no situated conduct`;
  }
  if (w.length <= 3) {
    return `too short to be a situated if-then conduct (${w.length} words: "${conduct}")`;
  }
  return null;
}

// ----------------------------------------------------------------------------
// Load
// ----------------------------------------------------------------------------

function loadProposal() {
  const file = argValue('--file') || DEFAULT_PROPOSAL;
  if (!fs.existsSync(file)) {
    console.error(`No proposal found at ${file}.`);
    console.error('Run the Categorizer first: node chaos/categorizer.js');
    process.exit(2);
  }
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`Could not parse ${file}: ${e.message}`);
    process.exit(2);
  }
  return { file, data };
}

// Normalize each node to the shape validate.js expects (defensive — tolerates a
// hand-edited proposal.json). parent_paths is coerced to string[][].
function normalizeNodes(data) {
  return asArray(data.nodes)
    .filter((n) => n && typeof n.name === 'string' && n.name.trim())
    .map((n) => {
      let pp = n.parent_paths;
      if (pp == null) pp = [];
      else if (Array.isArray(pp) && pp.length && !Array.isArray(pp[0])) pp = [pp];
      pp = asArray(pp).map((p) => asArray(p).map(String)).filter((p) => p.length);
      return {
        name: n.name.trim(),
        role: n.role === 'skeleton' ? 'skeleton' : 'hook',
        conduct: typeof n.conduct === 'string' ? n.conduct : '',
        parent_paths: pp,
        basis: typeof n.basis === 'string' ? n.basis : '',
        frontiers: asArray(n.frontiers).map(String).filter((f) => f.trim()),
      };
    });
}

// ----------------------------------------------------------------------------
// Index
// ----------------------------------------------------------------------------

function buildIndex(nodes) {
  const byName = new Map(); // normName -> node (last wins; duplicates reported separately)
  const dupNames = [];
  for (const n of nodes) {
    const k = normName(n.name);
    if (byName.has(k)) dupNames.push(n.name);
    byName.set(k, n);
  }
  // children keyed by parent FULL path (== the child's parent_path)
  const childrenByParentFullPath = new Map();
  for (const n of nodes) {
    for (const pp of n.parent_paths) {
      const k = pathKey(pp);
      if (!childrenByParentFullPath.has(k)) childrenByParentFullPath.set(k, []);
      childrenByParentFullPath.get(k).push(n);
    }
  }
  return { byName, dupNames, childrenByParentFullPath };
}

// A node's full paths (root-to-this). Root => [[name]]; else one per parent_path.
function fullPathsOf(node) {
  if (!node.parent_paths.length) return [[node.name]];
  return node.parent_paths.map((pp) => pp.concat(node.name));
}

// Children of a node across ALL its placements, de-duplicated by node identity.
function childrenOf(node, idx) {
  const seen = new Set();
  const out = [];
  for (const fp of fullPathsOf(node)) {
    for (const c of idx.childrenByParentFullPath.get(pathKey(fp)) || []) {
      const k = normName(c.name);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Report
// ----------------------------------------------------------------------------

function main() {
  const { file, data } = loadProposal();
  const nodes = normalizeNodes(data);
  const idx = buildIndex(nodes);
  const L = [];
  const verdicts = []; // { label, ok, note }

  L.push('================ CHAOS GENESIS — STRUCTURAL VALIDATION ================');
  L.push(`file: ${file}`);
  L.push(
    `generated_by: ${data.generated_by || '?'}  ·  model: ${data.model || '?'}  ·  effort: ${data.effort || '?'}  ·  rubric v${data.rubric_version || '?'}`
  );
  L.push('');

  // --- 1. Skeleton vs hook counts (§7) ---
  const skeleton = nodes.filter((n) => n.role === 'skeleton');
  const hooks = nodes.filter((n) => n.role === 'hook');
  const roots = nodes.filter((n) => !n.parent_paths.length);
  L.push('## 1. Counts (§7)');
  L.push(`  total nodes:   ${nodes.length}`);
  L.push(`  skeleton [S]:  ${skeleton.length}`);
  L.push(`  hooks [H]:     ${hooks.length}`);
  L.push(`  roots:         ${roots.length}  (${roots.map((r) => r.name).join(', ') || '—'})`);
  L.push('');

  // --- 2. Depth distribution (§0/§1: must exceed two layers) ---
  // Placement depth: a root placement = depth 0; a parent_path of length k => depth k.
  const depthHist = new Map();
  let maxDepth = 0;
  let placements = 0;
  for (const n of nodes) {
    const depths = n.parent_paths.length ? n.parent_paths.map((pp) => pp.length) : [0];
    for (const d of depths) {
      depthHist.set(d, (depthHist.get(d) || 0) + 1);
      if (d > maxDepth) maxDepth = d;
      placements += 1;
    }
  }
  L.push('## 2. Depth distribution (§0/§1 — must EXCEED two layers)');
  L.push(`  placements: ${placements}  ·  max depth: ${maxDepth}  ·  layers: ${maxDepth + 1}`);
  for (let d = 0; d <= maxDepth; d++) {
    const c = depthHist.get(d) || 0;
    const layer = d === 0 ? 'roots' : `layer ${d + 1}`;
    L.push(`    depth ${d} (${layer}): ${c} ${'█'.repeat(Math.min(c, 60))}`);
  }
  const depthOk = maxDepth >= 2;
  verdicts.push({
    label: 'Depth exceeds two layers',
    ok: depthOk,
    note: depthOk ? `max depth ${maxDepth} (≥3 layers)` : `max depth ${maxDepth} — still a flat ≤2-layer tree`,
  });
  L.push('');

  // --- 3. Multi-parent coverage (§5.3 quota) ---
  const parents = nodes.filter((n) => childrenOf(n, idx).length > 0);
  let satisfied = 0;
  const unsatisfied = [];
  for (const p of parents) {
    const kids = childrenOf(p, idx);
    const has = kids.some((c) => c.parent_paths.length >= 2);
    if (has) satisfied += 1;
    else unsatisfied.push(p.name);
  }
  const multiParentedNodes = nodes.filter((n) => n.parent_paths.length >= 2);
  L.push('## 3. Multi-parent coverage (§5.3 — most concepts-with-children should have ≥1 child with an alternate parent)');
  L.push(`  nodes that have children:           ${parents.length}`);
  L.push(`  …with ≥1 multi-parented child:      ${satisfied}  (${pct(satisfied, parents.length)})`);
  L.push(`  multi-parented nodes (≥2 parents):  ${multiParentedNodes.length} / ${nodes.length} (${pct(multiParentedNodes.length, nodes.length)})`);
  if (unsatisfied.length) {
    L.push(`  parents WITHOUT a multi-parented child (${unsatisfied.length}): ${unsatisfied.slice(0, 20).join(', ')}${unsatisfied.length > 20 ? ', …' : ''}`);
  }
  const coverage = parents.length ? satisfied / parents.length : 0;
  const coverageOk = coverage >= 0.5; // "substantial / most" — calibration dial
  verdicts.push({
    label: 'Substantial multi-parent coverage',
    ok: coverageOk,
    note: `${pct(satisfied, parents.length)} of parents have a multi-parented child (target: "most")`,
  });
  L.push('');

  // --- 4. Context-differentiation among multi-parented nodes (§5.3) ---
  // A multi-parented node is genuinely integrative only if it differentiates DIFFERENTLY
  // under each parent. Same child set under ≥2 parents == duplication.
  let leaves = 0;
  let differentiated = 0;
  const duplication = [];
  const oneContextOnly = [];
  for (const n of multiParentedNodes) {
    const fps = fullPathsOf(n);
    const sigs = fps.map((fp) => {
      const kids = (idx.childrenByParentFullPath.get(pathKey(fp)) || [])
        .map((c) => normName(c.name))
        .sort();
      return kids.join('|');
    });
    const nonEmpty = sigs.filter((s) => s !== '');
    if (nonEmpty.length === 0) {
      leaves += 1;
      continue;
    }
    const distinctAll = new Set(sigs).size;
    const distinctNonEmpty = new Set(nonEmpty).size;
    if (nonEmpty.length >= 2 && distinctNonEmpty === 1 && distinctAll === 1) {
      // children in ≥2 contexts, identical sets everywhere -> duplication
      duplication.push(n.name);
    } else if (nonEmpty.length === 1 && distinctAll === 1) {
      // children in exactly one context, none elsewhere (and no empty-context contrast counted)
      oneContextOnly.push(n.name);
      differentiated += 1; // differentiates in one context, absent in others = different downstream
    } else {
      differentiated += 1;
    }
  }
  L.push('## 4. Context-differentiation of multi-parented nodes (§5.3 — different children per parent, not shared)');
  L.push(`  multi-parented nodes:                 ${multiParentedNodes.length}`);
  L.push(`    leaves (no children — fine):        ${leaves}`);
  L.push(`    differentiate (children somewhere): ${multiParentedNodes.length - leaves - duplication.length}`);
  L.push(`      …of those, differentiate in only ONE parent context: ${oneContextOnly.length}${oneContextOnly.length ? ` (${oneContextOnly.slice(0, 15).join(', ')}${oneContextOnly.length > 15 ? ', …' : ''})` : ''}`);
  L.push(`    DUPLICATION (same children under ≥2 parents — §5.3 violation): ${duplication.length}${duplication.length ? ` → ${duplication.join(', ')}` : ''}`);
  const ctxOk = duplication.length === 0;
  verdicts.push({
    label: 'No multi-parent duplication',
    ok: ctxOk,
    note: ctxOk ? 'every differentiating multi-parented node differs per context' : `${duplication.length} node(s) share one child set across parents`,
  });
  L.push('');

  // --- 5. Frontier coverage (§5.5: every carve emits ≥1 frontier) ---
  const noFrontier = nodes.filter((n) => n.frontiers.length === 0);
  L.push('## 5. Frontier coverage (§5.5 — every carve emits ≥1 frontier)');
  L.push(`  nodes with ≥1 frontier: ${nodes.length - noFrontier.length} / ${nodes.length} (${pct(nodes.length - noFrontier.length, nodes.length)})`);
  if (noFrontier.length) {
    L.push(`  WITHOUT a frontier (${noFrontier.length}): ${noFrontier.map((n) => n.name).slice(0, 25).join(', ')}${noFrontier.length > 25 ? ', …' : ''}`);
  }
  const frontierOk = noFrontier.length === 0;
  verdicts.push({
    label: 'Frontier on every carve',
    ok: frontierOk,
    note: frontierOk ? 'all nodes carry ≥1 frontier' : `${noFrontier.length} node(s) missing a frontier`,
  });
  L.push('');

  // --- 6. Obviousness flags on hooks (§6/§7) ---
  const flagged = [];
  for (const h of hooks) {
    const reason = obviousnessReason(h);
    if (reason) flagged.push({ name: h.name, conduct: h.conduct, reason });
  }
  L.push('## 6. Obviousness flags on hooks (§6/§7 — "too obvious = non-generative") [heuristic]');
  L.push(`  hooks flagged: ${flagged.length} / ${hooks.length} (${pct(flagged.length, hooks.length)})`);
  for (const f of flagged.slice(0, 40)) {
    L.push(`    ⚠ "${f.name}" — ${f.reason}`);
  }
  if (flagged.length > 40) L.push(`    … and ${flagged.length - 40} more`);
  // This is heuristic, so it informs but does not by itself fail the structural verdict;
  // surface it as a soft target.
  verdicts.push({
    label: 'Hooks clear the obviousness bar [heuristic]',
    ok: flagged.length === 0,
    note: flagged.length === 0 ? 'no hooks reduce to bare virtue-words' : `${flagged.length} hook(s) flagged for review (heuristic)`,
    soft: true,
  });
  L.push('');

  // --- 7. Structural integrity ---
  const dangling = new Map(); // missing parent name -> [child names]
  for (const n of nodes) {
    for (const pp of n.parent_paths) {
      for (const anc of pp) {
        if (!idx.byName.has(normName(anc))) {
          if (!dangling.has(anc)) dangling.set(anc, []);
          dangling.get(anc).push(n.name);
        }
      }
    }
  }
  // cycle detection: a node reachable from itself via parent_paths
  const cycles = [];
  for (const n of nodes) {
    for (const pp of n.parent_paths) {
      if (pp.map(normName).includes(normName(n.name))) {
        cycles.push(n.name);
        break;
      }
    }
  }
  L.push('## 7. Structural integrity');
  L.push(`  duplicate node names: ${idx.dupNames.length}${idx.dupNames.length ? ` → ${idx.dupNames.join(', ')}` : ''}`);
  L.push(`  dangling parent refs: ${dangling.size}${dangling.size ? '' : ' (every parent_path name resolves to a node)'}`);
  for (const [missing, kids] of dangling) {
    L.push(`    ✗ "${missing}" referenced by: ${kids.slice(0, 10).join(', ')}${kids.length > 10 ? ', …' : ''}`);
  }
  L.push(`  cycles (name in its own parent path): ${cycles.length}${cycles.length ? ` → ${cycles.join(', ')}` : ''}`);
  const integrityOk = idx.dupNames.length === 0 && dangling.size === 0 && cycles.length === 0;
  verdicts.push({
    label: 'Structural integrity',
    ok: integrityOk,
    note: integrityOk ? 'no dup names, no dangling parents, no cycles' : 'see flags above',
  });
  L.push('');

  // --- Verdict ---
  L.push('================ STRUCTURAL-TARGETS VERDICT ================');
  for (const v of verdicts) {
    const mark = v.ok ? 'PASS  ' : v.soft ? 'REVIEW' : 'CONCERN';
    L.push(`  [${mark}] ${v.label} — ${v.note}`);
  }
  const hardFails = verdicts.filter((v) => !v.ok && !v.soft);
  L.push('');
  L.push(
    hardFails.length === 0
      ? '  → All hard structural targets met. (Review any heuristic flags above by eye.)'
      : `  → ${hardFails.length} hard target(s) not met — see CONCERN lines above.`
  );
  L.push('============================================================');

  console.log(L.join('\n'));
}

if (require.main === module) {
  main();
}

module.exports = { obviousnessReason, fullPathsOf, normName, pathKey };
