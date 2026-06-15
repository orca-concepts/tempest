# Chaos pipeline vs. v0.12 value-only rubric — investigation findings

**Scope:** investigation only; no fixes proposed. Checks whether the Chaos *pipeline code
and embedded prompts* still match the v0.12 value-only rubric (`chaos.md` itself excluded).

## Files inspected

Executable pipeline (chaos/):
- `snapshot.js` — read-only DB snapshot (attributes, concepts, edges, links, tunnels)
- `source.js` — OpenAlex discovery + full-text fetch
- `reason.js` — read/decompose + integrate passes; **the prompt text lives here** (no separate skill file)
- `apply.js` — emit: writes reviewed proposals into the dev graph
- `record-run.js`, `episodic/recordSchema.js`, `episodic/writeRecord.js` — episodic ledger
- `check-run.js`, `precision.js`, `check-schema.js` — validation / shared math / schema diagnostic
- `clear.js`, `reset-dev-db.js`, `migrate-chaos.js` — DB wipe + Chaos support schema
- Docs: `SCHEMA_NOTES.md`, `episodic/README.md`

No Chaos prompt/skill files exist outside `chaos/` (the only "brain" prompt is `chaos.md`
plus the prompt strings embedded in `reason.js`). `.claude/` holds only `settings.local.json`.

**Headline:** the *emit path is fully value-only*. `reason.js` hard-codes
`ATTRIBUTES = ['value']` (reason.js:100) and the prompt forces `attribute: "value"`;
`apply.js` and `reason.js` contain **zero** situation/combo references; `record-run.js`
excludes situations from what it derives. The leftover four-domain logic is concentrated in
(1) **prompt context** that still surfaces four attribute names to the model, (2) **latent
assumptions** that rely on the data being value-only rather than enforcing it, and (3) **dead
schema/diagnostics** for retired situations.

---

## (a) Dead / harmless leftovers

| File:line | Term | Note |
|---|---|---|
| `migrate-chaos.js:152, 165` | `'situation'` in `target_type` CHECK on `chaos_predictions` / `chaos_prediction_events` | Permissive constraint; nothing inserts situation-targeted predictions now. Dead but harmless. |
| `migrate-chaos.js:222–282, 314` | entire `chaos_situation_meta` table + columns (`lifecycle_phase`, `entrenchment_status`, `recurrence_count`, `precision`, `domain_balance`) | Full situation-metadata schema still created. No value-only writer touches it (apply.js has 0 situation refs). Large dead surface — see Cleanest Concerns #3. |
| `episodic/recordSchema.js:31` | `'situation'` in `proposalType` enum | **Deliberately** kept so historical records validate; documented at record-run.js:131. Harmless. |
| `record-run.js:130–136` | `PROPOSAL_ARRAYS` = concept/link/tunnel only | Situations explicitly dropped with a value-only comment. Correct behavior; the comment is just documentation. |
| `clear.js:53–54` | TRUNCATE `combos`, `combo_edges` | Cleanup of retired tables. Harmless/desirable. |
| `reset-dev-db.js:110–115` | TRUNCATE `combos`, `combo_edges`, `combo_subscriptions`, `combo_votes`, `chaos_situation_meta` | Same — correct cleanup of retired situation tables. |
| `reset-dev-db.js:65, 328, 341` | preserve dormant `action/tool/question` attribute rows (disabled via `ENABLED_ATTRIBUTES`) | Documented intentional: rows kept, disabled at read time. Harmless. |
| `check-schema.js:201–228` | describe `chaos_situation_meta`; `combos`, `combo_edges`, `tunnel_links` in expected-tables list | Read-only diagnostic that matches the still-present schema. Harmless. |
| `source.js:6` | "all six fields" | **False positive** — the six cog-sci *discipline tags* for paper sourcing, not attribute domains. Unrelated to the four-domain model. |
| `reason.js:421, 465` | `cost/benefit` | Appears only in **negative** instructions ("NOT a cost/benefit relation"). Actively enforces value-only association semantics — the opposite of a leftover. |
| `migrate-chaos.js:224, 235, 257` | `lifecycle`, `cost/benefit` | Comments inside the dead `chaos_situation_meta` block. Inherit that block's dead status. |

