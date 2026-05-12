# ORCA — Project Status & Technical Reference

**Last Updated:** May 12, 2026
**Current Status:** Phase 59 COMPLETE (tunnel link comments + combined votes page). Site still offline pending Lane Rideout legal disclosure of Phase 58 pivot scope and revised legal documents. Railway not yet reattached.

---

## Quick Context for New Claude Sessions

Orca is an open-source (AGPL v3) collaborative action ontology platform for academic research. Users create and navigate hierarchical concept graphs with context-dependent children, community voting, and concept attributes (action, tool, value, question). References to external resources are organized as **links** (URLs with optional titles and comments) attached to specific edges in the concept graph.

**Phase 58 pivot (May 2026):** Removed the entire document/corpus/annotation/message layer. The platform now uses a simpler link-based reference system: users paste URLs, the server auto-fetches Open Graph titles, and the community upvotes/discusses links. Cross-instance navigation lets users see where the same URL appears across different concepts. Full Phase 58 narrative archived in `ORCA_HISTORY.md`.

**Phase 59 (May 2026):** Tunnel links gained optional comments and now allow duplicates between the same edge pair (different comments = different rows = independent vote tallies). Graph Votes and Link Votes overlays merged into a single display-only Votes overlay with full root-to-edge ancestry rendering for link-voted edges.

**Current state:** Site is offline. All code changes are complete. Pending: Lane Rideout legal disclosure, revised legal documents (ToS, Privacy Policy, Copyright Policy), Railway reattachment, and relaunch of orcaconcepts.org. An **outreach mode** build flag (added Phase 59a) is available for soft-launching the site with the app gated behind an explanatory landing page while still allowing outreach via The Storm and Using Orca — see "Operational Modes" below.

**Key files:** This file (`ORCA_STATUS.md`) is the canonical technical reference. `ORCA_HISTORY.md` has completed phase narratives through Phase 58. `CLAUDE.md` has conventions loaded into every Claude Code session. `ORCA_TESTS.md` is the testing checklist.

---

## Tech Stack

- **Backend:** Node.js v24 / Express.js / PostgreSQL v16+ with pg_trgm
- **Frontend:** React 18 / Vite / React Router v6 / Axios
- **Auth:** JWT (jsonwebtoken) + Phone OTP (Twilio) for registration + Password (bcryptjs/zxcvbn)
- **Styling:** Inline styles only (no CSS files), EB Garamond serif font
- **License:** AGPL-3.0-only
- **Repository:** github.com/orca-concepts/orca (public)

---

## Operational Modes

### Outreach Mode (Phase 59a, commit `f6b1765`)

A frontend build flag that gates the live application behind an explanatory landing page while keeping the static info pages (The Storm, Using Orca) accessible. Intended for periods when the platform is not yet ready for live use but the public-facing site is still useful for outreach (e.g., during legal review, between development phases, after a major schema change).

**Toggle:** `VITE_OUTREACH_MODE` in `frontend/.env` (Vite frontend build-time env var). Set to `"true"` to enable, anything else (including `"false"` or unset) leaves the app live. Default in committed `.env` is `false`. Documented in `frontend/.env.example`.

**Implementation:**
- `frontend/src/components/AppShell.jsx` line ~24: reads `import.meta.env.VITE_OUTREACH_MODE === 'true'` into `isOutreachMode`.
- AppShell uses `isOutreachMode` to: (a) hide the Legal nav link, (b) hide the login/signup/user section in the header, (c) replace the sidebar + main content area with `<OutreachLanding />`.
- `frontend/src/components/OutreachLanding.jsx`: the landing page component.

**What is still accessible when ON:**
- The Storm essay page (`/the-storm`)
- Using Orca info page
- Static legal pages (still served, just unlinked from the header)
- Everything else routes to the outreach landing or is gated by the hidden nav

**What is NOT accessible when ON:**
- The app proper (root, concepts, voting, tunnels, superconcepts, etc.) — replaced by the landing page
- Login / signup / account flows — header section hidden
- Legal hub via nav — though direct URLs to legal pages still resolve

**Operational note:** Because this is a Vite build-time flag, flipping it requires a redeploy, not just a server restart. On Railway this means triggering a new build with the env var set. There is no in-app or admin-panel toggle.

