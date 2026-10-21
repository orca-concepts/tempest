# Phase 72 — Curated Communities

**Status:** Planned (spec for implementation). 72a is the first sub-phase.
**Design sessions:** October 6 and October 19, 2026
**Mockups:** `docs/mockups/` — `reader-leaf-view.png`, `reader-parent-view.png`, `edit-mode-leaf-view.png`, `graph-view.png`. Mockups show layout only — the existing Orca UI style rules in `CLAUDE.md` always apply.

## Summary

Add a second community mode, **curated**, so a journal can own a community built from its published papers, share it by link, and collect structured reader feedback. The existing behavior becomes the **open** mode and is unchanged except where noted (answer section in cards, graph view).

| | Open (today) | Curated (new) |
|---|---|---|
| Who adds/edits structure | Any logged-in user, append-only | Owners only; edit and delete allowed |
| Votes, vote sets, swaps, flags | Yes | No (hidden in UI, rejected by API) |
| Answers on questions | Links (multiple, voted) | Answers: comment + link + publication date (multiple) |
| Sibling ordering | Save votes / newest | Recency (publication date, see sorting rule) |
| Precedent / subsequent links | No | Yes, between siblings |
| Reader participation | Voting, adding | Feedback threads |

Existing communities are all test data; nothing needs migrating beyond defaults.

## Locked decisions

1. **Mode** is chosen at community creation (`open` or `curated`) and cannot change afterwards.
2. **Owners.** A `community_owners` table. The creator becomes the first owner (in both modes; ownership only grants powers in curated). Owners can add other owners. The last owner of a curated community cannot be removed and cannot delete their account until they add another owner.
3. **Anyone logged in can create a community** of either mode. Communities are shared by link (`/c/:slug`) — journals post that link on their site.
4. **Navigation stays page-based** with path-dependent identity. Precedent/subsequent links and answers live on edges.
5. **Answers:** each question (edge) can carry **multiple** answers (comment, link URL, publication date), ordered newest-first. No leaf/non-leaf distinction in the data — owners simply don't add answers to non-leaf questions.
6. **Recency sorting (curated):** siblings sort by sort-date, newest first. A question's sort-date is its newest answer's publication date; a question without answers uses its newest descendant's date; fallback is the edge's `created_at`.
7. **Precedent / subsequent:** directional links between **sibling** edges only (same parent and `graph_path`, enforced server-side). Stored once (A precedes B), shown on both cards. Removing from either card removes the row. Direct A↔B loops are rejected. Edit mode shows a soft warning when a subsequent's sort-date is earlier than its precedent's.
8. **Renaming** a question changes the concept's name everywhere it appears in the community. Edit mode notes "also appears under X". A rename that collides with an existing name in the community is rejected with a clear message.
9. **Deletes in curated are soft** (`deleted_at`), cascading to the edge's subtree, so feedback threads on removed questions can be archived rather than lost.
10. **Edit / view toggle** in the header, visible only to owners, default view. Edit mode: dotted outlines, click-to-edit fields, plus/X icons for precedent/subsequent and answers, bottom-corner plus to add a child.
11. **Graph view:** header button opens the whole graph from the root as a collapsible tree (reusing `VotesOverlay` tree rendering), answers as nested rows, current position highlighted, click to navigate. Available in both modes.
12. **Answer section in cards** replaces the side links panel — curated first (72b), open graphs later (72f; card shows top-voted link + count, expands to the full list).
13. **Feedback (curated only):** per-card feedback icon (suggest edits to the question or an answer; suggest adding/removing a precedent or subsequent link) and a page-level icon (suggest a new child, optionally with nested children — a whole branch). Every item has free-text comments and is a public thread. Readers can reply; owner replies are marked. Statuses: open, incorporated, declined. Readers can vote on feedback items; votes show only inside the feedback menu and sort feedback there, never the graph. Items snapshot the text they were written against. Login required to submit/reply/vote; guests can read. Owners get a feedback inbox for the community and count badges.

## Sub-phases

