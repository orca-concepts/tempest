# Chaos pipeline — value-only audit (inventory only)

**Status:** scoping pass. No code/SQL/schema changed. Disposable artifact — delete after the fix prompts are written.
**Pivot:** keep `[value]` only; retire `[action]`/`[tool]`/`[question]`; drop Situations (`combos`/`combo_edges`/`chaos_situation_meta`) and the lifecycle/phase map entirely; all tunnels become `value↔value` associative links (no cost/benefit, no cross-domain). Rubric `chaos/chaos.md` already reworked to v0.12.

Files in `chaos/`: **60 total** — 13 code (`.js`), 4 docs (`.md`), 43 regenerable data artifacts. Every file is accounted for below (findings or "no changes").

---

## 1. Summary

The dropped concepts are **deeply tangled in `reason.js` and `apply.js`**, lightly present in `snapshot.js` and `check-run.js`, and otherwise confined to the episodic schema and generated artifacts.

- **`reason.js` (highest surface area).** Carries the `ATTRIBUTES` four-domain constant, the `PHASES` lifecycle list + `PHASE_ENUM`, and the **entire model-facing prompt + output contract** for both passes (per-paper and integration). The output JSON the model is told to return includes four-domain `attribute` enums, `phase`/`conduct_phases`, full **situations** objects (`domain_balance`, `reading_list`, `core_spine`, `toggleable`), and **cost/benefit** tunnel framing (`relation`, `directness_note`). The post-processing (`reconstructConcepts`, `rewriteSituations`, `normalizeReadingLists`, `assignIntegrationFields`, `computeDistributions`, `writeJson`, `writeMarkdown`, `printSummary`) all thread phase/domain/situation through. This file is the bulk of the work.
- **`apply.js`.** A complete **situations writer** (`combos` + `combo_edges` + `chaos_situation_meta` INSERT/upsert, ~lines 746–800), situation precision recompute (live pass + backfill), `byDomain` reporting over four domains, and tunnel mapping that labels the tunnel by `t.relation` (cost/benefit). Concept/edge writing is attribute-generic (keyed by `sig(attribute,name)`) so it works value-only unchanged, but the situation paths must go.
- **`snapshot.js`.** Loads `combos`/`combo_edges`/`tunnel_links` and groups edges by attribute name. With non-value attributes gone from the DB, the grouping naturally collapses to `value`; the combos load becomes dead.
- **`check-run.js`.** Has a dedicated **situation_meta completeness** integrity check and "concepts by attribute" / combos counts.
- **`record-run.js` + `episodic/recordSchema.js`.** Carry `situation`/`tunnel` proposal types and a `situation` ref-builder; episodic records are historical, so the schema can keep enums for back-compat but new runs won't emit situations.
- **`source.js` is NOT in scope** despite many "field" hits — its "fields" are the six cog-sci **disciplines** (neuroscience, psychology…), not graph attribute domains.
- **Migrations/DB scripts** (`migrate-chaos.js`, `clear.js`, `reset-dev-db.js`, `check-schema.js`) reference the combos/situation tables but are **schema-management** scripts — noted under category 8, not changed here.

---

## 2. Findings by category

### Category 1 — Non-value attribute domains (`action`/`tool`/`question`)

| File · lines | What it does | Action | Notes |
|---|---|---|---|
| `reason.js:108` | `const ATTRIBUTES = ['value','action','tool','question']` | **REWORK→value-only** | Reduce to `['value']` (or inline). Drives validation/expectations. |
| `reason.js:386–389` | Per-paper prompt: "Decompose across the four domains: value=… action=… tool=… question=…" | **REWORK→value-only** | Must become a value-only instruction (dispositions only). |
| `reason.js:397,424,473–474` | Reconcile text + output schema `"attribute":"value"\|"action"\|"tool"\|"question"` + "same disposition/action/tool/question" | **REWORK→value-only** | Output enum must collapse to `"value"`; or drop the `attribute` field entirely since it's constant. |
| `reason.js:1198,1221` (computeDistributions/writeJson) | `domain={value,action,tool,question}` tally + `counts_by_domain` | **REWORK→value-only** | Becomes a single value count (or removed). |
| `reason.js:~1401,~1428` (writeMarkdown/printSummary) | "Concepts by domain: Values/Actions/Tools/Questions" report lines | **REWORK→value-only** | Cosmetic, but enumerates the four domains. |
| `apply.js:470–473,502–503` | `byDomain={value,action,tool,question}` dry-run report + `counts_by_domain` passthrough | **REWORK→value-only** | Report-only; concept write path itself is attribute-generic. |
| `apply.js:569,634–661` | reads `attributes` table; `getOrCreateEdge(...attribute_id)` | **KEEP** | Attribute-generic: resolves whatever attribute the proposal carries. Value-only proposals → only the `value` attribute row used. |
| `snapshot.js:46–82,177` | loads `attributes`, groups edges into `edges_by_attribute` by name | **KEEP (auto-collapses)** | With only `value` rows in DB, the map has one key. Comment at :46 ("the four domains…") is stale → minor REWORK of comment. |
| `check-run.js:303–308` | "Concepts by attribute" diagnostic (GROUP BY attribute) | **KEEP** | Works value-only (one row). Harmless. |
| `record-run.js:104,106,108` | ref builders include `item.attribute` | **KEEP** | Attribute-generic identity key; fine with constant `value`. |

