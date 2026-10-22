# ORCA — Testing Checklist

**Purpose:** This file is the authoritative testing checklist for the Orca app. Claude Code must read this file after implementing any code change and run tests according to the Run Levels below. Do not consider a task complete until the required tests pass.

**Writing style:** Tests are written in natural language. Claude Code should interpret each test and determine the appropriate verification method (curl, psql, `npm run build`, file inspection, subagent checks, etc.).

**Test users:** alice, bob, carol, dave, eve, frank (all have bcrypt-hashed fake phone numbers and fake emails)

**Post-Phase 58 note:** Documents, corpuses, annotations, messages, and citations have been retired. Sections testing those features have been removed. The core testing surface is now: auth, concepts, edge votes, web links (now called "links"), superconcepts (combos), tunnels, sidebar/navigation, moderation, and legal admin.

---

## CRITICAL: Test Result Persistence Rules

**These rules are mandatory. Violating them wastes real money on token usage.**

1. **Every agent that runs tests MUST write its results to a file** in the project root, named `test-results-section-{range}.md`. Results returned only in conversation context WILL be lost to context window compression before they can be compiled.

2. **Never defer report compilation.** Process each agent's file as soon as it completes.

3. **The final compiled report MUST also be written to a file** — `test-results-full.md` in the project root — before presenting it to the user.

4. **After the report is delivered**, delete the intermediate files. Do NOT commit them to git.

5. **If an agent finishes with "Done" and no file was written, that agent's work is lost.** Re-run it.

---

## Run Levels

### Level 1 — Standard (default after every change)
Run these:
- **Section 0 (Build & Startup)** — always, no exceptions
- **Every section directly touched by your changes** — use your judgment
- **Core regression sweep (Sections 2, 3, 9, 12, 15)** — Concepts, Votes, Web Links, Sidebar, and Superconcepts

### Level 2 — Full Regression (run when prompted, or before major commits)
Run **every section, every test, no skipping.**

### Level 3 — Targeted (run when prompted for a specific section)
Run only the specific section(s) named.

---

## 0. Build & Startup (ALWAYS RUN — every level)

- [ ] Frontend builds cleanly: `cd frontend && npm run build` produces zero errors
- [ ] Backend starts without crashing: `cd backend && node src/server.js` starts and connects to the database
- [ ] No console errors on the backend startup log (watch for "Cannot find module" or similar)

---

## 1. Authentication (Password Login + Phone OTP Registration)

### Password Login
- [ ] Login with username + correct password returns JWT token and user object
- [ ] Login with email + correct password returns JWT token and user object
- [ ] Login with wrong password returns 401
- [ ] Login with non-existent username returns 401 (no account enumeration)
- [ ] Login without identifier or password returns 400

### Registration (Phone OTP + Password)
- [ ] Sending a verification code with `intent=register` to a new phone number returns success
- [ ] Sending a verification code with `intent=register` to an existing phone number returns 400 before sending OTP
- [ ] Cannot register without providing a password
- [ ] Cannot register with a weak password (zxcvbn score < 2)
- [ ] Cannot register without email or age verification
- [ ] Successful registration returns a JWT token

### Forgot Password
- [ ] Forgot password send-code returns generic success message
- [ ] Forgot password reset validates password strength
- [ ] Successful password reset returns JWT token (auto-login)

### General Auth
- [ ] `/api/auth/me` returns current user info with valid JWT
- [ ] `/api/auth/me` returns 401 with no/invalid token
- [ ] "Log out everywhere" invalidates all existing JWTs

---

## 2. Concepts & Graph Navigation