- **72a — Mode, owners, share link, write gating** (this spec, below)
- **72b — Answers + card answer section (curated) + recency sorting**
- **72c — Edit mode: inline editing, soft delete, precedent/subsequent links**
- **72d — Graph view (both modes)**
- **72e — Feedback system + owner inbox**
- **72f — Card answer section for open graphs**
- Later: one-click "incorporate" for structured suggestions; email notifications to owners.

Docs to revise alongside: ToS and Copyright Policy (editorial ownership, public feedback); the append-only AD (curated exception).

---

## Phase 72a — Mode, owners, share link, write gating

### Schema (`backend/src/config/migrate.js`, idempotent)

```sql
ALTER TABLE communities ADD COLUMN IF NOT EXISTS mode VARCHAR(16) NOT NULL DEFAULT 'open';
-- CHECK constraint (add only if absent): mode IN ('open', 'curated')

CREATE TABLE IF NOT EXISTS community_owners (
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_owners_user ON community_owners (user_id);

-- Backfill: every community's creator becomes an owner (skip NULL created_by).
INSERT INTO community_owners (community_id, user_id)
  SELECT id, created_by FROM communities WHERE created_by IS NOT NULL
  ON CONFLICT DO NOTHING;
```

### Shared permission helper (new `backend/src/utils/communityAccess.js`)
- `getCommunityForConcept(conceptId)`, `getCommunityForEdge(edgeId)`, `getCommunityForLink(linkId)` → `{ id, mode }`.
- `isOwner(communityId, userId)`.
- `assertCanWriteStructure(community, userId)` → open: allowed; curated: owner only. On failure: `403 { error, code: 'curated_owner_only' }`.
- `assertVotingAllowed(community)` → curated: `403 { error, code: 'curated_no_votes' }`.
- Follows the never-throw-to-client convention: controllers translate helper results into responses.

### Endpoints

**Communities**
- `POST /api/communities` accepts `mode` (`open` default, or `curated`; 400 otherwise). Inserts the creator into `community_owners` in the same transaction.
- `GET /api/communities` and `GET /api/communities/:slug` return `mode`, and (when logged in) `isOwner`. `:slug` also returns `owners: [{ userId, username, orcidId }]`.
- `POST /api/communities/:id/owners/add` (owner only) body `{ username }` → 404 if no such user, idempotent if already owner.
- `POST /api/communities/:id/owners/remove` (owner only) body `{ userId }` → 400 `last_owner` if it would leave zero owners. An owner may remove themselves if another owner remains.

**Concepts:** `GET /api/concepts/:id` additionally returns `communityId`, `communityMode`, `isCommunityOwner`.

**Write gating — structure** (use `assertCanWriteStructure`):
`POST /concepts/root`, `POST /concepts/child`, `POST /concepts/nest-under-sibling`, `POST /votes/web-links/add`, `POST /votes/web-links/copy`, `POST /votes/web-links/:linkId/addenda`. Self-authored link removal (`/web-links/remove`) keeps its existing author check.

**Write gating — votes and flags** (use `assertVotingAllowed`):
`POST /votes/add`, `/votes/remove`, `/votes/swap/add`, `/votes/swap/remove`, `/votes/link/add`, `/votes/link/remove`, `/votes/web-links/upvote`, `/votes/web-links/unvote`, `/moderation/flag`, `/moderation/vote`.

**Account deletion:** `POST /api/auth/delete-account` returns 400 with the list of curated communities where the user is the sole owner (same pattern as the existing owned-combos pre-check).

### Frontend
- **Create community** (`CommunitiesBrowse.jsx`): mode choice (Open / Curated) with a one-line explanation of each. Browse list shows a plain-text "Curated" label on curated communities.
- **Share link:** `/c/:slug` route handled in AppShell (like the other deep links: added to `hasDeepLinkInUrl`). It resolves the slug, selects the community (same path as choosing it in Communities), opens its root page, then replaces the URL with `/`. Unknown slug → existing "unavailable link" toast. Works for guests. A "Share" control in the community header copies `https://orcaconcepts.org/c/<slug>` (origin-relative locally).
- **Curated, non-owner (and guests):** hide every add/create affordance (root/child create in `SearchField`, add-link form, nest-under-sibling, copy link) and every vote/flag affordance (save ▲, swap, vote-set bar and dots, Flip View similarity votes, link upvotes, flag). Read and navigation stay identical.
- **Curated, owner:** create affordances visible; vote/flag affordances hidden.
- **Owners panel** (owners only): reachable from the community header; lists owners, add by username, remove (disabled for the last owner).
- **Open communities:** no visible change except the mode label in the create form.