### Category 2 — Situations / combos

| File · lines | What it does | Action | Notes |
|---|---|---|---|
| `reason.js:480–512` | Integration prompt: "Compose SITUATIONS (§5)…" + situations output schema (`name,phase,members,domain_balance,reading_list,core_spine,toggleable,rationale,confidence`) | **REMOVE** | Model must stop emitting `situations` entirely. Largest prompt removal. |
| `reason.js:1013–1029` `rewriteSituations` | rewrites situation members to canonical names | **REMOVE** | Dead once situations gone. |
| `reason.js:1050–1074` `normalizeReadingLists` | normalizes situation reading lists to openalex ids | **REMOVE** | Dead once situations gone. |
| `reason.js:1144–1176` `assignIntegrationFields` (situation block) | defaults `entrenchment_status`, `ideal_anchor`, `recurrence_count`, `precision`, `domain_balance.under_budgeted` | **REMOVE (situation part)** | Keep the **concept** part (precision/surprise/provenance). Only the `integration.situations` loop goes. |
| `reason.js:1226,1354–1369` (writeJson/writeMarkdown) | emits `situations:` array + Situations markdown section | **REMOVE** | |
| `reason.js:255,1435` (printSummary/loadGraphState) | "Situations: N" console + `situations (combos): N` in graph-state | **REMOVE** | graph-state line at :235 should drop the combos count. |
| `apply.js:362–401` | builds `situations` plan (members, phase, reading_list, spine, meta fields) | **REMOVE** | |
| `apply.js:746–800` | **situations writer**: INSERT `combos`, INSERT `combo_edges`, upsert `chaos_situation_meta` | **REMOVE** | The core combos write. Also `comboIdByName` map. |
| `apply.js:160–190` (recompute) + `481–483,495–499` (dry-run) | situation precision recompute (backfill + live), situation counts in plan report | **REMOVE** | Situation precision in both the `--recompute-precision` backfill and the live apply pass. |
| `apply.js:456–457,478` | `plan.situations` assembled + `situationPredCount`/`situationEvents` | **REMOVE** | |
| `snapshot.js:95–110,153–166` | loads `combos` + `combo_edges` into snapshot | **REMOVE** | Becomes empty/dead post-pivot. |
| `check-run.js:209–223` | **situation_meta completeness** integrity check (combos vs chaos_situation_meta) | **REMOVE** | Whole check block. |
| `check-run.js:315–325` | combos count in totals table | **REWORK→value-only** | Drop `combos` column (keep concepts/edges/links/tunnels/papers). |
| `record-run.js:110–111,136` | `situation` ref builder + `['situations','situation']` in PROPOSAL_ARRAYS | **REWORK** | New runs won't have situations; safe to drop from array. Historical records still parse (schema keeps enum — see cat 8). |
| `episodic/recordSchema.js:31` | `'situation'` in `proposalType` enum | **KEEP (back-compat)** | Runs 1–4 recorded situations; keep enum so old records validate. New runs simply won't use it. |

### Category 3 — Lifecycle / phases