- [ ] Root concepts page (`GET /api/concepts/root`) returns all root concepts
- [ ] Creating a root concept requires an `attributeId`
- [ ] Creating a root concept creates both concept and root edge (`parent_id = NULL`, `graph_path = '{}'`)
- [ ] Creating a child concept creates edge with correct `graph_path` (root-to-parent inclusive)
- [ ] Concept names are capped at 255 characters
- [ ] Creating a concept with existing name reuses the concept ID (case-insensitive)
- [ ] Cycle detection prevents creating a child that would be its own ancestor
- [ ] Getting a concept with children returns sorted by save count descending (default)
- [ ] Sort by new (`?sort=new`) returns children sorted by `created_at` descending
- [ ] Hidden concepts (`is_hidden = true`) do not appear in children lists
- [ ] Concept search uses trigram similarity
- [ ] Guest users can view concepts but cannot create

---

## 3. Voting (Save / Swap / Link)

### Save votes
- [ ] Saving an edge creates a vote and saves the full path
- [ ] Unsaving cascades to all descendant edges in that branch
- [ ] Save count updates correctly after adding/removing saves

### Swap votes
- [ ] Swap votes only work between sibling edges (same parent_id + graph_path)
- [ ] Non-sibling swap returns 400
- [ ] Save and swap are mutually exclusive
- [ ] Auto-save on swap: casting swap A→B auto-saves B
- [ ] Auto-save persists after swap removal

### Link votes (Flip View)
- [ ] Link votes can only be added in contextual Flip View
- [ ] Adding and removing link votes updates counts correctly

---

## 4. Flip View

- [ ] Getting parents returns all parent contexts
- [ ] Contextual Flip View includes link vote counts and Jaccard similarity
- [ ] Decontextualized Flip View returns parents without link vote UI

---

## 5. Graph Votes Page (SavedPageOverlay)

- [ ] The Graph Votes overlay shows a flat list of all user's saved trees
- [ ] Save removal works and cascading unsave removes descendants
- [ ] Clicking a tree card navigates to the concept in a graph tab

---

## 6. Web Links (Phase 58 — Link-Based References)

### Adding links
- [ ] URL validation: must start with `http://` or `https://`, max 2048 chars
- [ ] Duplicate URLs on the same edge are ALLOWED (no 409 — per Phase 58d-1)
- [ ] Only the creator can remove a link
- [ ] Link is auto-upvoted by the adding user
- [ ] Submitting with empty title auto-fetches OG title from the URL (server-side)
- [ ] Submitting with a title uses the provided title as-is

### Link display
- [ ] Links tab is the default tab on the concept page right panel
- [ ] Sort toggle (Top | New) is visible above the link list
- [ ] Clicking "New" reorders by created_at DESC
- [ ] Clicking "Top" reorders by vote count DESC
- [ ] Vote count is clickable to toggle upvote (logged-in users)
- [ ] Creator can edit comment and remove link
- [ ] "(edited)" indicator appears only after genuine edits

### Comment line clamping
- [ ] Short comments (under 3 lines) show no "Show more" toggle
- [ ] Long comments clamp to 3 lines with "Show more" toggle
- [ ] "Show more" expands to full; "Show less" collapses back
- [ ] Long unbroken URLs and words wrap within the panel (no horizontal overflow)

### Cross-instance buttons
- [ ] "Show N other instances on this concept" appears when count > 0
- [ ] "Show N instances across all concepts" appears when count > 0
- [ ] Both buttons hidden when count = 0 (after fetch completes)
- [ ] Expanding shows instance list with path breadcrumbs (root → ... → concept)
- [ ] Path direction is root-to-target left-to-right
- [ ] Whole instance row is clickable (not just trailing arrow)

### Cross-instance navigation
- [ ] Same-concept click: scrolls to target link on current page (no new tab)
- [ ] Different-concept click: reuses existing graph tab if one matches the concept
- [ ] Different-concept click: creates new tab if no existing tab matches
- [ ] Auto-scroll to destination link after navigation
- [ ] Brief highlight (2s yellow tint) on destination link

### Cross-context web links tab
- [ ] In flip view, web links from all parent contexts are shown

---

## 7. Superconcepts / Combos

