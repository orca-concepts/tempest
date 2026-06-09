# Chaos — Schema Notes

What the Chaos read layer (`chaos/snapshot.js`) actually reads from the Orca dev
database, and an explicit inventory of what the Chaos rubric (`chaos.md`) needs that
the schema does **not** yet contain.

This stage is investigation + plumbing only. Nothing here creates, alters, or writes
anything. The "Gaps" section is a report, not a to-do that was executed.

- **Database:** `concept_hierarchy` (local dev), read via the backend's own pg pool
  (`backend/src/config/database.js`) and env vars (`backend/.env`). No new connection
  configuration was introduced.
- **Snapshot output:** `chaos/snapshot.json` (one structured object, edges grouped by
  attribute).
- **Counts at last snapshot** (script ↔ `psql` cross-check, identical):

  | Table | Rows |
  |---|---|
  | attributes | 4 |
  | concepts | 185 |
  | edges | 225 |
  | concept_links | 33 |
  | combos | 11 |
  | combo_edges | 15 |
  | tunnel_links | 38 |

  Edges by attribute: value 218, tool 3, question 2, action 2.

---

## 1. Tables and columns Chaos currently reads

Only the columns relevant to Chaos's reasoning are pulled; provenance/timestamp
columns are included where cheap and useful. The full canonical schema lives in
`ORCA_STATUS.md` — this is the Chaos-facing subset.

### `attributes`
The four domains of the graph. Seeded, stable.
- `id` — PK.
- `name` — one of `value`, `action`, `tool`, `question`.

Maps to chaos.md's four domains (§1 cost/benefit; §4 domain notes). The snapshot uses
this table to group edges by domain.

### `concepts`
The bare concept nodes (just a name + provenance). Contextual identity does **not**
live here — it lives on `edges` (path + attribute). See chaos.md P1, and the
"Path-Dependent Identity" AD in `ORCA_STATUS.md`.
- `id` — PK.
- `name` — VARCHAR(255), the concept label.
- `created_by` — FK `users(id)`, nullable (SET NULL on user delete).
- `created_at`.

