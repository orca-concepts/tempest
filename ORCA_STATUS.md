# ORCA — Project Status & Technical Reference

**Last Updated:** June 25, 2026
**Current Status:** Phase 70 complete. **Value-only pivot + situations removed from the UI.** The four-attribute model (action, tool, value, question) collapses to a single attribute, `value`, via `ENABLED_ATTRIBUTES=value`; attribute badges are removed from concept cards and the concept header. Situations (internally "combos"/"superconcepts") are retired from the **UI only** — no Browse Situations button, no Situations tab on the link panel, no situation tabs/cards/deep-links — while all backend endpoints, tables, components, handlers, and API methods are left intact as dead code. Phase 69 (concept-card & links-panel enhancements), Phase 68 (ORCID badge validation + `chaos-seed-data` rename), Phase 67 (situations-as-tabs + votes), and Phases 66, 64a, 65a, 65b-1/2, 62c, 63a remain live (situation-specific features from 66/67 are now UI-dormant). Separately, the **Chaos** seeding tool reached a milestone: all three engines — Ouranos (Categorizer), Gaia (Instantiator), and Krius (Scout) — are built; the 61-node v2.0 adjective taxonomy is grounded in real research and **cut over live into the dev graph**, and Krius's first graph-wide scouting pass has produced a reviewable frontier proposal (36 writable placements + advisory adjectives/abstractions). See the *Chaos Seeding Tool — Status* section below.

**Phase 70 (June 14, 2026):** Value-only pivot + situations removed from the UI.
- **Value-only attributes.** `backend/.env` set to `ENABLED_ATTRIBUTES=value`. `getAttributes` (`conceptsController.js`) already filters by this env var, so `GET /api/concepts/attributes` now returns only `{ id, name: 'value' }`. This alone collapses two UI surfaces that were already guarded on `availableAttributes.length > 1`: the root-page attribute filter bar (`Root.jsx`, auto-hidden; filter logic also short-circuits to "show all" at ≤1 attribute) and the create-root attribute picker (`SearchField.jsx`, auto-assigns the single attribute, no picker shown). No code change to `Root.jsx` or `SearchField.jsx` — they self-hide and remain a safe fail-back if multiple attributes are ever re-enabled.
- **Attribute badges removed (the only env-independent surface).** Deleted the badge JSX in `ConceptGrid.jsx` (per-card `{showAttributeBadge && concept.attribute_name && ...}`) and in `Concept.jsx` (concept-header `{currentAttribute && <span style={styles.graphAttributeBadge}>...}`). `currentAttribute` is kept (still passed to `Breadcrumb`); the `attributeBadge` / `graphAttributeBadge` style objects are left in place (dead, harmless). `migrate.js` still seeds all four attribute rows (`ON CONFLICT DO NOTHING`) — harmless, the env var filters at read time.
- **Situations removed from the UI (backend left intact).** Strategy: a "data lever" plus explicit removal of the deliberate entry points.
  - **Data lever** — `AppShell.jsx` `loadAllTabs` no longer calls `combosAPI.getSubscriptions()` / `combosAPI.getMyCombos()`; `comboSubscriptions` and `ownedCombos` are set to `[]`. This auto-hides every persistence surface that was already guarded on empty data: the "Add to Situation" button on concept pages (gated on `ownedCombos.length > 0`), sidebar situation items at top level and inside groups (lookup returns `undefined` → `null`), situation tab panes (`.map` over `[]`), and the situation tab context menu (no item to right-click).
  - **Explicit removals** — removed the "Browse Situations" sidebar button (`AppShell.jsx`); removed the "Situations" tab header + content render in `ConceptLinksPanel.jsx` and short-circuited its per-concept `combosAPI.getCombosByEdge` loader to `setSituations([])` (the `situations` / `setSituations` state and `renderSituationsTab` are kept declared but unreachable, to avoid undefined-ref churn).
  - **Deep-link neutralized** — `/situation/:id` in `AppShell.jsx` now redirects to `/` (drops `handleOpenSituationTab` / `setGuestComboId`, so the guest combo view is unreachable); `situation` was dropped from the `hasDeepLinkInUrl` regex so a stale situation URL no longer suppresses default tab activation. A 301 from `/superconcept/:id` → `/situation/:id` (Phase 66, `server.js`) still exists and now lands on the redirect-to-home path.
  - **Left as dead code (NOT touched):** `ComboListView`, `ComboTabContent`, all `combosAPI` methods, `handleOpenSituationTab` / `handleCloseSituationTab` / `renderSidebarComboItem` / `handleAddToCombo`, combo context-menu actions, all backend combo routes/controllers/tables, and the state vars `comboSubscriptions` / `ownedCombos` / `comboView` / `guestComboId` (still declared, never populated).
- **Verification:** frontend `npm run build` clean; backend starts and connects; `GET /api/concepts/attributes` returns only `value`.
- **Files:** `backend/.env`, `frontend/src/components/ConceptGrid.jsx`, `frontend/src/pages/Concept.jsx`, `frontend/src/components/AppShell.jsx`, `frontend/src/components/ConceptLinksPanel.jsx`.

**Phase 69 (June 13, 2026):** Concept-card & links-panel enhancements.
- **Cross-sibling-descendant flag.** `getConceptWithChildren` runs one graph_path prefix-slice query (`graph_path[1:n] = $base AND array_length > n AND child_id = ANY(directChildren)`) to find each direct child that also appears deeper in the current concept's subtree — within that subtree a deeper occurrence can only sit under a sibling (cycles prevented), so this is exactly "descendant of a sibling". Each such child carries `nestedLocations: [{ edgeId, graphPath, parentName }]`. `ConceptGrid` shows a `↘` arrow top-right of those cards; click navigates to the single nested location (`navigateInTab(childId, loc.graphPath, 'children')`) or opens a small "under {parent}" picker for >1.
- **Per-card link count.** A `(SELECT COUNT(*) FROM concept_links WHERE edge_id = e.id AND legal_hold = false)` correlated subquery added to BOTH `getConceptWithChildren` (children grid) and `getRootConcepts` (root grid, keyed on the root edge). Rendered as `N children · M links` in `ConceptGrid` (which both grids use).
- **Flip / Tunnel button counts.** `getConceptWithChildren` also returns `altParentCount` (other non-root parent contexts for the concept — matches `getConceptParents`, which excludes root edges) and `tunnelLinkCount` (tunnels on the current edge), plus `currentEdgeId`. `Concept.jsx` appends `· N` to the Flip View / Tunnel buttons only when > 0 (unchanged at 0).
- **Vote-set dots on links.** `getWebLinks` returns `voterUserIds` per link (`array_agg(DISTINCT clv.user_id) FILTER (...)`). `voteSets` (already loaded in `Concept.jsx` with per-set `userIds`) flows to `ConceptLinksPanel` → `LinkCard`, which intersects each link's voters with set membership and renders the matching color dots via `getSetColor` (same markup as the child-card dots). Naturally gated: empty `voteSets` → no dots; multiple dots per link supported. **AD note:** per-link voter ids are now sent to the client (frontend computes the intersection) — consistent with the vote-set endpoint, which already sends per-set `userIds`.

**Phase 68 (June 13, 2026):** ORCID badge display validation + `chaos-seed` → `chaos-seed-data`.
- **The bug:** `OrcidBadge` rendered *any* `orcid_id` as a link to `https://orcid.org/<value>`, guarding only `if (!orcidId)`. The `chaos-seed` system account's sentinel (`'CHAOS-SEED-ACCOUNT'`) is not a real iD, so every seed-authored link/tunnel/addendum/mention/situation showed a badge that 400s at ORCID.
- **Shared validator (dual-file, like `inOrcaLinks.js` ↔ `LinkifiedText.jsx`):** `backend/src/utils/orcidValidator.js` exports `ORCID_DISPLAY_REGEX`, `isValidOrcid(value)`, and `orcidForDisplay(value)` (→ value if valid else `null`); `frontend/src/utils/orcidValidator.js` exports the same regex + `isValidOrcid`. The two regex copies (`/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/`) are kept in sync manually.
- **Backend (display only — stored value untouched):** nine badge-display emit points wrap the emitted orcid with `orcidForDisplay`: `comboController` (`listCombos`, `getCombo`, `getCombosByEdge`), `tunnelController.getTunnelLinks`, `votesController` (`getWebLinks`, `getAllWebLinksForConcept`), `mentionsController.getMentions`, `usersController` (`searchUsers`, `getUserProfile`). Left truthful: `authController.getCurrentUser` (`/me`, identity not a third-party badge) and `usersController.exportMyData` (data export).
- **Frontend (defense in depth):** `OrcidBadge.jsx` returns `null` when `!isValidOrcid(orcidId)`; `ProfilePage.jsx`'s raw `orcid.org` link is gated on `isValidOrcid`.
- **Seed rename:** `chaos-seed` → `chaos-seed-data` (and email). `migrate-chaos.js` renames the legacy row in place via `UPDATE users ... WHERE username='chaos-seed'` before the idempotent INSERT, preserving id (25 locally) and every `created_by`/`added_by`. `apply.js`/`snapshot.js` resolve the new username. The sentinel `orcid_id` and password hash are unchanged.
- **DRY cleanup:** `authController.js`'s `registerWithOrcid` and `devConnectOrcid` endpoints now call the shared `isValidOrcid` instead of an inline copy of the same regex (behavior-identical — verified across valid iDs, the sentinel, empty, non-string, and bad-suffix inputs), so the ORCID format lives in exactly one place per layer.
- **Not touched:** schema, `orcid_id NOT NULL`, the registration/login flow behavior (the validator swap preserves it exactly).

**Phase 67 (June 13, 2026):** Situations-as-tabs + situation votes.
- **Bug fix (the trigger):** `setSavedPageOpen` was called at four sites in `AppShell.jsx` but never declared — dead state from the `SavedPageOverlay` removed in Phase 59b. In `handleSubscribeToCombo` the `combosAPI.subscribe()` call succeeded, then the undefined call threw a `ReferenceError`, was caught, and surfaced as a misleading "Failed to subscribe" alert (also skipping `refreshSidebarItems`, so the situation never appeared in the sidebar). Clicking a situation from Browse and from the concept link-panel Situations tab both routed through this. The follow-on "Not subscribed to this combo" popup was `unsubscribeFromCombo` returning 404 for a row that was never created.
- **Model change:** `handleSubscribeToCombo` → `handleOpenSituationTab` (idempotent open + activate; 409 = already open → just activate) and `handleUnsubscribeFromCombo` → `handleCloseSituationTab` (wired to a new sidebar X button on combo items, mirroring `handleCloseGraphTab`). `combo_subscriptions` is kept as the backing store for "open tabs" (no table rename), so open situations persist across refresh exactly like graph tabs. `unsubscribeFromCombo` returns `200 { ok: true }` when nothing was deleted (idempotent close).
- **Situation votes:** new `combo_votes` table (mirror of `tunnel_votes`, simple per-row toggle), `POST /api/combos/:id/vote` (`toggleComboVote`), `vote_count` + `user_voted` added to `listCombos` and `getCombo`. Browse default sort is now `vote_count DESC` (replacing subscriber count); `listCombos` accepts `?filter=voted` (EXISTS against `combo_votes` for the current user). Vote button in the `ComboTabContent` header (optimistic toggle); the header "Unsubscribe" button was removed (closing is the sidebar X). Browse cards are open-only: card click opens the tab, vote **count** is displayed but not votable from the card (voting is on the situation page).

## Chaos Seeding Tool — Status

*Separate workstream from the app phases above. Chaos is the graph-seeding system that authors the initial Orca `value` taxonomy and grounds it in real research. The design spec lives in `chaos.md` (currently **v2.0**, adjective-constrained); this section tracks build/operational state only. **The taxonomy is now CUT OVER into the dev graph (live, local).** Production promotion is deliberately deferred — see the promotion invariant below.*

**Model (v2.0, adjective-constrained).** Nodes are bare quality-adjectives describing good research ("Honest", "Transparent", "Reproducible") under an implicit "Good" predicate. Meaning is compositional (read along the path) and carried by multi-parent placement — the same adjective under different parents is a distinct contextual entity. The v1.0 "conduct"/lived-rendering face was removed: there is no per-node prose and no `description`/`conduct` column on `concepts`. Comprehension of abstract nodes comes from aggregated instances (now live — see Upward aggregation). Rationale: `chaos.md §0`.

**Three engines** (named for the order that emerges out of Chaos):

