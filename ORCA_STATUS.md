# ORCA — Project Status & Technical Reference

**Last Updated:** May 23, 2026
**Current Status:** Phase 63a complete. Favicon + page-specific Open Graph / Twitter Card preview tags for `/`, `/the-storm`, and `/using-orca`. Site live at orcaconcepts.org with verified Bluesky link previews.

---

## Quick Context for New Claude Sessions

Orca is an open-source (AGPL v3) collaborative action ontology platform for academic research. Users create and navigate hierarchical concept graphs with context-dependent children, community voting, and concept attributes (action, tool, value, question). References to external resources are organized as **links** (URLs with optional titles and comments) attached to specific edges in the concept graph.

**Phase 58 pivot (May 2026):** Removed the entire document/corpus/annotation/message layer. The platform now uses a simpler link-based reference system: users paste URLs, the server auto-fetches Open Graph titles, and the community upvotes/discusses links. Cross-instance navigation lets users see where the same URL appears across different concepts. Full Phase 58 narrative archived in `ORCA_HISTORY.md`.

**Phase 59 (May 2026):** Tunnel links gained optional comments and now allow duplicates between the same edge pair (different comments = different rows = independent vote tallies). Graph Votes and Link Votes overlays merged into a single display-only Votes overlay with full root-to-edge ancestry rendering for link-voted edges.

**Phase 60a (May 2026):** Self-authored links may now be hard-deleted by their adder (carve-out from append-only AD — see "Append-Only" section for the reframed principle). New `link_removal_log` table preserves a sparse audit trail (sha256 of URL, no plaintext content). Add-link form gained a required affirmation checkbox and on-paste/on-blur title preview via new `GET /web-links/preview-title` endpoint reusing the existing OG-fetch utility.

**Phase 61 pivot (May 2026):** Replaced Twilio phone OTP authentication with ORCID-first email+password registration. New signup flow: (1) ORCID OAuth proves the user owns an ORCID iD, (2) the user submits username, email, password, and ToS acceptance. If the submitted email matches an ORCID-verified email returned by `/v3.0/{orcid}/email`, the account is created with `email_verified_at = NOW()` and a welcome email is sent. Otherwise a verification email with a 24-hour single-use token is sent, and the welcome email follows after the user clicks the verify link. Password reset uses a similar email-token flow. Phase 61a added the schema + Resend integration. 61b added five new backend endpoints. 61c reworked `LoginModal.jsx` and added standalone `/reset-password` and `/email-verification` pages. A follow-up fix corrected the verification email's URL (it pointed at the frontend route instead of the backend endpoint, so verification appeared to succeed but didn't actually update the database).

**Phase 62b (May 2026):** Replaced the editable-comment model on links and tunnel links with an append-only addendum system. Original comments are now immutable; the author can post timestamped addenda below. Author ORCID badges now display on both link types. Share links added for superconcepts. Deep-link navigation (`/concept/:id` and `/superconcept/:id`) now works for both logged-in users and guests.

**Phase 63a (May 2026):** Added favicon and Open Graph / Twitter Card metadata for social media link previews. The favicon is an SVG of a lowercase 'o' in Georgia serif on an off-white `#FAF9F6` tile. Three pages have dedicated `summary_large_image` preview cards (home, The Storm, Using Orca) with custom screenshots; other paths fall back to a `summary` card with the favicon. Page-specific tags are injected by the Express SPA-fallback handler via an `OG_OVERRIDES` map — crawler bots and human visitors both receive the path-correct HTML, since crawlers don't execute JavaScript. Verified working on Bluesky via the cardyb extract endpoint.

**Current state:** Site is live at orcaconcepts.org. Railway attached, domain connected. An **outreach mode** build flag (added Phase 59a) is available for soft-launching the site with the app gated behind an explanatory landing page while still allowing outreach via The Storm and Using Orca — see "Operational Modes" below.

**Key files:** This file (`ORCA_STATUS.md`) is the canonical technical reference. `ORCA_HISTORY.md` has completed phase narratives through Phase 58. `CLAUDE.md` has conventions loaded into every Claude Code session. `ORCA_TESTS.md` is the testing checklist.

---

## Tech Stack

- **Backend:** Node.js v24 / Express.js / PostgreSQL v16+ with pg_trgm
- **Frontend:** React 18 / Vite / React Router v6 / Axios
- **Auth:** JWT (jsonwebtoken) + ORCID OAuth (required) for registration + Email/Password (bcryptjs/zxcvbn) + Resend for transactional email. ORCID is enforced at the database level (`orcid_id` is NOT NULL).
- **Transactional email:** Resend, sending from `noreply@orcaconcepts.org` (domain verified via Cloudflare DNS auto-configuration).
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

## Static Assets & Social Sharing (Phase 63a)

### Favicon

