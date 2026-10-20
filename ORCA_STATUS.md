# ORCA — Project Status & Technical Reference

**Last Updated:** October 19, 2026 (Phase 72a complete: community modes, owners, `/c/:slug` share links, curated write gating. Next: 72b answers + recency sorting)

This file is the canonical technical reference for Orca. It describes the system **as it is now**. Completed-phase narratives, commit lists, and the design history of removed features live in `ORCA_HISTORY.md`. `CLAUDE.md` holds the conventions loaded into every Claude Code session. `ORCA_TESTS.md` is the testing checklist.

---

## Current State

Orca is an open-source (AGPL v3) research-question graph platform for academics, live at **orcaconcepts.org** (Railway + Cloudflare). Users build hierarchical graphs of research questions, where a parent question is a goal that its children decompose, and attach links to the papers that bear on each question.

What is live:
- **Communities (Phase 71).** Every question lives in a community. Communities partition the graph: opening one shows only its questions. Anyone logged in can create a community. A cross-community "also asked in" bridge flags questions whose normalized text also exists in another community.
- **Community modes and owners (Phase 72a).** Each community is `open` or `curated`, chosen at creation and fixed. The creator is the first owner; owners can add and remove owners (any owner can remove any other, but never the last one). In curated communities only owners can add content, and nobody can vote or flag. Every community has a share link, `/c/:slug`.
- **Question-only graphs.** `question` is the only attribute (`ENABLED_ATTRIBUTES=question`).
- **Path-dependent identity.** The same question under two parents is two contextual entities with independent children, votes, and links.
- **Links on edges.** URLs with titles, immutable comments, author addenda, and upvotes, attached to one specific edge. **A link applies only to the question it is placed on and never surfaces on ancestor questions** (link inheritance was fully removed in October 2026).
- **Votes.** Save votes, swap votes (sibling-only), Flip View similarity votes, vote sets, and a display-only Votes overlay.
- **Nest under sibling.** Copy selected sibling questions' subtrees (with their links) under another sibling.
- **Auth.** ORCID-first registration plus email/password; Resend for transactional email.
- **Moderation and legal.** Community flagging (10 flags hides an edge), admin legal removal with `legal_hold`, DMCA strikes, and copyright infringement / counter-notice forms.

What is next: **Phase 72b** (answers with publication dates, the in-card answer section, and recency sorting for curated communities) — see `PHASE_72_CURATED_COMMUNITIES.md` and the Forward Roadmap. Existing community data is all test data and does not need preserving.

### Retired / dead code — do NOT surface as live or propose using
Backend code for some of these remains intact and must not be "fixed up" into use:
1. **Multi-attribute model** — `action`/`tool`/`value` rows remain seeded but are disabled at read time. Any mention of them is historical.
2. **AI seeding effort** — Chaos/Koios (Ouranos/Gaia/Krius). `chaos/` is tracked; `koios/` and `chaos (retired)/` are git-ignored local folders.
3. **Situations** (internally "combos"/"superconcepts") — UI removed in Phase 70. Tables, routes, `comboController`, `ComboListView`, `ComboTabContent` remain as dead code. `/situation/:id` redirects to `/`.
4. **Tunnels** (cross-graph tunnel links) — `TunnelView`, `tunnel_links`, `tunnel_votes`, `tunnel_link_addenda`, `/api/tunnels` are dead code.
5. **Mentions** ("Mentioned by" backreferences, Phase 65b) — **intentionally removed**. All code is gone and the `comment_mentions` table is dropped by `migrate.js`. In-comment linkification of in-orca URLs (`LinkifiedText`) still works; it is a separate feature.
6. **The Storm** essay page — **intentionally replaced** by the "thoroughly-conscious-ignorance" info page.
7. **Link inheritance / context-scoped link votes** — removed. There is one vote per user per link, everywhere.
8. **Legacy vote/tab endpoints** — `/tabs/*`, `/tree-order/*`, `/rankings/*`, `/tab-activity/*`, `/remove-from-tab`, `/drift/:parentEdgeId` are still mounted in `routes/votes.js` but belong to retired features (several return 410). `child_rankings` is a dormant table.

---

## Tech Stack

- **Backend:** Node.js v24 / Express / PostgreSQL 16+ with `pg_trgm`. Local database: `concept_hierarchy` (Windows service `postgresql-x64-18`).
- **Frontend:** React 18 / Vite / React Router v6 / Axios
- **Auth:** JWT + ORCID OAuth (required) + email/password (bcryptjs, zxcvbn). `users.orcid_id` is NOT NULL.
- **Transactional email:** Resend, from `noreply@orcaconcepts.org`.
- **Hosting:** Railway (backend + Postgres), Cloudflare (DNS + registrar).
- **Styling:** Inline styles only. CSS lists `EB Garamond, Georgia, serif`; Georgia is the intentionally rendered brand font — do not "fix" EB Garamond loading.
- **License / repo:** AGPL-3.0-only, github.com/orca-concepts/orca (public). Local path `C:\Users\17wil\orca\orca-public`; the developer uses Windows Command Prompt.