---

## Database Schema (Post-Phase 59)

All tables below are created/maintained in `backend/src/config/migrate.js`. Tables dropped in Phase 58a (documents, corpuses, annotations, messages, citations, etc.) are documented in `ORCA_HISTORY.md`.

### Core Tables

**users** — User accounts
- `id`, `username` (unique), `email`, `password_hash`, `phone_hash`, `phone_lookup` (HMAC, unique), `token_issued_after`, `age_verified_at`, `orcid_id` (partial unique index), `tos_accepted_at`, `tos_version_accepted`, `created_at`

**concepts** — Individual concept nodes
- `id`, `name` (VARCHAR 255), `created_by` (FK users, SET NULL), `legal_hold` (Phase 53b), `created_at`

**attributes** — Reusable attribute tags (action, tool, value, question)
- `id`, `name` (unique), `created_by`, `created_at`
- Seeded with 4 defaults. Controlled by `ENABLED_ATTRIBUTES` env var.

**edges** — Parent-child relationships in graph contexts
- `id`, `parent_id` (FK concepts, CASCADE), `child_id` (FK concepts, CASCADE), `graph_path` (integer array, root-to-parent inclusive), `attribute_id` (FK attributes, NOT NULL), `created_by`, `is_hidden` (moderation), `legal_hold`, `created_at`
- UNIQUE(parent_id, child_id, graph_path, attribute_id)
- Root edges: parent_id = NULL, graph_path = '{}'

### Vote Tables

**votes** — Save votes on edges. UNIQUE(user_id, edge_id).
**similarity_votes** — Link votes in Flip View. UNIQUE(user_id, origin_edge_id, similar_edge_id).
**replace_votes** — Swap votes (sibling-only). UNIQUE(user_id, edge_id, replacement_edge_id).
**vote_set_changes** — Append-only event log for save/unsave drift analysis.

### Link Tables (Phase 6 + Phase 58 enhancements)

**concept_links** — URLs attached to edges (context-specific)
- `id`, `edge_id` (FK edges, CASCADE), `url` (TEXT, NOT NULL), `title` (VARCHAR 255), `comment` (TEXT), `added_by` (FK users, SET NULL), `legal_hold`, `created_at`, `updated_at`
- No UNIQUE constraint on (edge_id, url) — duplicate URLs allowed per Phase 58d-1
- Server auto-fetches OG title when title is empty (Phase 58b-2)
- User delete capability removed in commit `0b382c4`. Rows are immutable from the user's perspective — only hidden via moderation or removed via admin legal removal.

**concept_link_votes** — Simple upvotes on links. UNIQUE(user_id, concept_link_id).

### Superconcept (Combo) Tables

**combos** — Named collections of edges. Case-insensitive unique name. `created_by` uses ON DELETE SET NULL.
**combo_edges** — Junction: combo to edge. UNIQUE(combo_id, edge_id).
**combo_subscriptions** — User subscriptions. Has `group_id` FK to tab_groups.

### Navigation Tables

**graph_tabs** — Persistent in-app navigation tabs (type, concept_id, path, view_mode, label, group_id).
**tab_groups** — Named expandable groups for tabs. Flat grouping only.
**sidebar_items** — Unified ordering (item_type: 'group' | 'graph_tab' | 'combo', polymorphic item_id).
**child_rankings** — Dormant (UI removed Phase 28b, table retained).

### Tunnel Tables (Phase 59a)

**tunnel_links** — Bidirectional cross-graph edge connections.
- `id`, `origin_edge_id`, `linked_edge_id`, `comment` (TEXT, nullable, added Phase 59a), `created_by`, `created_at`
- UNIQUE(origin_edge_id, linked_edge_id) **dropped in Phase 59a** — duplicates now allowed when comments differ
- Index on (origin_edge_id, linked_edge_id) added Phase 59a to preserve lookup performance after the UNIQUE drop

**tunnel_votes** — Directional endorsements. UNIQUE(user_id, tunnel_link_id).
- Constraint unchanged in Phase 59a — votes are per-row, each commented tunnel is its own row with its own independent vote tally.

### Moderation Tables

