# Phase 73 — Restructuring curated graphs: group, move into, ungroup

**Status:** planned (spec written November 4, 2026).
**Mode:** curated communities only, owners only, in Edit mode.

## Why

Journals will build their graphs **bottom-up**:
1. Collect leaf questions from a lookback period of their publications (each with its answer).
2. Group the leaves under goal questions, so each common goal is stated and the gap is visible as room for new work.
3. Repeat upward until the roots are reached.

That needs three structural moves at any level of a graph, including the community root list:
- **Group under a new question:** insert a new parent above a selection of siblings.
- **Move into…:** put a selection of siblings under an existing sibling.
- **Ungroup:** dissolve a question, moving its children up one level.

All three are **moves, not copies**. Edge rows keep their ids, so answers, feedback, and precedent/subsequent links stay attached.

## Decisions (November 4, 2026)

- **All three actions ship together.** They share one path-rewrite routine.
- **Selecting one question is allowed** for grouping. This inserts a level above it.
- **Sort rule unchanged.** A new goal question with answered descendants sorts as answered, by its newest descendant date (72b rule). The open-first section stays reserved for true gaps.
- **Nest-under-sibling becomes open-communities only.** It copies subtrees, which doesn't fit owner-curated graphs; Move into… replaces it there.
  - Backend: `POST /concepts/nest-under-sibling` returns 403 `{ code: 'open_only' }` when the community is curated, for owners too.
  - Frontend: the right-click "nest under sibling" entry is hidden in curated communities.

## UI

### Selection
- In Edit mode, every card on a curated page (community root list and question pages) shows a checkbox in its top-left corner.
- Selection is local state. It is cleared on leaving Edit mode, on navigation, and after any successful action.

### Action bar
- Shown while one or more cards are selected.
- Positioned above the fixed Add / Search bar, styled like the existing nest bar.
- Reads: **"N selected · Group under a new question · Move into… · Clear"**.

### Group under a new question
1. Opens an inline form, styled like `NewQuestionCard`, with a text field for the goal question.
2. A **preview line** from a dry run, for example: *"Creates 'X' here and moves 2 questions (and their 7 descendants) under it. 1 precedent link will be removed."*
3. **Confirm** / **Cancel** buttons.
4. On success, the page refreshes silently and scrolls to the new card with the 2s yellow highlight used for precedent links (`qcard-<edgeId>`).

### Move into…
1. A picker of eligible siblings: siblings that are not selected.
2. Then the same dry-run preview line, then Confirm / Cancel.
3. On success, the target card is highlighted.

### Ungroup
- An edit-mode control on any card whose question has at least one child.
- Opens an inline confirm with a dry-run preview, for example: *"Moves its 3 children up to this level and removes 'X'. Its 1 answer will be removed with it. 1 precedent link will be removed."*
- The removed question is soft-deleted (72c-1), so it can be restored by re-adding the same question at this level. Restoring brings back the question with its own answers only; its old children stay where they now are.

### Errors
Shown inline in the bar, form or confirm, in plain words. No `alert` or `confirm` dialogs.

## Backend

All three endpoints go in `routes/concepts.js` and `conceptsController.js`.

**Shared rules:**
- Authenticated.
- `communityAccess` helpers: `curated_only` (403) outside curated communities, `curated_owner_only` (403) for non-owners.
- Each runs in one transaction, locks the affected edge rows (`FOR UPDATE`), and accepts `dryRun: true`.
- A dry run performs every check and returns the preview counts without writing:
  - `{ movedCount, descendantCount, removedSequenceLinks: [{ linkId, fromName, toName }], answersRemoved }`.
- Cap: 1000 affected edges (400 `too_large`), as in nest-under-sibling.

### Path rewrite (shared helper)

`graph_path` is root-to-parent inclusive. Moving a selected edge **E** (concept **C**, path **G**) from its parent to a new parent concept **N** works like this:

1. **E itself** gets `parent_id = N` and `graph_path = G || N`. At the root level, G is `{}`, so the path becomes `{N}`.
2. **Every descendant edge** whose `graph_path` begins with `G || C` keeps everything after G, with N inserted after G. Path-scoped matching only (CLAUDE.md); never match by concept id alone.
3. **Soft-deleted descendant edges are rewritten too**, so restore-by-re-adding keeps working at the new location.
4. **Ungroup is the reverse:**
   - the children of question **Q** (path **G || Q**) get `parent_id` = Q's parent and `graph_path = G`;
   - descendant paths lose the Q element at that position;
   - at the root level, children become roots (`parent_id NULL`, `graph_path '{}'`).