---

## Security Posture

- **Production secrets** live only in Railway environment variables: `JWT_SECRET`, `DATABASE_URL`, `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `RESEND_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY` (restricted to the Safe Browsing API in Google Cloud Console). Rotation procedures live in an off-repo runbook.
- **Local `backend/.env`** holds only dev-safe values. ORCID, Resend, and Safe Browsing keys are absent locally: ORCID linking uses `POST /api/auth/orcid/dev-connect` (404 in production), emails are silently skipped, and Safe Browsing fails open. **Never add a production key to local `.env`** — test external integrations against production.
- **Git ignore** is layered: root `.gitignore` and `backend/.gitignore` both exclude `.env`. Root `.gitignore` also excludes production database dumps (`orca-prod-backup.sql`, `*-backup.sql`), the retired `koios/` and `chaos (retired)/` folders, and one-off files. **The repo is public — production dumps contain user data and must never be committed.** Stage files by name rather than `git add -A`.
- **Account access:** the Gmail account owning Railway, Resend, ORCID, Cloudflare, and GitHub has 2FA.
- **R2 storage is retired** (key revoked, bucket deleted, no SDK or config in code).

---

## Operational Modes

### Outreach Mode (Phase 59a)
A Vite build-time flag, `VITE_OUTREACH_MODE` in `frontend/.env` (`"true"` to enable; default `false`, documented in `frontend/.env.example`). When ON, `AppShell.jsx` hides the Legal nav and login/signup section and replaces the sidebar and main content with `<OutreachLanding />`. The info pages (`/using-orca`, `/thoroughly-conscious-ignorance`) and direct legal-page URLs stay reachable. Flipping it requires a redeploy (a new Railway build), not a restart.

**Phase 72 note:** journals will post community share links on their sites. Outreach mode must be OFF in production for those links to work.

---

## Static Assets & Social Sharing (Phase 63a)

- **Favicon:** `frontend/public/favicon.svg` — lowercase "o" in Georgia, black on `#FAF9F6`.
- **Fallback OG/Twitter tags** in `frontend/index.html` (`summary` card, favicon image).
- **Page-specific previews:** the `OG_OVERRIDES` map in `backend/src/server.js` has entries for `/`, `/using-orca`, and `/thoroughly-conscious-ignorance`, each with a 1200x630 PNG in `frontend/public/` and `summary_large_image`. The Express SPA-fallback handler injects the override tags (HTML-escaped) into the cached `index.html`; no User-Agent gating.
- **Gotcha:** `express.static(frontendDist, { index: false })` is required so `/` falls through to the SPA fallback and gets its override.
- **Adding a card:** add the PNG, add one `OG_OVERRIDES` entry, verify after deploy at `https://cardyb.bsky.app/v1/extract?url=...` (platforms cache aggressively; append a dummy query string to force a refetch).

---

## Database Schema

All tables are created and maintained idempotently in `backend/src/config/migrate.js`, which also drops tables from retired features. **Run `npm run migrate` (from `backend/`) before restarting the backend whenever tables or columns change.**

### Core
**users** — `id`, `username` (unique), `email`, `password_hash`, `token_issued_after`, `age_verified_at`, `orcid_id` (NOT NULL, partial unique index), `tos_accepted_at`, `tos_version_accepted`, `email_verified_at`, `email_verification_token` / `_expires_at`, `password_reset_token` / `_expires_at`, `created_at`. Tokens are single-use 64-char hex; consuming a token clears it.

**communities** (Phase 71) — `id`, `name`, `slug`, `description`, `mode` (Phase 72a: `'open'` default or `'curated'`, CHECK `communities_mode_check`; fixed after creation), `created_by` (FK users, SET NULL), `created_at`. Case-insensitive unique indexes on `name` and `slug`.

**community_owners** (Phase 72a) — `community_id` (FK communities, CASCADE), `user_id` (FK users, CASCADE), `added_by` (FK users, SET NULL), `created_at`. PRIMARY KEY `(community_id, user_id)`; index on `user_id`. Creators are inserted at creation (and were backfilled). Ownership grants powers only in curated communities.

**concepts** — `id`, `name` (VARCHAR 255), `community_id` (FK communities, **NOT NULL**), `normalized_name` (GENERATED STORED: lowercase, trimmed, whitespace-collapsed, trailing `?`/`.`/`!` stripped — the bridge match key), `created_by` (FK users, SET NULL), `legal_hold`, `created_at`.
- `idx_concepts_community_name` — UNIQUE `(community_id, LOWER(name))`. A name is unique **within** a community; the same text in two communities is two rows.
- Bootstrap: if any concept has a NULL `community_id` (pre-71 data), migrate creates a "General" community and backfills. A fresh database gets no communities.

**attributes** — `id`, `name` (unique), `created_by`, `created_at`. Four rows seeded; only `question` enabled.