---

## (b) Genuine four-domain assumptions that contradict value-only

**None that cause non-value emission.** The producing path is value-only end to end:
- `reason.js:100` `const ATTRIBUTES = ['value'];`
- `reason.js:360, 399, 401, 446, 475…` prompt asserts "single attribute domain: value",
  `"attribute": "value"` is the only allowed value in the concept/link/tunnel schemas.
- `apply.js` — no situation handling; consumes whatever proposals.json contains.
- `record-run.js` — derives concept/link/tunnel only.

The candidate that comes closest to a true contradiction is the prompt-context issue, but it
does not force non-value *output*, so it is classified under (c) rather than (b).

---

## (c) Ambiguous / needs a human decision

| File:line | Note |
|---|---|
| `snapshot.js:50–88` | Reads **ALL** attribute rows (`SELECT id, name FROM attributes`, no `ENABLED_ATTRIBUTES` filter) and builds `edges_by_attribute` with one bucket per attribute. The live `snapshot.json` therefore has `counts.attributes: 4` and `edges_by_attribute` keys `action/tool/value/question` (action/tool/question empty; all 14 edges under `value`). Comment says this is intentional ("mirror whatever is present"), but it propagates four-domain structure downstream. Decision: filter the snapshot to value, or leave it generic? |
| `reason.js:208–214` (`loadGraphState`) | Prints `attributes: ${snap.attributes names}` into the model prompt — currently **`attributes: action, tool, value, question`**. This contradicts the same prompt's "single attribute domain: value" instruction. The model receives both signals at once. Does **not** change emission (ATTRIBUTES is hard-coded), but it is a half-converted prompt context. → Cleanest Concern #1. |
| `reason.js:158–174` (`buildInventory`) | Iterates `Object.keys(edges_by_attribute)` over **all** attributes. Any non-value edge in the DB would enter the inventory as a non-value entry tagged with its attribute. Safe today only because the non-value buckets are empty — relies on data being value-only, not enforced in code. |
| `apply.js:487–598` | Attribute resolution is **data-driven**: `attrId.get(attribute)` against the DB `attributes` table; `materializeChain`/`getOrCreateEdge` accept any attribute name that exists (throws only on an *unknown* name, not a non-value one). No value-only guard at the emit boundary. Safe today only because `reason.js` emits value. A hand-edited `proposals.json` with `attribute: "action"` would create an `action` edge, since that row still exists. |

---

## Cleanest concerns (most likely a messy / partial conversion)

1. **Prompt surfaces all four attribute domains to the model.**
   `reason.js:214` (`loadGraphState`) emits `attributes: action, tool, value, question`
   (sourced from `snapshot.js`'s unfiltered attribute read, confirmed in live
   `snapshot.json`). The same prompt elsewhere insists the domain is value-only. This is the
   clearest half-conversion: a value-only prompt that still hands the model a four-domain
   graph-state line. Output is unaffected (ATTRIBUTES is hard-coded), but the contradictory
   context is exactly the kind of leftover the audit was looking for.

2. **Value-only is assumed, not enforced, at the emit + inventory boundary.**
   `apply.js` attribute resolution and `reason.js buildInventory` both accept any attribute
   the data carries; neither rejects a non-value attribute. The pipeline is value-only only
   because its single producer (`reason.js`, ATTRIBUTES=['value']) happens to emit value. If
   `proposals.json` is hand-edited or any legacy non-value edge reappears in the DB, four-domain
   behavior returns silently. Worth a human decision on whether to add a guard.

3. **`migrate-chaos.js` still stands up the entire situation schema.**
   `chaos_situation_meta` (table + lifecycle/entrenchment/recurrence/precision/domain_balance
   columns) and the `'situation'` `target_type` branch are created on every migrate, yet no
   value-only code path writes them. It is inert, but it is a large, convincing-looking dead
   surface that could mislead a future reader into thinking situations are still derived.

---

*Findings only — no fixes proposed or applied.*