### Non-goals (72a)
Answers and publication dates, recency sorting, edit mode, soft delete, rename, precedent/subsequent links, graph view, feedback, open-graph card changes, OG preview cards for `/c/:slug`.

### Tests to add to ORCA_TESTS.md
- Migration runs twice cleanly; `\d communities` shows `mode`; `\d community_owners` exists; creators backfilled.
- Create open and curated communities; creator is owner of both.
- In a curated community, a non-owner gets 403 `curated_owner_only` on create root/child/nest/add link/copy link, and 403 `curated_no_votes` on every vote and flag endpoint; an owner can create but still gets `curated_no_votes`.
- Open communities behave exactly as before.
- Owners add/remove, including the last-owner rule.
- `/c/:slug` opens the community for a guest and a logged-in user; bad slug shows the toast.
- Account deletion blocked for a sole curated owner.

---

## Phase 72b — Answers, in-card answer section, recency sorting (curated)

### Data model: answers are `concept_links` rows
Answers reuse `concept_links` (url, title, comment, added_by, edge_id) so Safe Browsing, OG title fetch, share URLs (`/link/:id`), legal removal, and `link_removal_log` all keep working. One new column:

```sql
ALTER TABLE concept_links ADD COLUMN IF NOT EXISTS published_on DATE;
```

- Curated communities: `published_on` is **required** when adding an answer (400 `published_on_required` otherwise). Valid ISO date (`YYYY-MM-DD`), not more than one year in the future.
- Open communities: accepted but optional and not displayed (open-mode answer UI is 72f).
- An edge may have any number of answers; they display newest `published_on` first (ties: newest `created_at`).

### Endpoints
- `POST /api/votes/web-links/add` accepts `publishedOn`. Existing gates apply (curated: owners only).
- `GET /api/votes/web-links/:edgeId` returns `publishedOn` per link.
- `POST /api/votes/web-links/remove`: in a **curated** community, any owner may remove any answer in that community (still blocked by `legal_hold`; still one atomic DELETE; still writes `link_removal_log`). Open communities keep the author-only rule.
- `GET /api/concepts/:id` and `GET /api/concepts/root`: in curated communities each child/root row includes `answers: [{ id, url, title, comment, publishedOn, addedByUsername, authorOrcidId, createdAt }]` (visible links only: `legal_hold = false`), newest first, and `sortDate`. Open communities: unchanged (no `answers` array).

