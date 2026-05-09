# ORCA — Project Status & Technical Reference

**Last Updated:** May 9, 2026
**Current Status:** Phase 58 link-based pivot COMPLETE. Site offline pending Lane Rideout legal disclosure of pivot scope and revised legal documents. Railway not yet reattached.

---

## Quick Context for New Claude Sessions

Orca is an open-source (AGPL v3) collaborative action ontology platform for academic research. Users create and navigate hierarchical concept graphs with context-dependent children, community voting, and concept attributes (action, tool, value, question). References to external resources are organized as **links** (URLs with optional titles and comments) attached to specific edges in the concept graph.

**Phase 58 pivot (May 2026):** Removed the entire document/corpus/annotation/message layer. The platform now uses a simpler link-based reference system: users paste URLs, the server auto-fetches Open Graph titles, and the community upvotes/discusses links. Cross-instance navigation lets users see where the same URL appears across different concepts.

**Current state:** Site is offline. All code changes are complete. Pending: Lane Rideout legal disclosure, revised legal documents (ToS, Privacy Policy, Copyright Policy), Railway reattachment, and relaunch of orcaconcepts.org.

**Key files:** This file (`ORCA_STATUS.md`) is the canonical technical reference. `ORCA_HISTORY.md` has completed phase narratives through Phase 56. `CLAUDE.md` has conventions loaded into every Claude Code session. `ORCA_TESTS.md` is the testing checklist.

---

## Tech Stack

- **Backend:** Node.js v24 / Express.js / PostgreSQL v16+ with pg_trgm
- **Frontend:** React 18 / Vite / React Router v6 / Axios
- **Auth:** JWT (jsonwebtoken) + Phone OTP (Twilio) for registration + Password (bcryptjs/zxcvbn)
- **Styling:** Inline styles only (no CSS files), EB Garamond serif font
- **License:** AGPL-3.0-only
- **Repository:** github.com/orca-concepts/orca (public)

---

## Database Schema (Post-Phase 58a)

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

### Tunnel Tables

**tunnel_links** — Bidirectional cross-graph edge connections. UNIQUE(origin_edge_id, linked_edge_id).
**tunnel_votes** — Directional endorsements. UNIQUE(user_id, tunnel_link_id).

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

## API Surface (Post-Phase 58b)

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
| POST | `/root` | Yes | Create root concept |
| POST | `/child` | Yes | Create child concept |
| POST | `/batch-children-for-diff` | Guest | Diff modal data |

### Votes and Links (`/api/votes`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/web-links/by-url` | Guest | Cross-concept URL search |
| GET | `/web-links/all/:conceptId` | Guest | All links across contexts |
| GET | `/web-links/:edgeId` | Guest | Links for edge (?sort=top/new) |
| GET | `/web-links/votes/me` | Yes | User's upvoted links |
| POST | `/web-links/add` | Yes | Add link (OG title auto-fetch) |
| POST | `/web-links/remove` | Yes | Remove own link |
| POST | `/web-links/upvote` | Yes | Upvote link |
| POST | `/web-links/unvote` | Yes | Remove upvote |
| PUT | `/web-links/:linkId/comment` | Yes | Edit link comment |
| GET | `/saved` | Yes | User's saved edges |
| POST | `/add` | Yes | Save an edge |
| POST | `/remove` | Yes | Unsave (cascades) |
| GET/POST | `/swap/*` | Yes | Swap vote CRUD |
| POST | `/link/add`, `/link/remove` | Yes | Flip View link votes |
| GET/POST | `/graph-tabs/*` | Yes | Graph tab CRUD |
| GET/POST | `/tab-groups/*` | Yes | Tab group CRUD |
| GET/POST | `/sidebar-items/*` | Yes | Sidebar ordering |

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
| GET | `/:edgeId` | Guest | Tunnel links for edge |
| POST | `/create` | Yes | Create bidirectional tunnel |
| POST | `/vote` | Yes | Toggle tunnel vote |

### Moderation (`/api/moderation`)
POST `/flag`, `/unflag`, `/vote`, `/vote/remove`, `/comment`, `/unhide` (admin). GET `/hidden/:parentId`, `/comments/:edgeId`.

### Pages (`/api/pages`)
GET `/:slug/comments`, POST `/:slug/comments`, POST `/comments/:commentId/vote`.