**edges** — `id`, `parent_id` (FK concepts, CASCADE), `child_id` (FK concepts, CASCADE), `graph_path` (int[], root-to-parent inclusive), `attribute_id` (NOT NULL), `created_by`, `is_hidden`, `legal_hold`, `created_at`. UNIQUE `(parent_id, child_id, graph_path, attribute_id)`. Root edges: `parent_id = NULL`, `graph_path = '{}'`. Edges inherit their community from their concepts (no `community_id` column on edges).

### Votes
- **votes** — save votes on edges. UNIQUE `(user_id, edge_id)`.
- **similarity_votes** — Flip View link votes. UNIQUE `(user_id, origin_edge_id, similar_edge_id)`.
- **replace_votes** — swap votes (sibling-only). UNIQUE `(user_id, edge_id, replacement_edge_id)`.
- **vote_set_changes** — append-only save/unsave event log.

### Links
- **concept_links** — `id`, `edge_id` (FK edges, CASCADE), `url`, `title`, `comment` (immutable after creation), `added_by` (FK users, SET NULL), `legal_hold`, `created_at`, `updated_at`. No uniqueness on `(edge_id, url)` — duplicate URLs with different comments are allowed. Hard-deletable by `added_by` when `legal_hold = false`.
- **concept_link_votes** — UNIQUE `(user_id, concept_link_id)`: one vote per user per link. (The `context_edge_id` column and its constraints were dropped in the link-inheritance removal.)
- **concept_link_addenda** — `id`, `concept_link_id` (CASCADE), `author_id` (SET NULL), `body`, `created_at`. Author must be the link's `added_by` (enforced in backend).

### Navigation
- **graph_tabs** — persistent in-app tabs (type, concept_id, path, view_mode, label, group_id). The API attaches `community_id` derived from the tab's concept (root tabs: null).
- **tab_groups** — flat named groups. **sidebar_items** — polymorphic ordering (`group` / `graph_tab` / `combo`).
- **child_rankings** — dormant.

### Moderation
- **concept_flags** — edge flags; 10 flags from distinct users hides the edge. UNIQUE `(user_id, edge_id)`.
- **concept_flag_votes** — hide/show votes. **moderation_comments** — discussion on hidden edges.

### Page comments
**page_comments** (slug-scoped, one level of replies via `parent_comment_id`), **page_comment_votes**.

### Legal and audit
- **legal_removals** — admin removal log (target_type: concept, edge, web_link). **dmca_strikes** — per-user strikes.
- **copyright_infringement_notices**, **copyright_counter_notices** — submissions from the public notice forms.
- **link_removal_log** — sparse audit of user link deletions (URL sha256 only, no plaintext).
- **safe_browsing_rejections** — sparse audit of URLs rejected by Safe Browsing (URL sha256, threat types, `source` = `add`/`preview`).

### Infrastructure
**rate_limit_counters** (Postgres-backed rate limit store), **data_export_requests** (2 exports per 12 months).

### Dead-code tables (still created; do not build on)
`combos`, `combo_edges`, `combo_subscriptions`, `combo_votes` (situations); `tunnel_links`, `tunnel_votes`, `tunnel_link_addenda` (tunnels).

---

## API Surface

All routes are mounted in `backend/src/server.js`. "Guest" = `optionalAuth`; "Yes" = `authenticateToken`.

### Authentication (`/api/auth`)
| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | No | Password login (username or email). Rejects rows with NULL `orcid_id`. |
| POST | `/orcid/begin-registration` | No | Registration step 1: exchange ORCID code, return iD + emails. 409 if the iD already has an account. |
| POST | `/register-with-orcid` | No | Registration step 2: create account. ORCID-verified email → verified + welcome email; otherwise a verification email. |
| GET | `/verify-email` | No | Consumes the verification token, then redirects to `/email-verification?status=...`. |
| POST | `/forgot-password` | No | Always 200 (timing-safe), 5/hour/IP, 1-hour token. |
| POST | `/reset-password` | No | Sets new password, advances `token_issued_after` (logs out all sessions). |
| GET | `/me` | Yes | Current user. |
| POST | `/logout-everywhere` | Yes | Advances `token_issued_after`. |
| POST | `/delete-account` | Yes | Requires zero owned combos (legacy pre-check) and not being the sole owner of any curated community (Phase 72a). |
| GET | `/orcid/authorize-url` | Guest | ORCID OAuth URL (`state` = register / link). |
| POST | `/orcid/callback` | Yes | Link ORCID to an existing account. |
| POST | `/orcid/dev-connect` | Yes | Dev-only ORCID linking; 404 in production. |