### Browse Superconcepts
- [ ] "Browse Superconcepts" button in sidebar opens overlay
- [ ] Combo list shows name, description, creator, concept count, subscriber count
- [ ] Search bar filters by name
- [ ] Sort toggle: Subscribers (default) | New
- [ ] Create, subscribe, unsubscribe all work

### Combo Tab Content
- [ ] Header shows name, description, owner, stats
- [ ] Subconcept list visible to all; add/remove controls owner-only
- [ ] Aggregated links view shows links from all member edges
- [ ] Each link card shows "From [concept name]" indicator
- [ ] Sort toggle (Top | New) reorders links
- [ ] Vote count is display-only (readOnlyVote) — no clickable vote arrow
- [ ] Link cards are clickable — navigates to the source concept page with auto-scroll
- [ ] Title link opens URL in new browser tab (not navigation)

### Superconcepts Tab in Links Panel
- [ ] "Superconcepts (N)" tab appears when current edge belongs to N > 0 superconcepts
- [ ] Tab hidden when N = 0 or in flip/tunnel view
- [ ] Clicking a superconcept card subscribes and switches to the combo tab

### Add to Superconcept from Graph View
- [ ] Button appears for logged-in owners of at least one combo
- [ ] Button hidden for guests or users with zero combos
- [ ] Single-combo shortcut: direct add without picker
- [ ] Multi-combo: dropdown picker

---

## 8. Link Votes Overlay (Phase 58d-2)

- [ ] "Link Votes" button in sidebar opens the overlay
- [ ] Shows all links the user has upvoted with path breadcrumbs
- [ ] Vote count is display-only (no clickable arrow)
- [ ] Link cards are clickable — navigates to concept page with auto-scroll + highlight
- [ ] Empty state: "You haven't upvoted any links yet."

---

## 9. Tunnel Links

- [ ] Creating a tunnel inserts two rows (bidirectional)
- [ ] Both directions auto-voted for creator
- [ ] Vote toggle works; directional (A→B independent from B→A)
- [ ] Tunnel view shows columns per enabled attribute
- [ ] Per-column search filters by attribute
- [ ] Per-column sort (Votes | New) works independently
- [ ] Cards show concept name, path, tunnel vote count, save vote count
- [ ] Tunnel view persists in graph tab across refresh

---

## 10. Moderation & Flagging

- [ ] One flag per user per edge
- [ ] Edge hidden after 10 distinct flags
- [ ] Unflagging restores if count drops below 10
- [ ] Hide/show community voting works
- [ ] Moderation comments can be added
- [ ] Admin unhide requires `ADMIN_USER_ID` match

---

## 11. Sidebar & Navigation

- [ ] Sidebar shows three action buttons: Graph Votes, Link Votes, Browse Superconcepts
- [ ] Sidebar items (combos, groups, graph tabs) appear in correct display_order
- [ ] Drag-and-drop reordering works
- [ ] Graph tab create/close adds/removes sidebar item
- [ ] Tab groups: create, rename, delete, toggle expand/collapse
- [ ] Browser back/forward navigate through concept history
- [ ] Combo tabs appear/disappear with subscribe/unsubscribe
- [ ] Existing-tab reuse: navigating to a concept that already has a tab switches to it (no duplicate)

---

## 12. Account Deletion

- [ ] Cannot delete account if user owns superconcepts — returns 400
- [ ] After transferring all superconcept ownership, deletion succeeds
- [ ] CASCADE deletes: votes, subscriptions, tabs, flags
- [ ] SET NULL: concepts, edges, links `created_by`/`added_by`
- [ ] Combos owned by deleted user become ownerless

---

## 13. Info Pages

- [ ] Using orca page loads at `/using-orca`
- [ ] The "thoroughly-conscious-ignorance" info page loads at `/thoroughly-conscious-ignorance`
- [ ] Comments load for guests (without vote buttons)
- [ ] Authenticated users can add comments (max 2000 chars)
- [ ] Reply nesting is exactly 1 level
- [ ] Vote toggle and auto-vote on creation work