- **Ouranos — the Categorizer** (`chaos/ouranos.js`). **BUILT** (genesis mode). Loads `chaos.md` as its system prompt; emits `chaos/genesis/proposal.json` + `proposal.md`. The v2.0 genesis run produced a **61-node, 10-root adjective taxonomy** — roots: Honest, Rigorous, Careful, Transparent, Open, Reliable, Fair, Humble, Significant, Clear — adjective-form throughout, ~30% of nodes multi-parented. Primary admission discipline is the **contrastive-separability gate** (admit a child only if research can be {parent}-but-not-{child} AND {child}-but-not-{sibling}); guards against thesaurus/synonym piles. Structural checks: `chaos/genesis/validate.js`. Genesis is currently one-shot (no frontier-driven run mode yet — see Next).
- **Gaia — the Instantiator** (`chaos/gaia.js`). **BUILT + RUN, two passes:**
  - **Primary grounding** (`--all`, `--node`, `--limit`). For each LEAF adjective (once per path), retrieves open-access papers from OpenAlex, judges **"exhibits not discusses"** (the paper's own research must *enact* the quality, not *study it as a topic*), emits links whose comments name the concrete exhibiting feature in **plain, cross-disciplinary, jargon-free** language. **Result: 50 / 54 leaf targets grounded, 141 instance links.** Output: `chaos/genesis/gaia-proposal.json` + `.md`.
  - **Multi-attach** (`--multiattach`). One paper → many concepts. Re-reads each accepted paper (full text on disk) against the whole leaf menu to catch qualities it exhibits beyond the one it was retrieved for — the grounding mechanism for buried-practice qualities that topic search can't surface. Two stages: **Stage A (propose)** — one cheap call/paper proposes candidates, each requiring a concrete locatable feature (*feature-or-abstain* gate; abstains on interpretive-only reads); **Stage B (confirm)** — the **same strict `judgePaper`** confirms each candidate. **Result: 97 full-text accepted papers scanned (34 abstract-only skipped) → 500 new instance links across 47 concepts.** Output: `chaos/genesis/gaia-multiattach-proposal.json` + `.md`.
- **Krius — the Scout** (`chaos/krius.js`). **BUILT + RUN (graph-wide, corpus channel).** Bottom-up scout over the grounded graph: reads the committed proposals (taxonomy + both Gaia groundings) and the papers on disk, and proposes three frontier kinds within the existing spine — **`missing_placement`** (an existing concept is also a kind-of a different existing parent; the **only apply.js-writable** kind, emitted as an additive name-based multi-parent edge with the concept's current parents shown), **`missing_adjective`** (a new sibling quality, advisory), and **`missing_abstraction`** (a single unnamed higher quality bridging two separate regions, advisory), plus **`possible_merge`** notes when a proposed name collapses to an existing concept. Every candidate passes a **§5 model judge, abstain-by-default**: the kind-of / legible-composition test for placements, the contrastive-separability test for adjectives, and the genuine-bridge-vs-co-occurrence-vs-synonym test for abstractions. Candidate hygiene: an **existing-name collision guard** reroutes any proposed name that already exists as a concept (adjectives → placement candidates; abstraction higher-qualities → placements under the existing concept); **abstraction and adjective consolidation** collapse repeated proposed names into one frontier (abstractions ranked by *strength* = number of contributing bridges; adjectives kept multi-parent, listing all proposed parents); cross-channel name overlaps and near-spelling pairs are **flagged, not merged**. Two input channels exist — corpus (free, default) and anchored OpenAlex retrieval (`--retrieve --limit N`, off by default); the graph-wide run used corpus only. Reviewable output: `chaos/genesis/krius-proposal.json` + `.md`, plus a calibration audit `chaos/genesis/krius-audit-<region|all>.md` (every KEPT + ABSTAINED verdict with its one-line judge rationale). **Upholds the promotion invariant: no DB writes, no `apply.js` call, no existing proposal modified.** Judgments cache under `chaos/scout_cache/` (gitignored; `KRIUS_PROMPT_VERSION='k2'`), so a re-run with no judge change is 0-call and reproducible. **Full run (--cap 5): 36 placements (writable) · 13 adjectives · 27 abstractions · 3 possible-merges · +21 below the cap; 823 abstained (~91%).** Top abstractions by strength: Forthcoming (8), Verifiable (5), Restrained (4). Placements remain **proposals** — applying selected ones via `apply.js` is a separate, human-approved step.

**Cutover (DONE — live in dev DB).** The genesis taxonomy + both grounding proposals were written to the dev graph in one transaction via `chaos/genesis/write.js` (merges both proposals) → `chaos/apply.js` (name-based write, `pg_dump` backup first). **Landed: 61 concepts · 80 edges · 598 concept_links (with titles) · 131 papers.** (641 merged links → 598 rows after apply.js's in-plan dedup by concept + normalized URL — same paper on the same edge collapsed; the same paper under *different* concepts is kept.) Cutover-specific build: `write.js` now merges `gaia-proposal` + `gaia-multiattach-proposal` links/papers; `apply.js` passes the article title through to `concept_links.title` (was hard-coded null) and emits a **zero-fallback path-key assertion** so `--dry-run`'s "DID NOT MAP CLEANLY" surfaces any link that would silently mis-place. **Re-cutover requires a snapshot+clear first** — the empty-graph precondition refuses to write into a populated graph (use `chaos/reset-dev-db.js --confirm`, which preserves `attributes` + the `chaos-seed-data` user).

**Upward link aggregation (BUILT, app-side; confirmed live on seed data).** `getWebLinks` (votesController.js) shows a concept's directly-placed links plus all links on descendant edges along the same `graph_path` lineage — **path-scoped, not concept-id-scoped**, so a link at A›B›C surfaces at B and A but never leaks to a different placement of B or C. Same prefix-scan in the flip view and the per-child/per-root count badges. Agrees with `apply.js`'s path→edge resolution, so seed links aggregate correctly. Inherited cards carry a link back to their own edge (so the same paper surfacing under an ancestor via two descendants reads as two distinct provenances, by design). No `edges.graph_path` index yet (fine at seed scale; revisit before large growth).

**Gaia operational details (hard-won — do not rediscover):**
- **OpenAlex now requires an API key** (policy changed Feb 2026; the old polite-pool `mailto` is ignored). Keyless ≈ **$0.10/day ≈ ~100 searches**; a **free key gives ~$1/day ≈ ~1,000 searches** (openalex.org → settings/api). A full primary run *without* a key WILL exhaust the budget mid-run. (Multi-attach uses NO OpenAlex.)
- **A 429 means one of two things.** *Too-fast* (temporary) vs. *daily credits exhausted* (permanent until **midnight UTC** = 8 PM Dayton). Gaia distinguishes them: ordinary 429 → capped backoff (2/5/15/30s, **hard-capped at 60s**); credit-exhaustion 429 → **halts** with a "resets at midnight UTC" message.
- **Caches** (`chaos/gaia_cache/`, gitignored): leaf-level (skips a grounded leaf entirely, including its OpenAlex search), per-paper judgment, per-node query plan, and (multi-attach) per-paper propose. All resumable on Ctrl+C. Auto-invalidate on `chaos.md` (rubricHash) or `GAIA_PROMPT_VERSION` change. Multi-attach uses a **separate `GAIA_MULTIATTACH_VERSION` ('ma1')** so it can't invalidate primary caches.
- **Multi-attach distribution is healthy:** mean ~5.3 attachments/paper, **max capped at 8** (Stage-A cap). The Open/Transparent family stays *discriminated* (Shared 23 / Accessible 22 / Reusable 11). Caveated top at 55 — expected (limitations sections are near-universal and concretely pointable).
- **Env vars:** `OPENALEX_API_KEY` (**never hardcode — repo is public**), `CHAOS_OPENALEX_DELAY_MS` (pacing, default ~1000ms), `CHAOS_MAILTO`. Fetched papers → `chaos/papers/<id>.json` (gitignored).

**Zero-accept paths — resolved.** Primary left 4 leaf-paths empty; multi-attach filled 3 (`Consenting` 0→28 — the gate was confirmed *correct, not over-strict*; `Consistent`/Reliable 0→14; `Precise`/Reliable 0→3). The 4th, `Precise` under Clear, has no single pinpointable feature a paper exhibits — **now that aggregation is live and cut over, it inherits instances from whatever grounds beneath it along the Clear lineage.**

**Promotion invariant (locked in `chaos.md §9).** The local DB is a **test bench**; the **JSON proposals are the source of truth**. Every graph-growing engine emits reviewable JSON and writes through the name-based `apply.js` path — never DB-only. Promotion to prod is a **name-based re-seed from the committed proposals, never a database row-copy** (IDs and `graph_path` are assigned at write time; name-based rebuild is what preserves path-scoped identity + FK integrity). Caveat: anything not captured in a proposal (votes, UI-authored content, hand edits) does not promote; while testing locally, treat the UI as a *viewer* and the engines' JSON as the real artifacts.

**Next (Chaos):**
1. **Krius placements — APPLIED (June 27, 2026).** All **36** writable `missing_placement` frontiers were written to the dev graph via `chaos/genesis/apply-krius.js --confirm` → apply.js's additive name-based multi-parent path (pg_dump backup first; additive + idempotent — no concepts created, nothing moved/deleted). **Edges 80 → 116.** Includes the one structural move: **Transparent demoted from root to a child of Honest** (roots 10 → 9). apply.js emitted a benign `DID NOT MAP CLEANLY — ancestor auto-created` block for the 17 parent concepts (genesis-mode design-feedback misfiring on an additive-edge plan; 0 concepts created, no duplicates — concept count held at 61); **suppress this for additive plans as part of the apply.js trim pass.** Krius's adjectives/abstractions remain advisory in `krius-proposal.json` and are NOT auto-consumed yet — that is the frontier-object + frontier-driven-run build (below).
2. **Frontier object + frontier-driven run mode** in Ouranos (genesis is currently one-shot) — the interleaved categorize↔instantiate loop the steady-state design calls for. Krius frontiers currently live only in `krius-proposal.json`; the durable object is what gives them cross-run memory (which were accepted/dismissed) and an app-facing surface.
3. **Broaden full-text coverage** (grounding-quality pass). Corpus full-text coverage ~46% — `fullTextPlan` only fetches from Europe PMC / arXiv / bioRxiv / medRxiv / PMC / PLOS / eLife / Frontiers / MDPI; OA papers elsewhere fall back to abstract-only (weaker for methods-buried qualities). Pair with re-fetching + re-judging the ~34 abstract-only accepted papers, then re-running multi-attach over them.
4. **apply.js v0.x trim — DONE (June 27, 2026).** Removed apply.js's provably-dead write paths (`tunnel_links`, the prediction/event ledger + accumulated-precision recompute and its `--recompute-precision` flag, restructure-mention addenda) after verifying no live caller passes that data; fixed the stale dry-run output (dropped dead-table lines; `value dispositions` → `concepts (distinct names)`); and made additive-edge plans stop emitting a false `DID NOT MAP CLEANLY` alarm — ancestors that resolve to existing concepts now print as informational, while a genuinely unresolvable path still trips the loud assertion. Retired `chaos/reason.js`, `chaos/source.js`, and `chaos/precision.js` to `chaos/_retired/` (zero importers). No schema changes; no working write path altered. (Note: there is no backend `build` script — chaos CLIs are validated by `node -c` + dry-run, not `npm run build`.)
5. **Multi-attach yield leak (minor).** A handful of Stage-B confirm responses returned unparseable JSON and were dropped (`(warn) judgment unparseable … not cached`). Not corrupting; retried (not reused) on re-run. Add a one-shot reparse/retry if it recurs at volume.
6. **Production promotion** — name-based re-seed of prod from the final committed proposals, as its own heavily-guarded invocation (its own confirmation + mandatory backup + empty-graph precondition on prod). Deferred until the machinery (incl. Krius + frontier runs) is validated locally. Operational detail (how the JSON reaches a prod-connected environment via Railway) to be scoped when ready.

**Key files:** `chaos.md` (spec, v2.0) · `chaos/ouranos.js` (Ouranos) · `chaos/gaia.js` (Gaia: primary + `--multiattach`) · `chaos/genesis/proposal.json` + `.md` (taxonomy) · `chaos/genesis/gaia-proposal.json` + `.md` and `chaos/genesis/gaia-multiattach-proposal.json` + `.md` (grounding) · `chaos/genesis/write.js` (cutover orchestrator) · `chaos/apply.js` (writer — name-based; additive multi-parent + cutover; v0.x dormant payload removed) · `chaos/krius.js` (Krius the Scout: corpus + `--retrieve`; `--region`, `--cap`, `--dry-run`, `--refresh`) · `chaos/genesis/krius-proposal.json` + `.md` (frontier proposal) · `chaos/genesis/krius-audit-<region|all>.md` (calibration audit) · `chaos/scout_cache/` (gitignored judgment cache) · `chaos/genesis/apply-krius.js` (applies writable placements to the dev graph: `--dry-run` default, `--confirm`, `--skip n,…`; additive multi-parent edges via apply.js) · `chaos/reset-dev-db.js` (guarded pre-cutover wipe) · seed account `chaos-seed-data` (resolved by username, id 25 locally).

---

## Quick Context for New Claude Sessions

Orca is an open-source (AGPL v3) collaborative action ontology platform for academic research. Users create and navigate hierarchical concept graphs with context-dependent children, community voting, and concept attributes (action, tool, value, question). References to external resources are organized as **links** (URLs with optional titles and comments) attached to specific edges in the concept graph.

**Phase 58 pivot (May 2026):** Removed the entire document/corpus/annotation/message layer. The platform now uses a simpler link-based reference system: users paste URLs, the server auto-fetches Open Graph titles, and the community upvotes/discusses links. Cross-instance navigation lets users see where the same URL appears across different concepts. Full Phase 58 narrative archived in `ORCA_HISTORY.md`.

**Phase 59 (May 2026):** Tunnel links gained optional comments and now allow duplicates between the same edge pair (different comments = different rows = independent vote tallies). Graph Votes and Link Votes overlays merged into a single display-only Votes overlay with full root-to-edge ancestry rendering for link-voted edges.

**Phase 60a (May 2026):** Self-authored links may now be hard-deleted by their adder (carve-out from append-only AD — see "Append-Only" section for the reframed principle). New `link_removal_log` table preserves a sparse audit trail (sha256 of URL, no plaintext content). Add-link form gained a required affirmation checkbox and on-paste/on-blur title preview via new `GET /web-links/preview-title` endpoint reusing the existing OG-fetch utility.

**Phase 61 pivot (May 2026):** Replaced Twilio phone OTP authentication with ORCID-first email+password registration. New signup flow: (1) ORCID OAuth proves the user owns an ORCID iD, (2) the user submits username, email, password, and ToS acceptance. If the submitted email matches an ORCID-verified email returned by `/v3.0/{orcid}/email`, the account is created with `email_verified_at = NOW()` and a welcome email is sent. Otherwise a verification email with a 24-hour single-use token is sent, and the welcome email follows after the user clicks the verify link. Password reset uses a similar email-token flow. Phase 61a added the schema + Resend integration. 61b added five new backend endpoints. 61c reworked `LoginModal.jsx` and added standalone `/reset-password` and `/email-verification` pages. A follow-up fix corrected the verification email's URL (it pointed at the frontend route instead of the backend endpoint, so verification appeared to succeed but didn't actually update the database).

**Phase 62b (May 2026):** Replaced the editable-comment model on links and tunnel links with an append-only addendum system. Original comments are now immutable; the author can post timestamped addenda below. Author ORCID badges now display on both link types. Share links added for superconcepts. Deep-link navigation (`/concept/:id` and `/superconcept/:id`) now works for both logged-in users and guests.

**Phase 62c (May 23, 2026):** Removed the ORCID disconnect endpoint (`POST /api/auth/orcid/disconnect`) and the Connect/Disconnect conditional UI block on the profile page. The endpoint was zombie code from Phase 41a (when ORCID was optional) that survived Phase 61d/e's transition to ORCID-required accounts. It was broken in two ways: (1) it attempted `UPDATE users SET orcid_id = NULL`, which violates the NOT NULL constraint added in 61d/e, and (2) even if it had worked, the defensive ORCID-present check at login (`authController.js:87`) would have locked the user out permanently. The bug surfaced during manual exercise of the endpoint during a security-hardening session and was fixed by removing the endpoint and UI rather than dropping the constraint. The profile page now passively displays the user's ORCID iD using the existing `OrcidBadge` component. The `devConnectOrcid` endpoint (dev-only ORCID linking) remains intact. This is the second instance of a zombie-code cleanup mirroring Phase 62a — see "Phase Transitions Can Leave Zombie Code" in Key Learnings.

**Phase 63a (May 2026):** Added favicon and Open Graph / Twitter Card metadata for social media link previews. The favicon is an SVG of a lowercase 'o' in Georgia serif on an off-white `#FAF9F6` tile. Three pages have dedicated `summary_large_image` preview cards (home, The Storm, Using Orca) with custom screenshots; other paths fall back to a `summary` card with the favicon. Page-specific tags are injected by the Express SPA-fallback handler via an `OG_OVERRIDES` map — crawler bots and human visitors both receive the path-correct HTML, since crawlers don't execute JavaScript. Verified working on Bluesky via the cardyb extract endpoint.

**Phase 64a (May 24, 2026):** Added Google Safe Browsing v4 URL safety check. The check runs at two existing call sites: `POST /api/votes/web-links/add` (security boundary, before INSERT) and `GET /api/votes/web-links/preview-title` (early feedback during the add-link form). Flagged URLs are rejected with `403` and a machine-readable `code: 'unsafe_url'`. Threat categories checked: MALWARE, SOCIAL_ENGINEERING, UNWANTED_SOFTWARE, POTENTIALLY_HARMFUL_APPLICATION. A sparse `safe_browsing_rejections` audit table records sha256 of URL, threat types, source ('add' vs 'preview'), and attempting user — modeled on `link_removal_log`. The utility follows the established fail-open never-throws contract: missing key, timeouts, network failures all return `{ safe: true, threats: [] }` with a warning log. Local dev runs without the key (warning at startup); production has the key set in Railway. This replaces the previously-considered "domain allowlist" approach — the allowlist was rejected as too restrictive for cross-disciplinary research (Phase 60a) and as insufficient defense against actually-malicious URLs (which Safe Browsing addresses directly).

**Phase 65a (May 24, 2026):** Added share buttons on regular links and tunnel links plus in-comment linkification of in-orca URLs. Share buttons (mirroring Phase 62b's concept/superconcept share buttons) copy `/link/:id` or `/tunnel/:id` URLs to clipboard. New `GET /api/votes/web-links/:linkId/location` and `GET /api/tunnels/:tunnelLinkId/location` endpoints resolve those URLs client-side to the parent edge's concept + path; the AppShell deep-link `useEffect` was extended to handle the new patterns (route to `/concept/:id?path=...#link-:id` and let the existing concept-deep-link path take over). A new `LinkifiedText` component replaces `ClampedText` on user-authored comment/addendum surfaces — only in-orca URLs (matching a narrow anchored grammar in `backend/src/utils/inOrcaLinks.js` and `frontend/src/components/LinkifiedText.jsx`) become clickable hyperlinks; external URLs and malformed strings remain plain text. Hyperlinks always open in a new browser tab (`target="_blank" rel="noopener noreferrer"`). Two follow-up bug fixes shipped in the same arc: `65a-fix` (location endpoints renamed `path` → `parentPath` and now return `graph_path` directly, fixing a duplicate-concept-in-breadcrumb bug caused by appending `concept_id` to `graph_path`); `65a-fix-2` (mount-time race between `loadAllTabs`'s default-tab-activation and the async location-resolution allowed a brief flash of the wrong concept in fresh browser tabs — fixed by suppressing default-activation when the URL is a deep-link pattern). The Phase 65b mentions feature is scaffolded but not yet implemented — `parseInOrcaLinks` utility is defined and tested but not called.

**Phase 65a-fix-3 (May 26, 2026):** Hangover bug from 65a's tunnel share flow. Opening a `/tunnel/:id` share URL correctly resolved to the right concept page but rendered in the default view mode (Children) instead of Tunnel View, so `TunnelView` was not mounted and `pendingScrollTunnelLinkId` was plumbed to a component that didn't exist on screen. The first fix attempt assumed `Concept.jsx`'s fragment-reading useEffect could detect a `#tunnel-:id` fragment and switch view mode — but AppShell's deep-link useEffect uses `handleOpenConceptTab` (which manages tab state directly without fragments) and then `navigate('/', { replace: true })` strips any hash, so the fragment effect was a dead code path for tunnels. The retry uses `handleOpenConceptTab`'s existing `viewMode` parameter (sixth positional argument) — the `/tunnel/:id` branch now passes `'tunnel'`. Regular link shares are unchanged because `ConceptLinksPanel` renders alongside any view mode.

**Phase 65b-1 (May 26, 2026):** Mentions data layer — schema, parser hookup at four write paths, backfill, and read endpoint. **No UI ships in this phase**; Mentions panels are deferred to 65b-2.

New `comment_mentions` join table with CHECK constraints on `source_type` (one of `concept_link_comment`, `concept_link_addendum`, `tunnel_link_comment`, `tunnel_link_addendum`) and `target_type` (one of `concept`, `superconcept`, `link`, `tunnel`). No foreign keys — there are four source × four target combinations and FKs would require multiple nullable columns and CHECK gymnastics; instead, integrity comes from (a) the parser being deterministic, (b) write-time inserts happening within the source row's transaction, (c) deletion paths cleaning up explicitly (currently just `POST /web-links/remove`), and (d) read-time visibility filtering joining to source tables and checking `is_hidden` / `legal_hold`.

A new `backend/src/utils/parseMentions.js` is a stricter variant of Phase 65a's `parseInOrcaLinks`: concept URLs MUST have `?path=` to be indexed (path-dependent identity is load-bearing), but empty `?path=` is accepted as a deliberate root-concept reference (Phase 65b-1-fix added this).

A new `GET /api/mentions/:targetType/:targetId?path=...&limit=&offset=` endpoint returns paginated mentions with the source's parent context (parent ID, author, ORCID badge data). The visibility filter is a LEFT JOIN to source/parent tables in the same query; mentions whose source's parent is hidden or legal-held are filtered out (NOT deleted — un-hiding restores them automatically).

`backend/scripts/backfill-mentions.js` is an idempotent backfill (DELETE-then-INSERT per source row) with a `--dry-run` flag. Ran cleanly locally (4 production-style test mentions indexed) and against production (1 historical mention indexed via Railway public proxy URL after the Railway CLI's `railway run` failed on the internal `postgres.railway.internal` hostname).

**Phase 65b-1-fix (May 26, 2026):** Root-concept share URLs. Root concepts have `graph_path = '{}'`. The Phase 62b share button was emitting `/concept/:id` (no `?path=`) for roots, which the strict mention parser rejected as ambiguous. Two coordinated changes: (a) `Concept.jsx` share button now always emits `?path=` — empty value for roots, full path otherwise; (b) `parseMentions.js` now distinguishes "path absent" (still rejected, ambiguous) from "path empty" (accepted as root reference); empty `target_path` is now a valid root-concept mention. The linkifier regex already accepted both shapes and needed no change; the schema already accepted empty `target_path` arrays.

**Phase 65b-2 (May 26, 2026):** Mentions UI — three surfaces, one shared component. A new `MentionsPanel.jsx` is consumed by: (a) a third "Mentioned by" tab on concept pages in `ConceptLinksPanel`, alongside Links and Situations; (b) a third "Mentioned by (N)" button on each `LinkCard`, alongside the "Other instances on this concept" and "Other instances across all concepts" buttons; (c) a "Mentioned by (N)" button on each tunnel card in `TunnelView`. All three follow the same pattern: always visible with a count, grayed when zero, click expands a panel showing newest-first mentions with Load More pagination (20 per page). Empty-state copy is surface-specific ("this concept" / "this link" / "this tunnel link"). Click on a mention row opens the source's parent link/tunnel in a new browser tab via the Phase 65a share URL (`/link/:id` or `/tunnel/:id`); the existing deep-link infrastructure scrolls and highlights the parent card. Per-mention rendering: author username + `OrcidBadge` + parent context (concept name / parent title) + clamped `LinkifiedText` snippet + relative timestamp. `mentionCount` is included in three existing list endpoints (`GET /web-links/:edgeId`, `GET /concepts/:id`, `GET /tunnels/:edgeId`) via correlated subqueries so badges render without an extra round trip. The 65b-2-fix follow-up aligned the visibility filter in those count subqueries with the canonical filter in `mentionsController.js` — initial implementation lacked the filter, so badges showed counts including mentions with hidden parents while the panel correctly excluded them. With this fix, count and panel agree exactly on all four surfaces.

**Phase 66 (June 2026):** Renamed "superconcept" to "situation" across the entire app — all user-facing UI text, URL routes (`/superconcept/:id` → `/situation/:id` with 301 redirect for old share links), backend regexes (`inOrcaLinks.js`, `parseMentions.js`), CHECK constraint on `comment_mentions.target_type`, data export key, and frontend prop/style key names. Situation page (ComboTabContent) redesigned: concepts grouped into columns by attribute (action, tool, value, question) matching TunnelView's layout; each concept card shows name (clickable), full path, and display-only vote count; client-side hide/show toggle on every card (hidden concepts grayed, their links excluded from aggregated reading list below); transfer ownership moved to a header button. `getCombo` endpoint now returns `save_count` per edge. VotesOverlay legend (saved/context dot) removed. Pre-existing bug fixed: dead `saved_tabs`/`vote_tab_links` references in `addVote` and `addSwapVote` in `votesController.js` that caused 500 errors on concept save votes.

**Chaos — concept-graph seeding tool (June 2026, in progress):** Chaos reads the dev database, sources open-access cognitive-science papers, and reasons through the `chaos.md` rubric (currently v0.6) via the Anthropic API (`claude-opus-4-8`) to propose concepts, links, tunnels, and Situations — written to review files, never to the database without review. Components live in `chaos/`: `snapshot.js` (read-only DB snapshot), `clear.js` (dev-graph wipe with pg_dump backup; the test-data graph was cleared June 2026 — bootstrapping state), `source.js` (OpenAlex discovery + source-native full-text fetchers: Europe PMC, arXiv/ar5iv, bioRxiv; ~full full-text yield with six-field balance preserved), `reason.js` (per-paper move-step read + integration pass; per-paper results cached in `chaos/reason_cache/` keyed by a hash of `chaos.md`, so rubric edits auto-invalidate stale reasoning), and `migrate-chaos.js` (below). apply.js writes reviewed proposals into the dev graph transactionally and idempotently (dry-run supported), attributed to the chaos-seed-data account.

**Chaos value-only prompt-consistency fix (June 15, 2026):** `reason.js`'s `loadGraphState` built the prompt's `attributes:` graph-state line from `snap.attributes` (the snapshot mirrors **every** attribute row still seeded in the dev DB), so the model was told `attributes: action, tool, value, question` while the rest of the same prompt insists the domain is value-only and `ATTRIBUTES` is hard-coded to `['value']` — contradictory context. Emission was never at risk (it is governed by the hard-coded `ATTRIBUTES`), but the line now derives from that same constant (`ATTRIBUTES.join(', ')`), so the displayed domains and the emitted domains share one source of truth and cannot diverge again. The line now reads `attributes: value`. Single-file change (`chaos/reason.js`); `snapshot.js`'s "mirror whatever is in the DB" read is intentionally left as-is, and no emit-time guard was added to `apply.js` (both deliberately deferred). Two related latent spots noted but not touched: `buildInventory` still iterates all `edges_by_attribute` keys (safe only because the non-value buckets are empty), and `apply.js` attribute resolution stays data-driven with no value-only guard.

**Chaos support schema (June 10, 2026):** Added by `chaos/migrate-chaos.js` to the LOCAL DEV database only. Deliberately **not** registered in `backend/src/config/migrate.js` (which runs on every Railway deploy), so production is untouched until the migration is manually promoted. Single transaction, idempotent (IF NOT EXISTS / ON CONFLICT).

- `papers` — one row per sourced paper. Identity: `openalex_id` UNIQUE NOT NULL; `doi` and `arxiv_id` carry partial UNIQUE indexes (WHERE NOT NULL); `url_normalized` indexed (not unique). Metadata: `title`, `publication_year`, `host_venue`, `authors TEXT[]`, `abstract`, `discipline_tags TEXT[]` (the six cog-sci field tags), `full_text_available`, `referenced_works_count`.
- `paper_citations` — `(citing_paper_id, cited_paper_id)` composite PK, both FK → `papers` ON DELETE CASCADE, CHECK citing <> cited, reverse index on `cited_paper_id`. Within-corpus citation edges (the temporal-depth axis).
- `concept_links.paper_id` — new NULLABLE INTEGER FK → `papers(id)` ON DELETE SET NULL, indexed. User-pasted links keep NULL; Chaos-applied links point at their grounding paper. LEFT JOIN convention applies.
- `chaos_predictions` — the one standing prediction per target: `target_type` CHECK ('concept','situation'), `target_id`, `prediction`, `run_id`, UNIQUE(`target_type`,`target_id`). Polymorphic target with no FK on `target_id` (concepts and combos live in different tables) — same convention as `comment_mentions`.
- `chaos_prediction_events` — APPEND-ONLY observation log (no `updated_at`): `event` CHECK ('confirmed','expected_absent','appeared_elsewhere'), `paper_id` nullable FK → `papers`, `run_id`, `noted_at`. Recurrence/decay counts are always DERIVED by query, never stored.
- Seed account: `chaos-seed-data` (renamed from `chaos-seed`; `migrate-chaos.js` renames the legacy row in place, preserving its id and all attribution), email `chaos-seed-data@orcaconcepts.org`, sentinel `orcid_id = 'CHAOS-SEED-ACCOUNT'` (non-digit, cannot collide with a real ORCID; never rendered as an ORCID badge — see ORCID display validation below), login disabled via non-bcrypt password hash. **Resolve by `username='chaos-seed-data'`, never by hardcoded id** — the SERIAL id differs per environment (local dev: 25).
- **ORCID badge display validation:** because the seed account's `orcid_id` is a non-ORCID sentinel, badge-display endpoints null it out at emit time via `backend/src/utils/orcidValidator.js` (`orcidForDisplay`), and `OrcidBadge.jsx` / `ProfilePage.jsx` render no badge for a non-ORCID-format value via `frontend/src/utils/orcidValidator.js` (`isValidOrcid`). The two regex copies are kept in sync manually (same convention as `inOrcaLinks.js` ↔ `LinkifiedText.jsx`). Display-only — the stored sentinel and the `orcid_id NOT NULL` constraint are untouched.

Gitignored operational dirs: `chaos/papers/`, `chaos/reason_cache/`, `chaos/proposals.*`, `backups/`. `chaos/snapshot.js` now snapshots the new tables; `chaos/SCHEMA_NOTES.md` updated to reflect resolved gaps.

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

## Security Posture (May 24, 2026)

**Production secrets** live only in Railway environment variables. They are not stored in any document, repository, or local file outside Railway. Each secret has a documented rotation procedure (in the off-repo operations runbook, not here, for the obvious reason). Current production keys: `JWT_SECRET`, `DATABASE_URL`, `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `RESEND_API_KEY`, `GOOGLE_SAFE_BROWSING_API_KEY` (Phase 64a). The Safe Browsing key is restricted at Google Cloud Console to the Safe Browsing API only — even if exfiltrated, it cannot be used to incur cost on other GCP services.

**Local development environment** (`backend/.env`) contains only local-dev-safe values:
- `JWT_SECRET`: distinct from production (rotating production has no effect on local)
- `DATABASE_URL`: points at the local Postgres instance only
- `ORCID_CLIENT_ID` / `ORCID_CLIENT_SECRET`: removed. ORCID OAuth is not exercised in local dev; the `POST /api/auth/orcid/dev-connect` endpoint (404 in production) is used instead to link an ORCID iD without an OAuth call. The `verifyOrcidExists` step in `registerWithOrcid` is also skipped outside production.
- `RESEND_API_KEY`: removed. `backend/src/utils/email.js` explicitly sets `resend = null` when the key is missing and all send functions early-return with a warning log. Emails are silently not sent in local dev.
- `GOOGLE_SAFE_BROWSING_API_KEY`: absent. `backend/src/utils/safeBrowsing.js` logs a single startup warning and `checkUrl` returns `{ safe: true, threats: [] }` on every call. URL safety is not checked in local dev; this is acceptable because malicious-link testing happens against production using Google's published test URL (`http://malware.testing.google.test/testing/malware/`).

**Git ignore protection** is layered: root `.gitignore` excludes `.env`; `backend/.gitignore` adds defense-in-depth for the same exclusion at the backend folder level. The latter exists so that a stray `git add backend/.env` run from the wrong working directory still has a chance of being blocked.

**Account access**: The Gmail account that owns Railway, Resend, ORCID, Cloudflare, and GitHub access has 2FA enabled.

**R2 storage was retired** as part of this hardening pass. The R2 access key was revoked at Cloudflare, the bucket was deleted, and the `R2_*` env vars were removed from Railway. The codebase has no S3/R2 SDK imports, no `R2_*` references, no related dependencies in `package.json`, and no upload routes — verified by audit before retirement. R2 was originally provisioned for the pre-Phase-58 document-upload feature and survived the Phase 58 pivot as orphaned config.

**Note on git history**: prior versions of this file referenced outside counsel by name; the current version does not. Older commits retain the reference. A history rewrite (`git filter-repo` + force-push) would be required to remove it. Decided not worth the risk and effort: the attorney-client relationship is not confidential and the reference is benign.

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
- The app proper (root, concepts, voting, tunnels, situations, etc.) — replaced by the landing page
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
- Seeded with 4 defaults. Controlled by `ENABLED_ATTRIBUTES` env var. **Phase 70: now `ENABLED_ATTRIBUTES=value` (value-only) — the other three rows remain seeded but disabled at read time.**

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

### Situation (Combo) Tables

**combos** — Named collections of edges. Case-insensitive unique name. `created_by` uses ON DELETE SET NULL.
**combo_edges** — Junction: combo to edge. UNIQUE(combo_id, edge_id).
**combo_subscriptions** — **(Phase 67) now backs "open situation tabs"**, not a user-facing subscription. A row means "this user has this situation open as a tab." Has `group_id` FK to tab_groups. `subscribeToCombo`/`unsubscribeFromCombo` are the open/close-tab operations (close is idempotent). UNIQUE(user_id, combo_id).
**combo_votes** — **(Phase 67)** Per-row situation vote (endorsement), independent of open tabs. UNIQUE(user_id, combo_id), index on `combo_id`. Modeled on `tunnel_votes`. Drives the Browse default sort and the "Voted" view filter.

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

**safe_browsing_rejections** — Sparse audit trail for URL submissions rejected by Google Safe Browsing (Phase 64a). Records `id`, `attempted_by_user_id` (FK users, SET NULL), `url_hash` (sha256 of lowercased URL, CHAR(64), NOT NULL), `threat_types` (TEXT[] NOT NULL — array of Safe Browsing categories like `MALWARE`, `SOCIAL_ENGINEERING`), `source` (VARCHAR(16) NOT NULL — `'add'` or `'preview'`, distinguishes the security-boundary rejection from the preview-time rejection), `rejected_at`. Indexed on `attempted_by_user_id` and `url_hash`. No plaintext URL preserved. Modeled on `link_removal_log`. Same forensic question is answerable: "did user X ever attempt to post URL Y?" — extends to "from which call site, and what was the threat category?".

**comment_mentions** — Backreference index for in-orca URLs in user-authored comments and addenda (Phase 65b-1). Records `id`, `source_type` (VARCHAR(32), CHECK in `'concept_link_comment'`, `'concept_link_addendum'`, `'tunnel_link_comment'`, `'tunnel_link_addendum'`), `source_id` (the id of the row in the source table), `target_type` (VARCHAR(16), CHECK in `'concept'`, `'situation'`, `'link'`, `'tunnel'`), `target_id` (the id of the mentioned thing), `target_path` (INTEGER[], NULL for non-concept targets, may be `'{}'` for root concept mentions per Phase 65b-1-fix), `created_at`. No FKs by design — see "No FK on `comment_mentions`" AD. Indexed on `(target_type, target_id)` and `(source_type, source_id)`. Rows are inserted at write time inside the source row's transaction (parser is `parseMentions.js`). Visibility filtering happens at read time via the `/api/mentions` endpoint, NOT at write time, so un-hiding a link's edge automatically restores its mentions. When a link is hard-deleted via `POST /web-links/remove`, mention rows where the deleted link is the source are also deleted (in the same transaction); no analogous cleanup exists yet for tunnel deletion since tunnels have no user-facing delete path.

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
| POST | `/orcid/dev-connect` | Yes | **Dev-only.** Links an ORCID iD to the current account by writing it directly to the DB (no OAuth call). Returns 404 in production. Used for local testing without exercising the real ORCID OAuth flow. |

### Concepts (`/api/concepts`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/root` | Guest | Root concepts (sort: saves/new) |
| GET | `/attributes` | Guest | Enabled attributes |
| GET | `/search` | Guest | Trigram search (?attributeId= filter) |
| GET | `/names/batch` | Guest | Batch name resolution |
| GET | `/:id` | Guest | Concept with children. **Phase 65b-2:** also returns `mentionCount` for the concept itself at the current path (target_type='concept', target_id=<id>, target_path=<path>) via correlated subquery with visibility filter. |
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
| GET | `/web-links/preview-title` | Yes | **NEW Phase 60a.** Title preview for the add-link form. Query: `?url=...`. Validates well-formed http(s) URL (400 on malformed). **Phase 64a:** runs Google Safe Browsing check BEFORE OG-fetch; rejects unsafe URLs with `403 { code: 'unsafe_url' }` and logs a `safe_browsing_rejections` row (`source: 'preview'`). On safe URLs, reuses the same OG-fetch utility as `POST /web-links/add` with SSRF protection (DNS resolve + private IP block) + 5s timeout. Returns `{ title: string }` (may be empty if no OG title found; SSRF-blocked URLs also return empty title — see "OG Title Auto-Fetch" AD for the rationale). |
| GET | `/web-links/votes/me` | Yes | User's upvoted links (legacy, retained for rollback safety post-59b) |
| GET | `/web-links/:edgeId` | Guest | Links for edge (?sort=top/new). Each link includes `addenda[]` and `authorOrcidId` (Phase 62b). **Phase 65b-2:** also includes `mentionCount` per link — count of visible mentions targeting this link, via correlated subquery using the same visibility filter as `/api/mentions` (filter must stay in sync — see "Visibility Filter Coupling" AD). |
| GET | `/web-links/:linkId/location` | Guest | **NEW Phase 65a.** Resolves a `concept_links.id` to its parent context for in-orca share URLs. Returns `{ linkId, edgeId, conceptId, parentPath }` where `parentPath` is root-to-parent inclusive (matches `graph_path` semantics AD #137 — the concept itself is NOT included). 404 if the link is hidden, hard-deleted, under legal hold, or non-existent (opaque, no information leakage). Consumed by AppShell's deep-link `useEffect` to route `/link/:id` to `/concept/:conceptId?path=...#link-:id`. |
| POST | `/web-links/add` | Yes | Add link (OG title auto-fetch). **Phase 64a:** runs Google Safe Browsing check after URL validation and before OG-fetch + INSERT; rejects unsafe URLs with `403 { code: 'unsafe_url' }` and logs a `safe_browsing_rejections` row (`source: 'add'`). |
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

### Situations (`/api/combos`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Guest | List all combos. **Phase 67:** returns `vote_count` + `user_voted` per combo; default sort is `vote_count DESC` (was subscriber count); accepts `?filter=voted` (only situations the current user voted for) and `?sort=new`. |
| GET | `/:id` | Guest | Combo details + edges. **Phase 66:** also returns `save_count` per edge. **Phase 67:** returns `vote_count` + `user_voted` for the situation. |
| GET | `/:id/links` | Guest | Aggregated links (?sort=top/new) |
| GET | `/by-edge/:edgeId` | Guest | Combos containing an edge |
| POST | `/create` | Yes | Create combo |
| GET | `/mine` | Yes | User's owned combos |
| GET | `/subscriptions` | Yes | User's open situation tabs (formerly "subscriptions") |
| POST | `/subscribe`, `/unsubscribe` | Yes | **Phase 67:** open / close a situation tab (idempotent). Reframed in place — no longer a user-facing subscription. |
| POST | `/:id/vote` | Yes | **NEW Phase 67.** Toggle the current user's vote on a situation. Returns `{ voted, vote_count }`. Mirrors `POST /tunnels/vote`. |
| POST | `/:id/edges/add`, `/:id/edges/remove` | Yes | Edge management (owner) |
| POST | `/:id/transfer-ownership` | Yes | Ownership transfer |

### Tunnels (`/api/tunnels`)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/:edgeId` | Guest | Tunnel links for edge. Each row returns `comment`, `addenda[]`, `authorOrcidId`, and `createdByUserId` (Phase 62b). **Phase 65b-2:** also returns `mentionCount` per tunnel via correlated subquery with visibility filter. |
| GET | `/:tunnelLinkId/location` | Guest | **NEW Phase 65a.** Resolves a `tunnel_links.id` to its origin edge's parent context for in-orca share URLs. Returns `{ tunnelLinkId, edgeId, conceptId, parentPath }`. Tunnels are bidirectional but the share URL anchors on the origin edge by convention. Same 404 opacity as `/web-links/:linkId/location`. |
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

### Mentions (`/api/mentions`, Phase 65b-1)
GET `/:targetType/:targetId?path=&limit=&offset=` — paginated mentions filtered by visibility. Guest-accessible. `targetType` must be one of `concept`, `situation`, `link`, `tunnel` (400 on invalid). `targetId` must be a positive integer (400 on invalid). For `concept` targets `?path=` is required (may be empty for root concepts — see Phase 65b-1-fix); ignored for link/tunnel/situation targets. `limit` defaults to 20, max 50; `offset` defaults to 0. Visibility filter is a LEFT JOIN to source/parent tables that hides mentions whose source's parent link/tunnel is `is_hidden = true` or `legal_hold = true`; un-hiding restores them automatically. Response shape: `{ mentions: [{ id, sourceType, sourceId, sourceParentId, sourceParentType, sourceText, sourceAuthor: { id, username, orcidId }, createdAt }], totalCount, hasMore }`. Sort order: newest first by mention `created_at`.

---

## Backend Utilities

- **`backend/src/utils/email.js`** (Phase 61a) — Resend wrapper. Exports `sendVerificationEmail`, `sendWelcomeEmail`, `sendPasswordResetEmail`. Each function NEVER throws — returns `{ success, error }`. Fails loudly at module load if `RESEND_API_KEY` is missing in production; warns in dev. Templates live in `backend/src/email-templates/{verify-email,welcome,reset-password}.html`.
- **`backend/src/utils/orcid.js`** (Phase 61b) — Shared ORCID API utility. Exports `exchangeOrcidCode`, `fetchOrcidEmails`, `verifyOrcidExists`. Used by both `POST /api/auth/orcid/callback` (existing-account linking) and `POST /api/auth/orcid/begin-registration` (new-account registration). All calls have 5-second timeouts.
- **`backend/src/utils/safeBrowsing.js`** (Phase 64a) — Google Safe Browsing v4 wrapper. Exports one function: `async function checkUrl(url) → { safe: boolean, threats: string[] }`. NEVER throws — fail-open on any error (returns `{ safe: true, threats: [] }` with a warning log). 5-second timeout via `AbortController`. Single startup warning when `GOOGLE_SAFE_BROWSING_API_KEY` is missing. Sends `clientId: 'orca-concepts'`, all four threat types (MALWARE, SOCIAL_ENGINEERING, UNWANTED_SOFTWARE, POTENTIALLY_HARMFUL_APPLICATION), `ANY_PLATFORM`. Called from `webLinksController.addWebLink` and `webLinksController.previewTitle`. Same contract shape as `email.js` and `orcid.js`.
- **`backend/src/utils/inOrcaLinks.js`** (Phase 65a) — Shared in-orca URL grammar + parser. Exports `IN_ORCA_LINK_REGEX_GLOBAL` (the anchored grammar with `g` flag for text scanning) and `parseInOrcaLinks(text)` which returns an array of `{ targetType, targetId, targetPath, fragment }` entries (deduplicated by target). The grammar is intentionally narrow: only `https://orcaconcepts.org/(concept|situation|link|tunnel)/[0-9]+(\?path=[0-9,]*)?(#(link|tunnel)-[0-9]+)?` and the localhost equivalent. Trailing punctuation in surrounding prose is not absorbed. The frontend `LinkifiedText.jsx` defines the same regex inline — they must stay in sync character-for-character; both files carry comments noting this. Used by the linkifier in `LinkifiedText.jsx` (via the inline-copied regex); not called by any backend write path (the mention parser is a separate utility, below).
- **`backend/src/utils/parseMentions.js`** (Phase 65b-1) — Stricter mention-indexing variant of `parseInOrcaLinks`. Exports `parseMentions(text) → Array<{ targetType, targetId, targetPath }>`. Two key differences from `parseInOrcaLinks`: (a) concept URLs MUST have `?path=` to be indexed (path-dependent identity is load-bearing), but empty `?path=` is accepted as a root-concept reference (Phase 65b-1-fix); (b) shape is mention-row-ready, with `targetPath` as `int[]` for concepts (possibly `[]` for roots) and `null` for link/situation/tunnel mentions. Deduplicates by `(targetType, targetId, targetPath)`. Never throws. Called at four write sites: `addWebLink` and `addConceptLinkAddendum` in `votesController.js`, `createTunnelLink` (both directions) and `addTunnelLinkAddendum` in `tunnelController.js`. Each write happens inside the source row's INSERT transaction.
- **`backend/scripts/test-email.js`** (Phase 61a) — CLI script for manually testing Resend integration. Usage: `node scripts/test-email.js <email-address>`.
- **`backend/scripts/manual-verify-email.js`** (Phase 61 follow-up fix) — CLI admin tool to manually mark a user's `email_verified_at` and send their welcome email. Created during the verify-URL bug postmortem; useful for any future case where email delivery leaves a user in a stuck state. Usage: `node scripts/manual-verify-email.js <user-id>`.

---

## Frontend Component Map (Post-Phase 61c)

### Pages (`frontend/src/pages/`)
- **Root.jsx** — Root concepts page with attribute filter
- **Concept.jsx** — Concept page with children, Flip View, Tunnel View, links panel. **Phase 62b fix:** Share link now uses `path` state (from API response) instead of `effectivePath` (tab path) — the previous code stripped the parent from the URL because `effectivePath` doesn't end with the concept ID in tab mode. **Phase 65a:** A new effect keyed on `[concept?.id]` reads `window.location.hash` (`#link-:id` or `#tunnel-:id`) and sets `pendingScrollLinkId` or the new `pendingScrollTunnelLinkId` state accordingly, then strips the hash from the URL via a replace-navigate so it doesn't retrigger. `pendingScrollTunnelLinkId` is passed to TunnelView. **Phase 65b-2:** Reads `conceptMentionCount` from the concept response and passes it to `ConceptLinksPanel` for the new "Mentioned by" tab.
- **ResetPasswordPage.jsx** — **NEW Phase 61c.** Standalone page at `/reset-password`. Reads `token` from query params, shows new-password form, POSTs to `/api/auth/reset-password`. On success, brief message then `navigate('/')` after 2 seconds. Accessible without auth.
- **VerifyEmailPage.jsx** — **NEW Phase 61c.** Standalone page at `/email-verification`. Reads `status` and `reason` query params (set by the backend `/api/auth/verify-email` redirect). Shows success (auto-redirects home after 2s) or error (with "Return to home" link). Accessible without auth.

### Core Components (`frontend/src/components/`)
- **AppShell.jsx** — Main layout: header, sidebar, tab management, overlays. Single "Votes" sidebar item replaces the former "Graph Votes" and "Link Votes" entries (Phase 59b). Reads `VITE_OUTREACH_MODE` into `isOutreachMode` (~line 24, Phase 59a) — when ON, hides Legal nav + login/signup, renders `<OutreachLanding />` in place of the sidebar/content area. **Phase 62b:** Deep-link effect handles `/concept/:id?path=...` (opens concept tab for guests and logged-in users) and `/situation/:id` (subscribes + opens combo tab for logged-in users; shows read-only `ComboTabContent` with back button for guests). `guestComboId` state tracks the deep-linked combo for guest viewing. **Phase 65a:** Deep-link effect extended for `/link/:id` and `/tunnel/:id` — fetches `parentPath` from the appropriate `/location` endpoint, then navigates to `/concept/:conceptId?path=...#link-:id` (or `#tunnel-:id`) so the existing concept-deep-link path resolves the rest. Unavailable-link toast (auto-dismiss 4s) shown when the `/location` API returns 404. A `hasDeepLinkInUrl` mount-time `useMemo` (intentionally empty dep array, eslint-disabled) detects whether the entry URL matches a deep-link pattern; when true, `loadAllTabs` skips its default-tab-activation step to prevent a flash of the wrong concept during async resolution — see Phase 65a Completion Narrative for the race details.
- **OutreachLanding.jsx** — **NEW Phase 59a.** Landing page shown when `VITE_OUTREACH_MODE=true`. Replaces the entire app surface with an explanation that the platform is not yet live. See "Operational Modes" section.
- **ConceptLinksPanel.jsx** — Right panel on concept page. **Phase 65b-2:** Three tabs — Links, Situations, and "Mentioned by (N)" (always visible, grayed when N=0). The Mentioned by tab renders `<MentionsPanel targetType="concept" targetId={...} targetPath={...} emptyStateNoun="concept" expanded={...} />`. Tab activation drives the `expanded` prop so the panel only fetches data when actually opened. Passes `conceptId` and `conceptPath` to LinkCard for copy-to-descendant flow. **Phase 65a:** uses `LinkifiedText` instead of `ClampedText` for link comment and addendum bodies. **Phase 60a:** add-link form gained (a) a required affirmation checkbox ("I affirm this URL points to content that is publicly available through legitimate means...") — Submit disabled until checked, state NOT persisted across modal close/reopen; (b) title preview triggered by URL field `onPaste` or `onBlur` (whichever fires first) calling `GET /web-links/preview-title` with `AbortController` cancellation on URL change; pre-fills title field on success with inline edit allowed.
- **LinkCard.jsx** — Reusable link card. Always-visible "Other instances on this concept (N)" / "Other instances across all concepts (N)" dropdowns (disabled when N=0). Prominent up-arrow vote icon. "Copy" button visible only when the current user is the link's adder. **Phase 60a:** "Remove" button restored, visible only when `currentUser?.id === link.added_by`. **Phase 62b:** Comment edit UI removed (original comments now immutable). "Add addendum" button visible to author only — opens inline modal with textarea, 2000-char counter, Escape-to-close. Addenda display below original comment with timestamps. Author username now accompanied by `OrcidBadge` (from `authorOrcidId` field). **Phase 65a:** Share button (visible to all users) copies `https://${origin}/link/:id` to clipboard with brief "Copied!" feedback. Comment and addendum bodies render through `LinkifiedText` instead of `ClampedText`. **Phase 65b-2:** Third "Mentioned by (N)" button alongside the two "Other instances" buttons (same disable-when-zero pattern). Click expands an inline `<MentionsPanel targetType="link" targetId={link.id} emptyStateNoun="link" expanded={...} />` below the buttons.
- **ClampedText.jsx** — **NEW Phase 59a.** Shared line-clamp component with expand toggle. Extracted from duplicated copies in LinkCard and ConceptLinksPanel; also consumed by TunnelView for tunnel comments. **Phase 65a:** still used on non-user-authored text (e.g., link titles, system messages); on user-authored comment/addendum surfaces it is replaced by `LinkifiedText` (which wraps the same clamping behavior with in-orca URL linkification).
- **LinkifiedText.jsx** — **NEW Phase 65a.** Drop-in replacement for `ClampedText` on user-authored comment/addendum surfaces (LinkCard, TunnelView, ConceptLinksPanel). Renders text with in-orca URLs (concept/situation/link/tunnel routes on the production or localhost host) as `<a href target="_blank" rel="noopener noreferrer">` hyperlinks; external URLs and non-matching strings render as plain text. The grammar is an anchored regex defined inline; the same grammar is also defined in `backend/src/utils/inOrcaLinks.js` and the two must stay in sync character-for-character. Preserves the existing line-clamp + expand-toggle behavior. Trailing punctuation in surrounding prose is not absorbed into the URL.
- **MentionsPanel.jsx** — **NEW Phase 65b-2.** Shared component consumed by `ConceptLinksPanel` (Mentioned by tab), `LinkCard` (Mentioned by inline expansion), and `TunnelView` (Mentioned by inline expansion per tunnel card). Props: `targetType` (concept/situation/link/tunnel), `targetId`, `targetPath` (for concepts), `emptyStateNoun` (for empty-state copy substitution: "this concept" / "this link" / "this tunnel link"), `expanded` (parent controls whether to fetch + render). When `expanded` becomes true, fetches `/api/mentions/:targetType/:targetId` and renders newest-first with Load More pagination (20 per page). Each mention row: author + `OrcidBadge` + parent context ("On <concept> / <parent title>") + clamped `LinkifiedText` snippet + relative timestamp. Whole row is clickable — opens the source's parent link/tunnel in a new browser tab via `window.open(${origin}/link|tunnel/${sourceParentId}, '_blank', 'noopener,noreferrer')`. Spinner during initial load; explainer copy when fetch completes with zero results. Inline styles only.
- **CopyLinkPicker.jsx** — Modal overlay for copying a link to a descendant edge. Expandable tree picker with path-scoped subtree fetch, request-generation race guard, Escape-to-close. Calls `POST /api/votes/web-links/copy` on confirm.
- **ComboTabContent.jsx** — Situation tab: header, edge management, aggregated links view. Has request-generation race guard on `loadComboLinks`. **Phase 62b:** Share button in header copies `/situation/:id` URL to clipboard. Unsubscribe button conditionally hidden when rendered in guest read-only mode (no `onUnsubscribe` callback). **Phase 66:** Redesigned layout — concepts grouped into columns by attribute (action, tool, value, question) matching TunnelView's pattern. Each concept card shows name (clickable to navigate), full path, and display-only vote count. Client-side hide/show toggle on every card; hidden concepts grayed (opacity 0.4) and their links excluded from aggregated reading list. Transfer ownership moved from dedicated section to inline header button. Remove button (owner only) retained. Two empty states: "No links yet..." vs "All concepts are hidden..."
- **ComboListView.jsx** — Browse Situations overlay
- **VotesOverlay.jsx** — **NEW Phase 59b.** Combined display-only votes page. Hierarchical tree built from `GET /api/votes/me/all` (saved edges + context edges + ancestors), with the user's link votes nested under each edge. No remove affordances anywhere — navigation into the concept is the only way to change votes. Saved edges visually distinguished from context-only edges. Applies Stale-State Guard request-generation pattern. Replaces the deleted `SavedPageOverlay.jsx` and `LinkVotesOverlay.jsx`. **Phase 66:** Saved/context dot legend removed.
- **FlipView.jsx** — Alt parent contexts with Jaccard similarity
- **TunnelView.jsx** — Cross-graph tunnels by attribute columns. Renders each tunnel row's optional `comment` (Phase 59a). Duplicates between the same edge pair are expected and rendered as independent rows with independent vote counts — do not collapse them. **Phase 62b:** Each tunnel card now shows author username + `OrcidBadge`. Addenda display below comment. "Add addendum" button visible to author only with inline modal. **Phase 65a:** Share button on each tunnel card copies `https://${origin}/tunnel/:id` to clipboard. Comment and addendum bodies render through `LinkifiedText` instead of `ClampedText`. New `pendingScrollTunnelLinkId` prop drives the same 300ms-delay/scrollIntoView/2s-highlight pattern that `ConceptLinksPanel` uses for `pendingScrollLinkId`. **Phase 65b-2:** "Mentioned by (N)" button on each tunnel card (tunnels don't have "Other instances" buttons, so this button stands alone but matches the card's affordance row visually). Click expands an inline `<MentionsPanel targetType="tunnel" targetId={tunnel.id} emptyStateNoun="tunnel link" expanded={...} />`.
- **ConceptGrid.jsx** — Grid display for child concepts
- **SearchField.jsx** — Combined add/search with trigram matching
- **DiffModal.jsx** — Side-by-side concept comparison
- **SwapModal.jsx** — Swap vote picker (sibling-only)
- **VoteSetBar.jsx** — Vote set color swatches and filtering
- **HiddenConceptsView.jsx** — Moderation review panel
- **LoginModal.jsx** — Login/Register/Forgot password modal. **Phase 61c:** registration tab now shows "Sign up with ORCID" as Step 1 (no email/password fields until ORCID auth succeeds), then a Step 2 form with email (prefilled from ORCID-verified email if available), username, password, and ToS checkbox. The Twilio-based phone OTP signup was removed. Forgot-password sub-view replaced with email-based reset request (calls `/api/auth/forgot-password`, shows timing-safe confirmation message).
- **ProfilePage.jsx** — User profile with ORCID, Privacy and Data section. **Phase 62c:** The Connect/Disconnect ORCID conditional UI was removed along with its handlers (`handleConnectOrcid`, `handleDisconnectOrcid`) and the `disconnectConfirm` state. Since ORCID is required at registration, both branches were unreachable. The profile now passively displays the user's ORCID iD via `OrcidBadge`. The `isDev`-gated dev-connect input remains for local testing.
- **DeleteAccountFlow.jsx** — Account deletion with situation transfer pre-check
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

### Safe Browsing Check at URL Submission (Phase 64a)

Every URL submitted to `concept_links` is checked against Google Safe Browsing v4 before being accepted. The check runs at two call sites:
1. `GET /web-links/preview-title` — early feedback during the add-link form. Runs before the OG-fetch.
2. `POST /web-links/add` — security boundary. Runs after URL validation, before OG-fetch and INSERT. Defense-in-depth: catches URLs flagged between preview and submit (unlikely but possible if Safe Browsing's database updated mid-session).

**Threat categories checked:** MALWARE, SOCIAL_ENGINEERING, UNWANTED_SOFTWARE, POTENTIALLY_HARMFUL_APPLICATION. Any match rejects the URL.

**Response on rejection:** `403 { error: '...', code: 'unsafe_url' }`. The `code` is the machine-readable contract; the `error` string is human-readable but should not be relied on by frontend logic. Frontend distinguishes this from other 403s and displays a blocking error that disables Submit (cannot be overridden by the affirmation checkbox).

**Fail-open philosophy:** Safe Browsing's API being unreachable (network failure, timeout, rate-limit, missing key) does NOT block link posting. The utility returns `{ safe: true, threats: [] }` and logs a warning. The reasoning: Orca is not a financial or medical platform; brief loss of malicious-URL filtering during a Safe Browsing outage is a smaller harm than blocking all link posts during the outage. Researchers using the platform during such a window get the equivalent of "no URL safety check" — which is the same posture every link service had before Safe Browsing existed.

**Audit trail:** Every rejection writes a row to `safe_browsing_rejections` with the sha256 hash of the lowercased URL, the threat types matched, the call source (`'add'` or `'preview'`), and the attempting user. No plaintext URL is preserved. This matches the privacy-preserving forensic posture of `link_removal_log` and answers the same class of question: "did user X ever attempt to post URL Y?" — with the added dimension of "from which call site, with which threat type."

**No appeal pathway shipped.** False positives are expected to be rare (Safe Browsing is generally precise) and a researcher who needs to discuss a flagged URL can describe it in prose without posting it as a clickable link. If false positives become a real friction point, an email-to-admin appeal flow is the next iteration — not in scope for 64a.

**Why this and not a domain allowlist:** Considered in Phase 60a and again in 64a planning. An allowlist that's "large enough not to limit researchers" must include every preprint server, every publisher, every university worldwide, every government/IGO, every news outlet, every repository platform — and will still miss things, generating steady "why can't I post this" complaints. Meanwhile, an allowlist defends against "random links" but not "dangerous links" (a compromised university subdomain or a hijacked publisher URL is on the allowlist). Safe Browsing reverses both: it doesn't restrict researchers, and it actually checks for the threat class the allowlist would have only proxied.

**Out-of-scope for 64a:**
- Retroactive scan of URLs already in the database (separate task)
- Tunnel link URLs (tunnels reference internal edges, not external URLs)
- Page comments and other non-`concept_links` text fields (separate phase if abuse surfaces)
- Appeal mechanism (deferred until needed)

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

### Deep-Link Navigation for Concepts and Situations (Phase 62b, May 2026)
AppShell has a `useEffect` keyed on `[loading, authLoading, location.pathname]` that handles two URL patterns:

- **`/concept/:id?path=1,2,3`** — calls `handleOpenConceptTab(conceptId, path)` which creates or reuses a graph tab. Works for both guests (ephemeral tab) and logged-in users (persisted tab). The URL is replaced with `/` after processing.
- **`/situation/:id`** — for logged-in users, calls `handleSubscribeToCombo` (subscribes if needed, switches to combo tab). For guests, sets `guestComboId` state which renders a read-only `ComboTabContent` with a back button. URL replaced with `/`. **Phase 66:** A 301 redirect from `/superconcept/:id` to `/situation/:id` in `server.js` preserves backwards compatibility for old share links.

**AD:** The deep-link effect must depend on `location.pathname`, not just `loading`/`authLoading`. Without the pathname dependency, the effect only fires on initial load — navigating to a share link while already loaded would not trigger it.

**AD:** The concept share link (`Concept.jsx`) must use the `path` state (from the API response, which is `[root, ..., parent, conceptId]`) when building the URL, NOT `effectivePath` (the tab's stored path, which is `[root, ..., parent]` without the concept ID). Using `effectivePath.slice(0, -1)` strips the parent instead of the concept ID.

### Deep-Link Navigation for Links and Tunnel Links (Phase 65a, May 24, 2026)

Extends the Phase 62b deep-link mechanism with two more URL patterns:

- **`/link/:linkId`** — AppShell's deep-link `useEffect` calls `GET /api/votes/web-links/:linkId/location`, which returns `{ conceptId, parentPath }`. The handler then navigates to `/concept/:conceptId?path=...#link-:linkId` and the existing concept-deep-link branch handles the rest. The fragment is read by a new effect in `Concept.jsx` (keyed on `[concept?.id]`) which sets `pendingScrollLinkId`. Existing scroll-and-highlight infrastructure from Phase 62b takes over.
- **`/tunnel/:tunnelLinkId`** — Same pattern via `GET /api/tunnels/:tunnelLinkId/location`. Tunnels are bidirectional but the share URL anchors on the origin edge by convention. Fragment is `#tunnel-:tunnelLinkId`; `Concept.jsx` reads it into `pendingScrollTunnelLinkId` and passes it to `TunnelView`.

**AD:** Location endpoints return `parentPath` (root-to-parent inclusive, matching `graph_path` semantics AD #137), NOT path-to-concept-inclusive. The field name `parentPath` is intentional — it makes the convention self-documenting at every call site and prevents the duplicate-concept-in-breadcrumb bug that Phase 65a originally shipped with (path-to-concept-inclusive was passed to `handleOpenConceptTab`, which expects path-to-parent; the destination concept was then appended a second time by `getConceptWithChildren`'s response). Anywhere a future endpoint returns a location-like response, prefer `parentPath` over the ambiguous `path`.

**AD:** When the entry URL is a deep-link pattern (`/concept/`, `/situation/`, `/link/`, `/tunnel/` followed by an ID), AppShell's `loadAllTabs` must NOT auto-activate the user's first saved graph tab. The default-activation is correct for the home page but causes a visible flash of the wrong concept when an async deep-link resolution is pending. Implementation: a mount-time `useMemo` with empty deps and a regex test for the deep-link patterns produces `hasDeepLinkInUrl`; `loadAllTabs` checks this flag before its `setActiveTab` call. The synchronous `/concept/:id` and `/situation/:id` paths happen to win the race against the default-activation, but the async `/link/:id` and `/tunnel/:id` paths do not — the suppression makes the behavior consistent regardless of timing.

### In-Orca URL Grammar (Phase 65a, May 24, 2026)

In-orca URLs are recognized by a narrow anchored regex defined in both `backend/src/utils/inOrcaLinks.js` and `frontend/src/components/LinkifiedText.jsx`. The two files must stay character-for-character identical; both carry comments noting this. The grammar accepts:

- Production: `^https://orcaconcepts\.org/(concept|situation|link|tunnel)/[0-9]+(\?path=[0-9,]*)?(#(link|tunnel)-[0-9]+)?$`
- Local dev: same shape with `https?://localhost(:[0-9]+)?` as the host.

Trailing punctuation in surrounding prose (commas, periods, parens) is NOT absorbed into the URL — match must end at a word boundary. Better to render a URL as plain text than to render a wrong URL as clickable. The grammar is intentionally narrow; URLs with garbage query params, non-numeric IDs, or any other variation do not linkify and do not generate mentions (Phase 65b respects the same grammar with one tightening — see Strict vs Permissive Grammars AD below).

### Mentions Index Design (Phase 65b-1, May 26, 2026)

The `comment_mentions` table is a join table connecting in-orca URL references in user-authored prose to the things they reference. The design has several deliberate properties:

**No foreign keys.** There are four `source_type` values × four `target_type` values, so referential integrity via FK would require multiple nullable FK columns and CHECK gymnastics. Instead, integrity comes from: (a) the parser being deterministic and called only inside source row INSERT transactions; (b) explicit cleanup at known deletion paths (currently just `POST /web-links/remove`); (c) visibility filtering at read time, which catches the case of orphaned mention rows pointing at deleted/hidden/legal-held parents. Trade-off: orphaned mention rows can exist in the table, but the read endpoint hides them. A future cleanup utility could remove them periodically, but it's not necessary for correctness.

**Visibility filter at read time, not write time.** When a link is hidden, its mention rows stay in the database. The `/api/mentions` endpoint LEFT JOINs to source/parent tables and filters out mentions whose source's parent link/tunnel has `is_hidden = true` or `legal_hold = true`. Un-hiding restores mentions automatically. Same forensic question is preserved: "did user X ever mention concept Y?" remains answerable via raw SQL even when the mention is filtered from API responses.

**Write at source-row transaction time.** Parser runs synchronously inside the same transaction as the source row's INSERT. If the parser or mention INSERT fails, the entire write (link/addendum/tunnel/etc.) rolls back. This guarantees that a comment in the DB has correctly-indexed mentions, and a partial state (comment exists, mentions missing) cannot occur. Note: if the parser misses a real mention due to a grammar bug, the comment is still saved without that mention — the parser's contract is "never throw," not "never miss." Missed mentions are a degradation; partial state would be a corruption.

**Backfill is idempotent.** `backend/scripts/backfill-mentions.js` runs DELETE-then-INSERT per source row, so re-running it produces identical row counts. Supports `--dry-run` for pre-flight inspection. Required for picking up mentions written by pre-65b-1 comments; was run once locally and once in production after 65b-1 deploy.

### Strict vs Permissive In-Orca URL Grammars (Phase 65b-1, May 26, 2026)

Phase 65a's `parseInOrcaLinks` and 65b-1's `parseMentions` are two parsers of the in-orca URL grammar with **different strictness**, deliberately:

- **Linkifier grammar (`parseInOrcaLinks`, used by `LinkifiedText.jsx`):** permissive. Any URL matching `^https?://(host)/(concept|situation|link|tunnel)/[0-9]+(\?path=[0-9,]*)?(#(link|tunnel)-[0-9]+)?$` is clickable, including concept URLs with no `?path=` (treated as "the user pasted something concept-y, render it clickable, let the destination handle it").
- **Mention parser (`parseMentions`, used at write paths and backfill):** strict. Concept URLs MUST have `?path=` to be indexed as mentions. Path-dependent identity is load-bearing for Orca; a mention without a path is a mention to "concept name X regardless of context," which dilutes the identity model. The reason for using a separate strict parser instead of tightening `parseInOrcaLinks` is that the linkifier should NOT break existing user-pasted URLs by suddenly making them non-clickable. The two parsers coexist; the linkifier renders more URLs clickable than the indexer indexes.

This is asymmetric by design. A URL like `https://orcaconcepts.org/concept/5` (no path) renders as clickable in a comment but does not generate a mention. Users pasting such URLs eventually learn (via the absence of an expected mention) that the Share button is the right way to reference a concept — Share emits `?path=` correctly per Phase 65b-1-fix.

### Root Concept Mentions via Empty Path (Phase 65b-1-fix, May 26, 2026)

Root concepts have `graph_path = '{}'` (the empty array — see graph_path Semantics AD #137). The Phase 62b concept share button was conditionally emitting `?path=` only when the path was non-empty, producing `/concept/N` (no query string) for roots. Combined with the Phase 65b-1 strict mention parser, this meant root-concept share URLs were clickable but not indexed as mentions — a design hole.

The fix has two coordinated parts: (a) the share button now ALWAYS emits `?path=` with empty value for roots and the full path for non-roots; (b) `parseMentions.js` distinguishes "path absent" (still rejected, ambiguous) from "path empty" (accepted as root reference). The linkifier was already permissive enough; no change there. The schema already accepted `target_path = '{}'`; no change there.

**Resulting invariant:** every root concept share URL is now `/concept/N?path=` (visibly empty path query). Every non-root concept share URL is `/concept/N?path=A,B,C`. The presence of `?path=` (even when empty) is the signal that the URL is a deliberate concept reference, not a malformed hand-typed string. Backfilled root mentions appear in `comment_mentions` with `target_path = '{}'`.

### Visibility Filter Coupling Across Four Locations (Phase 65b-2, May 26, 2026)

The visibility filter that hides mentions whose source's parent link/tunnel is `is_hidden = true` or `legal_hold = true` now lives in **four places** that must stay in sync:

1. `backend/src/controllers/mentionsController.js` — canonical version in the `/api/mentions/:targetType/:targetId` endpoint. The LEFT JOIN + WHERE conditions filter the paginated results.
2. `backend/src/controllers/conceptsController.js` — correlated subquery for the concept's `mentionCount` field.
3. `backend/src/controllers/votesController.js` — correlated subquery for each link's `mentionCount` field in `GET /web-links/:edgeId`.
4. `backend/src/controllers/tunnelController.js` — correlated subquery for each tunnel's `mentionCount` field in `GET /tunnels/:edgeId`.

If any of these drift from the others, badges (count) and panels (results) disagree. Phase 65b-2 originally shipped with the count subqueries missing the filter entirely — badges showed counts that included hidden-parent mentions while the panel correctly excluded them. The 65b-2-fix follow-up ported the canonical filter to all three count subqueries and added matching code comments noting the four-way coupling.

**Mitigation paths considered (not yet taken):**
- Extract the filter to a SQL view (`visible_mentions`) that the four locations query.
- Extract to a Postgres function returning a JOIN-able rowset.
- Move counts onto materialized columns on `concept_links`/`tunnel_links`/`concepts` updated on mention insert/delete (changes the maintenance burden but avoids the count-vs-panel-divergence class of bug entirely).

For now: code comments and discipline. The "extract to shared SQL helper" cleanup is documented in Tech Debt; revisit when (a) a fifth caller appears, or (b) the count-vs-panel divergence bites again.

### Legacy Bare-Concept URLs Are Not Routable (Phase 65b-2 area, May 26, 2026)

URLs of the form `https://orcaconcepts.org/concept/N` (no `?path=`) — pre-65b-1-fix share URLs hand-typed or copied from elsewhere — are accepted by the linkifier (rendered as clickable hyperlinks in comments) but, when clicked, AppShell's deep-link useEffect cannot parse a path from the URL and produces a blank app shell with sidebar + header but no main content area. There is no toast or error.

This is a real edge case, but narrow: post-65b-1-fix, every share URL emitted by Orca's UI includes `?path=` (empty value for roots). Real-world production URLs going forward all carry the query. The only ways to encounter a bare-concept URL are (a) hand-typing one, (b) copy-pasting from a comment that was authored before 65b-1-fix shipped, or (c) external sources that constructed the URL manually.

Accepted as known limitation, documented as tech debt. Two potential resolutions: (a) make AppShell graceful — treat missing `?path=` as empty path / root concept; (b) show the existing "That link is no longer available" toast and redirect to `/`. Either is a small fix; deferred because the case is genuinely rare. See Tech Debt.

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

### Phase Transitions Can Leave Zombie Code (added Phase 62c)
When a phase changes an architectural assumption — e.g., "ORCID is optional" → "ORCID is required" in Phase 61d/e — endpoints, UI elements, and code paths that depended on the previous assumption may survive in the codebase even though they are no longer reachable, valid, or correct. This has now happened twice:

- **Phase 62a** cleaned up Phase-58-era zombie UI on the profile page (saved-tabs and annotation-related affordances that the Phase 58 pivot had silently invalidated).
- **Phase 62c** removed the ORCID disconnect endpoint and UI, which Phase 41a had created when ORCID was optional and Phase 61d/e had silently invalidated when it added the `NOT NULL` constraint on `orcid_id`. The endpoint was broken (it attempted `UPDATE users SET orcid_id = NULL`, violating the constraint) and, even if it had worked, the defensive ORCID-present check at login would have permanently locked out any user who used it.

The pattern is: a phase changes a constraint, schema, or invariant; previously-valid code paths that relied on the old invariant become invalid but compile and ship; they sit dormant until either (a) a user exercises them, (b) a developer notices during unrelated work, or (c) an architecture review surfaces them. The cost of leaving them is real — the disconnect endpoint would have produced a 500 error on first contact with any real user clicking the button.

**Practice going forward:** when a phase changes an architectural assumption, search the codebase for previously-valid code paths that relied on the old assumption, not just the obvious ones the phase touches. Endpoints, UI buttons, conditional branches keyed on the now-invariant condition, and tests are all candidates. This is a class of debt distinct from "TODOs" and "tech debt" — it's silent invalidation rather than known imperfection, and it doesn't surface in normal review.

---

## Phase 66 Completion Narrative

Phase 66 shipped two user-facing changes (the "superconcept" → "situation" rename and the situation page redesign) plus a pre-existing bug fix, bundled because the rename touched nearly every file the redesign also touched.

**The rename:** "Superconcept" was the original technical term for named collections of edges. In user testing and outreach, "situation" better conveyed the feature's purpose — a curated research situation composed of concepts from across the graph. The rename touched: all user-facing UI text, the URL route (`/superconcept/:id` → `/situation/:id`), backend regexes in `inOrcaLinks.js` and `parseMentions.js`, the CHECK constraint on `comment_mentions.target_type`, `VALID_TARGET_TYPES` in `mentionsController.js`, the data export key (`superconcepts_owned` → `situations_owned`), frontend prop names (`onNavigateToSuperconcept` → `onNavigateToSituation`), and style key names in `ConceptLinksPanel`. A 301 redirect from `/superconcept/:id` to `/situation/:id` in `server.js` preserves backwards compatibility for old share links already in the wild.

**The situation page redesign:** `ComboTabContent` was restructured from a flat subconcept list + aggregated links to an attribute-columnar layout matching `TunnelView`'s pattern. Concepts are grouped into columns by attribute (action, tool, value, question). Each card shows the concept name (clickable to navigate), full path breadcrumb, and a display-only save vote count (new `save_count` field from `getCombo`'s correlated subquery). A client-side hide/show toggle on every card (available to everyone, not just owners) grays hidden concepts and excludes their links from the aggregated reading list below. Transfer ownership was moved from a dedicated section to an inline "Transfer" button in the header alongside Share and Unsubscribe.

**Bug fix (pre-existing):** The `addVote` and `addSwapVote` handlers in `votesController.js` referenced the dropped `saved_tabs` and `vote_tab_links` tables, causing 500 errors on any concept save vote. This bug predated the current session (discovered during Phase 62b Level 1 testing, documented in Tech Debt). Fixed by removing the dead table references.

---

## Phase 65b-2 Completion Narrative

Phase 65b-2 shipped the Mentions UI, completing the in-orca-links arc that began with Phase 65a (share buttons + linkification) and continued through 65b-1 (mentions data layer). With 65b-2 live, in-orca URLs are now a first-class feature: write them, click them, and see backreferences accumulate on every targetable surface.

**The phase didn't split.** Earlier analysis suggested splitting into 65b-2a (concept tab) and 65b-2b (link/tunnel affordances), but the three surfaces share enough machinery — same `MentionsPanel` component, same pagination, same click-to-source behavior — that splitting would have introduced refactoring tax for no clear smoke-testing benefit. The combined phase modified one new file (`MentionsPanel.jsx`) and seven existing files, which is bigger than typical but coherent.

**Design choices that mattered:**

- **Always-visible affordances with `(N)` counts, grayed when zero.** Matches the existing "Other instances" pattern on `LinkCard`. The Mentions tab on concept pages is also always visible (not hidden when empty); users always know where to find it, and an empty state with explainer copy ("No mentions yet. When researchers reference this concept...") covers the new-user case.

- **A single `MentionsPanel` component for all three surfaces.** Props: `targetType`, `targetId`, `targetPath`, `emptyStateNoun`, `expanded`. The parent controls activation via `expanded`. This avoids three near-identical components and centralizes the pagination + click-handling logic.

- **`mentionCount` baked into existing list endpoints, not a separate count endpoint.** A correlated subquery per row in `getWebLinks`, `getConceptWithChildren`, and `getTunnelLinks`. No extra round trip per page load. At current row volumes the subquery cost is negligible.

- **Click on a mention row opens a new browser tab via the Phase 65a share URL.** The whole row is the click target. No separate "open" affordance, no inline expansion that breaks the navigation paradigm users learned in 65a. Consistent with the always-new-tab framing of 65a.

- **Addendum-precise scroll-and-highlight deferred.** The destination is the parent link/tunnel card, not the specific addendum within it. Users on the destination page have to eyeball which addendum mentioned them. Documented as a possible future improvement; not in 65b-2.

### Bug 65b-2-fix: visibility filter divergence

Smoke testing surfaced a class of bug that the original spec explicitly warned about: the count subqueries lacked the same visibility filter that the `/api/mentions` endpoint applies. So a concept whose only mention had a hidden source's parent edge would show `Mentioned by (1)` on the badge but render an empty panel when expanded — count and panel disagreed.

The fix ported the canonical filter from `mentionsController.js` to the three count subqueries (in `conceptsController.js`, `votesController.js`, `tunnelController.js`) and added matching code comments noting the four-way coupling. The filter now lives in four places that must stay in sync; documented in the "Visibility Filter Coupling" AD with potential extraction paths if the duplication gets unwieldy.

This is the second time the 65b arc surfaced a count-vs-panel divergence concern at spec time (first was during 65b-2 planning, second was 65b-2-fix actually fixing it). The lesson: when a UI element shows a count, the count must come from a query that runs the same WHERE clauses as the query that produces the panel results. Anything less is a guaranteed-eventual disagreement.

### A second bug: legacy bare-concept URLs

During smoke testing, a single in-orca URL in a comment (`http://localhost:3000/concept/180` — no `?path=`) failed to navigate when clicked. This was diagnosed as a pre-existing issue, NOT a 65b-2 regression: bare-concept URLs were broken before 65b-1-fix shipped (since the share button now always emits `?path=`, no new URL of this form can be generated). The URL was hand-typed during early 65a testing.

Decided to leave it as-is: the case is genuinely narrow (only hand-typed or pre-65b-1-fix URLs are affected), users don't construct URLs manually, and the cost of a graceful-fallback fix is non-zero. Documented as known limitation in Tech Debt. If this becomes a real friction point — e.g., external sites that link into Orca with manually constructed URLs — the fix is a small AppShell change (treat missing `?path=` as empty path, route to the concept as a root reference).

### Meta-lessons (Phase 65b arc complete)

Five distinct bugs surfaced across the 65a → 65b-2 arc, four caught at smoke-test time:
- `65a-fix`: `graph_path` semantics in `parentPath` field name
- `65a-fix-2`: async race in `loadAllTabs` vs deep-link useEffect
- `65a-fix-3`: dead fragment-reading effect for tunnels; correct fix uses `handleOpenConceptTab`'s viewMode arg
- `65b-1-fix`: root concept share URLs missing `?path=`
- `65b-2-fix`: visibility filter divergence between count subqueries and `/api/mentions` endpoint

The investigation prompts continue to be the highest-leverage tool in the workflow. Each of the five bugs was correctly diagnosed by a Claude Code investigation before any code change was written. The fixes themselves were all small (1-30 lines); the diagnoses were the hard part.

The pattern across these bugs: **a new producer of a behavior was added without first verifying the assumptions baked into existing consumers.** `graphPath` conventions, mount ordering, fragment survival through navigation, share-button output format, visibility filter coupling — in each case, the new code assumed a behavior of existing code that turned out to be different from what the spec assumed. Catching this at spec time (rather than smoke-test time) requires the spec to explicitly cite the existing pattern being extended and verify the actual behavior, not the inferred behavior.

If/when a custom Claude Code skill for ORCA phase prompts is built (still deferred to post-launch), this should be the top item. Until then, the investigation prompts will continue catching things, just later than ideal.

---

## Phase 65b-1 Completion Narrative

Phase 65b-1 shipped the data layer for Mentions: schema, parser hookup at four write paths, read endpoint, and idempotent backfill. **No UI in this phase** — Mentions panels and counts are 65b-2.

**The split:** the in-orca-links arc was designed as 65a (share + linkify) and 65b (mentions). Mentions itself split into 65b-1 (data flow) and 65b-2 (UI polish). Reason: the data layer is a foundation that benefits from being proven in production before any UI consumes it; if the join table, parser hookup, or visibility filter have bugs, the UI can't tell which layer is misbehaving. Splitting also let the backfill be a clearly-scoped commit with its own risk profile (one-off script across all existing comments).

**Design choices and the reasoning:**

- **No FKs on `comment_mentions`.** Four source × four target = sixteen possible relationships. Modeling them with FKs would require sixteen nullable columns with CHECK constraints, or a polymorphic FK pattern (not natively supported by Postgres). Instead, integrity comes from determinism: the parser runs in the source row's transaction, deletion paths clean up explicitly, and read-time visibility filtering joins to source/parent tables. Orphan rows can exist in the table but are invisible to API consumers. Tradeoff accepted.

- **Two parsers with different strictness.** The linkifier's grammar (Phase 65a's `parseInOrcaLinks`) is permissive — any concept URL with or without `?path=` is clickable. The mention parser (65b-1's `parseMentions`) is strict — concept URLs without `?path=` are rejected. The asymmetry exists because tightening the linkifier would break existing user expectations (a URL that was clickable yesterday shouldn't suddenly not be), but the mention index needs path-dependent identity to be meaningful. The two parsers share a grammar definition philosophy but diverge on strictness for concept URLs specifically. This is the kind of design that needs a clear AD because the asymmetry is non-obvious — see "Strict vs Permissive In-Orca URL Grammars" AD.

- **Visibility filtering at read time.** When a link is hidden by moderation, its mention rows stay in the database. The endpoint LEFT JOINs to the source's parent and filters out hidden/legal-held parents. Un-hiding restores mentions automatically. This is the same pattern Phase 53b established for legal hold and Phase 6 established for `is_hidden`; the alternative (DELETE on hide, INSERT on un-hide) is messier and breaks the principle that hiding is reversible.

- **Backfill is idempotent.** DELETE-then-INSERT per source row means re-running the script produces identical counts. The `--dry-run` flag was load-bearing for the production run; it would have caught a missing table, wrong env var, or grammar misfire before any writes.

### The bug arc — surface in this phase

Three bugs surfaced during smoke testing and were resolved in-arc:

1. **`65a-fix-3` (tunnel view auto-switch).** Discovered when paste-testing tunnel share URLs locally. Opening `/tunnel/:id` resolved to the right concept but rendered in the default view mode (Children) instead of Tunnel View; `TunnelView` was never mounted and the scroll-and-highlight silently failed. The first attempted fix added a fragment-reading effect to `Concept.jsx` that would detect `#tunnel-:id` and call `setViewMode('tunnel')` — but the effect never fired, because `handleOpenConceptTab` manages tab state without using URL fragments and `navigate('/', { replace: true })` strips any hash. The correct fix uses `handleOpenConceptTab`'s existing `viewMode` parameter (sixth positional argument), which the `/tunnel/:id` branch was simply omitting. Lesson: when extending a working pattern with new async steps, verify that the working pattern's ordering wasn't relying on synchronous execution OR specific URL state. The fragment-reading effect was added in 65a as defensive code but turned out to be a dead path because `handleOpenConceptTab` doesn't use fragments.

2. **`65b-1-fix` (root concept share URLs).** Discovered when realizing a root concept share URL `http://localhost:3000/concept/1` was not generating a mention row. The strict mention parser rejected it because it lacked `?path=`. But root concepts have empty `graph_path` and the share button was correctly omitting `?path=` per its existing logic. So this was a real design hole, not a parser bug: roots are first-class navigable entities and should be mention-able, but the strict grammar said otherwise. Resolved by tightening the share button (always emit `?path=`, with empty value for roots) AND relaxing the parser (accept `?path=` with empty value as a root reference, still reject `?path=` absent entirely). The schema already accepted `target_path = '{}'` so no migration was needed.

3. **A non-bug worth noting:** the dry-run found that one existing production addendum (created during 65a smoke testing) had `https://orcaconcepts.org/concept/1` with no `?path=` and was correctly rejected as ambiguous (predates the 65b-1-fix share-button change). Accepted as a one-time grandfathered case — fixing it would require a manual SQL edit, and the cost is "one ungenerated mention that no UI consumes yet."

### Meta-lessons

- The investigation prompts (asking Claude Code to diagnose without writing a fix) continue to be the most leveraged tool in this workflow. All three 65a/65b-1 bugs were correctly diagnosed before any fix was written.

- Migration files modifications need an explicit "actually run migrate" step in the verification checklist. Claude Code reported "Migration runs cleanly" in 65b-1 self-verification when it had only syntax-checked the file. The next phase that adds a migration needs the verification step to be: "run `node src/config/migrate.js` AND THEN `psql -c '\d <tablename>'` confirming the table exists, AND THEN paste the output."

- "When extending an existing pattern, identify the most similar existing pattern and verify the new spec matches its actual behavior, not its inferred behavior." This is the third phase where assuming behavior bit us (65a-fix: graph_path semantics; 65a-fix-2: sync-vs-async race in deep-link useEffect; 65a-fix-3: assumed fragment would survive handleOpenConceptTab). Worth codifying in the eventual Claude Code skill (still deferred to post-launch).

- Production backfill via Railway CLI requires the public Postgres URL, not the internal one. `railway run` injects the production env vars but executes locally, so `postgres.railway.internal` doesn't resolve. The workaround is to manually set `DATABASE_URL` to the public proxy URL (`<random>.proxy.rlwy.net:<port>`) for the duration of one terminal session. This is annotated as future tech debt — if backfill operations become routine, a better pattern would be to add a `migrate-prod` npm script with documented public-URL handling.

---

## Phase 65a Completion Narrative

Phase 65a added share buttons on links and tunnel links plus in-comment linkification of in-orca URLs. The phase shipped with two follow-up bug fixes (`65a-fix` and `65a-fix-2`) that surfaced during smoke testing and are documented here as architectural lessons.

**The trigger:** users wanted to reference other concepts and links inside their comments — to write "see also [other concept]" without copying a clunky URL. The initial design considered a concept picker UI but ruled it out as messy (especially for picking specific links/tunnel-links). Final design: a "Copy share link" button on every targetable surface; users paste the URL into their comment; comment rendering linkifies in-orca URLs only.

**The simplification mid-design:** the original framing involved seamless in-app navigation (jump to existing tab, scroll-and-highlight, etc.). Reframed late in planning to "always open a new browser tab" — cuts a class of edge cases (existing-tab-vs-new decision, click interception, history management) and decouples the navigation model from the mentions feature entirely. New-tab behavior also dovetails with the new browser tab opening the same deep-link URL the share button copies — which routes through the existing deep-link infrastructure rather than a parallel in-app navigation path.

**Why split into 65a + 65b:** the share-and-linkify half is independently useful and testable. The mentions half (`comment_mentions` join table, parsing at write time, mentions panel UI) is a larger architectural addition that benefits from 65a being proven in production first. The `parseInOrcaLinks` utility was scaffolded in 65a so the URL grammar is defined exactly once; 65b will plug it into write-time hooks.

### Bug 1: `65a-fix` — duplicate concept in breadcrumb

The `/location` endpoints originally returned `path: [...row.graph_path, row.concept_id]` — i.e., root-to-concept-inclusive. AppShell's deep-link handler passed that array directly to `handleOpenConceptTab` as the tab path. But `handleOpenConceptTab` expects path-to-parent only (matching the `effectivePath` / `?path=` query-string convention used elsewhere). The redundant `concept_id` at the end caused `getConceptWithChildren`'s response to append the concept again, producing a breadcrumb with the destination concept repeated: `Root > X > Y > Code Availability > Code Availability`.

**Fix:** renamed the response field from `path` to `parentPath` and changed the value to `row.graph_path` directly (no append). The new name makes the convention explicit at every call site. AppShell's `/link/:id` and `/tunnel/:id` branches updated to read `data.parentPath`.

**Lesson:** `graph_path` semantics are subtle. `ORCA_STATUS.md`'s AD #137 explicitly warns "never append parent_name separately," and this bug was the same class of error in a new disguise. When writing a spec touching `graph_path` or paths in general, the spec should identify the most-similar existing consumer (here: Phase 62b's concept share URL, which uses path-to-concept-inclusive in the `?path=` query but treats the tab's stored path as path-to-parent) and match its convention exactly — or explicitly document a new convention with a self-documenting field name.

### Bug 2: `65a-fix-2` — async race causes flash of wrong concept

After fixing Bug 1, share URLs worked but had a different symptom: opening `/link/:id` in a fresh browser tab while logged in briefly showed the user's first saved graph tab (the "originating" concept they were on when they copied the link) before switching to the correct destination. Clicking the same URL again in the same browser tab worked correctly.

**Root cause:** a race between `loadAllTabs`'s default-tab-activation and the async location-resolution.

Mount sequence:
1. `loadAllTabs` sets `loading=true`, gating the deep-link `useEffect`.
2. `loadAllTabs` finishes by calling `setActiveTab({ type: 'graph', id: loadedGraph[0].id })` to restore the user's last-viewed tab.
3. `setLoading(false)` triggers the deep-link `useEffect`.
4. For `/concept/:id` (synchronous handler): `handleOpenConceptTab` runs before paint, overriding `setActiveTab`. User never sees the originating tab.
5. For `/link/:id` (async — API call to `/location` first): the originating tab is rendered while the API call is in flight. When `.then()` fires, the destination tab activates, but the user already saw the wrong tab briefly.

On subsequent clicks in the same browser tab, `loadAllTabs` doesn't re-run (it's mount-only), so the race doesn't reproduce.

**Fix:** at mount, detect whether the entry URL matches a deep-link pattern (`/(concept|situation|link|tunnel)/\d+`). If so, suppress `loadAllTabs`'s default-activation. The mount detection is a `useMemo` with an empty dep array (intentional — we want a one-shot snapshot, not a live value that flips when the URL is rewritten during deep-link resolution). The deep-link handler then activates the correct tab once its (possibly async) resolution completes.

**Lesson:** introducing async into a previously-synchronous code path can break implicit ordering assumptions. The Phase 62b deep-link branch happened to win the race against `loadAllTabs`'s default-activation by virtue of being synchronous; the assumption "deep-link handler wins because it runs after `loadAllTabs`" was load-bearing but undocumented. When extending a working pattern with new async steps, verify that the working pattern's ordering wasn't relying on synchronous execution.

### Combined meta-lesson

Both bugs share a pattern: a new producer of a behavior (location endpoint, async deep-link branch) was added without checking the assumptions baked into existing consumers (`handleOpenConceptTab`'s path convention, the implicit ordering between mount effects). The bugs were caught in smoke testing rather than at spec time. Going forward, when writing a Claude Code prompt that adds a new producer of a behavior, the spec should explicitly cite the most-similar existing consumer and either match its conventions or call out the divergence.

If/when a custom Claude Code skill for ORCA phase prompts is built (currently deferred to post-launch), "for every new spec, identify the most similar existing pattern and verify the new spec matches its conventions" should be a top item — possibly the top item.

---

## Phase 64a Completion Narrative

Phase 64a added Google Safe Browsing v4 URL safety checks at the two existing link-submission call sites, replacing the previously-considered domain-allowlist approach.

**The trigger:** revisiting domain restrictions as a defense against "random or dangerous links." The original Phase 60a discussion had rejected an allowlist as too restrictive for cross-disciplinary research. In re-examining the question, the framing shifted: an allowlist defends against the *origin* of a URL (which is a weak proxy for safety — university subdomains and Google Docs both make any allowlist and both get compromised), while what the user actually wanted to defend against was malicious *content* at the URL. Safe Browsing addresses the actual threat directly without the false-positive cost of a domain list.

**Design choices, all of which followed established patterns:**
- **Two call sites, same utility.** Preview-time check gives early feedback before the user invests effort in the affirmation checkbox; post-time check is the security boundary. Defense-in-depth.
- **Fail-open never-throws contract.** Mirrors `email.js` and `orcid.js`. Module logs once at startup if the key is missing; every `checkUrl` call returns `{ safe: true, threats: [] }` on any failure. Safe Browsing outages should not take down link posting on a research platform.
- **Sparse hash-only audit table.** `safe_browsing_rejections` matches `link_removal_log`'s schema and intent. Same forensic capability ("did user X ever attempt URL Y?") without retaining content the user wasn't allowed to post in the first place. The added `source` column distinguishes preview from post — both are signal but they're different signals.
- **403 with `code: 'unsafe_url'`.** Machine-readable contract for the frontend so it can render a blocking error (no override possible) while distinguishing this case from other 403s (e.g., legal-hold).
- **No appeal flow.** False positives are expected to be rare. If they become friction, an email-to-admin path is the next iteration. Deferred until needed.

**Implementation notes:**
- Local dev runs without the API key. The startup warning is the correct local behavior; testing happens against production using Google's published test URL (`http://malware.testing.google.test/testing/malware/`), which Safe Browsing always flags. This preserves the Phase-62c-era security posture of keeping production secrets out of `backend/.env`.
- The Google Cloud API key is restricted to the Safe Browsing API only — if exfiltrated, it cannot be used to incur cost on other GCP services.
- The check is positioned BEFORE the OG-fetch at both call sites, so SSRF protection is not the only thing standing between an attacker and a fetched-but-malicious response. The order is: validate format → check Safe Browsing → fetch OG title → INSERT.

**Lessons:**
- The "domain allowlist" framing surfaced twice (Phase 60a planning, Phase 64a planning) and was rejected both times for the same underlying reason. Worth noting that revisiting a previously-rejected approach is fine — but the second visit should explicitly re-engage with the prior reasoning rather than relitigate from scratch. The framing that finally moved the conversation was "what is the actual threat — origin or content?" — and once that was clear, Safe Browsing was the obvious answer.
- The pattern of "server-side utility that gates a write path, with sparse hash-only audit logging on rejection" now has two instances (`link_removal_log` and `safe_browsing_rejections`). Both follow the same shape. If a third instance lands (e.g., spam detection, content classifier), the audit-write logic is worth extracting into a small helper. Premature to abstract at N=2.
- Suggested early in planning to add the production key to `backend/.env` for local smoke-testing, which would have directly undone the Phase-62c security hardening pass. Caught and corrected before any change was made. Going forward: any phase that adds a new external API integration with a production key should default to the fail-open / disabled path locally, with testing happening against production.

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
- The "is this principle protecting shared structure or self-authored self-contained content?" distinction is a useful lens. Likely re-applicable when thinking about future features (e.g., should user-authored situations be deletable? Probably yes if no one else has subscribed; what about after subscriptions exist? Different question).

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
- ~~**Pre-existing: `POST /api/votes/add` broken (saved_tabs reference)**~~ **Resolved Phase 66** — dead `saved_tabs` / `vote_tab_links` references removed from `addVote` and `addSwapVote` in `votesController.js`.
- **Deep-link concept tab label:** When opening a concept via `/concept/:id`, the tab label defaults to "Concept" because `handleOpenConceptTab` is called without a `conceptName`. The correct name loads after the API call, but the tab label isn't updated retroactively. Consider updating the tab label in `loadConcept` after the API response arrives.
- **Profile page edit affordances need verification (Phase 62a):** The profile page now re-fetches after edit-save operations. Confirm in production that all edit flows (e.g., the Edit button next to the email field) properly trigger a re-fetch and don't leave stale data on screen. If any edit flow doesn't trigger a re-fetch, it'll silently show stale data until the user navigates away. (Phase 62c removed the ORCID Connect/Disconnect flow from this surface — no longer applicable.)
- **In-orca URL regex duplicated (Phase 65a):** The grammar is defined in `backend/src/utils/inOrcaLinks.js`, `frontend/src/components/LinkifiedText.jsx`, AND now `backend/src/utils/parseMentions.js` (the strict mention variant). All three files carry comments noting that the shared portion of the grammar must stay in sync character-for-character, but there is no enforcement. Two reasonable resolutions: (a) move the regex to a `shared/` directory imported by both backend (Node `require`) and frontend (Vite `import`); (b) add a build-time sync check (CI step or unit test that reads both files and compares regex strings). Promoted from "low priority" to "medium priority" by Phase 65b-1 since the third file makes the duplication more brittle. Address before any further variant is added.

- **Production backfill requires manual public-URL workaround (Phase 65b-1):** `railway run node backend/scripts/backfill-mentions.js --dry-run` fails with `ENOTFOUND postgres.railway.internal` because the production env vars reference Railway's internal Postgres hostname, which only resolves from inside the Railway network. The workaround is to copy the public proxy URL (`<random>.proxy.rlwy.net:<port>`) from the Postgres service's Variables tab and `set DATABASE_URL=<public-url>` for the duration of one local terminal session. If backfill operations become routine, this should be codified — either as a documented runbook step or as a `migrate-prod` npm script that handles the URL substitution. For now, low priority since backfills are one-off operations.

- **Mention deletion not implemented for tunnel hard-deletes (Phase 65b-1):** When a regular link is deleted via `POST /web-links/remove`, its mention rows are cleaned up in the same transaction. No analogous cleanup exists for tunnel deletion because there is no user-facing tunnel-delete path yet. The visibility filter at read time handles the case (orphaned mention rows are invisible to API consumers when their source's parent tunnel doesn't exist or is hidden), so this is a "garbage stays in the table" issue rather than a correctness issue. Address when a user-facing tunnel-delete path is built.

- **Visibility filter duplicated across four backend locations (Phase 65b-2):** The mentions visibility filter (hide mentions whose source's parent link/tunnel is `is_hidden = true` or `legal_hold = true`) is now defined in four files: `mentionsController.js` (canonical), `conceptsController.js` (count subquery), `votesController.js` (count subquery), `tunnelController.js` (count subquery). Each is annotated with a code comment noting the coupling, but there is no enforcement. If a fifth caller appears, or if the divergence bites again, extract to a SQL view (`visible_mentions`) or a Postgres function returning a JOIN-able rowset. See "Visibility Filter Coupling" AD. Medium priority.

- **Legacy bare-concept URLs are not routable (Phase 65b-2 area):** URLs of the form `/concept/N` (no `?path=`) are clickable in comments but produce a blank app shell when clicked because AppShell's deep-link useEffect cannot parse a path. No new URLs of this form can be generated by the UI post-65b-1-fix (the share button always emits `?path=`), so the only ways to encounter one are (a) hand-typing, (b) copy-pasting from a pre-65b-1-fix comment, or (c) externally-constructed URLs. Two potential resolutions if this becomes a real friction point: (a) make AppShell graceful — treat missing `?path=` as empty path / root reference; (b) show the existing "unavailable link" toast. Either is a small fix; deferred because the case is genuinely rare. See "Legacy Bare-Concept URLs Are Not Routable" AD.

- **Addendum-precise scroll-and-highlight deferred (Phase 65b-2):** When a mention's source is an addendum (not the original comment), clicking the mention opens the parent link/tunnel card with scroll-and-highlight on the card itself, not on the specific addendum within it. Users must eyeball which addendum mentioned them. Would require extending the URL fragment grammar to support `#link-:id-addendum-:id` (or equivalent) and adding addendum-precise scroll logic in `LinkCard` and `TunnelView`. Deferred; revisit if users complain. Low priority — link cards aren't huge.
- **OG image file still named with old "superconcept" convention (Phase 66):** If a page-specific OG card screenshot was named `og-superconcept.png` or similar, it may need renaming for consistency with the "situation" rename. Low priority — the filename is never user-visible, only the OG_OVERRIDES path key matters.
- **`handleOpenConceptTab` accepts `conceptName` but is called without one in deep-link branches:** The deep-link concept tab label item above generalizes — `/link/:id` and `/tunnel/:id` resolutions also call `handleOpenConceptTab(data.conceptId, data.parentPath)` without a name. The fix is the same: pull the name from the loaded concept after the API call and update the tab label retroactively.
- **`subscriber_count` is now vestigial (Phase 67):** The Browse page and situation header display `vote_count` instead. `getComboSubscriptions` still computes `subscriber_count` (now meaning "people with the situation open as a tab"), and the field is unused by the UI. Drop from that query if no consumer reappears. Also: `reloadComboSubscriptions` in `AppShell.jsx` is defined but no longer called (its only caller, the old Browse `onSubscribe`, was removed) — safe to delete on next pass.
- **`combo_subscriptions` table name is misleading post-Phase-67:** it now stores "open situation tabs," not subscriptions. Kept the name to avoid a wide rename across migrate/controller/routes/`api.js`. The endpoints `POST /combos/subscribe` and `/unsubscribe` are likewise reframed open/close-tab operations. Consider renaming to `combo_open_tabs` (+ endpoint aliases) if the vocabulary mismatch causes confusion. Low priority.

### Forward Roadmap
- ~~Phase 70: value-only pivot (`ENABLED_ATTRIBUTES=value` + attribute badges removed) + situations removed from the UI (data lever + entry-point removal; backend left as dead code)~~ **completed June 14, 2026**
- ~~Phase 69: concept-card & links-panel enhancements — cross-sibling-descendant flag + per-card link count (children & root grids) + Flip/Tunnel button counts + vote-set color dots on links~~ **completed June 13, 2026**
- ~~Phase 68: ORCID badge display validation (shared `orcidValidator`; null invalid iDs at emit + render no badge) + `chaos-seed` → `chaos-seed-data` rename~~ **completed June 13, 2026**
- ~~Phase 67: situations-as-tabs (reframe subscriptions → open tabs, closeable X) + situation votes (`combo_votes`) + Browse votes sort + "Voted" view + `setSavedPageOpen` zombie fix~~ **completed June 13, 2026**
- ~~Phase 66: "Superconcept" → "Situation" rename + situation page redesign + VotesOverlay legend removal + saved_tabs bug fix~~ **completed June 6, 2026**
- ~~Phase 65b-2: Mentions UI — concept tab + link card affordance + tunnel card affordance + mentionCount in list endpoints~~ **completed May 26, 2026** (with `65b-2-fix` follow-up for visibility filter alignment). **In-orca-links arc complete.**
- ~~Phase 65a: share buttons on links/tunnel-links + in-comment linkify of in-orca URLs~~ **completed May 24, 2026** (with `65a-fix` and `65a-fix-2` follow-ups)
- ~~Phase 65a-fix-3: tunnel view auto-switch on `/tunnel/:id` share URL~~ **completed May 26, 2026**
- ~~Phase 65b-1: Mentions data layer — schema, parser hookup, backfill, read endpoint~~ **completed May 26, 2026** (with `65b-1-fix` for root-concept share URLs)
- ~~Phase 64a: Google Safe Browsing URL check at preview and post~~ **completed May 24, 2026**
- ~~Phase 62c: removed dead ORCID disconnect endpoint and UI~~ **completed May 23, 2026**
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

## Recent Commits (Phase 59 through 66)

```
[hash] phase 66: rename "superconcept" to "situation" + situation page redesign
        — All user-facing UI text, URL routes, backend regexes, CHECK constraints,
          data export keys updated from "superconcept" to "situation".
        — /superconcept/:id 301-redirects to /situation/:id for old share links.
        — ComboTabContent redesigned: concepts grouped by attribute columns
          (action, tool, value, question); client-side hide/show toggle per card;
          hidden concepts excluded from aggregated links; transfer ownership
          moved to header button; getCombo returns save_count per edge.
        — VotesOverlay legend (saved/context dot) removed.
        — Bug fix: removed dead saved_tabs / vote_tab_links references from
          addVote and addSwapVote in votesController.js (pre-existing 500 errors).
[hash] phase 65b-2: Mentions UI (concept tab, link/tunnel affordances, mentionCount)
        — New MentionsPanel.jsx shared component used by concept tab + link cards
          + tunnel cards; always-visible (N) count, grayed when 0; empty-state
          with surface-specific copy ("this concept" / "this link" / "this tunnel
          link"); Load More pagination at 20/page; click-to-source opens parent
          in new tab via Phase 65a share URL.
        — ConceptLinksPanel.jsx: third "Mentioned by" tab.
        — LinkCard.jsx: third "Mentioned by" button alongside "Other instances".
        — TunnelView.jsx: "Mentioned by" button on each tunnel card.
        — mentionCount via correlated subquery in GET /web-links/:edgeId,
          /concepts/:id, /tunnels/:edgeId; visibility filter matches /api/mentions
          (per 65b-2-fix).
        — Includes 65b-2-fix: aligned count subquery visibility filter with
          /api/mentions endpoint after smoke testing surfaced badge-vs-panel
          count divergence.
[hash] phase 65b-1: mentions data layer (schema, parser hookup, backfill, read endpoint)
        — comment_mentions table with CHECK constraints (no FKs by design);
          parseMentions.js strict variant (requires ?path= for concept URLs,
          accepts empty path as root reference per 65b-1-fix); parser called
          at four write sites in same transaction as source row; mention
          rows cleaned up at POST /web-links/remove; new GET /api/mentions
          endpoint with visibility filter (LEFT JOIN to source/parent tables,
          hides hidden/legal-held); backfill-mentions.js script (idempotent,
          --dry-run flag); no UI yet (Phase 65b-2).
[hash] phase 65b-1-fix: handle root concept share URLs in parser and share button
        — Concept.jsx share button always emits ?path= (empty for roots);
          parseMentions.js distinguishes "path absent" (reject) from
          "path empty" (accept as root reference); schema already allowed
          target_path '{}'; linkifier regex already accepted both shapes.
[hash] phase 65a-fix-3 (retry): pass viewMode 'tunnel' to handleOpenConceptTab
        — /tunnel/:id branch passes 'tunnel' as 6th positional arg;
          earlier fragment-reading-effect attempt was dead code path since
          handleOpenConceptTab doesn't use URL fragments.
[hash] phase 65a-fix-2: suppress default tab activation when URL is a deep-link
        — Mount-time hasDeepLinkInUrl useMemo (empty deps); loadAllTabs skips
          its setActiveTab default-restoration when set. Fixes flash of wrong
          concept on fresh-browser-tab opens of /link/:id and /tunnel/:id.
[hash] phase 65a-fix: location endpoints return parentPath, not path-to-concept
        — Renamed response field; returns row.graph_path directly; AppShell
          reads data.parentPath. Fixes duplicate-concept-in-breadcrumb.
[hash] phase 65a: share buttons + in-orca linkify in comments
        — GET /web-links/:linkId/location and /tunnels/:tunnelLinkId/location;
          Share buttons on LinkCard and TunnelView; AppShell handles /link/:id
          and /tunnel/:id with client-side resolution + unavailable-link toast;
          Concept.jsx reads URL fragment for scroll-and-highlight;
          LinkifiedText replaces ClampedText on user-authored comment surfaces;
          inOrcaLinks.js shared URL grammar (parseInOrcaLinks scaffolded for 65b).
[hash] phase 64a: Google Safe Browsing URL check at preview and post
        — safeBrowsing.js utility (fail-open, 5s timeout, never throws);
          safe_browsing_rejections audit table (sha256 hash only, no plaintext);
          reject unsafe URLs at POST /web-links/add and GET /web-links/preview-title;
          403 with code: 'unsafe_url' for frontend distinction; ConceptLinksPanel
          shows blocking error and disables submit on unsafe URL; .env.example
          entry; missing key = fail-open with startup warning.
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