### Concepts (`/api/concepts`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/root?communityId=&sort=` | Guest | Root questions of a community (400 without `communityId`). Includes per-card link count. |
| GET | `/attributes` | Guest | Enabled attributes (returns only `question`). |
| GET | `/search?q=&communityId=` | Guest | Trigram search scoped to a community (400 without `communityId`). |
| GET | `/names/batch` | Guest | Batch name resolution. |
| GET | `/:id?path=` | Guest | Question with children. Returns per-child link counts, `nestedLocations` (cross-sibling descendant flag), `altParentCount`, `currentEdgeId`, and (Phase 72a) `communityId`, `communityMode`, `isCommunityOwner`. |
| GET | `/:id/parents` | Guest | Flip View parent contexts (excludes root edges). |
| GET | `/:id/votesets` | Guest | Vote-set analysis. |
| GET | `/:id/subtree?path=` | Guest | Path-scoped descendant tree (500-edge cap, depth 50); used by CopyLinkPicker. |
| GET | `/:id/bridges` | Guest | Same-`normalized_name` questions in other communities, each with `viewMode` (`flip` if it has a non-root placement, else `root`). |
| POST | `/batch-children-for-diff` | Guest | DiffModal data. |
| POST | `/root` | Yes | Create a root question. Body `{ name, attributeId, communityId }`. Rate-limited. |
| POST | `/child` | Yes | Create a child question; community derived from `graphPath[0]`. Rate-limited. |
| POST | `/nest-under-sibling` | Yes | Copy selected sibling questions' full subtrees (edges + links, original authors preserved) under another sibling. Additive; originals untouched. Body `{ parentConceptId, path, selectedEdgeIds, targetEdgeId }`. Works on the root list (empty `path`). All selected and target questions must be in the same community (400 otherwise — matters on the root list). 1000-edge cap. |

### Communities (`/api/communities`, Phase 71)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/` | Guest | All communities with `mode`, `is_owner` (when logged in), `concept_count`, `root_count`, ordered by name. |
| GET | `/:slug` | Guest | One community by slug (case-insensitive) with `mode`, `is_owner`, and `owners: [{ userId, username, orcidId }]`; 404 if missing. Used by the `/c/:slug` share link. |
| POST | `/` | Yes | Create. Body `{ name, description, mode }` (`mode` defaults to `open`; 400 if not `open`/`curated`). ≤255 chars; 409 on case-insensitive name clash; slug auto-generated with `-2`, `-3` on collision. Creator inserted into `community_owners` in the same transaction. |
| POST | `/:id/owners/add` | Yes | Owner only (403 `owner_only`). Body `{ username }`; 404 if no such user; idempotent. |
| POST | `/:id/owners/remove` | Yes | Owner only. Body `{ userId }`. Locks owner rows (`FOR UPDATE`) then refuses to leave zero owners (400 `last_owner`). An owner may remove themselves if another remains. |

**Curated gating (Phase 72a).** In curated communities these return 403 `{ code: 'curated_owner_only' }` for non-owners: `POST /concepts/root`, `/concepts/child`, `/concepts/nest-under-sibling`, `/votes/web-links/add`, `/votes/web-links/copy`, `/votes/web-links/:linkId/addenda`. These return 403 `{ code: 'curated_no_votes' }` for everyone, owners included: `POST /votes/add`, `/votes/remove`, `/votes/swap/add`, `/votes/swap/remove`, `/votes/link/add`, `/votes/link/remove`, `/votes/web-links/upvote`, `/votes/web-links/unvote`, `/moderation/flag`, `/moderation/vote`. `POST /auth/delete-account` returns 400 with `curatedCommunities` when the user is the sole owner of any curated community.