| File · lines | What it does | Action | Notes |
|---|---|---|---|
| `reason.js:98–106` | `const PHASES=['Sensing the gap',…]` | **REMOVE** | |
| `reason.js:364` | `PHASE_ENUM = PHASES.map(...)` | **REMOVE** | |
| `reason.js:378–385,421,427,450` | Per-paper prompt: CARS/move-step phase reading, `conduct_phases`, `"phase": PHASE_ENUM\|null`, "Use the EXACT phase strings" | **REMOVE** | The CARS "both ends of the arc" framing and the `phase`/`conduct_phases` output fields all go. |
| `reason.js:483,496,507` | Integration prompt: "shared lifecycle phase", situation `phase`, concept `phase` enum | **REMOVE** | (Overlaps cat 2 for the situation `phase`.) |
| `reason.js:704,709,834,962` | `conduct_phases`/`phase` threaded through compactCandidates & reconstructConcepts | **REMOVE** | Concept objects lose `phase`. |
| `reason.js:1199–1207,1222–1223` (computeDistributions/writeJson) | `phase`/`questionsUnphased` tally + `phase_distribution`/`questions_unphased` output | **REMOVE** | |
| `reason.js:1291,1303–1307,1383,1429–1431` (writeMarkdown/printSummary) | phase columns in markdown + "Lifecycle phase distribution" console block + conduct-phase line | **REMOVE** | |
| `apply.js:362–401,773–794` | situation `lifecycle_phase` / `phase` write (within combos meta) | **REMOVE** | Subsumed by cat 2 removal of the situations writer. |
| `snapshot.js` | — | **KEEP** | Snapshot loads **no** phase data (edges have no phase column; `chaos_situation_meta` is not loaded). Nothing to change. |

> **Note:** there is **no `phase` column on `concepts`/`edges`** — "phase" lives only in proposals (model output) and `chaos_situation_meta.lifecycle_phase`. So phase removal is entirely a reason.js (prompt/emit) + apply.js (situation-meta) concern; no concept-write or snapshot change.

### Category 4 — Cross-domain vs value↔value tunnels

| File · lines | What it does | Action | Notes |
|---|---|---|---|
| `reason.js:388–389,437–442` | Per-paper tunnel framing: P2 "disposition ↔ the action that enacts it", `"relation": "a cost/benefit relation"`, `directness_note` | **REWORK→value-only** | Tunnels become value↔value associative links. Drop cost/benefit + directness/action framing; `from`/`to` both `value`. |
| `reason.js:480–481,501–504` | Integration: "Finalize CO-GROUNDED **cost/benefit** tunnels (P8)…ensure each pairs a disposition with the action…" + tunnel output schema `relation`/`cogrounding_url` | **REWORK→value-only** | Reframe relation as an associative link, not cost/benefit; endpoints both value. |
| `reason.js:999–1011` `rewriteTunnels` | rewrites tunnel endpoints to canonical names | **KEEP** | Endpoint-agnostic; works value↔value. |
| `apply.js:350–359` | tunnel plan: resolves both endpoints to edges, `comment: t.relation` | **KEEP (mostly)** | Endpoint-generic. `comment` still stores `relation` text — fine; only the *meaning* changes (rubric/prompt), not the write. |
| `apply.js:494,508` | tunnel counts/report | **KEEP** | |
| `record-run.js:107–109,135` | `tunnel` ref builder (uses `from`/`to`/`cogrounding_url`) | **KEEP** | Value↔value still has from/to. |
| `episodic/recordSchema.js:30` | `'tunnel'` proposal type | **KEEP** | Tunnels remain. |
| `snapshot.js:112–117` | loads `tunnel_links` | **KEEP** | Tunnels remain a value-only feature. |

### Category 5 — Reasoner prompt text & output contract (exhaustive — `reason.js`)

This is the contract the model is told to satisfy; **all of it changes shape**. Two system prompts:

**`perPaperSystem` (`reason.js:366–452`):**
- `:378–385` — CARS / move-step "both ends of the arc" + phase-name framing → **REMOVE** (cat 3).
- `:386–389` — "four domains: value/action/tool/question" + P2 disposition↔action tunnel pairing → **REWORK→value-only**.
- Output JSON contract `:417–449`:
  - `:421` `"conduct_phases": string[]` → **REMOVE**.
  - `:424` `"attribute": "value"|"action"|"tool"|"question"` → **REWORK** (collapse to value / drop field).
  - `:427` `"phase": PHASE_ENUM | null` → **REMOVE**.
  - `:437–442` tunnels block (`relation`=cost/benefit, `cogrounding_url`, `directness_note`) → **REWORK→value-only**.
  - `:450` "Use the EXACT phase strings" → **REMOVE**.
  - (concepts `name`/`parent_path`/`prediction`/`grounding`/`rationale`, links block, `prediction_test` gaps/non_confirmations/mis_structures → **KEEP**.)

**`integrationSystem` (`reason.js:454–512`):**
- `:473–474` "merge … same attribute + disposition/action/tool/question" → **REWORK→value-only**.
- `:480–481` "Finalize CO-GROUNDED **cost/benefit** tunnels (P8) … pairs a disposition with the action" → **REWORK→value-only**.
- `:482–485` "Compose SITUATIONS (§5) … domain-balance … reading list … core-spine vs toggleable" → **REMOVE**.
- Output JSON contract `:493–512`:
  - `:495–496` concept `attribute` + `phase` enum → **REWORK/REMOVE**.
  - `:501–504` tunnels block → **REWORK→value-only**.
  - `:506–510` situations block (`phase`, `members`, `domain_balance{value,question,action,tool}`, `reading_list`, `core_spine`, `toggleable`) → **REMOVE**.
  - (`recurrences` block → **KEEP**.)