---

## 14. Search

- [ ] Concept search uses trigram similarity and returns relevant results
- [ ] Search results show "Voted" badge for concepts the user has voted on
- [ ] No corpus annotation badges (retired in Phase 58)

---

## 15. Guest Access

- [ ] Guests can browse root concepts and navigate the graph
- [ ] Guests can view web links and superconcepts
- [ ] Guests can view Flip View, Tunnel View
- [ ] Guests CANNOT: create concepts, vote, add links, flag, or subscribe
- [ ] Login prompt appears when guest attempts a restricted action

---

## 16. Design & UI Conventions

- [ ] All styling uses inline styles (no external CSS files)
- [ ] Font is EB Garamond on all interactive elements
- [ ] Background is soft off-white, text is black
- [ ] No emoji icons in UI chrome
- [ ] No italics anywhere
- [ ] No colored buttons

---

## 17. Diff Modal

- [ ] Right-click context menu shows "Compare" option
- [ ] Diff modal shows Shared/Similar/Unique grouping
- [ ] Drill-down navigation with breadcrumbs works
- [ ] Batch children endpoint respects max 10 panes

---

## 18. Vote Sets

- [ ] Color swatches shown for vote sets with 10+ users
- [ ] Filtering by vote set works
- [ ] Multi-select works

---

## 19. Admin Legal

- [ ] Legal removal works for target types: concept, edge, web_link
- [ ] legal_hold prevents community unhide
- [ ] DMCA strikes auto-insert on dmca removal
- [ ] Repeat-infringer queue shows users with 3+ active strikes
- [ ] Strike dismissal works

---

## 20. ORCID Integration

- [ ] OrcidBadge renders when orcidId is provided
- [ ] Badge appears next to combo creator names
- [ ] ORCID connect/disconnect flow works
- [ ] User search by username or ORCID works

---

## Phase 72a — Curated Communities (Mode, Owners, Share, Write Gating)

- [ ] Migration runs twice cleanly; `\d communities` shows the `mode` column with its CHECK constraint; `\d community_owners` shows the table; every community with a non-null `created_by` has its creator backfilled as an owner
- [ ] Create an open community and a curated community; the creator is an owner of both (`is_owner` true in the list and get-by-slug payloads)
- [ ] `POST /api/communities` with an invalid `mode` returns 400
- [ ] Curated: a non-owner gets 403 `curated_owner_only` on create root, create child, nest-under-sibling, add link, and copy link
- [ ] Curated: an owner can create a root and a child (201)
- [ ] Curated: both owners and non-owners get 403 `curated_no_votes` on save, unsave, swap add/remove, link (similarity) add/remove, web-link upvote/unvote, moderation flag, and moderation vote
- [ ] Open communities behave exactly as before: a logged-in non-owner can create, save, and upvote
- [ ] Owners: add another owner by username (idempotent; 404 for unknown username); remove an owner; removing the last remaining owner returns 400 `last_owner`
- [ ] Account deletion is blocked (400, with the community list) for a user who is the sole owner of any curated community
- [ ] `/c/:slug` opens the community for a guest and for a logged-in user (selects it, opens its root, replaces the URL with `/`); an unknown slug shows the unavailable-link toast
- [ ] The community header Share control copies `…/c/<slug>`
- [ ] Curated, non-owner (and guests): no create affordances (root/child create, add-link form, nest-under-sibling, copy link) and no vote/flag affordances (save ▲, swap, vote-set bar/dots, Flip View similarity votes, link upvotes, flag) are shown
- [ ] Curated, owner: create affordances are shown; vote/flag affordances are hidden; an Owners panel is reachable from the community header
- [ ] An open community's UI is unchanged aside from the mode label in the create form

---