`frontend/public/favicon.svg` — a lowercase 'o' in Georgia serif (black `#000` on `#FAF9F6` off-white tile, viewBox `0 0 64 64`). Referenced by `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` and `<link rel="apple-touch-icon" ...>` in `frontend/index.html`. SVG renders crisp at any size; no PNG fallbacks are generated (modern browsers handle SVG favicons natively; if legacy IE support is ever needed, that's a future phase).

### Open Graph / Twitter Card metadata

Baseline (fallback) OG and Twitter Card tags live in `frontend/index.html`. They use `og:image = favicon.svg` and `twitter:card = summary` (the small-card type) so deep-linked routes without a dedicated preview image still get a valid card.

Page-specific previews are wired up via an `OG_OVERRIDES` map in `backend/src/server.js`, structured as:

```javascript
const OG_OVERRIDES = {
  '/': { title, description, image, twitterCard },
  '/the-storm': { ... },
  '/using-orca': { ... },
};
```

Each override path has its own 1200x630 PNG screenshot in `frontend/public/` (`og-orca-main.png`, `og-the-storm.png`, `og-using-orca.png`) and uses `twitter:card = summary_large_image` (the big-card type).

**Architecture:** The Express SPA-fallback handler (the `/^(?!\/api).*/` catch-all that serves `frontend/dist/index.html` per Phase 54b) does string replacement on the cached `index.html` to inject the override tags when `req.path` has an entry in `OG_OVERRIDES`. All replacement values are HTML-escaped to prevent injection. Tags are served unconditionally — there is NO User-Agent gating, because human visitors never see meta tags and UA detection is brittle. The cache is loaded once at server start.

**Static-serving gotcha:** Express's `express.static(frontendDist)` by default serves `index.html` for directory requests (i.e., `/`), bypassing the SPA fallback. Phase 63a-fix disables this with `express.static(frontendDist, { index: false })` so the home page falls through to the SPA fallback and picks up its override. Without this, all other override paths work but `/` silently serves the fallback tags.

**Adding a new page-specific OG card:** (1) place a 1200x630 PNG in `frontend/public/`, (2) add a one-line entry to `OG_OVERRIDES` with the path, title, description, absolute image URL, and `twitterCard`. Verify via `https://cardyb.bsky.app/v1/extract?url=...` after deploy.

**Cache gotcha:** Bluesky, Twitter, and other platforms cache OG data aggressively. If a preview looks wrong after a fix, the platform's debugger tools (e.g., cardyb) often have a refresh affordance, or you can append a dummy query string to force a fresh fetch.

---

## Database Schema (Post-Phase 61a)

All tables below are created/maintained in `backend/src/config/migrate.js`. Tables dropped in Phase 58a (documents, corpuses, annotations, messages, citations, etc.) are documented in `ORCA_HISTORY.md`.

### Core Tables

**users** — User accounts
- `id`, `username` (unique), `email`, `password_hash`, `token_issued_after`, `age_verified_at`, `orcid_id` (NOT NULL, partial unique index), `tos_accepted_at`, `tos_version_accepted`, `created_at`
- **Email verification and password reset columns (Phase 61a):** `email_verified_at`, `email_verification_token` (VARCHAR(64), partial index WHERE NOT NULL), `email_verification_expires_at`, `password_reset_token` (VARCHAR(64), partial index WHERE NOT NULL), `password_reset_expires_at`. Tokens are single-use random hex; consuming a token clears it.

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
- Hard-deletable by `added_by` user via `POST /web-links/remove` when `legal_hold = false` (Phase 60a). Deletion cascades to `concept_link_votes` rows. A sparse audit record is written to `link_removal_log` (URL sha256 only, no plaintext). Moderation hide and legal removal pathways remain separate and unaffected.

**concept_link_votes** — Simple upvotes on links. UNIQUE(user_id, concept_link_id).

**concept_link_addenda** — Append-only addenda posted by the link's author below the original comment (Phase 62b).
- `id`, `concept_link_id` (FK concept_links, CASCADE, NOT NULL), `author_id` (FK users, SET NULL), `body` (TEXT, NOT NULL), `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- Index on `concept_link_id`. Author is always the parent link's `added_by` at write time — enforced by backend, not by FK.

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

**tunnel_link_addenda** — Append-only addenda posted by the tunnel link's author (Phase 62b).
- `id`, `tunnel_link_id` (FK tunnel_links, CASCADE, NOT NULL), `author_id` (FK users, SET NULL), `body` (TEXT, NOT NULL), `created_at` (TIMESTAMPTZ, NOT NULL, DEFAULT NOW())
- Index on `tunnel_link_id`. Same author-enforcement pattern as `concept_link_addenda`.

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
**link_removal_log** — Sparse audit trail for user-initiated link removals (Phase 60a). Records `removed_link_id` (no FK, the link is gone), `removed_by_user_id` (FK users, SET NULL), `original_edge_id` (no FK), `original_url_hash` (sha256 of lowercased URL, CHAR(64)), `removed_at`. No plaintext URL, title, or comment is preserved — this is intentional. Indexed on `removed_by_user_id` and `original_url_hash` for forensic lookup ("did user X ever post URL Y?").

### Infrastructure Tables

**rate_limit_counters** — Postgres-backed rate limit store (SMS, global safety net).
**data_export_requests** — Audit log for self-service data exports (2 per 12 months).

---

## API Surface (Post-Phase 61b)

All routes mounted in `backend/src/server.js`. Auth: `authenticateToken` = required JWT; `optionalAuth` = guest-accessible.

### Authentication (`/api/auth`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/login` | No | Password login (username or email) |
| POST | `/orcid/begin-registration` | No | **NEW Phase 61b.** Step 1 of ORCID-first registration. Exchanges ORCID OAuth code, returns ORCID iD + verified/unverified emails for form prefill. Does not create an account. 409 if an account already exists with that ORCID iD. |
| POST | `/register-with-orcid` | No | **NEW Phase 61b.** Step 2 of registration. Creates the user account. If submitted email is in `verifiedEmailsFromOrcid`, sets `email_verified_at = NOW()` and sends welcome email; otherwise sends verification email. Returns JWT + user + `emailVerificationStatus`. |
| GET | `/verify-email` | No | **NEW Phase 61b.** Token-based email verification. Redirects to `${FRONTEND_BASE_URL}/email-verification?status=...`. Single-use token; consuming it clears the row's verification token columns. Sends welcome email on success. |
| POST | `/forgot-password` | No | **NEW Phase 61b.** Email-based password reset initiation. Always returns 200 with the same message regardless of whether the user exists (timing-safe). Rate-limited (5/hour/IP). Generates a 64-char hex token with a 1-hour expiry. |
| POST | `/reset-password` | No | **NEW Phase 61b.** Token-based password reset completion. Validates token + new password strength, updates `password_hash`, advances `token_issued_after` (invalidates all existing JWTs for this user), clears reset token. |
| GET | `/me` | Yes | Get current user info |
| POST | `/logout-everywhere` | Yes | Invalidate all JWTs (advances `token_issued_after`) |
| POST | `/delete-account` | Yes | Delete account (requires zero owned combos) |
| GET | `/orcid/authorize-url` | Optional | ORCID OAuth URL (with optional `state` param to distinguish register vs link flows) |
| POST | `/orcid/callback` | Yes | Exchange ORCID code for existing-account linking |
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
| GET | `/web-links/all/:conceptId` | Guest | All links across contexts. Each link includes `addenda[]` and `authorOrcidId` (Phase 62b). |
| GET | `/web-links/preview-title` | Yes | **NEW Phase 60a.** Title preview for the add-link form. Query: `?url=...`. Validates well-formed http(s) URL (400 on malformed). Reuses the same OG-fetch utility as `POST /web-links/add` with SSRF protection (DNS resolve + private IP block) + 5s timeout. Returns `{ title: string }` (may be empty if no OG title found; SSRF-blocked URLs also return empty title — see "OG Title Auto-Fetch" AD for the rationale). |
| GET | `/web-links/votes/me` | Yes | User's upvoted links (legacy, retained for rollback safety post-59b) |
| GET | `/web-links/:edgeId` | Guest | Links for edge (?sort=top/new). Each link includes `addenda[]` and `authorOrcidId` (Phase 62b). |
| POST | `/web-links/add` | Yes | Add link (OG title auto-fetch) |
| POST | `/web-links/remove` | Yes | **RESTORED Phase 60a.** Hard-delete a self-authored link. Body: `{ linkId }`. Single SQL statement checks `added_by = req.user.userId AND legal_hold = false` to close the race against admin legal-hold-set. 403 with generic error on any failure (no information leakage). On success: row deleted, votes cascade, sparse record written to `link_removal_log`. This is the new-semantics version distinct from the version eliminated in commit `0b382c4`. |
| POST | `/web-links/copy` | Yes | Copy link to a descendant edge (adder only, same root graph, descendant edge required). Returns new row; original untouched. |
| POST | `/web-links/:linkId/addenda` | Yes | **NEW Phase 62b.** Add an addendum to a self-authored link. Body: `{ body }`. 2000 char limit. Atomic `added_by` + `legal_hold` check. Replaces the deleted `PUT /web-links/:linkId/comment` endpoint. |
| POST | `/web-links/upvote` | Yes | Upvote link |
| POST | `/web-links/unvote` | Yes | Remove upvote |
| GET | `/saved` | Yes | User's saved edges (legacy, retained for rollback safety post-59b) |
| GET | `/me/all` | Yes | **NEW Phase 59b.** Unified votes payload for the combined Votes overlay. Returns `{ savedEdges, linkVotes, contextEdges, ancestorEdges }`. `contextEdges` are edges referenced by link votes but not saved by the user; `ancestorEdges` walk root-to-edge for every saved + context edge so the frontend can render full ancestry. Both context and ancestor entries are flagged `isContextOnly: true`. Single recursive CTE — no N+1. |
| POST | `/add` | Yes | Save an edge |
| POST | `/remove` | Yes | Unsave (cascades) |
| GET/POST | `/swap/*` | Yes | Swap vote CRUD |
| POST | `/link/add`, `/link/remove` | Yes | Flip View link votes |
| GET/POST | `/graph-tabs/*` | Yes | Graph tab CRUD |
| GET/POST | `/tab-groups/*` | Yes | Tab group CRUD |
| GET/POST | `/sidebar-items/*` | Yes | Sidebar ordering |

**Route ordering gotcha (Phase 60a):** Literal-path routes under `/web-links/*` (e.g., `/web-links/preview-title`, `/web-links/votes/me`, `/web-links/by-url`, `/web-links/all/:conceptId`) MUST be registered in `routes/votes.js` BEFORE the `/web-links/:edgeId` catch-all, or Express will interpret the literal segment as an `edgeId` and shadow the literal route. Any new endpoint added in this namespace must follow the same ordering.

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
| GET | `/:edgeId` | Guest | Tunnel links for edge. Each row returns `comment`, `addenda[]`, `authorOrcidId`, and `createdByUserId` (Phase 62b). |
| POST | `/create` | Yes | Create tunnel. Accepts optional `comment` (Phase 59a). Duplicates between the same edge pair are now allowed — every POST creates a new row. |
| POST | `/vote` | Yes | Toggle tunnel vote (per-row, unchanged) |
| POST | `/:tunnelLinkId/addenda` | Yes | **NEW Phase 62b.** Add an addendum to a self-authored tunnel link. Body: `{ body }`. 2000 char limit. `created_by` check. |

### Moderation (`/api/moderation`)
POST `/flag`, `/unflag`, `/vote`, `/vote/remove`, `/comment`, `/unhide` (admin). GET `/hidden/:parentId`, `/comments/:edgeId`.

### Pages (`/api/pages`)
GET `/:slug/comments`, POST `/:slug/comments`, POST `/comments/:commentId/vote`.

### Users (`/api/users`)
GET `/search`, `/:id/profile`, `/me/export`, `/me/export-status`. PATCH `/me`.

### Admin (`/api/admin`)
POST `/legal-removal`, GET `/legal/removals`, POST `/legal/removals/:id/mark-notified`, GET `/legal/repeat-infringers`, POST `/legal/strikes/:id/clear`.

---

## Backend Utilities

- **`backend/src/utils/email.js`** (Phase 61a) — Resend wrapper. Exports `sendVerificationEmail`, `sendWelcomeEmail`, `sendPasswordResetEmail`. Each function NEVER throws — returns `{ success, error }`. Fails loudly at module load if `RESEND_API_KEY` is missing in production; warns in dev. Templates live in `backend/src/email-templates/{verify-email,welcome,reset-password}.html`.
- **`backend/src/utils/orcid.js`** (Phase 61b) — Shared ORCID API utility. Exports `exchangeOrcidCode`, `fetchOrcidEmails`, `verifyOrcidExists`. Used by both `POST /api/auth/orcid/callback` (existing-account linking) and `POST /api/auth/orcid/begin-registration` (new-account registration). All calls have 5-second timeouts.
- **`backend/scripts/test-email.js`** (Phase 61a) — CLI script for manually testing Resend integration. Usage: `node scripts/test-email.js <email-address>`.
- **`backend/scripts/manual-verify-email.js`** (Phase 61 follow-up fix) — CLI admin tool to manually mark a user's `email_verified_at` and send their welcome email. Created during the verify-URL bug postmortem; useful for any future case where email delivery leaves a user in a stuck state. Usage: `node scripts/manual-verify-email.js <user-id>`.

---

## Frontend Component Map (Post-Phase 61c)

### Pages (`frontend/src/pages/`)
- **Root.jsx** — Root concepts page with attribute filter
- **Concept.jsx** — Concept page with children, Flip View, Tunnel View, links panel. **Phase 62b fix:** Share link now uses `path` state (from API response) instead of `effectivePath` (tab path) — the previous code stripped the parent from the URL because `effectivePath` doesn't end with the concept ID in tab mode.
- **ResetPasswordPage.jsx** — **NEW Phase 61c.** Standalone page at `/reset-password`. Reads `token` from query params, shows new-password form, POSTs to `/api/auth/reset-password`. On success, brief message then `navigate('/')` after 2 seconds. Accessible without auth.
- **VerifyEmailPage.jsx** — **NEW Phase 61c.** Standalone page at `/email-verification`. Reads `status` and `reason` query params (set by the backend `/api/auth/verify-email` redirect). Shows success (auto-redirects home after 2s) or error (with "Return to home" link). Accessible without auth.

### Core Components (`frontend/src/components/`)
- **AppShell.jsx** — Main layout: header, sidebar, tab management, overlays. Single "Votes" sidebar item replaces the former "Graph Votes" and "Link Votes" entries (Phase 59b). Reads `VITE_OUTREACH_MODE` into `isOutreachMode` (~line 24, Phase 59a) — when ON, hides Legal nav + login/signup, renders `<OutreachLanding />` in place of the sidebar/content area. **Phase 62b:** Deep-link effect handles `/concept/:id?path=...` (opens concept tab for guests and logged-in users) and `/superconcept/:id` (subscribes + opens combo tab for logged-in users; shows read-only `ComboTabContent` with back button for guests). `guestComboId` state tracks the deep-linked combo for guest viewing.
- **OutreachLanding.jsx** — **NEW Phase 59a.** Landing page shown when `VITE_OUTREACH_MODE=true`. Replaces the entire app surface with an explanation that the platform is not yet live. See "Operational Modes" section.
- **ConceptLinksPanel.jsx** — Right panel on concept page (Links tab + Superconcepts tab). Passes `conceptId` and `conceptPath` to LinkCard for copy-to-descendant flow. Uses shared `ClampedText`. **Phase 60a:** add-link form gained (a) a required affirmation checkbox ("I affirm this URL points to content that is publicly available through legitimate means...") — Submit disabled until checked, state NOT persisted across modal close/reopen; (b) title preview triggered by URL field `onPaste` or `onBlur` (whichever fires first) calling `GET /web-links/preview-title` with `AbortController` cancellation on URL change; pre-fills title field on success with inline edit allowed.
- **LinkCard.jsx** — Reusable link card. Always-visible "Other instances on this concept (N)" / "Other instances across all concepts (N)" dropdowns (disabled when N=0). Prominent up-arrow vote icon. "Copy" button visible only when the current user is the link's adder. **Phase 60a:** "Remove" button restored, visible only when `currentUser?.id === link.added_by`. **Phase 62b:** Comment edit UI removed (original comments now immutable). "Add addendum" button visible to author only — opens inline modal with textarea, 2000-char counter, Escape-to-close. Addenda display below original comment with timestamps using shared `ClampedText`. Author username now accompanied by `OrcidBadge` (from `authorOrcidId` field).
- **ClampedText.jsx** — **NEW Phase 59a.** Shared line-clamp component with expand toggle. Extracted from duplicated copies in LinkCard and ConceptLinksPanel; also consumed by TunnelView for tunnel comments.
- **CopyLinkPicker.jsx** — Modal overlay for copying a link to a descendant edge. Expandable tree picker with path-scoped subtree fetch, request-generation race guard, Escape-to-close. Calls `POST /api/votes/web-links/copy` on confirm.
- **ComboTabContent.jsx** — Superconcept tab: header, edge management, aggregated links view. Has request-generation race guard on `loadComboLinks`. **Phase 62b:** Share button in header copies `/superconcept/:id` URL to clipboard. Unsubscribe button conditionally hidden when rendered in guest read-only mode (no `onUnsubscribe` callback).
- **ComboListView.jsx** — Browse Superconcepts overlay
- **VotesOverlay.jsx** — **NEW Phase 59b.** Combined display-only votes page. Hierarchical tree built from `GET /api/votes/me/all` (saved edges + context edges + ancestors), with the user's link votes nested under each edge. No remove affordances anywhere — navigation into the concept is the only way to change votes. Saved edges visually distinguished from context-only edges. Applies Stale-State Guard request-generation pattern. Replaces the deleted `SavedPageOverlay.jsx` and `LinkVotesOverlay.jsx`.
- **FlipView.jsx** — Alt parent contexts with Jaccard similarity
- **TunnelView.jsx** — Cross-graph tunnels by attribute columns. Renders each tunnel row's optional `comment` (Phase 59a) using shared `ClampedText`. Duplicates between the same edge pair are expected and rendered as independent rows with independent vote counts — do not collapse them. **Phase 62b:** Each tunnel card now shows author username + `OrcidBadge`. Addenda display below comment. "Add addendum" button visible to author only with inline modal.
- **ConceptGrid.jsx** — Grid display for child concepts
- **SearchField.jsx** — Combined add/search with trigram matching
- **DiffModal.jsx** — Side-by-side concept comparison
- **SwapModal.jsx** — Swap vote picker (sibling-only)
- **VoteSetBar.jsx** — Vote set color swatches and filtering
- **HiddenConceptsView.jsx** — Moderation review panel
- **LoginModal.jsx** — Login/Register/Forgot password modal. **Phase 61c:** registration tab now shows "Sign up with ORCID" as Step 1 (no email/password fields until ORCID auth succeeds), then a Step 2 form with email (prefilled from ORCID-verified email if available), username, password, and ToS checkbox. The Twilio-based phone OTP signup was removed. Forgot-password sub-view replaced with email-based reset request (calls `/api/auth/forgot-password`, shows timing-safe confirmation message).
- **ProfilePage.jsx** — User profile with ORCID, Privacy and Data section
- **DeleteAccountFlow.jsx** — Account deletion with superconcept transfer pre-check
- **SidebarDndContext.jsx** — Drag-and-drop for sidebar reordering
- **InfoPage.jsx** — Using orca page with comments
- **TheStormPage.jsx** — Static essay page
- **LegalPage.jsx** — Legal hub
- **TermsPage.jsx**, **PrivacyPage.jsx**, **CopyrightPage.jsx**, **CopyrightPolicyPage.jsx** — Static legal pages
- **AdminLegalRemovalsPanel.jsx** — Admin legal removal panel
- **OrcidBadge.jsx**, **OrcidCallback.jsx** — ORCID integration. **Phase 61c:** `OrcidCallback.jsx` extended to handle a `state` query param distinguishing `register` (new account flow) from `link` (existing account flow). For `state=register`, calls `/api/auth/orcid/begin-registration` and routes the user to the Step 2 registration form with ORCID data prefilled.

**Deleted in Phase 59b:** `SavedPageOverlay.jsx`, `LinkVotesOverlay.jsx`.

---

## Architecture Decisions (Still in Force)

### Path-Dependent Identity
A concept's contextual identity is determined by graph_path + attribute. Same concept under different parents = different contextual entities with independent votes, children, and links.

### graph_path Semantics (AD #137)
`graph_path` stores root-to-parent inclusive. Parent IS the last element. Never append parent_name separately.

### Single-Attribute Graphs
Every graph has one attribute from the root edge. Descendants inherit. Backend enforces via `graph_path[0]` lookup.

### Append-Only for Shared Graph Structure (reframed Phase 60a)
Append-only applies to **shared graph structure** — content that becomes part of other users' experience and that other users vote on or build atop. **Concepts and edges are never user-deletable** (only hidden via moderation or legally removed). Votes on shared structure persist as history.

**Carve-out for self-authored, self-contained content (Phase 60a):** A user may hard-delete their own `concept_links` rows via `POST /web-links/remove` when `legal_hold = false`. The rationale: a link is sufficiently self-contained that its removal does not collapse other users' graph structure — only the URL, title, comment, and vote count disappear; the edge itself, the concept structure, and other links remain. Compare to a concept or edge whose deletion would orphan every downstream contribution. Link mobility is still provided by the copy-to-descendant flow.

**Comment immutability + addenda (Phase 62b):** Original comments on `concept_links` and `tunnel_links` are now immutable once created. The `PUT /web-links/:linkId/comment` endpoint has been removed. Instead, the author may post append-only addenda via `POST /web-links/:linkId/addenda` or `POST /tunnels/:tunnelLinkId/addenda`. Each addendum is timestamped and displayed below the original comment. Addenda cascade-delete with their parent link. This is a strengthening of the append-only principle — not an exception.

This is a narrower statement of the original append-only principle. The previous version (commit `0b382c4`) generalized "append-only" beyond shared structure because annotations — the pre-Phase-58 feature it was written for — *seemed* self-contained but actually weren't (threading + anchoring made them load-bearing for others). Now that annotations are gone, the principle can be sharpened to its actual target: shared structure.

### User Removal of Self-Authored Links (Phase 60a)
A self-authored `concept_links` row may be hard-deleted by its `added_by` user via `POST /web-links/remove`. Specifics:
- **Permission check is atomic with the delete.** The query is a single DELETE with both `added_by = req.user.userId` AND `legal_hold = false` in the WHERE clause. This closes the race window where an admin sets `legal_hold` between a permission check and a delete.
- **Failure mode is opaque.** Both "not the adder" and "under legal hold" return identical 403 responses ("Cannot remove this link"). Distinguishing them would leak information about which links are under legal review.
- **Hard delete, not soft.** No `is_removed` flag, no tombstone row in `concept_links`. The row is physically removed. Cascading FK on `concept_link_votes.concept_link_id` removes vote rows. Other users who had upvoted lose their vote silently — this is the cost of the "gone means gone" semantic.
- **Sparse audit trail.** A row is INSERTed into `link_removal_log` inside the same transaction: `removed_link_id`, `removed_by_user_id`, `original_edge_id`, `original_url_hash` (sha256 of lowercased URL), `removed_at`. No plaintext URL, title, or comment is preserved. This is sufficient to answer "did user X ever post URL Y?" for legal/moderation questions without retaining the content the user wanted removed.
- **Three distinct removal pathways now exist, each with its own audit table:** user-removal (`link_removal_log`, sparse hash-only), moderation-hide (`is_hidden = true` on the edge, content retained), legal-removal (`legal_removals`, content retained for takedown record). They are not interchangeable — admins should NOT use the user-removal endpoint to hide content for moderation reasons, because that pathway destroys the content.
- **Tunnel links are out of scope.** `tunnel_links` remains append-only — its row is shared graph structure across two graphs, and the symmetric "carve-out" reasoning is weaker for cross-graph artifacts.

### Link Affirmation at Posting (Phase 60a)
The add-link form requires the user to tick an affirmation checkbox before Submit is enabled:

> I affirm this URL points to content that is publicly available through legitimate means (e.g., open access publication, the publisher's website, an institutional or preprint repository), and that posting this link does not violate any agreement, embargo, or known prohibition.

The affirmation is a UI-layer commitment, not a per-link database field. It exists for the user's moment-of-decision before posting, not as a stored record. State is not persisted across modal close/reopen — every link is a fresh affirmation. This pairs with the DMCA agent registration and Copyright Policy as the platform's layered approach to user-generated link content (cf. the upcoming Phase 60-cluster legal hardening work).

### Title Preview on Blur or Paste (Phase 60a)
The add-link form fetches the OG title via `GET /web-links/preview-title` when the user pastes a URL or blurs the URL field, whichever fires first. Implementation notes:
- Validation before fetch: non-empty + `URL.canParse(value)` + http(s) protocol. Silent failure if invalid (user may still be typing).
- `AbortController` cancels the in-flight fetch when the URL changes, so only the most recent URL drives the displayed title.
- The fetched title pre-fills the title field but remains user-editable. On submit, the field's current value is sent — the existing `POST /web-links/add` OG-fetch fallback handles empty titles regardless.
- Failure path shows "Couldn't fetch title — you can enter one manually" and ensures the title field is visible. The user can submit anyway with a manually entered title.

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

The OG-fetch utility (`fetchOgTitle`) is designed to **never throw** — it returns `null` (or empty string at the endpoint layer) on any failure, including SSRF blocks, timeouts, no-OG-tag pages, and network errors. This is intentional because both call sites (`POST /web-links/add` and `GET /web-links/preview-title`, Phase 60a) need to handle "no title available" gracefully without distinguishing the cause. The consequence: a user attempting to preview a private-IP URL will see "Couldn't fetch title — you can enter one manually" instead of a specific SSRF error. The SSRF protection IS still active (no request leaves the server); the user-facing message is just less specific. Acceptable because the threat model does not include accidental private-IP URLs from researchers, and distinguishing failure modes would either (a) change the utility's contract in a way that affects `addWebLink`, or (b) require duplicating SSRF checks at the controller layer.

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

### Verification URLs Point at Backend, Reset URLs Point at Frontend (Phase 61b fix, May 2026)
Email verification works by emailing the user a link to a **backend** endpoint (`${FRONTEND_BASE_URL}/api/auth/verify-email?token=...`). The backend handler does the actual database mutation (sets `email_verified_at`, clears the token, sends the welcome email) and THEN redirects to a frontend page (`/email-verification?status=success`). The frontend page is a thin presentation layer.

Password reset works the opposite way. The reset email links to a **frontend** page (`${FRONTEND_BASE_URL}/reset-password?token=...`). The frontend renders a "set a new password" form and POSTs to the backend on submit.

The asymmetry exists because verification needs no user input (just clicking the link IS the action), while reset needs the user to choose a new password. Putting verification on the frontend (as initially shipped in Phase 61b before being fixed) created a silent failure: the page rendered "success" regardless of whether the backend had run.

**AD:** Any email-triggered flow that mutates state without user input goes to the backend first. Any email-triggered flow that needs the user to enter something goes to the frontend first. New auth-adjacent email flows should follow this split.

### ORCID is Required at the Database Level (Phase 61d/e, May 2026)
`users.orcid_id` is NOT NULL. Every user account must have an ORCID iD linked. This is enforced at three layers:
1. **Database constraint** — any INSERT or UPDATE leaving `orcid_id` NULL is rejected by Postgres.
2. **Registration flow** — `POST /api/auth/register-with-orcid` requires an ORCID iD that the backend re-verifies via ORCID's public API before creating the row.
3. **Login defensive check** — `POST /api/auth/login` rejects with `account_missing_orcid` if it ever loads a user row with NULL `orcid_id` (defends against future migration mistakes).

This is a soft validation mechanism, not identity verification — anyone can create an ORCID. The friction filters casual abuse and signals that the platform is researcher-oriented. If persistent abuse emerges, the next layer of defense is "ORCID must have at least N works" or "ORCID must be older than N days" — both are additional checks at registration time, not architectural changes.

### Auth Context Stays Minimal; Profile Data Comes from API (Phase 62a, May 2026)
The auth context (`AuthContext.jsx`) is the source of truth ONLY for identity-level data needed to render the app shell: user `id`, `username`, and the JWT. Everything else about a user — `email`, `email_verified_at`, `orcid_id`, profile fields, subscription state, etc. — must be fetched from the appropriate API endpoint at component mount time.

Rationale: the auth context is populated once at login (or registration) and only re-populated on subsequent logins. It cannot reliably reflect changes to user data that happen during an active session. Treating it as a cache of the full user record creates bugs where stale data displays after user edits, after schema changes, or after the user record gets updated server-side via admin action.

The profile page is the first component to apply this split explicitly. Future components displaying user-data fields should:
1. Take the user `id` from auth context (since that's identity, not data)
2. Fetch the full record via the appropriate endpoint (e.g., `GET /api/users/:id/profile`)
3. Render from the fetched response, not from auth context
4. Re-fetch after any successful mutation that affects user data

Components that only need identity (e.g., "show username in header") continue to read from auth context — that's the correct use.

### Deep-Link Navigation for Concepts and Superconcepts (Phase 62b, May 2026)
AppShell has a `useEffect` keyed on `[loading, authLoading, location.pathname]` that handles two URL patterns:

- **`/concept/:id?path=1,2,3`** — calls `handleOpenConceptTab(conceptId, path)` which creates or reuses a graph tab. Works for both guests (ephemeral tab) and logged-in users (persisted tab). The URL is replaced with `/` after processing.
- **`/superconcept/:id`** — for logged-in users, calls `handleSubscribeToCombo` (subscribes if needed, switches to combo tab). For guests, sets `guestComboId` state which renders a read-only `ComboTabContent` with a back button. URL replaced with `/`.

**AD:** The deep-link effect must depend on `location.pathname`, not just `loading`/`authLoading`. Without the pathname dependency, the effect only fires on initial load — navigating to a share link while already loaded would not trigger it.

**AD:** The concept share link (`Concept.jsx`) must use the `path` state (from the API response, which is `[root, ..., parent, conceptId]`) when building the URL, NOT `effectivePath` (the tab's stored path, which is `[root, ..., parent]` without the concept ID). Using `effectivePath.slice(0, -1)` strips the parent instead of the concept ID.

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

## Phase 62b Completion Narrative

Phase 62b replaced the editable-comment model with an append-only addendum system, added author ORCID display, and shipped share links with deep-link navigation.

**62b-1 through 62b-4 (core addenda work):** Two new tables (`concept_link_addenda`, `tunnel_link_addenda`) with FK CASCADE. The `PUT /web-links/:linkId/comment` endpoint was removed; two new `POST .../addenda` endpoints were added with atomic `added_by`/`legal_hold` checks and a 2000-character limit. Both `GET /web-links/:edgeId` and `GET /web-links/all/:conceptId` (flip view) now return `addenda[]` and `authorOrcidId` per link. `GET /tunnels/:edgeId` returns the same plus `createdByUserId`. Frontend: LinkCard lost its edit UI, gained addendum display (with `ClampedText`), "Add addendum" modal, and `OrcidBadge` next to author name. TunnelView gained author display, addendum display, and "Add addendum" modal. ConceptLinksPanel cleaned of all edit-related state and props.

**Share links and deep-link navigation:** A Share button was added to both the concept page header and the superconcept (combo) tab header. Clicking it copies a URL (`/concept/:id?path=...` or `/superconcept/:id`) to the clipboard. A new `useEffect` in AppShell handles these URLs on navigation: concepts open a graph tab (works for guests and logged-in users); superconcepts subscribe + open the combo tab (logged-in) or show a read-only `ComboTabContent` with a back button (guests).

**Share link path bug:** The concept share handler used `effectivePath.slice(0, -1)` to build the URL. In tab mode, `effectivePath` is the tab's stored path (`[root, ..., parent]`), not the API response path (`[root, ..., parent, conceptId]`). Slicing `effectivePath` stripped the parent from the URL instead of the concept ID. Fixed to use the `path` state from the API response. This was a pre-existing bug that only became visible once deep-link navigation was added — previously share links just showed the root page for guests.

**Deep-link dependency bug:** The initial `useEffect` depended only on `[loading, authLoading]`, so it never re-ran when a logged-in user navigated to a share link (both values were already `false` and stable). Fixed by adding `location.pathname` to the dependency array.

**Lessons:**
- `effectivePath` (the tab's stored path) and `path` (the API response's full graph_path) diverge because the backend appends the concept ID to the path param. Any code that needs the full graph_path should use the API response, not the tab state.
- `useEffect` dependencies for URL-driven effects must include the URL parts they depend on. `location.pathname` is not a derived value from `loading` — omitting it means the effect only fires on mount.

---

## Phase 62a Completion Narrative

Three small frontend fixes plus minor backend cleanup, all triggered by post-Phase-61 testing surfacing zombie UI:

1. **Profile page data-fetch bug:** The profile page was reading user data from auth context, but the auth context doesn't include the `email` field. Newly-registered users saw "Email: not set" until they pressed F5, which triggered a fresh fetch from `GET /api/users/:id/profile` (which DOES include email). Fix: profile page now fetches user data from the API on mount via `useEffect`, with auth context demoted to "identity only" (id, username, JWT). Edit affordances re-fetch after save to avoid stale display.

2. **Annotation filters on concept pages:** Phase 58a dropped the annotation tables but left UI filter options for "annotations" and "top annotations" in place. They were either dead-clicking or silently filtering on columns that no longer existed. Removed from concept pages, sort dropdowns, and any backend route branches that accepted `sort=annotations`.

3. **Corpus/document counters on profile page:** Profile page showed "Corpuses created" and "Documents uploaded" with no numbers — the underlying tables were dropped in 58a, so the JOIN/COUNT queries returned nothing. Removed both the JSX and the backend computation.

**Lesson:** Phase 58 (the document/corpus/annotation layer removal) was a large surgical change and the post-removal UI audit was incomplete. After major schema deletions, every page that consumed the deleted data should be explicitly walked. Filed for next time: when removing a major feature, the deletion PR should include a "consumer checklist" of every page/component that referenced it, with each item explicitly checked off after the corresponding UI is cleaned up.

**Related architecture pattern:** "Auth context = who you are; API call = full data" is now the documented norm (see new AD below). The profile page is the first explicit consumer of this split — future user-data displays should follow the same pattern.

---

## Phase 61 Completion Narrative (through 61c + fix)

Phase 61 replaced Twilio phone OTP authentication with ORCID-first email+password registration.

**The trigger:** Twilio was annoying to deal with for an academic-research target audience (researchers are global, SMS deliverability is uneven internationally, and the SMS cost-per-signup adds up). ORCID was already partially integrated for post-login account linking. Making ORCID required for registration provided soft validation against spam ("you have to have an ORCID to sign up" is moderate friction for bad actors and zero friction for the target audience) without claiming identity verification (anyone can make an ORCID).

**Five sub-phases planned, three complete:**
- **61a (commit `8f5837e`)** added the Resend integration, the email-sending utility, three HTML email templates, five new `users` columns for email verification and password reset tokens, and a manual test script. No auth logic changed.
- **61b (commit `34a23f8`)** added five new backend endpoints (`orcid/begin-registration`, `register-with-orcid`, `verify-email`, `forgot-password`, `reset-password`), extracted ORCID logic to a shared `utils/orcid.js`, and left the four Twilio-based endpoints in place untouched.
- **61c (commit `6a1bbbb`)** reworked `LoginModal.jsx` and `OrcidCallback.jsx` for ORCID-first signup, added standalone `/reset-password` and `/email-verification` pages, and stopped the frontend from calling any of the Twilio endpoints. The backend Twilio endpoints stayed alive as zombie code.
- **61d/e (combined, shipped May 16, 2026)** combined into a single cleanup commit because the production database had no real users requiring migration — manual SQL linked the admin's ORCID and deleted the test user, after which `orcid_id` could be made NOT NULL safely. The combined phase: dropped `phone_hash` and `phone_lookup` columns, added the NOT NULL constraint on `orcid_id`, deleted four legacy auth endpoints and their controller methods, deleted `backend/src/utils/phoneAuth.js`, uninstalled the `twilio` npm package, removed four Twilio env vars from `.env.example` and from Railway, and added a defensive ORCID-present check at login. The Twilio account itself remains active externally (user's choice whether to cancel it) but nothing in the codebase or Railway references it.

**The verify-URL bug:** Phase 61a's prompt to Claude Code (written by the chat-side Claude) included a specific example URL pattern (`${FRONTEND_BASE_URL}/verify-email?token=...`) that omitted the `/api/auth` prefix. Claude Code followed the example, so the verification email's link pointed at the frontend route instead of the backend endpoint. The frontend route happily rendered "success" regardless of whether the backend had run, so the bug was invisible until manual database inspection showed `email_verified_at` was still NULL for a "verified" user. Fixed in commit `6af90ce`. Documented as an Architecture Decision (see "Verification URLs Point at Backend, Reset URLs Point at Frontend"). One affected test user was manually verified via SQL.

**Resend domain verification:** Initial deployment used Resend's test sender (`onboarding@resend.dev`), which only delivers to the address that signed up for Resend. This blocked multi-email testing. Domain verification for `orcaconcepts.org` was auto-configured via Cloudflare's Resend integration, after which `noreply@orcaconcepts.org` became the production sender.

**Lessons:**
- When writing a prompt for Claude Code, example URLs in the prose are treated as authoritative patterns. Vague specs Claude Code interprets sensibly; precise but incorrect examples it copies verbatim. Double-check any concrete URLs / file paths / SQL fragments in prompts before sending.
- A frontend page that renders "success" based purely on a query param is a defensive choice that hides bugs. Whenever a frontend page reports the outcome of a backend operation, the page should verify that outcome via its own backend call, not trust what the URL says. Filed as future improvement, not done in 61c.
- The "test it with curl" verification done after Phase 61b tested password reset (which had the right URL) but not email verification (which had the wrong URL, because curl can't get an OAuth code). Critical paths that require a browser to test should be flagged in self-verification steps as "deferred to next phase's E2E test" so they don't get implicitly skipped.

---

## Phase 60a Completion Narrative

Phase 60a bundled three coherent link-UX changes triggered by pre-launch legal/copyright thinking.

**The trigger:** considering whether to limit Orca link sources to arXiv-only as a copyright mitigation. That specific restriction was rejected as too narrow (arXiv is mostly STEM; humanities, law, medicine all need other sources). But the conversation surfaced three real changes worth making before launch: (1) the append-only AD's blanket "no user removal" was a holdover from the annotation era and no longer fit a link-only platform, (2) some moment-of-friction at posting time would do real work alongside DMCA registration and the Copyright Policy, (3) the existing add-link UX revealed the auto-fetched title only after submission, which was confusing.

**The reframing of append-only** was the conceptually significant part. The original principle was written when annotations existed and the append-only-ness of annotations was load-bearing for thread integrity and span anchoring. With annotations gone, the principle had been over-generalized — concept_links don't have the same downstream-coupling properties. Narrowing the principle to "shared graph structure" (concepts, edges, votes on shared structure) and explicitly carving out self-authored self-contained content (links, link comments) is a more accurate statement of what the principle was always trying to protect. Tunnel links remain append-only as a deliberate distinction — they're cross-graph artifacts and the symmetric reasoning is weaker.

**Implementation notes:**
- The `link_removal_log` design (sha256 hash, no plaintext) is the explicit "minimum forensic trail consistent with user-initiated hard delete" — preserves the ability to answer "did user X ever post URL Y?" without preserving the content the user wanted removed.
- Combining the permission check and `legal_hold` check into a single atomic DELETE statement closes a real race window: an admin setting `legal_hold` between a separate SELECT-for-check and a DELETE could otherwise let a user delete a row that was just placed under hold.
- The deliberate opaqueness of the 403 response ("Cannot remove this link" regardless of cause) avoids leaking which links are under legal review.
- The title preview reuses the existing OG-fetch utility rather than duplicating SSRF logic — the price is that SSRF-blocked URLs appear identically to "no OG tag" URLs in the preview. Acceptable for the threat model.
- A route-ordering issue surfaced during implementation: the new `GET /web-links/preview-title` route would have been swallowed by the existing `GET /web-links/:edgeId` catch-all if registered after it. Fixed by moving literal-path routes above the catch-all. Documented as an architectural note in the API surface section.

**Lessons:**
- Architectural decisions written for a deleted feature need explicit re-evaluation after the feature is removed. The append-only AD was technically still in force after Phase 58 but was protecting a smaller surface than its language implied. Worth doing a sweep for similar over-generalized ADs from earlier phases — anywhere ORCA_STATUS.md references annotations, citations, or document spans as the rationale for a still-active principle, the rationale may now be stale even if the principle is still useful.
- The "is this principle protecting shared structure or self-authored self-contained content?" distinction is a useful lens. Likely re-applicable when thinking about future features (e.g., should user-authored superconcepts be deletable? Probably yes if no one else has subscribed; what about after subscriptions exist? Different question).

---

## Known Tech Debt and Forward Roadmap

### Tech Debt
- N+1 by-url count fetches (batch endpoint future optimization)
- ~~Title edit after creation not implemented~~ **Superseded Phase 62b** — comments are now immutable; addenda replace editing
- ~~ClampedText duplicated in LinkCard and ConceptLinksPanel~~ **Resolved Phase 59a** — extracted to shared `ClampedText.jsx`
- AppShell tab management complexity warrants refactor
- Tree ordering persistence retired (session-local only)
- **Stale-state audit results (May 2026):** `FlipView`, `TunnelView`, and the former `LinkVotesOverlay` were audited and found safe at the time — but `TunnelView`'s safety was STRUCTURAL (it unmounts on every navigation, so its state resets naturally), not DEFENSIVE (explicit state clearing in code). If `TunnelView` is ever changed to persist across navigations the way `ConceptLinksPanel` does, it will immediately exhibit the Failure 1 pattern (stale `tunnelData` visible during the load window). Same caveat applies to `FlipView`. `ComboTabContent.loadComboLinks` race guard added in a follow-up commit. `VotesOverlay` (Phase 59b) applies the guard from day one. Any new edge-keyed fetch below a navigable parent must follow the Stale-State Guard on Navigation AD from day one — do not rely on unmount behavior as protection.
- **Copy-link UX:** After a successful copy, the UI refreshes the source view but does not auto-navigate to the destination. Consider adding a "View at destination" link in the success toast (would reuse the existing `pendingScrollLinkId` cross-concept scroll infrastructure).
- **Copy-link subtree depth limit:** Hardcoded at 50 in the recursive CTE. If real-world graphs grow deeper, this will silently truncate the picker — should be made configurable or removed in favor of relying solely on the 500-edge row cap.
- **Legacy votes endpoints (Phase 59b):** `GET /api/votes/saved` and `GET /api/votes/web-links/votes/me` are retained for rollback safety. Once `VotesOverlay` is proven stable in production, these endpoints and any remaining call sites should be removed.
- **TunnelView pre-59a duplicate handling:** The component now expects duplicate rows. Any production data created before 59a will still be unique-per-pair. Worth confirming after launch that the rendering also handles the "single row" case cleanly (it should, but the test scenarios used during 59a development all had duplicates).
- **Email verification frontend trust (Phase 61c):** `VerifyEmailPage.jsx` reports success/error based on the `status` query param set by the backend redirect, without independently verifying. This hid the URL bug fixed mid-Phase-61. Defensive improvement: have the page call a backend `GET /api/auth/verify-email-status?token=...` to confirm the user's actual `email_verified_at` state. Low priority — the bug is fixed, the page is now reliable in practice.
- **`FRONTEND_BASE_URL` naming (Phase 61):** The env var is used as the base URL for both frontend pages and backend API paths (since they're served from the same domain on Railway). Name implies "frontend only," but it's actually "the public base URL of the deployed app." Consider renaming to `PUBLIC_BASE_URL` in a future cleanup.
- **Combo links endpoint missing addenda/ORCID (Phase 62b):** `GET /api/combos/:id/links` does not return `addenda[]` or `authorOrcidId` per link. ComboTabContent renders links with `readOnlyVote`, so the ORCID badge and addenda would be visible but the data isn't there. Low priority since combo link cards are a read-only aggregation view.
- **Pre-existing: `POST /api/votes/add` broken (saved_tabs reference):** The `addVote` handler in `votesController.js` queries the dropped `saved_tabs` table (~line 101), causing a 500 on save-vote. Discovered during Phase 62b Level 1 testing. Not a 62b regression — predates this session.
- **Deep-link concept tab label:** When opening a concept via `/concept/:id`, the tab label defaults to "Concept" because `handleOpenConceptTab` is called without a `conceptName`. The correct name loads after the API call, but the tab label isn't updated retroactively. Consider updating the tab label in `loadConcept` after the API response arrives.
- **Profile page edit affordances need verification (Phase 62a):** The profile page now re-fetches after edit-save operations. Confirm in production that all edit flows (e.g., the Edit button next to the email field, ORCID disconnect) properly trigger a re-fetch and don't leave stale data on screen. If any edit flow doesn't trigger a re-fetch, it'll silently show stale data until the user navigates away.

### Forward Roadmap
- ~~Phase 63a: favicon + page-specific Open Graph / Twitter Card tags~~ **completed May 23, 2026**
- ~~Phase 62b: comment addenda + author ORCID + share links + deep-link navigation~~ **completed May 17, 2026**
- ~~Phase 62a: profile page data-fetch fix + Phase-58-era UI cleanup~~ **completed May 16, 2026**
- ~~Phase 61d/e: ORCID enforcement and Twilio removal~~ **completed May 16, 2026**
- Phase 63b: `robots.txt` + `sitemap.xml` for SEO/crawler control (on the horizon, unscheduled)
- Welcome banner / verification reminder for unverified users (future)
- ~~Domain verification for Resend on `orcaconcepts.org`~~ **completed Phase 61**
- DMCA agent registration (unblocked; LLC formed)
- ~~Re-attach Railway and relaunch~~ **completed Phase 61** (Railway connected to new repo, `orcaconcepts.org` domain re-attached)
- Revised legal documents (ToS, Privacy Policy, Copyright Policy) — Copyright Policy in particular needs review for any remaining references to documents/annotations from the pre-Phase-58 era, and should now reflect the user-removal pathway alongside DMCA and moderation
- Public data API
- Federated ontologies (sketched in ORCA_HISTORY)
- Retire legacy votes endpoints (`GET /api/votes/saved`, `GET /api/votes/web-links/votes/me`) once `VotesOverlay` is proven stable in production
- Sweep for other over-generalized ADs written before Phase 58 that may now protect a smaller surface than their language implies (cf. Phase 60a "Lessons")

---

## Recent Commits (Phase 59 through 63a)

```
9b7f2b4 Phase 63a-fix: disable static directory-index so / hits OG override
e41d556 Phase 63a: favicon + page-specific Open Graph / Twitter Card tags
bba3d0e fix: share button styling to match neighboring buttons
7e8b0d8 fix: deep-link effect missing location.pathname dependency
45e5c19 fix: share link used effectivePath instead of API path, dropping parent
f00bfbf feat: deep-link for concepts and guest superconcept viewing
6b4bc47 feat: share link for superconcepts
c22cf80 fix: return addenda + authorOrcidId from getAllWebLinksForConcept (flip view)
5909592 phase 62b-4: TunnelView addendum UI + author + ORCID display
7a36d66 phase 62b-3: LinkCard addendum UI + ORCID badge
b855c5a phase 62b-2: addenda endpoints + remove comment edit + return author ORCID
38637d3 phase 62b-1: addenda tables for concept_links and tunnel_links
e0a8446 update legal docs
e05ec40 phase 62a: profile data-fetch fix + remove Phase-58-era zombie UI
08ae45e phase 61d/e: enforce ORCID required, remove Twilio entirely
6af90ce fix(61): email verification URL pointed at frontend instead of backend endpoint
6a1bbbb phase 61c: frontend ORCID-first registration + email-based password reset UI
34a23f8 phase 61b: ORCID-first registration and email-based auth endpoints
8f5837e Phase 61a: schema and email infrastructure (resend)
5eb92bc cleaning up info pages
515cb54 phase 60a: user-removable links + affirmation checkbox + title preview
        — Restored POST /web-links/remove with atomic added_by + legal_hold
          check; new link_removal_log table (sha256 hashes only, no plaintext);
          new GET /web-links/preview-title endpoint sharing OG-fetch utility;
          LinkCard Remove button + confirmation modal; affirmation checkbox
          required on add-link form; on-paste/on-blur title preview with
          AbortController; append-only AD reframed to "shared graph structure"
          with carve-out for self-authored self-contained content.
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