**concept_flags** — Edge flags (10 = auto-hide). UNIQUE(user_id, edge_id).
**concept_flag_votes** — Community hide/show votes. UNIQUE(user_id, edge_id).
**moderation_comments** — Discussion on hidden edges.

### Page Comments

**page_comments** — Comments on info pages (slug-scoped, 1-level nesting).
**page_comment_votes** — Comment upvotes. UNIQUE(user_id, comment_id).

### Legal and Admin Tables

**legal_removals** — Admin legal removal audit log. Supports target_type: concept, edge, web_link.
**dmca_strikes** — Per-user DMCA strike record. Partial index on active (uncleared) strikes.

### Infrastructure Tables

**rate_limit_counters** — Postgres-backed rate limit store (SMS, global safety net).
**data_export_requests** — Audit log for self-service data exports (2 per 12 months).

---

## API Surface (Post-Phase 59)

All routes mounted in `backend/src/server.js`. Auth: `authenticateToken` = required JWT; `optionalAuth` = guest-accessible.

### Authentication (`/api/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/login` | No | Password login (username or email) |
| POST | `/send-code` | No | Send OTP for registration |
| POST | `/verify-register` | No | Verify OTP + create account |
| POST | `/forgot-password/send-code` | No | Send OTP for password reset |
| POST | `/forgot-password/reset` | No | Reset password via OTP |
| GET | `/me` | Yes | Get current user info |
| POST | `/logout-everywhere` | Yes | Invalidate all JWTs |
| POST | `/delete-account` | Yes | Delete account (requires zero owned combos) |
| GET | `/orcid/authorize-url` | Yes | ORCID OAuth URL |
| POST | `/orcid/callback` | Yes | Exchange ORCID code |
| POST | `/orcid/disconnect` | Yes | Remove ORCID link |

### Concepts (`/api/concepts`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/root` | Guest | Root concepts (sort: saves/new) |
| GET | `/attributes` | Guest | Enabled attributes |
| GET | `/search` | Guest | Trigram search (?attributeId= filter) |
| GET | `/names/batch` | Guest | Batch name resolution |
| GET | `/:id` | Guest | Concept with children |
| GET | `/:id/parents` | Guest | Flip view parents |
| GET | `/:id/votesets` | Guest | Vote set analysis |
| GET | `/:id/subtree` | Guest | Path-scoped descendant tree (?path=1,2,3); used by CopyLinkPicker. Recursive CTE, 500-edge cap, depth 50, filters `is_hidden = false`. |
| POST | `/root` | Yes | Create root concept |
| POST | `/child` | Yes | Create child concept |
| POST | `/batch-children-for-diff` | Guest | Diff modal data |

### Votes and Links (`/api/votes`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/web-links/by-url` | Guest | Cross-concept URL search |
| GET | `/web-links/all/:conceptId` | Guest | All links across contexts |
| GET | `/web-links/:edgeId` | Guest | Links for edge (?sort=top/new) |
| GET | `/web-links/votes/me` | Yes | User's upvoted links (legacy, retained for rollback safety post-59b) |
| POST | `/web-links/add` | Yes | Add link (OG title auto-fetch) |
| POST | `/web-links/copy` | Yes | Copy link to a descendant edge (adder only, same root graph, descendant edge required). Returns new row; original untouched. |
| POST | `/web-links/upvote` | Yes | Upvote link |
| POST | `/web-links/unvote` | Yes | Remove upvote |
| PUT | `/web-links/:linkId/comment` | Yes | Edit link comment |
| GET | `/saved` | Yes | User's saved edges (legacy, retained for rollback safety post-59b) |
| GET | `/me/all` | Yes | **NEW Phase 59b.** Unified votes payload for the combined Votes overlay. Returns `{ savedEdges, linkVotes, contextEdges, ancestorEdges }`. `contextEdges` are edges referenced by link votes but not saved by the user; `ancestorEdges` walk root-to-edge for every saved + context edge so the frontend can render full ancestry. Both context and ancestor entries are flagged `isContextOnly: true`. Single recursive CTE — no N+1. |
| POST | `/add` | Yes | Save an edge |
| POST | `/remove` | Yes | Unsave (cascades) |
| GET/POST | `/swap/*` | Yes | Swap vote CRUD |
| POST | `/link/add`, `/link/remove` | Yes | Flip View link votes |
| GET/POST | `/graph-tabs/*` | Yes | Graph tab CRUD |
| GET/POST | `/tab-groups/*` | Yes | Tab group CRUD |
| GET/POST | `/sidebar-items/*` | Yes | Sidebar ordering |

