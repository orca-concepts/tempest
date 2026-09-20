# Phase 71 — Community Pages

**Status:** Planned (spec for implementation)
**Author:** design session, 2026-09-20

## Summary

Add **communities** (a.k.a. community pages): a way to carve the single Orca graph into
per-discipline / per-research-community partitions. Opening a community shows only the
concepts (questions) entered in that community. Cross-pollination is provided by a
lightweight **exact-name bridge**: if a question's normalized name also exists in another
community, the concept page flags it ("also asked in …") and links to that community's
copy.

This is a **partition** model, not an overlay: each community has its own concept nodes.
The same question text in two communities = two independent concept rows; sameness is
discovered by string match, not by shared identity.

## Core insight (why this is not a rewrite)

A `graph_path` is a chain of concept IDs that all belong to one community (concept
identity is community-scoped). Therefore **every path-scoped / id-scoped query is
automatically community-safe** — `getConceptWithChildren`, the Phase 69 cross-sibling
scan, upward link aggregation, flip view, vote sets — none of them change. Only the
**three entry points** that reach concepts by *name* or list *all roots* need an explicit
community filter:

1. `getRootConcepts` (list roots)
2. `searchConcepts` (find by name)
3. the create-reuse lookups in `createRootConcept` / `createChildConcept`

## Decisions locked (design session)

1. **Different nodes per community.** Concept identity is community-scoped; no cross-community reuse.
2. **Exact string matching** for the bridge, normalized: lowercase + trim + whitespace-collapse + **strip trailing `?`/`.`/`!`**. (pg_trgm "similar" tier deferred.)
3. **No global space** — all content lives in a community. Existing data bootstraps into a single **"General"** community.
4. **No governance** — anyone logged in can create a community and add to any community. No roles, no owner-gating on use. **"No deletions" = no user deletions**; moderation (`is_hidden`), community flags, and `legal_hold` still apply and are not opt-out. Communities are not user-deletable.
5. **Bridge click → decontextualized flip view** (`/concept/:id?view=flip`, identical to a search-result click), **with a fallback to the root page** (`/concept/:id`) when the target concept has no non-root placement (because `getConceptParents` excludes root edges, a root-only question would otherwise land on an empty flip view). This is option (b).

## Out of scope / stays inactive

Per current project direction, these are **retired/UI-dormant** and are NOT touched or
surfaced by this feature: the multi-attribute model (`question` is the only attribute),
the AI seeding effort (Chaos/Koios), **Situations** (combos), and **Tunnels**
(`TunnelView`, `tunnel_links`, `/api/tunnels`). Because tunnels are dead, the earlier
"restrict tunnels to same-community" question is moot.

---

## Phase 71a — Backend foundation

### Schema (`backend/src/config/migrate.js`, idempotent style)

```sql
-- communities
CREATE TABLE IF NOT EXISTS communities (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,   -- provenance only; LEFT JOIN convention
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_slug ON communities (LOWER(slug));
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_name ON communities (LOWER(name));

-- scope concepts + add the match key
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS community_id INTEGER REFERENCES communities(id);
ALTER TABLE concepts ADD COLUMN IF NOT EXISTS normalized_name TEXT
  GENERATED ALWAYS AS (
    regexp_replace(regexp_replace(lower(btrim(name)), '\s+', ' ', 'g'), '[?.!]+$', '')
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_concepts_community ON concepts (community_id);
CREATE INDEX IF NOT EXISTS idx_concepts_norm ON concepts (normalized_name);
-- name unique WITHIN a community (replaces old global reuse-by-name)
CREATE UNIQUE INDEX IF NOT EXISTS idx_concepts_community_name
  ON concepts (community_id, LOWER(name));
```

- `concepts.community_id` is **authoritative**. Do NOT add `community_id` to `edges` —
  edges inherit community from their concepts and the root/children queries already JOIN
  `concepts`. (Denormalize onto `edges` only if profiling later demands it.)
- The `normalized_name` expression is immutable (`lower`/`btrim`/`regexp_replace`), so it
  is valid as a `GENERATED ALWAYS … STORED` column.

### Bootstrap migration (one-time, in `migrate.js` after the ALTERs)

```sql
-- create General if absent, backfill all existing concepts, then enforce NOT NULL
INSERT INTO communities (name, slug, description)
  SELECT 'General', 'general', 'Default community for pre-existing questions.'
  WHERE NOT EXISTS (SELECT 1 FROM communities WHERE LOWER(slug) = 'general');
UPDATE concepts SET community_id = (SELECT id FROM communities WHERE LOWER(slug) = 'general')
  WHERE community_id IS NULL;
ALTER TABLE concepts ALTER COLUMN community_id SET NOT NULL;
```

Run order matters: add nullable column → backfill → set NOT NULL. Follows the
CLAUDE.md rule about running `npm run migrate` before restarting the backend.

### Query-path changes (`conceptsController.js`)

- **`getRootConcepts` (line 5).** Accept active `communityId` (query param). Add
  `AND c.community_id = $2` to the WHERE at line 33. Return 400 if `communityId` missing.
- **`searchConcepts` (line 368).** Accept `communityId`. Add `AND c.community_id = $N`
  to both the `exact_matches` and `similar_matches` CTEs. (The `attrFilter` block is
  vestigial under question-only; leave it untouched.)
- **`createChildConcept` (line 522).** Derive community from `graphPath[0]`'s concept
  (fetch alongside the existing root-edge attribute query at line 538). Scope the reuse
  lookup at line 557 to `WHERE LOWER(name) = LOWER($1) AND community_id = $C`; include
  `community_id` in the `INSERT INTO concepts`.