### Recency sorting (curated only)
Siblings (children of one page, and the root list) are ordered by `sortDate` DESC, then edge `created_at` DESC:
1. the newest `published_on` among answers on the child's own edge; else
2. the newest `published_on` among answers on any **descendant** edge of that child (path-scoped: descendant edges are those whose `graph_path` starts with the child's full path, i.e. `[...P, childId]`, or `[childId]` for a root); else
3. the child edge's `created_at`.
Computed in SQL. The existing `sort` parameter is ignored in curated communities. Hidden edges and legal-held links are excluded.

### Frontend (curated communities)
- **Answer section in each card** (ConceptGrid, children and root grids): under the question text, each answer shows its title as a link (new tab, `rel="noopener noreferrer"`), the publication date, and the comment (clamped, via `LinkifiedText`). No vote controls. Cards with no answers show no answer section (no placeholder text for readers).
- **Owners:** each card has a small "Add answer" control opening an inline form: URL (title preview on paste/blur, reusing the existing preview endpoint), title, comment, publication date (`<input type="date">`), and the existing required affirmation checkbox. Each answer row has a "Remove" control with an inline confirm (no browser `confirm()` dialogs). 72c moves these into edit mode.
- **The side links panel is hidden in curated communities' children view.** Flip View is unchanged.
- **Deep links:** `/link/:id` to a curated answer scrolls to and highlights that answer row inside its card (reusing the `pendingScrollLinkId` pattern), since the side panel is hidden.
- **Open communities:** no visible change.

### Non-goals (72b)
Edit mode and inline editing of answers or questions, soft delete, precedent/subsequent links, graph view, feedback, open-mode answer UI, displaying `sortDate` on cards.

### Tests to add to ORCA_TESTS.md
- Migration twice; `published_on` column present.
- Curated: owner adds answers with dates; non-owner gets `curated_owner_only`; missing date → `published_on_required`; bad/far-future date → 400.
- Answers appear in the card newest-first; side panel hidden; open community unchanged.
- Sorting: leaf with newer answer sorts above older; a parent with no answers sorts by its newest descendant answer; an unanswered childless question sorts by creation date; root list follows the same rule.
- A second owner can remove the first owner's answer in curated; a non-owner cannot; legal-held answers cannot be removed.
- `/link/:id` for a curated answer highlights the row in its card.

---

## Phase 72c — Owner edit mode, precedent/subsequent links

72c ships in two runs: **72c-1** (edit mode, inline editing, renaming, soft delete) and **72c-2** (precedent/subsequent links). Mockups: `docs/mockups/edit-mode-leaf-view.png` (edit mode) and `docs/mockups/reader-leaf-view.png` (view mode). Layout only — house style rules apply.

### 72c-1 — Edit mode, inline editing, renaming, soft delete

**Edit / view toggle**
- Owners of a curated community see an "Edit" / "View" toggle in the page header on both the community root page and question pages. Non-owners and open communities never see it.
- State lives in AppShell, per community, defaults to View, is not persisted across reloads, and resets when the active community changes.
- **View mode** shows exactly what readers see: no Add answer, Remove, or create controls (these moved out of view mode in 72c-1).
- **Edit mode**: cards and editable fields get a dashed outline (`1px dashed`, neutral gray). Everything below is edit-mode only.

**Inline question editing (rename)**
- Clicking a question's text (card title, or the page title on its own page) turns it into an input. Enter or blur saves, Escape cancels; empty is rejected.
- `POST /api/concepts/:id/rename` body `{ name }`. Curated communities only (open → 403 `curated_only`); owners only (403 `curated_owner_only`). Renames the **concept row**, so the new text appears everywhere that question is placed in the community. A case-insensitive clash with another concept in the same community → 409 `name_taken` with the clashing question's id. Rejects legal-held concepts (403).
- When the question also appears under other parents (`altParentCount > 0`, already returned by `GET /concepts/:id`), the input shows "Also appears under N other question(s) — renaming changes it everywhere."

**Inline answer editing**
- In edit mode each answer's title, comment, URL, and publication date are click-to-edit; the per-answer Remove and the card's "+ Add answer" live here now.
- `POST /api/votes/web-links/:linkId/edit` body any of `{ title, comment, url, publishedOn }`. Curated only (open → 403 `curated_only`, since open-community comments stay immutable); owners only. Same validation as add: `publishedOn` required to remain set, URL must be http(s) and passes the Safe Browsing check when changed, title may not be emptied (fall back to OG fetch if blank). Updates `updated_at`. Rejects legal-held links.

**Adding questions in edit mode**
- A "+" control fixed at the bottom-right of the page opens an inline "New question" card at the top of the list (input, Enter to save, Escape to cancel), using the existing create root / create child endpoints.
- In curated communities the Add / Search field becomes search-only for everyone (its "Create … as root question / Add … as child" option is removed); adding happens only through edit mode.

**Soft delete**
- Edit mode shows an "✕" on each card. Clicking it shows an inline confirm on the card: "Delete this question? It has N sub-questions; they will be removed too." Yes / No (no browser dialogs).
- `POST /api/concepts/edges/:edgeId/delete` — curated only, owners only. Marks the edge and **all its descendant edges** (path-scoped: `graph_path` starts with the edge's full path) as deleted: `deleted_at = NOW()`, `deleted_by = user`, `delete_batch_id` (one UUID per delete action), **and `is_hidden = true`** so every existing visibility filter excludes them with no further query changes. The concept rows are untouched (the same question may still be placed elsewhere). Answers on deleted edges stay in the table but are unreachable. Refuses if any affected edge or link is under `legal_hold` (409 `legal_hold`). Returns the number of edges deleted.
- Moderation surfaces must never show deleted edges as moderated content: the hidden-questions list, unhide (admin and community), flag/vote/comment endpoints, and the hidden-count badges exclude rows where `deleted_at IS NOT NULL`.
- **Re-adding** a deleted question under the same parent (same parent, path, and concept) restores that one edge (clears `deleted_at`, `deleted_by`, `delete_batch_id`, `is_hidden`) instead of hitting the edges uniqueness constraint. Its old sub-questions stay deleted. A restore-batch UI is out of scope.

**Schema (72c-1)**
```sql
ALTER TABLE edges ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE edges ADD COLUMN IF NOT EXISTS delete_batch_id UUID;
CREATE INDEX IF NOT EXISTS idx_edges_deleted_batch ON edges (delete_batch_id) WHERE delete_batch_id IS NOT NULL;
```
(Use `gen_random_uuid()`; it is built into PostgreSQL 13+.)

**Non-goals (72c-1):** precedent/subsequent links, graph view, feedback, a restore UI, editing in open communities, moving a question to a different parent.

**Tests (72c-1)**
- Toggle visible only to curated owners; defaults to View; resets on community switch.
- View mode shows no edit controls even for owners.
- Rename: succeeds for owner; appears under every parent; 409 `name_taken` on clash; 403 for non-owner and in open communities.
- Answer edit: each field; Safe Browsing on URL change; cannot clear `publishedOn`; 403 in open communities.
- Delete: subtree removed from every view (grid, root list, search, Votes overlay, Flip View, counts); never appears in moderation lists; legal-hold refusal; re-adding restores just that edge.
- Curated Add / Search has no create option.

### 72c-2 — Precedent / subsequent links

**Schema**
```sql
CREATE TABLE IF NOT EXISTS question_sequence_links (
  id SERIAL PRIMARY KEY,
  from_edge_id INTEGER NOT NULL REFERENCES edges(id) ON DELETE CASCADE,  -- the precedent
  to_edge_id INTEGER NOT NULL REFERENCES edges(id) ON DELETE CASCADE,    -- the subsequent
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (from_edge_id, to_edge_id),
  CHECK (from_edge_id <> to_edge_id)
);
CREATE INDEX IF NOT EXISTS idx_qsl_to ON question_sequence_links (to_edge_id);
```

**Rules (enforced server-side)**
- Both edges are siblings: same `parent_id` and `graph_path` (root siblings: both root edges in the same community), neither deleted, community is curated.
- No direct loop: reject if the reverse link (B→A) exists (409 `reverse_exists`). Longer chains are allowed.
- Owners only. Links whose edges are deleted are excluded from reads.

**Endpoints**
- `POST /api/concepts/sequence-links/add` body `{ fromEdgeId, toEdgeId }`; `POST /api/concepts/sequence-links/remove` body `{ linkId }`.
- `GET /concepts/:id` and `GET /concepts/root` (curated): each row adds `precedents: [{ linkId, edgeId, conceptId, name }]` and `subsequents: [...]` in one extra query, no N+1.

**UI**
- Each curated card gets a two-column row below its answers: "Precedent questions" and "Subsequent questions" (mockup), listing sibling names. Clicking a name scrolls to that sibling's card and highlights it (same 2s highlight). View mode hides the row when both lists are empty.
- Edit mode: each column has "+" (opens a picker listing eligible siblings: not itself, not already linked that direction, not one that would create a direct loop) and an "✕" per entry. Empty columns show "No precedent questions" / "No subsequent questions".
- Soft warning (edit mode only): when a subsequent's `sortDate` is earlier than its precedent's, show "dated earlier than its precedent" beside that entry.

**Tests (72c-2)**
- Add/remove both directions; shown on both cards; removing from either side removes it from both.
- Non-sibling, cross-community, deleted, self, duplicate, and reverse links rejected with the right codes.
- Deleting a question hides its links on the surviving sibling.
- Picker excludes ineligible siblings; soft warning appears when dates are out of order.

---

## Phase 72d — Graph view (both modes)

Mockup: `docs/mockups/graph-view.png` (layout reference only).

### Behavior
- A **"Graph"** button in the page header (community root page and question pages), visible to everyone in both modes, opens a full-pane overlay styled like the Votes overlay (← Back, title, Expand all / Collapse all).
- **Scope:** opened from a question page, it shows that question's whole root graph (from `graph_path[0]`, or the question itself if it is a root). Opened from the community root page, it shows every root of the community.
- **Tree:** a collapsible hierarchy built from edges (path identity: a question placed under two parents appears in both places). Siblings use the same order as the grid: curated → the 72b recency rule (open questions first, then newest date); open → save count descending, then newest.
- **Rows:** question rows are clickable and navigate the current tab to that question (correct path), then close the overlay. In curated communities each question's answers appear as nested rows (↗ marker, title linking to the URL in a new tab, publication date, comment clamped to two lines). Open communities show only questions, with the existing "N links" count in muted text.
- **Current position:** when opened from a question page, the path to the current question is expanded, the current question's row is highlighted (not a color button — a light background tint consistent with the existing highlight), and scrolled into view. Other branches start expanded if the graph has ≤ 150 questions, otherwise collapsed below the current path.
- Deleted and hidden edges, and legal-held links, never appear.

### Endpoint
`GET /api/concepts/graph?communityId=&rootConceptId=` (guest-accessible)
- `communityId` required. `rootConceptId` optional: when given, return only that root's graph; otherwise every root in the community.
- Returns `{ mode, truncated, nodes: [{ edgeId, parentEdgeId, conceptId, name, graphPath, childCount, linkCount, saveCount (open only), sortDate (curated only), answers: [...] (curated only) }] }`.
- Implementation: a small, fixed number of queries (edges by path prefix or community, one answers query, one sort-date pass reusing the 72b logic) — no per-node queries. `parentEdgeId` is derived in code from `graph_path` (the edge whose child is `graph_path[last]` with path `graph_path[0..last-1]`).
- Cap at 2000 edges; set `truncated: true` if hit (the overlay shows a one-line note).
- Register before the `/:id` route in `routes/concepts.js`.

### Frontend
- New `GraphViewOverlay.jsx` (tree rendering may borrow from `VotesOverlay.jsx`'s styles; do not change VotesOverlay's behavior).
- Opened from AppShell like the Votes overlay; receives the active community, the current question and path (if any), and a navigate callback that uses the existing in-tab navigation.
- Stale-State Guard on the fetch; Escape closes; all controls are `<button>`s.

### Non-goals (72d)
Editing from the graph view, showing precedent/subsequent links in the tree, feedback, drag-and-drop, cross-community graphs.

### Tests (72d)
- Button visible in both modes, for guests and users.
- From a question page: the current question is highlighted and scrolled into view with its path expanded.
- From the root page: all roots shown.
- Curated sibling order matches the grid; answers nested with working links; open communities show questions and link counts only.
- Clicking a question navigates and closes; deleted/hidden questions absent; truncation note when capped.

---

## Phase 72e — Reader feedback (curated only)

Mockups: `docs/mockups/reader-leaf-view.png` and `reader-parent-view.png` (the page-with-pencil icon on each card and in the page's bottom corner). Layout only — house style applies; the icon is an inline SVG, not an emoji.

### Decisions (October 21, 2026)
- **Visible immediately.** Feedback is public as soon as it is posted; owners can hide items or replies.
- **Author edits until locked.** The author may edit or delete their item until it is **locked**: an owner has replied in its thread, or its status is no longer `open`. Replies follow the same rule: editable/deletable by their author until an owner replies after them or the item's status changes.
- **In-app only.** Owners learn about feedback through an inbox and count badges. No email in 72e.
- **Archived on delete.** Feedback whose target question (or, for new-question suggestions, whose parent) has been soft-deleted is **archived**: read-only, hidden from the card, listed under "Archived" in the owner inbox with its snapshot. Restoring the question un-archives it (archive state is computed from `edges.deleted_at`, not stored).
- Guests can read; posting, replying, and voting require login. Open communities have no feedback.
- Feedback votes: one upvote per user per item, toggleable. Shown only inside the feedback menu; they sort feedback, never the graph.

### Schema (72e-1)
```sql
CREATE TABLE IF NOT EXISTS feedback_items (
  id SERIAL PRIMARY KEY,
  community_id INTEGER NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  edge_id INTEGER REFERENCES edges(id) ON DELETE CASCADE,          -- the card the feedback is about; for new_child, the parent's edge (NULL = community root list)
  kind VARCHAR(24) NOT NULL,  -- edit_question | edit_answer | add_precedent | remove_precedent | add_subsequent | remove_subsequent | new_child | general
  target_link_id INTEGER REFERENCES concept_links(id) ON DELETE SET NULL,   -- edit_answer: which answer
  target_edge_id INTEGER REFERENCES edges(id) ON DELETE SET NULL,          -- sequence suggestions: the sibling
  proposal JSONB,             -- kind-specific proposed values (new question text; proposed answer fields; etc.)
  snapshot JSONB NOT NULL,    -- what the reader was looking at: question text, answer fields, sibling name
  comment TEXT,               -- free text, up to 2000 chars
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',  -- open | incorporated | declined
  status_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status_at TIMESTAMP,
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- CHECK constraints for kind and status values; indexes on (community_id, status), (edge_id).

CREATE TABLE IF NOT EXISTS feedback_replies (
  id SERIAL PRIMARY KEY,
  feedback_id INTEGER NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_owner_reply BOOLEAN NOT NULL DEFAULT false,   -- author was a community owner when posting
  body TEXT NOT NULL,                               -- up to 2000 chars
  is_hidden BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
-- index on feedback_id

CREATE TABLE IF NOT EXISTS feedback_votes (
  feedback_id INTEGER NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (feedback_id, user_id)
);
```
72e-2 adds `feedback_suggested_nodes` (below).

### Kinds and validation (server-side)
| kind | target | proposal | Rule |
|---|---|---|---|
| `edit_question` | `edge_id` | `{ name }` | non-empty, ≤255 |
| `edit_answer` | `edge_id`, `target_link_id` | any of `{ title, comment, url, publishedOn }` | link must be on that edge; URL http(s) + Safe Browsing; date valid |
| `add_precedent` / `add_subsequent` | `edge_id`, `target_edge_id` | — | target is a sibling (72c-2 rules), not already linked that way |
| `remove_precedent` / `remove_subsequent` | `edge_id`, `target_edge_id` | — | that link currently exists |
| `general` | `edge_id` | — | `comment` required |
| `new_child` | parent `edge_id` or NULL | 72e-2 | 72e-2 |
- Community must be curated (403 `curated_only`); target edges must be live (not deleted) and in that community.
- `snapshot` is built by the server from current data, never trusted from the client.
- `comment` optional except for `general`; ≤2000 chars. Rate-limited with the existing per-user limiter.

### Endpoints (72e-1) — new `feedbackController.js` + `routes/feedback.js`, mounted at `/api/feedback`
- `GET /edge/:edgeId` (guest) — live feedback for one card: items (not hidden) with snapshot, proposal, comment, author (username + ORCID badge data), status, vote count, `userVoted`, `locked`, `canEdit`, and replies (not hidden; owner replies flagged). Sorted: `open` first, then votes desc, then newest. Owners also receive hidden items and replies, flagged `isHidden`.
- `GET /edge/:edgeId/count` is not needed if `GET /concepts/:id` and `/root` return `openFeedbackCount` per curated row (one extra grouped query).
- `POST /` — create (body: `edgeId`, `kind`, `targetLinkId?`, `targetEdgeId?`, `proposal?`, `comment?`).
- `POST /:id/edit` / `POST /:id/delete` — author only, unlocked only (409 `locked`). Delete is a hard delete (self-authored content).
- `POST /:id/replies` — any logged-in user; `is_owner_reply` set server-side. `POST /replies/:replyId/edit` and `/delete` — author only, unlocked only.
- `POST /:id/vote` — toggle; returns `{ voted, voteCount }`.
- `POST /:id/status` — owners only; body `{ status: 'open' | 'incorporated' | 'declined', reply? }` (optional reply posted as an owner reply in the same transaction).
- `POST /:id/hide`, `POST /replies/:replyId/hide` — owners (and the site admin) only; body `{ hidden: true | false }`.
- Archived items (target edge deleted) reject every write with 409 `archived`.

### UI (72e-1)
- Each curated card shows a feedback icon button with the open count when > 0 (e.g. icon + "3"). Visible to everyone, in view mode and edit mode.
- Clicking opens a **feedback panel** for that card (an overlay or side panel consistent with existing overlays; Escape closes):
  - Header: the question text.
  - "Suggest a change" (login required; guests see a "Log in to suggest a change" prompt): choose a kind, then kind-specific fields — proposed question text (prefilled); which answer + proposed fields (prefilled); which sibling (eligible list, as in the 72c-2 picker); or just a comment for "Something else". Free-text comment box on every kind.
  - The list of feedback items: kind label ("Suggested rewording", "Suggested answer change", "Suggested precedent", …), what was proposed vs the snapshot (plain before → after text), comment, author + ORCID badge, time, status label, vote button with count, replies (owner replies marked "Owner"), reply box, and edit/delete for the author while unlocked.
  - Owners additionally see status controls (Mark incorporated / Decline / Reopen, each with an optional reply) and Hide / Unhide on items and replies.
- No browser dialogs; all controls `<button>`s; house style.

### 72e-2 — New-question/branch suggestions, owner inbox, badges
- **Schema:**
```sql
CREATE TABLE IF NOT EXISTS feedback_suggested_nodes (
  id SERIAL PRIMARY KEY,
  feedback_id INTEGER NOT NULL REFERENCES feedback_items(id) ON DELETE CASCADE,
  parent_node_id INTEGER REFERENCES feedback_suggested_nodes(id) ON DELETE CASCADE,  -- NULL = top of the suggested branch
  name VARCHAR(255) NOT NULL,
  answer_url TEXT, answer_title VARCHAR(255), answer_published_on DATE, answer_comment TEXT,
  position INTEGER NOT NULL DEFAULT 0
);
```
- **Page-level icon** (bottom corner of the community root page and each question page, mockup): opens a panel listing existing `new_child` feedback for this page and a **branch builder**: one or more suggested questions, each optionally with its own children (nested to any reasonable depth, cap 50 nodes) and an optional answer (URL with Safe Browsing, title, date, comment), plus a free-text comment. Stored as one `new_child` item plus its nodes.
- **Owner inbox:** an "Inbox" button in the curated community header for owners, with the open count. Overlay listing every feedback item in the community with filters Open / Incorporated / Declined / Archived, sorted newest first (votes shown), each linking to its card (navigate + open that card's panel). Archived items show their snapshot and are read-only.
- **Badges:** open counts on card icons (from 72e-1) and on the page-level icon; the Inbox button shows the community's total open count.

### Non-goals (72e)
One-click "incorporate" (applying a suggestion automatically), email notifications, feedback in open communities, feedback on the graph view.

### Tests (72e)
- Create each kind; validation errors; open community rejected; guest read-only.
- Snapshot reflects data at submit time even after the owner edits the question.
- Author edit/delete until an owner replies or status changes, then 409 `locked`.
- Votes toggle; sorting open → votes → newest.
- Owner status changes (with reply), hide/unhide items and replies; hidden items invisible to non-owners.
- Deleting the target question archives its feedback (read-only, 409 `archived`); re-adding the question un-archives it.
- 72e-2: branch suggestions with nested nodes and answers; inbox filters and counts; navigation from inbox to the card's panel.