### `edges` (grouped by attribute in the snapshot)
The real structure of the graph: a parent→child relationship in a specific path
context under one attribute. This is the unit chaos.md calls a "concept-in-context"
(P1; Situations §5 "members are edges").
- `id` — PK.
- `parent_id` — FK `concepts(id)`; **NULL for root edges**.
- `child_id` — FK `concepts(id)`.
- `graph_path` — INTEGER[], root-to-parent inclusive (`'{}'` for roots). See the
  `graph_path` Semantics AD (#137) in `ORCA_STATUS.md` — never append the parent.
- `attribute_id` — FK `attributes(id)`; the edge's domain. Inherited from the root
  edge of the graph.
- `is_hidden` — BOOLEAN; moderation hide. Chaos should treat hidden edges as not
  part of the live graph for proposal purposes.
- `created_by`, `created_at`.

Note: `legal_hold` exists on `edges` in the canonical schema but is not pulled — it is
a moderation/legal concern irrelevant to Chaos's read model. Easy to add later if
Chaos ever needs to avoid proposing atop legally-held structure.

### `concept_links`
External reference URLs attached to a specific edge. These are chaos.md's "links" /
exemplar documents (P5 exemplar test, P8 co-grounding, §10 link proposals).
- `id` — PK.
- `edge_id` — FK `edges(id)`; the context the link grounds.
- `url` — TEXT.
- `title` — VARCHAR(255), often OG-fetched.
- `comment` — TEXT; in Chaos terms this is the exemplification claim.
- `added_by`, `created_at`.

### `combos` (= Situations) and `combo_edges`
A combo is a named collection of member edges — the app feature chaos.md calls a
**Situation** (§5). `combo_edges` is the junction.
- `combos`: `id`, `name`, `description`, `created_by`, `created_at`.
- `combo_edges`: `id`, `combo_id` (FK), `edge_id` (FK), `added_at`.

### `tunnel_links`
Bidirectional cross-graph connections between two edges — chaos.md's cost/benefit
**tunnels** (§6 distinguishes these doc-grounded tunnels from the internal lifecycle
map's reasoning-validated tradeoff tunnels, which are **not** in this DB).
- `id` — PK.
- `origin_edge_id`, `linked_edge_id` — FK `edges(id)`.
- `comment` — TEXT, nullable; the relationship rationale.
- `created_by`, `created_at`.

---

## 2. What chaos.md needs that does NOT yet exist

The rubric assumes several stores the current schema has no table or column for.
**None of these are created in this stage** — this is the gap report the goal asked
for. Each entry: what the rubric wants, where it's invoked, and the rough shape it
would take (for a later, reviewed stage).

### 2a. A papers / sources table — **MISSING**
chaos.md repeatedly treats a *paper* as a first-class object: the corpus is fetched
and deduped (§7.2, §8.2), papers are placed in the lifecycle map (P10), recurrence is
counted per concept across papers (P13), and citation edges connect papers (§7, P11).
Today the only representation of an external document is a `concept_links` row — a URL
bound to one edge, with no identity of its own. The same paper linked on three edges
is three unrelated rows; there is nothing to dedupe against, count recurrence over, or
hang citations off.
- **Needed:** a `papers` (or `sources`) table with a stable identity (DOI / arXiv id /
  normalized URL), title, fetched metadata, and discipline tags. `concept_links` would
  then reference a paper id rather than (or in addition to) a raw URL.
- **Status:** does not exist. Report only.

### 2b. A citations table (paper → paper) — **MISSING**
chaos.md §7.8 ("citation tracking") and P11 ("temporal depth") require recording that
paper A advances/cites paper B, to build a progression axis. There is no table for
inter-paper relationships of any kind. (It cannot be modeled on `tunnel_links`, which
connects *edges* in the concept graph, not papers.)
- **Needed:** a `paper_citations` table — `citing_paper_id`, `cited_paper_id`,
  depends on 2a existing first.
- **Status:** does not exist. Report only.

### 2c. A per-concept recurrence count — **MISSING**
P13 ("recurrence is the corpus's vote") and the §9 `recurrence_tracking` knob require
tracking how many times each concept has been independently re-exemplified by fresh
papers. No such counter or derivable source exists today: with no papers table (2a),
"independent re-exemplification" can't even be computed from `concept_links` reliably
(duplicate URLs are allowed and there's no paper identity to count distinct papers by).
- **Needed:** either a `recurrence_count` column on a concept-context (likely on
  `edges`, since identity is contextual — P1) or a derived count over a papers↔concepts
  grounding table. Depends conceptually on 2a.
- **Status:** does not exist. Report only.

### 2d. A dedicated Chaos seed user account — **MISSING (not verified to exist)**
§8 "Operational notes" specifies that Chaos's contributions are attributed to a
**dedicated seed account**, not a personal account, for clean provenance and handoff.
The `users` table exists and `created_by`/`added_by` columns are ready to carry such an
id, but there is no evidence a Chaos-specific user row has been provisioned. (The
snapshot does not read `users`, so this stage cannot confirm or deny a specific row —
flagged as a provisioning gap to settle before any write stage.)
- **Needed:** one `users` row reserved for Chaos, whose id is the `created_by` /
  `added_by` for every Chaos-applied proposal.
- **Status:** not provisioned / unverified. Report only — no user is created here.

### 2e. A proposal-staging table — **MISSING (by design, for now)**
The pipeline (§8 steps 6–8) emits proposals to a **review file**, gates on human
review, then applies accepted items. Today there is no staging table, and chaos.md's
current design deliberately uses a file, not the DB, for the review gate. So this is a
"does not exist" that may stay a file rather than becoming a table — but it is recorded
here because the goal asked for it explicitly, and a future Phase-B (auto-write
low-risk outputs, §8) might want a queue table with proposal status.
- **Needed (if promoted from file to DB):** a `chaos_proposals` table — proposal type,
  payload (JSON), status (pending/accepted/rejected/modified), reason, run id.
- **Status:** does not exist; currently intended as a review file, not a table.

---

## 3. Summary

Chaos can fully read the **current** graph today: concepts, edges (by domain), links,
situations, and tunnels all snapshot cleanly and the counts reconcile against `psql`.

What's missing is everything the rubric needs to model **papers over time** — a papers
table (2a), inter-paper citations (2b), and per-concept recurrence (2c) — plus the
operational pieces a write stage will need: a dedicated seed account (2d) and, if the
review gate ever moves into the DB, a proposal-staging table (2e). All five are
reported here and **not built** in this stage.