**Reconcile instructions** added earlier (`:397,468`): mention "same disposition/action/tool/question" and "intermediate root" — **REWORK→value-only** wording (drop non-value domains; keep the nest/cluster guidance).

> The model's **required output shape changes**: concept objects drop `phase` (and effectively `attribute`); per-paper output drops `conduct_phases`; the integration output drops the entire `situations` array and reframes `tunnels`. Downstream `reconstructConcepts`/`compactCandidates`/emit must match.

### Category 6 — Prompt/version cache keys (bump on prompt change)

| File · lines | What | Current value | Action |
|---|---|---|---|
| `reason.js:78` | `const PROMPT_VERSION` | **`'p2-graph-reconcile'`** | **REWORK→bump** (e.g. `p3-value-only`). Folded into `stateHash` (`:629`, used by both cache keys). |
| `reason.js:623–633` | `rubricHash()` (FNV of chaos.md) + `cachePathFor(id, stateHash)` → `${id}-r${rubricHash}-s${stateHash}.json` | n/a | **KEEP mechanism.** chaos.md→v0.12 already changes `rubricHash`, and bumping `PROMPT_VERSION` changes `stateHash`, so **stale per-paper + integration caches auto-invalidate** (existing `reason_cache/*.json` orphan). No manual clear needed, but bumping `PROMPT_VERSION` is the explicit belt-and-suspenders. |
| `reason.js:733–734` | `integrationCachePath` salts with `MODEL\|EFFORT\|rubricHash\|stateHash` | n/a | **KEEP** (inherits the bump via stateHash). |

### Category 7 — Zombie / orphaned paths (become dead post-removal)

| File · lines | Why it dies | Action |
|---|---|---|
| `reason.js:1013–1029` `rewriteSituations`, `:1050–1074` `normalizeReadingLists` | no caller once situations dropped from finalize (`:1185–1186`) | **REMOVE** + their exports (`module.exports`) and the calls in `finalizeProposals`. |
| `reason.js` `PHASES`/`PHASE_ENUM` | unreferenced once prompts/emit drop phase | **REMOVE** |
| `apply.js:404–428` restructure-mention handler (`pushRM`, `restructure_mentions`) | **already dead** today (reason.js never emits `restructure_mentions`; forward-compat passthrough at `reason.js:1240–1243`) — *pre-existing* zombie, not caused by this pivot | **NOTE / optional REMOVE** — flag for the owner; it's orthogonal to value-only but is dead code in the same file. |
| `apply.js:747` `comboIdByName` + situation precision maps | no producers once situations gone | **REMOVE** with the situations writer. |
| `record-run.js` `situation` branch in `refOf`/`PROPOSAL_ARRAYS` | new runs emit no situations | **REMOVE** from new-run path (keep recordSchema enum for old records). |
| `snapshot.json` `combos`/`combo_edges` keys | nothing reads them post-pivot | regenerated empty on next snapshot — no code action. |

### Category 8 — Schema / DB assumptions (NOTE ONLY — do not change)