## Phase 72b — Answers, Card Answer Section (Curated), Recency Sorting

- [ ] Migration runs twice cleanly; `\d concept_links` shows a nullable `published_on DATE` column
- [ ] Curated: adding an answer requires a publication date — missing date returns 400 `published_on_required`; a malformed date and a date more than one year in the future both return 400 `invalid_published_on`; a valid `YYYY-MM-DD` succeeds (201) and the response echoes `publishedOn`
- [ ] Open: `publishedOn` is optional on add-link (link saves with or without it) and is echoed back when supplied
- [ ] Curated: a non-owner (and guest) gets 403 `curated_owner_only` on add answer; an owner can add
- [ ] `GET /votes/web-links/:edgeId` returns `publishedOn` for each link
- [ ] Curated `GET /concepts/:id`: each child carries `answers[]` (legal-held links excluded, newest `published_on` first, ties newest `created_at`) and `sortDate`; children are ordered in two groups — (a) **open questions first** (no answer on their own edge and none on any descendant edge; `sortDate` is `null`, not a `created_at` fallback), ordered by edge `created_at` DESC; then (b) **answered questions**, ordered by `sortDate` DESC (own newest answer date, else newest descendant answer date), then edge `created_at` DESC. Reference build (R1 → L1 2021-05-01, L2 2024-03-01, P→Q 2023-01-01, U1 created first, U2 created second, both no answers) orders **U2, U1, L2, P, L1**, with `sortDate` null for U2 and U1
- [ ] Curated `GET /concepts/root?communityId=` follows the same two-group rule (descendant dates included; open roots first by `created_at` DESC); the `sort` param is ignored in curated
- [ ] Open `GET /concepts/:id` and `/concepts/root` responses are unchanged in shape (no `answers`/`sortDate` keys) and order (votes/newest)
- [ ] Curated removal: any owner may remove any answer in the community; a non-owner cannot (403); a `legal_hold` answer cannot be removed even by an owner (403). Open communities keep author-only removal
- [ ] Curated UI: each question card in the children grid and the root grid shows its answers (title link opens in a new tab with `rel="noopener noreferrer"`, publication date, comment via LinkifiedText, clamped); no vote controls; no answer section on a card with no answers (non-owners/guests)
- [ ] Curated owner UI: a per-card "Add answer" form (URL with title preview on paste/blur, title, comment, `date` input, required affirmation checkbox) and a per-answer "Remove" with an inline confirm (no `window.confirm`/`alert`)
- [ ] Curated children view: the side links panel (ConceptLinksPanel) is hidden; Flip View still shows the links panel
- [ ] `/link/:id` to a curated answer opens the parent question's page and scrolls to + highlights the answer row inside its card (300ms delay, 2s highlight)
- [ ] Open communities show no visible change (no card answer section; links panel intact)

---

## Phase 72c-1 — Curated Edit Mode (rename, answer edit, soft delete, inline add)

### Schema
- [ ] Migration runs twice cleanly; `\d edges` shows `deleted_at TIMESTAMP`, `deleted_by INTEGER` (FK users ON DELETE SET NULL), `delete_batch_id UUID`, and the partial index `idx_edges_delete_batch` (`WHERE deleted_at IS NOT NULL`)

### Rename (`POST /api/concepts/:id/rename`)
- [ ] Curated owner renames a question; the new name shows under every placement of that concept in the community (concept-level rename)
- [ ] Rename to a name already used by another concept in the community → 409 `name_taken` with the clashing `conceptId`; a no-op rename to the same text (any case) succeeds
- [ ] Non-owner (and guest) → 403 `curated_owner_only`; in an open community → 403 `curated_only`; a legal-held concept → 403 `legal_hold`