Removed in commit `0b382c4`: `POST /web-links/remove` — user delete capability eliminated to enforce append-only AD.

### Superconcepts (`/api/combos`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Guest | List all combos |
| GET | `/:id` | Guest | Combo details + edges |
| GET | `/:id/links` | Guest | Aggregated links (?sort=top/new) |
| GET | `/by-edge/:edgeId` | Guest | Combos containing an edge |
| POST | `/create` | Yes | Create combo |
| GET | `/mine` | Yes | User's owned combos |
| GET | `/subscriptions` | Yes | User's combo subscriptions |
| POST | `/subscribe`, `/unsubscribe` | Yes | Subscription management |
| POST | `/:id/edges/add`, `/:id/edges/remove` | Yes | Edge management (owner) |
| POST | `/:id/transfer-ownership` | Yes | Ownership transfer |

### Tunnels (`/api/tunnels`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:edgeId` | Guest | Tunnel links for edge. Each row returns its `comment` field (Phase 59a). |
| POST | `/create` | Yes | Create tunnel. Accepts optional `comment` (Phase 59a). Duplicates between the same edge pair are now allowed — every POST creates a new row. |
| POST | `/vote` | Yes | Toggle tunnel vote (per-row, unchanged) |

### Moderation (`/api/moderation`)
POST `/flag`, `/unflag`, `/vote`, `/vote/remove`, `/comment`, `/unhide` (admin). GET `/hidden/:parentId`, `/comments/:edgeId`.

### Pages (`/api/pages`)
GET `/:slug/comments`, POST `/:slug/comments`, POST `/comments/:commentId/vote`.

### Users (`/api/users`)
GET `/search`, `/:id/profile`, `/me/export`, `/me/export-status`. PATCH `/me`.

### Admin (`/api/admin`)
POST `/legal-removal`, GET `/legal/removals`, POST `/legal/removals/:id/mark-notified`, GET `/legal/repeat-infringers`, POST `/legal/strikes/:id/clear`.

---

## Frontend Component Map (Post-Phase 59)

### Pages (`frontend/src/pages/`)
- **Root.jsx** — Root concepts page with attribute filter
- **Concept.jsx** — Concept page with children, Flip View, Tunnel View, links panel

