# Phase 72 — Curated Communities

**Status:** Planned (spec for implementation). 72a is the first sub-phase.
**Design sessions:** October 6 and October 19, 2026
**Mockups:** keep in `docs/mockups/` (reader view, edit mode, parent view, graph view). Mockups show layout only — the existing Orca UI style rules in `CLAUDE.md` always apply.

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