### Answer edit (`POST /api/votes/web-links/:linkId/edit`)
- [ ] Curated owner edits each field independently (title, comment, URL, publication date); `updated_at` advances
- [ ] A changed URL is re-checked by Safe Browsing (unsafe → 403 `unsafe_url`); a malformed URL → 400
- [ ] `publishedOn` cannot be cleared (empty → 400 `published_on_required`); a blank title falls back to the OG fetch of the resolved URL
- [ ] Non-owner → 403 `curated_owner_only`; open community → 403 `curated_only`; legal-held answer → 403 `legal_hold`

### Soft delete (`POST /api/concepts/edges/:edgeId/delete`)
- [ ] Deleting a question with two levels of sub-questions marks the edge and its entire path-scoped subtree `deleted_at` + `is_hidden = true` under one shared `delete_batch_id`
- [ ] The deleted questions vanish from `GET /concepts/:id`, `/concepts/root`, `/concepts/search`, Flip View parent data, `/votes/me/all`, and child counts
- [ ] `GET /moderation/hidden/:parentId` does not list a deleted edge; unhide (admin), flag, moderation vote, and moderation comment on a deleted edge are refused
- [ ] If any affected edge or link is under `legal_hold`, the delete is refused with 409 `legal_hold` and nothing changes
- [ ] Re-adding the same concept under the same parent+path (create root/child) restores only that single edge (`restored: true`), leaving its former subtree deleted
- [ ] Non-owner → 403 `curated_owner_only`; open community → 403 `curated_only`

### Frontend — edit/view toggle and UI
- [ ] An Edit/View toggle appears in the header only for owners of curated communities (root page and question pages); state lives in AppShell per community, defaults to View, is not persisted, and resets on community change
- [ ] View mode is read-only: the per-card "+ Add answer" form and per-answer "Remove" (72b) appear only in edit mode
- [ ] Edit mode: cards get dashed outlines; question titles (cards and the page title) are inline click-to-edit (Enter/blur saves, Escape cancels); the "Also appears under N other question(s)" note shows when `altParentCount > 0`
- [ ] Edit mode: answer title/URL/comment/date are inline click-to-edit; each answer has a "Remove" with an inline confirm (no `window.confirm`)
- [ ] Edit mode: a bottom-right "+" opens an inline New question card at the top of the list (root → create root, child → create child); each card's "✕" soft-deletes with an inline confirm stating the sub-question count (no `window.confirm`/`alert`)
- [ ] In curated communities the search field never offers create (for anyone); search still works. Open communities are unchanged (no edit toggle, no dashed cards, search create intact)

---

## Phase 72c-2 — Precedent / subsequent sibling links (curated)

### Schema
- [ ] Migration runs twice cleanly; `\d question_sequence_links` shows `from_edge_id`/`to_edge_id` (NOT NULL, FK edges ON DELETE CASCADE), `created_by` (FK users ON DELETE SET NULL), a `CHECK (from_edge_id <> to_edge_id)`, a UNIQUE `(from_edge_id, to_edge_id)`, and indexes `idx_qseq_from` / `idx_qseq_to`

### Endpoints (`POST /api/concepts/sequence-links/add|remove`)
- [ ] Owner A adds X→Y (siblings, curated); GET shows Y in X.subsequents and X in Y.precedents, each entry `{ linkId, edgeId, conceptId, name }`
- [ ] Rejections each with their own code: Y→X → 409 `reverse_exists`; X→Y again → 409 `duplicate_link`; X→X → 400 `self_link`; X→W (different parent) → 400 `not_siblings`; non-owner B → 403 `curated_owner_only`; open community → 403 `curated_only`; a soft-deleted edge → 400 `edge_deleted`
- [ ] Curated root-level siblings can be linked; two roots from different communities → 400 `not_siblings`
- [ ] Remove X→Y by linkId clears it from both cards; a non-owner remove → 403 `curated_owner_only`
- [ ] Soft-deleting Y (72c-1) removes the link from the surviving sibling X (read filter excludes deleted/hidden edges)
- [ ] Reads add `precedents[]`/`subsequents[]` to each curated row in `GET /concepts/:id` and `/concepts/root` in one extra query (no N+1); open community responses carry no `precedents`/`subsequents` keys