### Core Components (`frontend/src/components/`)
- **AppShell.jsx** — Main layout: header, sidebar, tab management, overlays. Single "Votes" sidebar item replaces the former "Graph Votes" and "Link Votes" entries (Phase 59b). Reads `VITE_OUTREACH_MODE` into `isOutreachMode` (~line 24, Phase 59a) — when ON, hides Legal nav + login/signup, renders `<OutreachLanding />` in place of the sidebar/content area.
- **OutreachLanding.jsx** — **NEW Phase 59a.** Landing page shown when `VITE_OUTREACH_MODE=true`. Replaces the entire app surface with an explanation that the platform is not yet live. See "Operational Modes" section.
- **ConceptLinksPanel.jsx** — Right panel on concept page (Links tab + Superconcepts tab). Passes `conceptId` and `conceptPath` to LinkCard for copy-to-descendant flow. Uses shared `ClampedText`.
- **LinkCard.jsx** — Reusable link card. Always-visible "Other instances on this concept (N)" / "Other instances across all concepts (N)" dropdowns (disabled when N=0). Prominent up-arrow vote icon. "Copy" button next to "Edit" visible only when the current user is the link's adder. No user-facing remove button (append-only enforcement). Uses shared `ClampedText`.
- **ClampedText.jsx** — **NEW Phase 59a.** Shared line-clamp component with expand toggle. Extracted from duplicated copies in LinkCard and ConceptLinksPanel; also consumed by TunnelView for tunnel comments.
- **CopyLinkPicker.jsx** — Modal overlay for copying a link to a descendant edge. Expandable tree picker with path-scoped subtree fetch, request-generation race guard, Escape-to-close. Calls `POST /api/votes/web-links/copy` on confirm.
- **ComboTabContent.jsx** — Superconcept tab: header, edge management, aggregated links view. Has request-generation race guard on `loadComboLinks`.
- **ComboListView.jsx** — Browse Superconcepts overlay
- **VotesOverlay.jsx** — **NEW Phase 59b.** Combined display-only votes page. Hierarchical tree built from `GET /api/votes/me/all` (saved edges + context edges + ancestors), with the user's link votes nested under each edge. No remove affordances anywhere — navigation into the concept is the only way to change votes. Saved edges visually distinguished from context-only edges. Applies Stale-State Guard request-generation pattern. Replaces the deleted `SavedPageOverlay.jsx` and `LinkVotesOverlay.jsx`.
- **FlipView.jsx** — Alt parent contexts with Jaccard similarity
- **TunnelView.jsx** — Cross-graph tunnels by attribute columns. Renders each tunnel row's optional `comment` (Phase 59a) using shared `ClampedText`. Duplicates between the same edge pair are expected and rendered as independent rows with independent vote counts — do not collapse them.
- **ConceptGrid.jsx** — Grid display for child concepts
- **SearchField.jsx** — Combined add/search with trigram matching
- **DiffModal.jsx** — Side-by-side concept comparison
- **SwapModal.jsx** — Swap vote picker (sibling-only)
- **VoteSetBar.jsx** — Vote set color swatches and filtering
- **HiddenConceptsView.jsx** — Moderation review panel
- **LoginModal.jsx** — Login/Register/Forgot password modal
- **ProfilePage.jsx** — User profile with ORCID, Privacy and Data section
- **DeleteAccountFlow.jsx** — Account deletion with superconcept transfer pre-check
- **SidebarDndContext.jsx** — Drag-and-drop for sidebar reordering
- **InfoPage.jsx** — Using orca page with comments
- **TheStormPage.jsx** — Static essay page
- **LegalPage.jsx** — Legal hub
- **TermsPage.jsx**, **PrivacyPage.jsx**, **CopyrightPage.jsx**, **CopyrightPolicyPage.jsx** — Static legal pages
- **AdminLegalRemovalsPanel.jsx** — Admin legal removal panel
- **OrcidBadge.jsx**, **OrcidCallback.jsx** — ORCID integration

**Deleted in Phase 59b:** `SavedPageOverlay.jsx`, `LinkVotesOverlay.jsx`.

---

## Architecture Decisions (Still in Force)

### Path-Dependent Identity
A concept's contextual identity is determined by graph_path + attribute. Same concept under different parents = different contextual entities with independent votes, children, and links.

### graph_path Semantics (AD #137)
`graph_path` stores root-to-parent inclusive. Parent IS the last element. Never append parent_name separately.

### Single-Attribute Graphs
Every graph has one attribute from the root edge. Descendants inherit. Backend enforces via `graph_path[0]` lookup.

### Append-Only for Graph Content (strengthened, commit `0b382c4`)
Concepts, edges, and concept_links are never deleted by users — only hidden via moderation or legally removed. Quality curated through voting. The `POST /web-links/remove` endpoint was eliminated to enforce this; users have no path to delete their own links. Editing comments on one's own links is still allowed (correction is different from removal). Link mobility is provided by the copy-to-descendant flow, not by move-with-delete.

### Links Live on Edges (Not Concepts)
`concept_links.edge_id` ties each link to a specific parent context. Duplicate URLs allowed — different comments are valuable contributions. The copy-to-descendant flow does not block duplicates at the destination, consistent with this AD.

### Copy-to-Descendant for Links (new, commit `0b382c4`)
A link's original adder may copy it to any descendant edge within the same root graph. Semantics:
- A new `concept_links` row is INSERTed at the destination edge with the same url, title, comment, and `added_by = current user`.
- The source row is untouched. Votes do not transfer (the destination starts at zero votes — votes are tied to the (edge, link) pair, not the URL).
- Permission: backend verifies `concept_links.added_by = req.user.userId`. Frontend hides the Copy button when the current user isn't the adder, but this is UX only — the backend check is the security boundary.
- Destination scope: descendants only, within the same root graph (same `graph_path[0]`). Cross-graph copy is rejected by the backend.