### Users (`/api/users`)
GET `/search`, `/:id/profile`, `/me/export`, `/me/export-status`. PATCH `/me`.

### Admin (`/api/admin`)
POST `/legal-removal`, GET `/legal/removals`, POST `/legal/removals/:id/mark-notified`, GET `/legal/repeat-infringers`, POST `/legal/strikes/:id/clear`.

---

## Frontend Component Map (Post-Phase 58c/d)

### Pages (`frontend/src/pages/`)
- **Root.jsx** — Root concepts page with attribute filter
- **Concept.jsx** — Concept page with children, Flip View, Tunnel View, links panel

### Core Components (`frontend/src/components/`)
- **AppShell.jsx** — Main layout: header, sidebar, tab management, overlays
- **ConceptLinksPanel.jsx** — Right panel on concept page (Links tab + Superconcepts tab)
- **LinkCard.jsx** — Reusable link card with comment clamping, vote button, clickable/readOnlyVote modes
- **ComboTabContent.jsx** — Superconcept tab: header, edge management, aggregated links view
- **ComboListView.jsx** — Browse Superconcepts overlay
- **SavedPageOverlay.jsx** — Graph Votes overlay: flat list of saved trees
- **LinkVotesOverlay.jsx** — Link Votes overlay: user's upvoted links with navigation
- **FlipView.jsx** — Alt parent contexts with Jaccard similarity
- **TunnelView.jsx** — Cross-graph tunnels by attribute columns
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

---

## Architecture Decisions (Still in Force)

### Path-Dependent Identity
A concept's contextual identity is determined by graph_path + attribute. Same concept under different parents = different contextual entities with independent votes, children, and links.

### graph_path Semantics (AD #137)
`graph_path` stores root-to-parent inclusive. Parent IS the last element. Never append parent_name separately.

### Single-Attribute Graphs
Every graph has one attribute from the root edge. Descendants inherit. Backend enforces via `graph_path[0]` lookup.

### Append-Only for Graph Content
Concepts, edges, and concept_links are never deleted by users — only hidden via moderation or legally removed. Quality curated through voting.

### Links Live on Edges (Not Concepts)
`concept_links.edge_id` ties each link to a specific parent context. Duplicate URLs allowed — different comments are valuable contributions.

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
`pendingScrollLinkId` state: AppShell to Concept to ConceptLinksPanel. 300ms delay, scrollIntoView, 2s yellow highlight.

### Legal Hold (AD Phase 53b)
`legal_hold` flag on concepts, edges, concept_links prevents community unhide.

---

## Phase 58 Completion Narrative

Phase 58 pivoted orca from a document/annotation platform to a link-based reference system.

**Removed:** 30+ database tables; 13 backend files; 19 frontend components; 6 API module exports.

**Added:** OG title fetcher with SSRF protections; cross-concept URL search; combo aggregated links; user link votes endpoint; sort toggles; cross-instance navigation with scroll/highlight; LinkCard component; LinkVotesOverlay; comment line clamping.

**Sub-phases:** 58.0 (inventory), 58a (DB migration), 58b-1 (backend removal), 58b-2 (new endpoints), 58c-1 (frontend deletion), 58c-2 (surgical edits), 58d-1 (concept page links), 58d-2 (combo view + link votes + sidebar), 58e (documentation).

**Lessons:** Build success does not mean runtime success with Vite/React — undefined JSX references only surface at runtime. Multiple patch passes were needed for cascading dead-reference cleanup. Future pivots should instrument runtime error detection earlier.

---

## Known Tech Debt and Forward Roadmap

### Tech Debt
- N+1 by-url count fetches (batch endpoint future optimization)
- Title edit after creation not implemented (needs backend endpoint)
- ClampedText duplicated in LinkCard and ConceptLinksPanel
- AppShell tab management complexity warrants refactor
- Tree ordering persistence retired (session-local only)

### Forward Roadmap
- Lane Rideout legal disclosure of Phase 58 pivot
- Revised legal documents
- DMCA agent registration
- Re-attach Railway and relaunch
- Public data API
- Federated ontologies (sketched in ORCA_HISTORY)

---

## Recent Commits (Phase 58)

```
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

---

**END OF TECHNICAL REFERENCE**