### Frontend (curated only)
- [ ] Each card shows two columns, "Precedent questions" and "Subsequent questions", below the answer section; clicking a name scrolls to that sibling's card and highlights it (300ms delay, 2s highlight)
- [ ] View mode hides the whole row when both lists are empty; edit mode always shows both columns, with "No precedent/subsequent questions" when empty
- [ ] Edit mode: each column's "+" opens a picker of eligible siblings (not itself, not already linked in either direction); adding a precedent P to card C creates P→C, a subsequent S creates C→S; each entry has an "✕" to remove; the page refreshes so both cards update
- [ ] Edit mode soft warning: a subsequent entry dated earlier than this card (both `sortDate` non-null) reads "dated earlier than its precedent"
- [ ] All controls are `<button>`s (no `window.confirm`/`alert`); open communities show no sequence-link UI

---

## Phase 72d — Graph view (both modes)

### Endpoint (`GET /api/concepts/graph?communityId=&rootConceptId=`, guest-accessible)
- [ ] Registered before `/:id` in `routes/concepts.js`: `GET /concepts/graph?communityId=` returns 200 with a `nodes` array (not swallowed by `/:id` and treated as a concept id)
- [ ] `communityId` only returns every root's graph for the community; `rootConceptId` returns only that root's graph (its root edge + path-scoped descendants)
- [ ] Soft-deleted edges and their subtree are absent; `is_hidden` edges absent; legal-held links are excluded from each node's `answers[]`
- [ ] Curated nodes carry `answers[]` (newest publication date first) and `sortDate`; open nodes carry `saveCount` and `linkCount` and no `answers`/`sortDate`
- [ ] Curated sibling order (open questions first by newest `created_at`, then answered by `sortDate` desc, then `created_at` desc) matches `GET /concepts/:id` for the same parent; reference build orders `U2, U1, L2, P, L1`
- [ ] Open sibling order is `saveCount` desc, then newest `created_at`
- [ ] `parentEdgeId` links every non-root node to the edge whose child is `graph_path[last]` with path `graph_path[0..last-1]`; root nodes have `parentEdgeId: null`
- [ ] 400 without `communityId`; 404 when `rootConceptId` is not a live root of that community
- [ ] The number of SQL queries is small and fixed regardless of graph size (mode lookup + optional root validation + one edges query + one curated answers query; no per-node queries). Verified: identical count for a 5-node and a 50-node root scope (4 each with `rootConceptId`)
- [ ] Capped at 2000 edges with `truncated: true` when hit (ordered shallow-to-deep so dropped rows are the deepest leaves)

### Frontend (`GraphViewOverlay.jsx`)
- [ ] A "Graph" button in the page header on the community root page and on question pages, both modes, guests included, opens the overlay
- [ ] Full-pane overlay like the Votes overlay: `←` Back, "Graph" title, Collapse all / Expand all, Escape closes
- [ ] Each question row with children (or, in curated communities, answers) shows a `▸`/`▾` toggle as its own `<button>` separate from the question text; the toggle expands/collapses without navigating; collapsing a question hides its answers too
- [ ] Expand all / Collapse all apply to the whole tree; per-branch toggles work independently afterward; collapse state persists while the overlay stays open
- [ ] Siblings ordered per the spec (curated recency rule; open save count desc then newest)
- [ ] Clicking a question row navigates the current tab to that question with the correct path and closes the overlay
- [ ] Curated: answers nested under their question (`↗`, title link opening in a new tab with `rel="noopener noreferrer"`, publication date, comment clamped to two lines). Open: questions plus muted "N links"
- [ ] Opened from a question page: that question is highlighted (light background tint), its ancestor path expanded, and scrolled into view; other branches start expanded when ≤ 150 questions, otherwise collapsed below the current path
- [ ] Truncation note shown when the response is truncated
- [ ] Stale-state guard on the fetch; all controls are `<button>`s (external answer links are anchors); VotesOverlay behavior unchanged