### Tunnel Comments and Duplicates (Phase 59a, commit `f6b1765`)
Tunnel links carry an optional free-text `comment` and may duplicate between the same `(origin_edge_id, linked_edge_id)` pair. Different comments are distinct contributions, mirroring the concept_links comment model. Consequences:
- The UNIQUE constraint on `(origin_edge_id, linked_edge_id)` was dropped in Phase 59a. A non-unique index on the same columns preserves lookup performance.
- `tunnel_votes.UNIQUE(user_id, tunnel_link_id)` is unchanged — vote tallies are per-row, so two tunnels between the same edges with different comments accumulate votes independently.
- TunnelView renders each row as its own card with its own comment and vote button. Do not collapse visually identical edge pairs; the comment differentiates them.
- The tunnel creation UI exposes an optional comment textarea. Empty input is stored as NULL.

### Votes Pages Are Display-Only (Phase 59b, commit `4f1d507`)
The Votes overlay shows the user's current votes and provides click-to-navigate, nothing else. Removing a save vote or a link upvote happens by navigating into the concept itself, never from the overlay. The X / remove button on save-vote rows was removed in Phase 59b — link-vote rows never had one. This formalizes the votes overlay as a read-only index. Consequences:
- New vote-display features (e.g., swap-vote views, tunnel-vote views) should follow the same display-only pattern.
- Vote mutation endpoints (`POST /votes/add`, `/remove`, `/web-links/upvote`, `/unvote`) remain available for use from concept pages — only the overlay UI affordance is being withdrawn.

### OG Title Auto-Fetch
Server-side fetching with SSRF protections (DNS resolve + private IP block). 5s timeout. Falls back to URL-as-title.

### Save/Swap Mutual Exclusivity
Saving removes existing swap; swapping removes existing save with cascading unsave.

### Sibling-Only Swap Votes (AD #256)
Cross-context relevance expressed via tunneling, not swaps.

### Auto-Save on Swap (AD #257)
Casting swap A to B auto-saves B. Removing swap does NOT remove auto-save.

### Vote Set Threshold
Only sets with 10+ users get swatches. Ordered by user count descending.

### Auth Middleware Pattern
Always `const authenticateToken = require('../middleware/auth')` — never destructured.

### Frontend vs Backend User ID
Frontend: `user.id`. Backend: `req.user.userId`. Never mix.

### LEFT JOIN for SET NULL FKs
Queries joining `users` via `created_by` or `added_by` MUST use LEFT JOIN.

### Promise.all Fault Tolerance
Every member must have `.catch()` fallback.

### Tab Reuse on Navigation
`handleOpenConceptTab` uses `graphTabsRef` to find existing tabs. Reuses instead of duplicating.

### Cross-Concept Scroll and Highlight
`pendingScrollLinkId` state: AppShell to Concept to ConceptLinksPanel. 300ms delay, scrollIntoView, 2s yellow highlight. Now also consumed by VotesOverlay link-row clicks (Phase 59b).

### Legal Hold (AD Phase 53b)
`legal_hold` flag on concepts, edges, concept_links prevents community unhide.

### Stale-State Guard on Navigation (commit `3089bbf`, May 2026)
Async fetches keyed on a route param (such as `edgeId`) must:
1. Clear the parent-held param state to `null` at the START of navigation, not after the new fetch completes. Otherwise the child component renders one frame with the previous param value and fetches stale data.
2. Capture a request generation ID (a `useRef` counter incremented per call) at the start of every async fetch, and bail out of all state setters in that fetch if the ID no longer matches the current generation. Without this, a slow response from the previous edge can land after a fast response from the new edge and overwrite the correct data.
3. Await any setter functions that the child depends on (e.g., `loadVoteSets` setting `parentEdgeId`) before marking the page as loaded. Fire-and-forget setters open a window where downstream components render with stale or missing values.

Tab reuse via `graphTabsRef` means `Concept` components are keyed by tab ID, not concept ID, so they do not remount on navigation — stale state persists across navigations until explicitly cleared. This pattern applies anywhere an edge-keyed child fetch lives below a navigable parent. `CopyLinkPicker`, `ComboTabContent`, and `VotesOverlay` (Phase 59b) all apply this guard to their async fetches.