What the **pipeline assumes** about schema (to reconcile with the owner's app-side attribute takedown):

- **`attributes` table has 4 rows** — `reset-dev-db.js:409,425` hard-asserts `after.attributes === 4` ("YES (4)"); `migrate-chaos.js` and seed logic assume the four-domain seed. **If the app reduces `attributes` to 1 row, this assertion breaks** (would report "NO (1)"). → reconcile.
- **`combos` / `combo_edges` tables exist** and are written by `apply.js:746–772`, loaded by `snapshot.js:95–110`, checked by `check-run.js:214–219`, truncated by `clear.js:53–55` and `reset-dev-db.js:108–112`. The pivot stops *using* them but the **tables remain** (app owns `combos`/`combo_edges`; also `combo_subscriptions`/`combo_votes`). No migration here.
- **`chaos_situation_meta` table** — created by `migrate-chaos.js:238–282`, written by `apply.js:776–800`, checked by `check-run.js:215`, described by `check-schema.js:202–203`, truncated by `reset-dev-db.js:112`. Pivot stops writing it; **table can stay** (dev-only; drop is a separate, owner-coordinated migration decision). **Make no migration change now.**
- **No `phase` column** anywhere on `concepts`/`edges` — phase is model-output + `chaos_situation_meta.lifecycle_phase` only. So there is **no concept/edge schema change** implied by dropping phases.
- **`attribute_id NOT NULL` on `edges`** — value-only proposals still set `attribute_id` (the `value` row), so the constraint is satisfied unchanged.
- `chaos_predictions`/`chaos_prediction_events` `target_type CHECK ('concept','situation')` (`migrate-chaos.js:152,165`) — keeps `'situation'`; harmless if unused. Note only.

---

## 3. Files needing no changes

**Code (logic unaffected by the pivot):**
- `chaos/source.js` — "fields" = cog-sci disciplines, not graph attributes; discovery/full-text only. **KEEP.**
- `chaos/precision.js` — pure P16 curve; attribute/phase/situation-agnostic. **KEEP.**
- `chaos/episodic/writeRecord.js` — generic record writer/validator driver. **KEEP.**
- `chaos/check-schema.js` — read-only schema introspection; references `chaos_situation_meta`/`combos` only to *describe* them (cat 8 note), no behavioral change required for the pivot. **KEEP** (optionally tidy later).
- `chaos/clear.js`, `chaos/reset-dev-db.js`, `chaos/migrate-chaos.js` — schema/DB management; touch combos/situation **tables** but are out of scope (cat 8, no schema change now). **KEEP** — except note `reset-dev-db.js:409` `attributes===4` assertion as a reconcile item.

**Docs:**
- `chaos/chaos.md` — already reworked to v0.12 (the source of truth driving this). **No change here.**
- `chaos/SCHEMA_NOTES.md`, `chaos/episodic/README.md` — documentation; update later if desired, not required for code parity. **KEEP.**

**Regenerable data artifacts (no code; regenerate or ignore):**
- `chaos/proposals.json`, `chaos/proposals.reasoned.json`, `chaos/proposals.md`, `chaos/snapshot.json`, `chaos/last-apply.json` — outputs; regenerated next run (gitignored).
- `chaos/papers/*.json` (6), `chaos/reason_cache/*.json` (26 — auto-invalidated by the cache-key bump), `chaos/backups/*.sql` (2).
- `chaos/episodic/index.json`, `chaos/episodic/run-0001..0004.json` (4) — **historical records; keep as-is** (they legitimately contain situations/phases from runs 1–4; recordSchema keeps the enums for back-compat).

---

## 4. Recommended order of fix prompts

Driven by the data-flow dependency **reason.js (producer) → apply.js (consumer) → check-run.js (verifier)**, plus snapshot at the head:

1. **`reason.js` first (prompts + output contract + emit + cache bump).** It is the producer of everything downstream; once it stops emitting situations/phases and reframes tunnels (and `PROMPT_VERSION` is bumped to invalidate caches), the proposals shape is value-only. Do this as one focused prompt (prompts, `ATTRIBUTES`/`PHASES`, `reconstructConcepts`/`compactCandidates`, `rewriteSituations`/`normalizeReadingLists` removal, `computeDistributions`/`writeJson`/`writeMarkdown`/`printSummary`). *Cross-file dependency: nothing downstream can safely drop its situation/phase handling until reason.js stops producing them — but reason.js can ship first because apply.js tolerantly skips absent arrays (`asArray(proposals.situations)` → empty).*
2. **`apply.js` second.** Remove the situations writer (`combos`/`combo_edges`/`chaos_situation_meta`), situation precision (live + backfill), `byDomain` four-domain report, and situation plan assembly. Safe only after reason.js stops emitting `situations` (else you'd silently drop real proposals). Keep concept/edge/tunnel writers (attribute-generic). *Optionally* delete the pre-existing dead restructure-mention handler in the same pass.
3. **`snapshot.js` third.** Drop the `combos`/`combo_edges` load and fix the "four domains" comment; the attribute grouping auto-collapses to value. Independent of 1–2 but cosmetically should follow so the snapshot the model sees matches.
4. **`check-run.js` fourth.** Remove the `situation_meta completeness` integrity check and the `combos` totals column. Must come **after** apply.js stops writing combos (else the checker correctly flags now-absent writes). 
5. **`record-run.js` last (small).** Drop the `situation` branch from new-run derivation; leave `episodic/recordSchema.js` enums intact for historical records.

**Out of band (owner-coordinated, separate from these prompts):** the `reset-dev-db.js` `attributes===4` assertion and any decision to *drop* `combos`/`chaos_situation_meta` tables (cat 8) — these touch schema/DB management and should be reconciled with the app-side attribute takedown, not bundled into the pipeline-logic fixes.

---

*End of audit. Nothing in this pass modified code, SQL, schema, or git state.*