### Votes and Links (`/api/votes`)
| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/web-links/by-url?url=` | Guest | Every instance of a URL across questions ("Other instances"). |
| GET | `/web-links/all/:conceptId?path=` | Guest | Flip View aggregate: links grouped by parent context. Each group contains **only links placed on that group's edge**. |
| GET | `/web-links/preview-title?url=` | Yes | Safe Browsing check, then OG title fetch for the add-link form. 403 `{ code: 'unsafe_url' }` on unsafe URLs. |
| GET | `/web-links/votes/me` | Yes | Legacy (retained for rollback). |
| GET | `/web-links/:linkId/location` | Guest | Resolves a link to `{ linkId, edgeId, conceptId, parentPath }` for `/link/:id` share URLs; opaque 404 if hidden/held/deleted. |
| GET | `/web-links/:edgeId?sort=top\|new` | Guest | Links on one edge, with `addenda[]`, `authorOrcidId`, vote count, `voterUserIds`. |
| POST | `/web-links/add` | Yes | Add a link. Safe Browsing check, then OG title fallback. |
| POST | `/web-links/copy` | Yes | Copy own link to a descendant edge in the same root graph. |
| POST | `/web-links/remove` | Yes | Hard-delete own link (single atomic DELETE checking `added_by` and `legal_hold`; generic 403). Writes `link_removal_log`. |
| POST | `/web-links/upvote`, `/web-links/unvote` | Yes | Body `{ linkId }`. One vote per user per link. |
| POST | `/web-links/:linkId/addenda` | Yes | Author-only addendum, 2000 chars. |
| GET | `/me/all?communityId=` | Yes | Votes overlay payload `{ savedEdges, linkVotes, contextEdges, ancestorEdges }`, optionally scoped to a community. |
| GET | `/saved` | Yes | Legacy (retained for rollback). |
| POST | `/add`, `/remove` | Yes | Save / unsave an edge (unsave cascades to descendants). |
| GET/POST | `/swap/:edgeId`, `/swap/add`, `/swap/remove` | Yes | Swap votes. |
| POST | `/link/add`, `/link/remove` | Yes | Flip View similarity votes. |
| GET/POST | `/graph-tabs`, `/graph-tabs/create\|update\|close` | Yes | Graph tabs (responses carry `community_id`). |
| GET/POST | `/tab-groups`, `/tab-groups/create\|rename\|delete\|toggle\|add-tab\|remove-tab` | Yes | Tab groups. |
| GET/POST | `/sidebar-items`, `/sidebar-items/reorder` | Yes | Sidebar ordering. |
| — | `/tabs/*`, `/tree-order/*`, `/rankings/*`, `/tab-activity/*`, `/remove-from-tab`, `/drift/:parentEdgeId` | — | Retired features, still mounted. Do not use. |

**Route-ordering gotcha:** literal `/web-links/*` routes must be registered before the `/web-links/:edgeId` catch-all in `routes/votes.js`.

### Other namespaces
- **Moderation (`/api/moderation`):** POST `/flag`, `/unflag`, `/vote`, `/vote/remove`, `/comment`, `/unhide` (admin); GET `/hidden/:parentId`, `/comments/:edgeId`.
- **Pages (`/api/pages`):** GET/POST `/:slug/comments`, POST `/comments/:commentId/vote`.
- **Users (`/api/users`):** GET `/search`, `/:id/profile`, `/me/export`, `/me/export-status`; PATCH `/me`.
- **Legal (`/api/legal`):** POST `/infringement`, `/counter-notice` (public notice forms).
- **Admin (`/api/admin`):** POST `/legal-removal`; GET `/legal/notices`, `/legal/counter-notices`, `/legal/removals`, `/legal/repeat-infringers`; POST `/legal/removals/:id/mark-notified`, `/legal/strikes/:id/clear`.
- **Dead code:** `/api/combos/*`, `/api/tunnels/*`.

---

## Backend Utilities

- **`utils/communityAccess.js`** (Phase 72a) — the curated permission boundary. `getCommunityForConcept` / `getCommunityForEdge` / `getCommunityForLink` → `{ id, mode }` (an edge's community is its child concept's); `isOwner(communityId, userId)`; `assertCanWriteStructure(community, userId)` and `assertVotingAllowed(community)` return `{ ok }` or `{ ok: false, status, code, error }` for the controller to send. New write or vote endpoints must use these helpers rather than inline permission SQL.

All external-service utilities share one contract: **never throw**; return a result object and log a warning on failure.
- **`utils/email.js`** — Resend wrapper (`sendVerificationEmail`, `sendWelcomeEmail`, `sendPasswordResetEmail`). Templates in `src/email-templates/`. No key → sends are skipped.
- **`utils/orcid.js`** — `exchangeOrcidCode`, `fetchOrcidEmails`, `verifyOrcidExists` (5s timeouts).
- **`utils/orcidValidator.js`** — `ORCID_DISPLAY_REGEX`, `isValidOrcid`, `orcidForDisplay`. Mirrored in `frontend/src/utils/orcidValidator.js`; keep the two regexes in sync manually.
- **`utils/safeBrowsing.js`** — `checkUrl(url) → { safe, threats }`. Fails open. Called from `votesController.addWebLink` and `previewTitle`.
- **`utils/ogTitleFetcher.js`** — `fetchOgTitle` with SSRF protection (DNS resolve + private-IP block), 5s timeout, returns null on any failure.
- **`utils/inOrcaLinks.js`** — in-orca URL grammar. The same regex is inlined in `frontend/src/components/LinkifiedText.jsx`; keep them identical.
- **`utils/userRateLimiter.js`**, **`utils/pgRateLimitStore.js`** — per-user and global rate limiting.
- **Scripts:** `backend/scripts/test-email.js <address>`, `backend/scripts/manual-verify-email.js <user-id>`.

---

## Frontend Component Map

### Routing
`App.jsx` routes `/profile/:userId`, `/orcid/callback`, `/reset-password`, `/email-verification`; `/login` and `/register` redirect to `/`; everything else goes to `AppShell`. AppShell handles info slugs (`thoroughly-conscious-ignorance`, `using-orca`), legal slugs, and deep links `/c/:slug` (Phase 72a), `/concept/:id?path=`, `/link/:id`, `/tunnel/:id` (dead), `/situation/:id` (redirects to `/`). The active community is held in AppShell state and remembered in `localStorage` (`orca_active_community`, a slug). `/c/:slug` resolves the slug, selects the community through the same path as choosing it in Communities, opens its root page, and replaces the URL with `/`; an unknown slug shows the unavailable-link toast. Works for guests.

### Pages (`frontend/src/pages/`)
- **Root.jsx** — root questions of the active community; shows a "No community selected" nudge and hides search/create when none is active.
- **Concept.jsx** — question page: children grid, Flip View, links panel, bridge badge ("also asked in"), nest-under-sibling mode, share button (always emits `?path=`, empty for roots), `#link-:id` scroll-and-highlight. Derives `votingAllowed` (not curated) and `canCreate` (curated: owner; open: logged in) from the concept response and threads them to ConceptGrid, VoteSetBar, FlipView, ConceptLinksPanel, LinkCard, and SearchField. Root.jsx does the same for the root grid.
- **ResetPasswordPage.jsx**, **VerifyEmailPage.jsx** — standalone auth pages.
- **Saved.jsx**, **SavedTabContent.jsx**, **Login.jsx**, **Register.jsx** — legacy files, not routed.

### Components (`frontend/src/components/`)
- **AppShell.jsx** — header (shows "Community: <name>"), sidebar, tabs, overlays, deep links, outreach mode. Holds the active community; graph tabs are filtered to it (root tabs always shown; groups with no in-community tabs hidden). `hasDeepLinkInUrl` suppresses default-tab activation during async deep-link resolution.
- **CommunitiesBrowse.jsx** — community list (plain "Curated" label on curated ones) and inline create form with an Open / Curated choice; selecting one sets the active community and opens a root tab.
- **CommunityHeaderControls.jsx** (Phase 72a) — in the community header: Share (copies the `/c/:slug` URL) for everyone, and an owners panel (list, add by username, remove; remove disabled for the last owner) for owners.
- **ConceptGrid.jsx** — child/root cards: `N children · M links`, `↘` cross-sibling-descendant flag, vote-set dots.
- **ConceptLinksPanel.jsx** — right-hand links panel. Children view shows the current edge's links; Flip View shows the aggregate grouped by parent context. Add-link form with a required affirmation checkbox and title preview on paste/blur. Comments render through `LinkifiedText`.
- **LinkCard.jsx** — link card: vote, "Other instances" dropdowns, Copy (adder only), Remove (adder only), Add addendum (author only), Share (`/link/:id`), ORCID badge, vote-set color dots.
- **LinkifiedText.jsx** — comment renderer that turns in-orca URLs into links (new tab); external URLs stay plain text. **ClampedText.jsx** — line-clamp with expand.
- **CopyLinkPicker.jsx** — subtree picker for copy-to-descendant.
- **FlipView.jsx** — alternate parent contexts with Jaccard similarity.
- **VotesOverlay.jsx** — display-only Votes tree (saved + context + ancestor edges, link votes nested), community-scoped. Its tree rendering is the planned base for the Phase 72 graph view.
- **SearchField.jsx** (add/search, community-scoped), **AddConceptModal.jsx**, **Breadcrumb.jsx**, **DiffModal.jsx**, **SwapModal.jsx**, **VoteSetBar.jsx**, **HiddenConceptsView.jsx**.
- **LoginModal.jsx** (ORCID-first registration, password login, forgot password), **OrcidBadge.jsx**, **OrcidCallback.jsx**, **ProfilePage.jsx**, **DeleteAccountFlow.jsx**, **ProtectedRoute.jsx**, **SidebarDndContext.jsx**.
- **InfoPage.jsx** — generic info page with comments (used for both info slugs). **OutreachLanding.jsx**.
- **LegalPage.jsx**, **TermsPage.jsx**, **PrivacyPage.jsx**, **CopyrightPage.jsx**, **CopyrightPolicyPage.jsx**, **InfringementNoticePage.jsx**, **CounterNoticePage.jsx**, **AdminLegalRemovalsPanel.jsx**.
- **Dead code:** `ComboListView.jsx`, `ComboTabContent.jsx`, `TunnelView.jsx`.

---

## Architecture Decisions (Still in Force)

### Graph model
- **Path-dependent identity.** A question's contextual identity is `graph_path` + attribute. Same question under different parents = independent votes, children, and links.
- **`graph_path` semantics (AD #137).** Root-to-parent inclusive; the parent is the last element. Never append the parent separately. Location-style responses use the field name `parentPath` to make this explicit.
- **Root edges** have `parent_id = NULL` and `graph_path = '{}'`. Subqueries over non-root edges must filter `parent_id IS NOT NULL`.
- **Single-attribute graphs.** The attribute comes from the root edge; descendants inherit; backend enforces via `graph_path[0]`.
- **Path-scoped recursive queries.** Any recursive CTE over descendants must match the full `graph_path` (`e.graph_path = st.graph_path || st.child_id`), not just `parent_id`. Filtering by concept identity alone leaks across contexts.

### Communities (Phase 71)
- **Partition, not overlay.** Concept identity is community-scoped; a `graph_path` never crosses communities, so every path- or id-scoped query is automatically community-safe. Only the three entry points that find concepts **by name or list all roots** filter by community: `getRootConcepts`, `searchConcepts`, and the reuse lookups in `createRootConcept` / `createChildConcept`.
- **Bridge, not shared identity.** Sameness across communities is discovered by `normalized_name` match, never by shared rows. A bridge click goes to the decontextualized Flip View, or to the root page if the target has no non-root placement.
- **Two governance modes (Phase 72a).** Open communities: anyone logged in adds content, votes, and flags. Curated communities: owners only add content; votes and flags are off for everyone. Communities are not user-deletable in either mode. The backend helpers in `communityAccess.js` are the security boundary; hidden UI is cosmetic.
- **Ownership policy.** Any owner can add or remove any other owner, including the creator; the last owner can never be removed. Owner rows are locked during removal so concurrent removals cannot empty the list.
- **No default community.** Only a community the browser explicitly chose before is restored on load.

### Shared structure and authorship
- **Append-only for shared graph structure.** Concepts and edges are never user-deletable; they are hidden by moderation or removed by legal action. (Phase 72 curated communities will be an explicit, owner-scoped exception.)
- **Self-authored link removal.** A user may hard-delete their own link when not under legal hold: one atomic DELETE, generic 403 on failure, votes cascade, sparse `link_removal_log` row. User removal, moderation hide, and legal removal are three separate pathways with separate audit trails — never substitute one for another.
- **Immutable comments + addenda.** Link comments cannot be edited; authors post timestamped addenda.
- **Links live on edges, and only there.** A link applies only to the edge it was placed on. It does not surface on ancestors in any view, and votes are one per user per link. Duplicate URLs on one edge are allowed (different comments are different contributions).
- **Copy-to-descendant.** The adder may copy a link to a descendant edge in the same root graph; a new row with zero votes.
- **Votes pages are display-only.** The Votes overlay only navigates; votes change from question pages.
- **Save/swap.** Saving removes an existing swap; swapping removes the save (cascading). Swaps are sibling-only; casting a swap auto-saves the replacement. Vote sets with 10+ users get swatches.

### Link safety
- **Link affirmation.** The add-link form requires ticking an affirmation that the URL is legitimately public; not stored per link.
- **OG title fetch** is server-side with SSRF protection and never throws; any failure shows "Couldn't fetch title".
- **Safe Browsing** checks every submitted URL at preview and at add (MALWARE, SOCIAL_ENGINEERING, UNWANTED_SOFTWARE, POTENTIALLY_HARMFUL_APPLICATION), rejects with 403 `unsafe_url`, logs a hash-only row, and fails open if the API is unreachable. Chosen over a domain allowlist because the threat is content, not origin.

### Auth and identity
- **ORCID is required at the database level** (`orcid_id` NOT NULL), re-verified at registration, and checked defensively at login. It is friction, not identity verification.
- **Email flows:** a flow that mutates state without user input (verification) links to the **backend** first, then redirects; a flow needing input (password reset) links to the **frontend** form.
- **Auth context stays minimal.** `AuthContext` holds only `id`, `username`, and the JWT. Everything else is fetched from the API at mount and re-fetched after mutations.
- **User IDs:** frontend `user.id`; backend `req.user.userId`. Never mix.
- **Auth middleware:** `const authenticateToken = require('../middleware/auth')` — never destructure the default export.

### Frontend patterns
- **Stale-state guard on navigation.** Edge-keyed async fetches below a navigable parent must clear param state at navigation start, use a request-generation `useRef` counter and bail out of stale setters, and await dependent setters before marking loaded. Concept components are keyed by tab, not concept, so they do not remount.
- **Tab reuse.** `handleOpenConceptTab` reuses existing tabs via `graphTabsRef`.
- **Deep links.** The deep-link effect depends on `location.pathname`. Share links build from the API's `path`, not the tab's stored path. Deep-link entry suppresses default-tab activation.
- **Cross-concept scroll and highlight.** `pendingScrollLinkId` flows AppShell → Concept → ConceptLinksPanel (300ms delay, scrollIntoView, 2s highlight).
- **`Promise.all` fault tolerance.** Every member in `loadAllTabs` needs `.catch(() => [])`.
- **LEFT JOIN** any join to `users` through a SET NULL provenance column.
- **Legal hold** on concepts, edges, and links prevents community unhide.

---

## Key Learnings

- **Phase transitions leave zombie code.** When a phase changes an assumption (a constraint, a feature removal), search for code paths that relied on the old assumption, not just the ones the phase touches. Removing a feature should come with a checklist of every page/component that consumed it. (Examples: the ORCID disconnect endpoint in 62c; the link-inheritance vote machinery that outlived the feature until October 2026.)
- **Docs drift silently.** The October 2026 audit found 44 mismatches, including a whole removed feature (Mentions) still documented as live. After each phase, update this file; periodically run a read-only Claude Code audit comparing it to the code.
- **Diagnose before fixing.** Investigation-only Claude Code prompts have been the highest-leverage tool for bugs.
- **Cite the closest existing consumer.** When a prompt adds a new producer of a behavior (a new endpoint returning a path, a new async step), name the most-similar existing consumer and match its conventions. Most path bugs have been `graph_path` convention mismatches.
- **Counts and panels must share a WHERE clause.** A badge count and the list it summarizes must use identical filters.
- **Async can break implicit ordering.** Making a previously synchronous step async can break effects that won a race by accident.
- **Precise examples in prompts are copied verbatim.** Double-check every URL, path, and SQL fragment in a prompt.
- **Frontend success pages should verify, not trust a query param.**
- **Over-general ADs outlive their rationale.** Re-evaluate principles written for removed features.
- **Keep commits to one feature, and stage files by name.**

---

## Known Tech Debt

- **Legacy votes endpoints** (`/saved`, `/web-links/votes/me`) and retired-feature routes in `routes/votes.js` should be removed once confirmed unused.
- **Dead code** for situations and tunnels (backend + frontend) could be deleted in a dedicated cleanup phase. `DeleteAccountFlow` and `/delete-account` still pre-check owned combos.
- **Legacy page files** `Saved.jsx`, `SavedTabContent.jsx`, `Login.jsx`, `Register.jsx` are unrouted.
- **Bare `/concept/N` URLs** (no `?path=`) produce a blank shell when opened; UI no longer generates them.
- **Deep-link tab labels** default to "Concept" until the name loads; update the label after the API response.
- **In-orca URL regex** is duplicated between `inOrcaLinks.js` and `LinkifiedText.jsx` with no enforcement.
- **Email verification page** trusts the redirect's `status` param; could confirm via a backend call.
- **`FRONTEND_BASE_URL`** is really the public base URL; consider renaming to `PUBLIC_BASE_URL`.
- **Production backfills** need the Railway public proxy URL (`set DATABASE_URL=<public-url>`) because `railway run` can't resolve the internal hostname.
- **Copy-link subtree depth** is hardcoded at 50.
- **AppShell** tab-management complexity warrants a refactor.
- **Stale `/the-storm` OG image** `og-the-storm.png` may remain in `frontend/public/`; safe to delete.

---

## Forward Roadmap

### Phase 72 — Curated communities (in progress; full spec in `PHASE_72_CURATED_COMMUNITIES.md`)
- ~~72a: mode + owners + `/c/:slug` + write gating~~ **completed October 19, 2026** (with a follow-up fix: same-community check in nest-under-sibling, row lock in owner removal)
- **Next: 72b** — answer fields + in-card answer section (curated) + recency sort.

Purpose: let a journal own a community built from its published papers, share it by link, and collect reader feedback. Decisions locked in planning (October 2026):

- **Built in 72a:** community modes, `community_owners`, `/c/:slug`, and curated gating for existing write/vote endpoints (see API Surface). Remaining decisions for later sub-phases:
- **Curated editing (72c):** only owners create/edit/delete questions, answers, and precedent/subsequent links. Deletes are soft (`deleted_at`) so feedback threads on removed questions can be archived. Owner edits are in place (comments mutable in curated, unlike open).
- **Navigation stays page-based.** Path-dependent identity is kept.
- **Answer information** (both modes, replacing the side links panel with an answer section inside the child card): comment, link, and **publication date**. **Multiple answers per question** allowed, ordered newest-first. Answers live on the edge, like links today. Not restricted to leaves — owners simply don't add answers to non-leaf questions.
- **Recency sorting (curated):** siblings sort by newest publication date; a leaf's date is its newest answer, a parent's is its newest descendant's.
- **Precedent / subsequent links:** directional links between **sibling** edges only (same parent and `graph_path`, enforced server-side). One row per link, shown on both cards; removing it from either side removes it from both. Block direct A↔B loops. Soft warning in edit mode when a subsequent's date is earlier than its precedent's.
- **Renaming** a question renames it everywhere it appears in the community (concept-level name); show "also appears under X" in edit mode; handle the within-community uniqueness conflict.
- **Edit mode / view mode toggle** in the header, owners only, defaulting to view. Edit mode uses dotted outlines; fields are click-to-edit; plus/X icons add/remove precedent/subsequent links; a bottom-corner plus adds a child.
- **Graph view:** a header button opens the whole graph from the root as a collapsible tree (built from VotesOverlay's tree rendering), answers as nested rows, current position highlighted, click to navigate. Offered in open communities too.
- **Reader feedback (curated only):** a feedback icon on each card (suggest edits to the question or its answers; suggest adding/removing precedent or subsequent links) and a bottom-corner icon (suggest a new child, optionally with its own children — a whole branch). Each item has free-text comments and is shown as a public thread. Readers can reply; owner replies are marked. Statuses: open / incorporated / declined. Readers can vote on feedback (visible only inside the feedback menu; sorts feedback, never the graph). Each item snapshots the text it was written against. Login required to submit; guests can read. Owners get a feedback inbox across the community plus count badges. Needs moderation, rate limits, and Safe Browsing on suggested links.
- **Remaining sub-phases:** 72b answer fields + card answer section (curated) + recency sort; 72c precedent/subsequent + edit mode; 72d graph view; 72e feedback system + owner inbox; 72f card answer section for open graphs. Later: one-click "incorporate" and email notifications.
- **Docs to revise alongside:** ToS / Copyright Policy (editorial ownership, public feedback); the append-only AD (curated exception).

### Other
- Phase 63b: `robots.txt` + `sitemap.xml` (unscheduled).
- Welcome banner / verification reminder for unverified users.
- Revised legal documents (Copyright Policy review for pre-Phase-58 references, user-removal pathway).
- Public data API; federated / connected community graphs (the long arc: connecting journal "islands").
- Retire legacy votes endpoints once the Votes overlay is proven stable.