### Path-Scoped Recursive Subtree Queries (commit `0b382c4`)
Any recursive CTE that walks descendants in the concept graph MUST scope by full `graph_path`, not by `parent_id` alone or by `graph_path[last] = parent.child_id` alone. Both partial filters allow cross-context leakage because the same concept can appear under multiple paths.

Correct pattern (PostgreSQL):
```
WITH RECURSIVE subtree AS (
  -- Base case: children of the starting edge in THIS path context
  SELECT e.id AS edge_id, e.child_id, e.graph_path, ...
  FROM edges e
  WHERE e.parent_id = $1
    AND e.graph_path = $3::integer[]   -- $3 = [...parentPath, conceptId]
    AND e.is_hidden = false
  UNION ALL
  -- Recursive step: full graph_path must equal parent's path with parent's child_id appended
  SELECT e.id, e.child_id, e.graph_path, ...
  FROM edges e
  JOIN subtree st ON e.parent_id = st.child_id
    AND e.graph_path = st.graph_path || st.child_id   -- array concatenation, not just last-element check
  WHERE e.is_hidden = false AND st.depth < 50
)
```
This was discovered when the CopyLinkPicker initially showed children from other graph paths. Two separate bugs in the same query — one in the base case, one in the recursive step — both stemming from "filter by concept identity, not contextual identity." If you write a subtree query and you find yourself filtering only by IDs, stop and add the path check.

The Phase 59b ancestor walk in `GET /votes/me/all` is the inverse case — walking UPWARD from each edge using its `graph_path` array elements. Same principle applies: ancestors must be resolved by graph_path position, not by parent_id alone, because a concept's identity as an ancestor depends on which path it sits in.

---

## Phase 59 Completion Narrative

Phase 59 added tunnel comments and unified the votes overlays.

**59a (commit `f6b1765`):** Two pieces of work landed in one commit.
- **Tunnel comments + duplicates:** Tunnel links gained an optional `comment` column. The `UNIQUE(origin_edge_id, linked_edge_id)` constraint was dropped and replaced with a non-unique index. Backend tunnel creation no longer rejects existing pairs — every POST creates a new row. Frontend tunnel creation UI gained an optional comment textarea. TunnelView now renders comments via a shared `ClampedText` component extracted from duplicated copies in LinkCard and ConceptLinksPanel.
- **Outreach mode:** Added the `VITE_OUTREACH_MODE` build flag and `OutreachLanding.jsx` to support soft-launching the site with the app gated behind an explanatory landing page. See "Operational Modes" section above for full details.

**59b (commit `4f1d507`):** `SavedPageOverlay.jsx` and `LinkVotesOverlay.jsx` were merged into a single `VotesOverlay.jsx`. A new endpoint `GET /api/votes/me/all` returns saved edges, the user's link votes, context-only edges (referenced by link votes but not saved), and the full ancestor chain for all of the above — assembled in a single recursive CTE walking upward via graph_path. The overlay renders these as one hierarchical tree, with link votes nested under their edges. All remove/X affordances were stripped from the overlay; mutation now requires navigating into the concept page. The legacy endpoints (`GET /votes/saved`, `GET /web-links/votes/me`) were retained to enable UI rollback without a backend revert; their deletion will happen in a later phase once the new overlay is proven stable in production.

**Lessons:**
- The "votes pages are display-only" framing only became visible once we tried to write the spec for the merged page. Both prior overlays had inconsistent affordances — Graph Votes had an X button, Link Votes did not — and the merge forced the question. Worth checking for similar inconsistencies elsewhere when components are touched.
- Commit `f6b1765` bundled two unrelated features (tunnel comments + outreach mode) under a single message. Both are now documented, but the bundling made the doc-update pass harder than it needed to be — required an investigation phase to reconstruct the secondary scope. Future commits should keep features in separate commits, or at minimum the commit message should enumerate both pieces of scope.

---

## Known Tech Debt and Forward Roadmap