---

## Phase 72e-1 — Reader feedback (curated)

### Schema
- [ ] Migration runs twice cleanly; `\d feedback_items` shows `kind` CHECK (allowing `new_child`), `status` CHECK (`open`/`incorporated`/`declined`), FKs (community CASCADE, edge CASCADE, target_link SET NULL, target_edge SET NULL, author/status_by SET NULL), and indexes `idx_feedback_items_community_status` / `idx_feedback_items_edge`; `feedback_replies` has `is_owner_reply`, `is_hidden`, and `idx_feedback_replies_feedback`; `feedback_votes` has PK `(feedback_id, user_id)`

### Endpoints (`/api/feedback`, curated only)
- [ ] Reader B can create one item of each 72e-1 kind (`edit_question`, `edit_answer`, `general`, `add_precedent`, `add_subsequent`, `remove_precedent`, `remove_subsequent`) on a curated card → 201
- [ ] Validation: empty `edit_question` name → 400 `name_required`; `edit_answer` with a link not on that edge → 400 `link_not_on_edge`; `add_precedent` to a non-sibling → 400 `not_siblings`; `remove_subsequent` with no such link → 400 `link_not_found`; `general` with empty comment → 400 `comment_required`; comment > 2000 → 400 `comment_too_long`; `new_child` → 400 `unsupported_kind`
- [ ] Feedback in an open community → 403 `curated_only`; guest POST → 401; guest GET → 200
- [ ] Snapshot: after the owner renames the question, an earlier `edit_question` item's `snapshot.questionText` still shows the old text
- [ ] Author edits/deletes their item before any owner reply (200); after an owner replies, or the status changes, both → 409 `locked`
- [ ] Reply: author edits own reply before an owner replies (200); after a later owner reply, → 409 `locked`
- [ ] Vote toggles on/off (`{ voted, voteCount }`); list ordering is open-first, then votes desc, then newest
- [ ] Owner sets `incorporated` with an optional reply in one transaction (owner reply appears, marked owner); owner hides an item and a reply — both vanish for readers and guests; owner still sees them flagged `isHidden`
- [ ] Non-owner hide / status → 403; site admin may also hide (existing admin check)
- [ ] Soft-deleting the target question archives its feedback: the card's feedback disappears, every write (create/vote/reply/status/hide/edit) → 409 `archived`; re-adding the question un-archives it (reachable again, `archived: false`)
- [ ] `GET /concepts/:id` and `/concepts/root` return `openFeedbackCount` per curated row (live, not hidden, status open), matching the live open count; no per-node N+1 (one grouped query)
- [ ] Create and reply are covered by the existing per-user rate limiter

### Frontend (`FeedbackPanel.jsx`, curated cards)
- [ ] A page-with-pencil feedback icon (inline SVG, not emoji) with the open count when > 0 shows on every curated card in both view and edit mode; clicking opens the feedback panel (overlay, Escape closes)
- [ ] Header shows the question text; "Suggest a change" form offers a kind picker with kind-specific prefilled fields (proposed question; which answer + proposed fields; sibling picker for sequence kinds; comment on every kind); guests see "Log in to suggest a change"
- [ ] The list shows each item's kind label, before → after summary, comment, author + ORCID badge, time, status, vote button + count, replies (owner replies marked "Owner"), reply box, and author edit/delete while unlocked
- [ ] Owners additionally see status controls (Mark incorporated / Decline / Reopen, optional reply) and Hide/Unhide on items and replies
- [ ] The list and the card's open count refresh after every action; all controls are `<button>`s; no `window.confirm`/`alert`; comment and reply bodies render via `LinkifiedText`; Stale-State Guard on the panel fetch

---

**END OF TESTING CHECKLIST**