5. **`graph_tabs`:** rewrite `path` for every user's tab whose concept/path lies inside a moved subtree (including tabs on the moved questions themselves), so no tab goes blank. AppShell reloads its tabs after a successful action.
6. **Unchanged:** `concept_links`, `feedback_items`, `question_sequence_links` and `votes` reference edge ids, and edge ids don't change, so nothing else needs rewriting. Curated communities have no votes or flags.
7. **Sequence links:**
   - After a group or move, delete links between a moved edge and a non-moved edge, since they are no longer siblings. Links between edges that moved together are kept.
   - After an ungroup, delete links touching Q's edge.
   - The preview lists them by name first.

### `POST /api/concepts/group-under-new-parent`
**Body:** `{ selectedEdgeIds: [...], name, dryRun? }`

**Rules and error codes:**
- All selected edges must share `parent_id` and `graph_path`, and must not be deleted or hidden: 400 `not_siblings`, 409 `edge_deleted`.
- At the root level they must also share a community.
- `name`:
  - trimmed, non-empty, at most 255 characters: 400 `empty_name`, `name_too_long`;
  - if a concept with that name already exists in the community (case-insensitive), reuse that concept row, as `/child` does;
  - if that concept is already a visible sibling at this level: 409 `sibling_exists`, returning its `edgeId` (the UI suggests Move into… instead).
- **Cycle:** the new parent concept must not appear in G or anywhere inside a selected subtree (any `graph_path` element or `child_id`): 409 `cycle`.
- **Conflict:** if the destination identity `(N, C, G || N)` already exists for any selected C, including as a soft-deleted edge: 409 `conflict`, returning the names.
- **Legal hold:** if any affected edge or link is legal-held: 409 `legal_hold`.
- **Creates:** the parent's edge at this level (root level: a root edge), then runs the rewrite.
- **Returns:** `{ newEdgeId, newConceptId, movedCount, descendantCount, removedSequenceLinkIds }`.

### `POST /api/concepts/move-into-sibling`
**Body:** `{ selectedEdgeIds, targetEdgeId, dryRun? }`

**Rules and error codes:**
- The target is a visible sibling, not selected: 400 `target_selected` or `not_siblings`.
- Same `cycle`, `conflict`, `legal_hold` and deleted checks as above.
- Same rewrite, with N = the target's concept.
- **Returns:** `{ targetEdgeId, movedCount, descendantCount, removedSequenceLinkIds }`.

### `POST /api/concepts/edges/:edgeId/ungroup`
**Body:** `{ dryRun? }`

**Rules and error codes:**
- The edge must exist and have at least one visible child: 400 `no_children`.
- **Conflict:** if any child's concept already exists at the destination level (visible or soft-deleted, same parent and path): 409 `conflict`, returning the names.
- `legal_hold` as above.
- **Performs:**
  1. rewrite the children up;
  2. soft-delete Q's edge with a new `delete_batch_id` (its answers become hidden with it);
  3. remove sequence links touching Q.

  Q's feedback becomes archived by the existing computed rule.
- **Returns:** `{ movedCount, descendantCount, deletedEdgeId, removedSequenceLinkIds }`.

## Non-goals (73)

- Restructuring in open communities.
- Dragging and dropping cards.
- Moving questions between different parents or levels other than these three actions.
- An undo history.
- A restore UI for deleted batches (still on the "later" list).
- Changes to the sort rule, feedback, or the graph view.

## Tests (73)

**Group:**
- one question, several questions, and the root level;
- answers, feedback threads, and kept sequence links stay attached (same edge ids);
- the sequence links that are removed are exactly the ones the preview listed;
- deep descendants (three or more levels) get correct paths;
- soft-deleted descendants are rewritten and can be restored at the new location;
- tabs open inside the moved subtree still load.

**Move into:** the same checks, plus `target_selected`, `cycle` and `conflict`.

**Ungroup:**
- children move up, the question is soft-deleted, and re-adding it restores it without its old children;
- `conflict` when a child's name already exists at the upper level;
- root-level ungroup makes the children roots.

**Errors and permissions:**
- each endpoint returns `curated_only` in open communities and `curated_owner_only` for readers;
- a dry run makes no writes;
- `legal_hold`, `too_large`, `not_siblings`.

**Nest-under-sibling:**
- 403 `open_only` in curated, for owners too;
- unchanged in open communities;
- the right-click entry is hidden in curated.

**Graph view:** reflects the new structure.