### Tech Debt
- N+1 by-url count fetches (batch endpoint future optimization)
- Title edit after creation not implemented (needs backend endpoint)
- ~~ClampedText duplicated in LinkCard and ConceptLinksPanel~~ **Resolved Phase 59a** — extracted to shared `ClampedText.jsx`
- AppShell tab management complexity warrants refactor
- Tree ordering persistence retired (session-local only)
- **Stale-state audit results (May 2026):** `FlipView`, `TunnelView`, and the former `LinkVotesOverlay` were audited and found safe at the time — but `TunnelView`'s safety was STRUCTURAL (it unmounts on every navigation, so its state resets naturally), not DEFENSIVE (explicit state clearing in code). If `TunnelView` is ever changed to persist across navigations the way `ConceptLinksPanel` does, it will immediately exhibit the Failure 1 pattern (stale `tunnelData` visible during the load window). Same caveat applies to `FlipView`. `ComboTabContent.loadComboLinks` race guard added in a follow-up commit. `VotesOverlay` (Phase 59b) applies the guard from day one. Any new edge-keyed fetch below a navigable parent must follow the Stale-State Guard on Navigation AD from day one — do not rely on unmount behavior as protection.
- **Copy-link UX:** After a successful copy, the UI refreshes the source view but does not auto-navigate to the destination. Consider adding a "View at destination" link in the success toast (would reuse the existing `pendingScrollLinkId` cross-concept scroll infrastructure).
- **Copy-link subtree depth limit:** Hardcoded at 50 in the recursive CTE. If real-world graphs grow deeper, this will silently truncate the picker — should be made configurable or removed in favor of relying solely on the 500-edge row cap.
- **Legacy votes endpoints (Phase 59b):** `GET /api/votes/saved` and `GET /api/votes/web-links/votes/me` are retained for rollback safety. Once `VotesOverlay` is proven stable in production, these endpoints and any remaining call sites should be removed.
- **TunnelView pre-59a duplicate handling:** The component now expects duplicate rows. Any production data created before 59a will still be unique-per-pair. Worth confirming after launch that the rendering also handles the "single row" case cleanly (it should, but the test scenarios used during 59a development all had duplicates).

### Forward Roadmap
- Lane Rideout legal disclosure of Phase 58 pivot
- Revised legal documents
- DMCA agent registration
- Re-attach Railway and relaunch
- Public data API
- Federated ontologies (sketched in ORCA_HISTORY)
- Phase 60 candidate: retire legacy votes endpoints (`GET /api/votes/saved`, `GET /api/votes/web-links/votes/me`) once `VotesOverlay` is proven stable in production

---

## Recent Commits (Phase 59)

```
4f1d507 phase 59b: combine graph and link votes pages
        — Unified VotesOverlay replacing SavedPageOverlay + LinkVotesOverlay;
          new GET /votes/me/all endpoint; display-only votes pages AD.
f6b1765 outreach mode, tunnel link comments added
        — Phase 59a, two features bundled:
          (1) tunnel_links.comment column + dropped UNIQUE constraint
              + allow duplicate tunnels + shared ClampedText component;
          (2) outreach mode build flag (VITE_OUTREACH_MODE) +
              OutreachLanding.jsx — see "Operational Modes" section.
0b382c4 feat: remove remove button and add copy to descendents option (append-only enforcement; path-scoped subtree CTE; CopyLinkPicker)
3089bbf fix: navigation stale links (clear parentEdgeId on nav + request-gen race protection on link fetch)
c143810 fix: 58d-2, combo card clickability + readonly votes + restore Graph Votes sidebar
6b6966c fix: 58d-1 polish, comment clamp + expand toggle + long-string line breaking
4d4dd09 feat: 58d-1 patches, dedup removed + count buttons + tab reuse + cross-concept scroll/highlight
276721a feat: 58c, complete frontend pivot — deletions, surgical edits, runtime patches
b6d2d41 feat: 58c-1, delete retired frontend components and clean API imports
f3649ae feat: 58b-2, add OG title fetcher and cross-concept/superconcept link endpoints
2a265a0 feat: 58b-remove retired backend controllers, routes, helpers, and dependencies
7e413f5 feat: 58a, drop retired tables and update migrate.js
475d463 docs: Phase 58 plan + deletion inventory for link-based pivot
dfff99d status doc update phase 58
```

Note: the Phase 58 LinkCard UI work (prominent vote icon + always-visible instance dropdowns + race guard on ComboTabContent) was bundled into intermediate commits not all reflected in this list. The current state described above is the live behavior.

---

**END OF TECHNICAL REFERENCE**
