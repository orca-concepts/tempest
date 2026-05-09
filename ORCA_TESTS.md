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
- [ ] The Storm page loads at `/the-storm`
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

**END OF TESTING CHECKLIST**