- **`createRootConcept` (line 662).** Accept `communityId` in the body. Scope the reuse
  lookup at line 684 by community; include `community_id` in the `INSERT INTO concepts`;
  the "already exists" checks become within-community.

`getConceptWithChildren`, `getConceptParents`, `getVoteSets`, `getSubtree`, and all link
/ vote / mention controllers are **unchanged** (path/id-scoped ⇒ community-safe).

### Bridge endpoint

`GET /api/concepts/:id/bridges` — for the concept being viewed, find same-normalized-name
concepts in *other* communities, and precompute the click destination (option b):

```sql
SELECT c.id                       AS concept_id,
       c.community_id,
       comm.name                  AS community_name,
       comm.slug                  AS community_slug,
       EXISTS (
         SELECT 1 FROM edges e
         WHERE e.child_id = c.id AND e.parent_id IS NOT NULL AND e.is_hidden = false
       )                          AS has_nonroot_placement   -- true → flip, false → root
FROM concepts c
JOIN communities comm ON comm.id = c.community_id
WHERE c.normalized_name = (SELECT normalized_name FROM concepts WHERE id = $1)
  AND c.community_id <> (SELECT community_id FROM concepts WHERE id = $1)
ORDER BY comm.name;
```

Response per match: `{ conceptId, communityName, communitySlug, viewMode }` where
`viewMode = has_nonroot_placement ? 'flip' : 'root'`. Frontend routes to
`/concept/:conceptId?view=flip` or `/concept/:conceptId` accordingly. Guest-accessible.
(Refinement, not MVP-blocking: a target whose every edge is hidden is effectively
invisible; can be filtered later.)

### Community CRUD (`communitiesController.js` + `routes/communities.js`, mounted in `server.js`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/communities` | Guest | List all (browse landing). Include concept/root counts. |
| GET | `/api/communities/:slug` | Guest | One community; used to resolve slug → id for scoped root/search calls. |
| POST | `/api/communities` | Yes | Create. Validate name (≤255), generate unique slug, case-insensitive name uniqueness (409 on clash). |

Threaded params: `GET /concepts/root?communityId=`, `GET /concepts/search?...&communityId=`,
`POST /concepts/root` body `{ name, attributeId, communityId }`.

Conventions to honor: `authenticateToken = require('../middleware/auth')` (never
destructure); `req.user.userId` on backend; LEFT JOIN when joining `users` via the
SET NULL `created_by`; every `Promise.all` member in frontend loaders gets `.catch()`.

---

## Phase 71b — Frontend

### Routing / surfaces

- **`/` → Communities browse** (new landing; replaces the current root-concept list as
  the top-level page). Cards: name, description, counts. "Create community" (auth only).
- **`/c/:slug` → inside a community**: that community's root questions = scoped
  `getRootConcepts`. This establishes the **active community** context that drives the
  create-root action and which roots/search results appear.
- **`/concept/:id?path=` and `?view=flip` → unchanged.** Community is derivable from the
  concept; the Phase 65a deep-link machinery keeps working.
- **Active-community context** lives in AppShell app state, derived from route. Create
  actions (`SearchField`) and root listing (`Root.jsx`) read it and pass `communityId`.

### Bridge badge

- On the concept page header (`Concept.jsx` → `ConceptLinksPanel` or the header area),
  fetch `GET /api/concepts/:id/bridges` and render "Also asked in: **B**, **C**" when
  non-empty. Click → navigate per `viewMode` (flip or root) into that community.
- Styling per house rules: inline styles, EB Garamond, warm off-white bg, black text,
  no colored buttons, no emoji/italics, plain Unicode arrows only.

### Components

- New `CommunitiesBrowse.jsx` (landing) and a `CreateCommunityModal.jsx`.
- `Root.jsx` / `SearchField.jsx` gain `communityId` plumbing (they already self-hide the
  attribute picker under question-only — no attribute UI work).

---

## Phase 71c — Polish (optional, post-MVP)

- Per-child bridge badge in `ConceptGrid` (correlated subquery mirroring the Phase 69
  `link_count` at `conceptsController.js:89`) so the flag is visible while browsing.
- "Follow" communities for sidebar quick-access — reuse the polymorphic `sidebar_items`
  pattern (`item_type: 'community'`). Nav convenience, NOT a permission.
- Communities-as-tab-containers deeper integration in AppShell if the flat model proves
  limiting.
- pg_trgm "similar questions" tier alongside the exact bridge.

---

## Testing (ORCA_TESTS.md)

Run Level 1 after each change (Section 0 Build & Startup always; plus Concepts, Votes,
Web Links, Sidebar). Feature-specific checks to add:

- Migration runs (`node src/config/migrate.js`) then `\d concepts` shows `community_id`
  (NOT NULL) + `normalized_name`; `\d communities` exists; "General" row present and all
  legacy concepts backfilled.
- Root list, search, and create are all scoped to the active community (no leakage).
- Creating the same question name in two communities yields two concept rows.
- Bridge endpoint returns the other-community match with correct `viewMode`
  (flip when a non-root placement exists, root when root-only).
- Guests can browse communities and see bridges; cannot create/add.
- Moderation hide and `legal_hold` still function inside a community.

## Open questions

None blocking. Deferred: hidden-only-target filtering on bridges; whether the browse
landing needs sort/search at launch.
