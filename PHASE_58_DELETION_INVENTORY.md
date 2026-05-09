# Phase 58 Deletion Inventory

Comprehensive catalog of every file, route, component, table, and code block that touches features being retired in the Phase 58 pivot to link-based references.

---

## 1. Database Tables to Drop

### Tables to DROP entirely (Phase 58a)

| Table | Line in migrate.js | Description |
|-------|-------------------|-------------|
| `documents` | ~515 | Uploaded document content (title, body, format, versions) |
| `corpuses` | ~493 | Named collections of documents |
| `corpus_documents` | ~590 | Junction: links documents to corpuses |
| `corpus_subscriptions` | ~628 | User subscriptions to corpuses |
| `corpus_allowed_users` | ~750 | Corpus membership/permissions |
| `corpus_invite_tokens` | ~777 | Invite tokens for corpus access |
| `document_annotations` | ~666 | Annotations (concept-to-document links) |
| `annotation_votes` | ~701 | Endorsement votes on annotations |
| `annotation_color_set_votes` | ~724 | Preferred color sets per annotation (dormant) |
| `annotation_removal_log` | ~807 | Logs of annotation removals (dormant) |
| `document_tags` | ~1111 | Tag definitions for documents |
| `document_favorites` | ~914 | Per-corpus document favoriting |
| `document_concept_links_cache` | ~853 | Cached concept-name matches in documents |
| `document_authors` | ~1636 | Document co-authorship |
| `document_invite_tokens` | ~1652 | Invite tokens for co-authorship |
| `document_citation_links` | ~1991 | Citation URL detection in uploaded docs |
| `document_external_links` | ~2130 | arXiv/DOI links on documents |
| `combo_annotation_votes` | ~2060 | Votes on annotations within combos |
| `message_threads` | ~1751 | Annotation messaging threads |
| `messages` | ~1764 | Individual messages in threads |
| `message_read_status` | ~1776 | Per-user read timestamps for threads |
| `copyright_infringement_notices` | ~1296 | DMCA takedown notice submissions |
| `copyright_counter_notices` | ~1310 | DMCA counter-notification submissions |
| `saved_tree_order_v2` | ~877 | Tree display order (keyed on corpus_id) |
| `saved_page_tab_activity` | ~939 | Dormancy tracking (keyed on corpus_id) |
| `user_corpus_tab_placements` | ~1042 | Graph tab placement inside corpus nodes |

### Tables that reference dropped tables (cascade or FK update needed)

| Table | Issue |
|-------|-------|
| `legal_removals` | References `documents` and `document_annotations` via target_type/target_id. Keep table but remove document/annotation target_type support in code. |
| `dmca_strikes` | References `legal_removals`. Keep table but will have no new DMCA strikes after copyright form removal. |
| `sidebar_items` | Has rows with `item_type = 'corpus'`. These rows must be deleted. |
| `saved_tree_order` (legacy) | References `saved_tabs` which references `users`. Can be dropped too (already retired). |
| `saved_tabs` | Legacy, functionally retired. Can be dropped. |
| `vote_tab_links` | Legacy, functionally retired. Can be dropped. |

### User table columns to drop

| Column | Reason |
|--------|--------|
| `users.hide_annotation_warning` | Only relevant to annotation creation flow |

### Columns on KEPT tables that reference dropped tables

| Table.Column | References | Action |
|--------------|-----------|--------|
| `combos` (no change needed) | combo_annotation_votes drops cleanly via CASCADE | No action on combos table itself |

---

## 2. Backend Controllers and Routes to Delete

### Controllers to DELETE entirely

| File | Description |
|------|-------------|
| `backend/src/controllers/corpusController.js` (3843 lines) | All corpus, document, annotation, version, tag, favorite, invite, orphan, citation endpoints |
| `backend/src/controllers/messagesController.js` (578 lines) | Annotation messaging threads and replies |
| `backend/src/controllers/legalController.js` (67 lines) | Copyright infringement + counter-notice intake |

### Controllers to MODIFY (not delete)

| File | Changes needed |
|------|---------------|
| `backend/src/controllers/adminLegalController.js` (399 lines) | Remove document/annotation/page_comment target types from `legalRemove`. Remove `getNotices`, `getCounterNotices` endpoints. Keep edge/concept/web_link removal support + `getRemovals`, `getRepeatInfringers`, `clearStrike`. |
| `backend/src/controllers/comboController.js` (828 lines) | Remove `getComboAnnotations`, `voteComboAnnotation`, `unvoteComboAnnotation` functions. Remove annotation_count from listCombos/getCombo. Keep combo CRUD, subscriptions, edge management. |
| `backend/src/controllers/conceptsController.js` | Remove `getAnnotationsForConcept` function (~200 lines). Remove `cited_by_count` and annotation-related JOINs from root/children queries (sort-by-annotations option). |
| `backend/src/controllers/votesController.js` | Remove `getUserSavesByCorpus` corpus badge logic (~60 lines). Remove `getTreeOrderV2`/`updateTreeOrderV2` (~50 lines). Remove `getTabPlacements`/`placeTabInCorpus`/`removeTabFromCorpus` (~80 lines). Remove `getMyAnnotationVotes`. |
| `backend/src/controllers/authController.js` | Remove `hideAnnotationWarning` endpoint. Remove corpus ownership pre-check in `deleteAccount` (keep combo check). |
| `backend/src/controllers/usersController.js` | Remove annotation, document, corpus data from `exportMyData`. Keep web_links, page_comments, superconcepts, graph votes. |

### Route files to DELETE entirely

| File | Description |
|------|-------------|
| `backend/src/routes/corpuses.js` (196 lines) | All /api/corpuses/* routes |
| `backend/src/routes/documents.js` (48 lines) | All /api/documents/* routes |
| `backend/src/routes/messages.js` (32 lines) | All /api/messages/* routes |
| `backend/src/routes/citations.js` (9 lines) | /api/citations/resolve/:annotationId |
| `backend/src/routes/annotations.js` (10 lines) | /api/annotations/:id/cited-by |
| `backend/src/routes/legal.js` (9 lines) | /api/legal/infringement + counter-notice |

### Route files to MODIFY

| File | Changes |
|------|---------|
| `backend/src/routes/adminLegal.js` | Remove `getNotices`, `getCounterNotices` routes |
| `backend/src/routes/concepts.js` | Remove `/:id/annotations` route |
| `backend/src/routes/votes.js` | Remove `saved-by-corpus`, `tree-order-v2/*`, `tab-placements/*`, `my-annotation-votes` routes |
| `backend/src/routes/auth.js` | Remove `/hide-annotation-warning` route |
| `backend/src/routes/combos.js` | Remove `/:id/annotations`, `/:id/annotations/vote`, `/:id/annotations/unvote` routes |

### server.js changes

Remove these `app.use()` lines:
- `app.use('/api/corpuses', corpusesRoutes);` (line 125)
- `app.use('/api/documents', documentRoutes);` (line 127)
- `app.use('/api/messages', messageRoutes);` (line 129)
- `app.use('/api/citations', citationRoutes);` (line 130)
- `app.use('/api/annotations', annotationRoutes);` (line 134)
- `app.use('/api/legal', legalRoutes);` (line 135)

And their corresponding `require()` imports (lines 9, 11, 13, 14, 18, 19).

---

## 3. Backend Middleware, Helpers, and Utilities to Delete

| File | Description | Action |
|------|-------------|--------|
| `backend/src/utils/documentLineage.js` | `getRootDocumentId` + `isDocumentAuthor` helpers | DELETE entirely |
| `backend/src/config/check-dormancy.js` | Background job marking corpus tabs dormant | DELETE entirely |
| `backend/src/config/seed-test-data.js` | Seeds corpus/document/annotation test data | DELETE or rewrite (remove corpus/doc/annotation sections) |
| `backend/src/config/seed-test-scenarios.js` | Additional test scenario seeding | DELETE or rewrite |
| `backend/src/config/test-41c.js` | Test script for document external links | DELETE entirely |
| `backend/src/config/inject-esr-votes.js` | Injects votes (may reference annotations) | REVIEW — likely safe to keep if vote-only |
| `backend/src/config/backfill-tos-consent.js` | Backfills ToS consent timestamps | KEEP (user-table only) |
| `backend/src/utils/userRateLimiter.js` | MODIFY — remove `annotationCreateLimiter`, `documentUploadLimiter`, `versionCreateLimiter`, `messageThreadCreateLimiter`, `messageReplyLimiter` |

---

## 4. Frontend Components to Delete

### Components to DELETE entirely

| File | Description | Only imported from |
|------|-------------|-------------------|
| `frontend/src/components/CorpusTabContent.jsx` | Persistent corpus tab with doc viewer + annotations | AppShell.jsx |
| `frontend/src/components/CorpusListView.jsx` | Browse Corpuses overlay | AppShell.jsx |
| `frontend/src/components/CorpusDetailView.jsx` | Corpus detail page in browse overlay | AppShell.jsx |
| `frontend/src/components/CorpusDocumentList.jsx` | Shared document list sub-component | CorpusTabContent, CorpusDetailView |
| `frontend/src/components/CorpusUploadForm.jsx` | Document upload UI | CorpusTabContent, CorpusDetailView |
| `frontend/src/components/CorpusMembersPanel.jsx` | Corpus member management | CorpusTabContent, CorpusDetailView |
| `frontend/src/components/DocumentView.jsx` | Full document text viewer | AppShell.jsx |
| `frontend/src/components/AnnotationPanel.jsx` | Annotation creation panel | CorpusTabContent, Concept.jsx |
| `frontend/src/components/AnnotateFromGraphPicker.jsx` | Corpus/doc picker for annotating from graph | Concept.jsx |
| `frontend/src/components/AnnotationWarningModal.jsx` | "Annotations are permanent" warning | AnnotationPanel.jsx |
| `frontend/src/components/AnnotationVotesOverlay.jsx` | Browse user's annotation votes | AppShell.jsx |
| `frontend/src/components/CitationRedirect.jsx` | /cite/a/:annotationId route handler | App.jsx |
| `frontend/src/components/MessagesPage.jsx` | Messages page (drill-down threads) | AppShell.jsx |
| `frontend/src/components/MessageThread.jsx` | Individual thread chat view | MessagesPage.jsx |
| `frontend/src/components/AcceptInvite.jsx` | /invite/:token corpus invite acceptance | App.jsx |
| `frontend/src/components/DocInviteAccept.jsx` | /doc-invite/:token co-author acceptance | App.jsx |
| `frontend/src/components/OrphanRescueModal.jsx` | Orphan document rescue UI | AppShell.jsx |
| `frontend/src/components/InfringementNoticePage.jsx` | Copyright infringement form | AppShell.jsx |
| `frontend/src/components/CounterNoticePage.jsx` | Counter-notification form | AppShell.jsx |

### Components that do NOT exist (no MobileBlocker.jsx found)
- `MobileBlocker.jsx` — not present in the codebase (Phase 57 was abandoned before implementation)

---

## 5. Frontend Components to MODIFY (not delete)

### `frontend/src/components/AppShell.jsx` (2224 lines) — HEAVY modification

**Imports to remove:**
- `corpusAPI`, `messagesAPI` from api.js
- `CorpusTabContent`, `CorpusListView`, `CorpusDetailView`, `DocumentView`, `OrphanRescueModal`, `MessagesPage`, `AnnotationVotesOverlay`, `InfringementNoticePage`, `CounterNoticePage`

**State to remove:**
- `corpusTabs`, `pendingCorpusDocumentId`, `pendingAnnotationId`, `pendingAnnotationFromGraph`
- `corpusView`, `messagesPageOpen`, `messagesUnreadCount`, `messagesInitialAnnotationId`, `messagesInitialAnnotationIds`
- `showOrphanModal`, `orphanCount`, `annotationVotesOpen`

**Functions to remove:**
- `handleSubscribeToCorpus` (corpus auto-subscribe + pending doc navigation)
- `handleAnnotateFromGraph` (annotation-from-graph flow)
- `loadCorpusTabs` / corpus subscription loading logic inside `loadAllTabs`
- Messages unread count fetching logic
- Orphan document check logic
- Any corpus tab rendering in the sidebar
- `handleOpenCorpusTab` / corpus tab switching

**JSX blocks to remove:**
- Browse Corpuses button in sidebar action buttons
- Messages button in sidebar action buttons
- Corpus tab items in the sidebar list
- `<CorpusTabContent>` rendering (display:none pattern)
- `<CorpusListView>` / `<CorpusDetailView>` / `<DocumentView>` overlays
- `<MessagesPage>` overlay
- `<AnnotationVotesOverlay>` overlay
- `<OrphanRescueModal>` rendering
- `<InfringementNoticePage>` and `<CounterNoticePage>` route matching in LEGAL_SLUGS
- `report-infringement` and `counter-notice` from LEGAL_SLUGS array
- Login modal notice text referencing documents/annotations

### `frontend/src/pages/Concept.jsx` (1177 lines)

**Imports to remove:**
- `AnnotateFromGraphPicker`
- `AnnotationPanel` (if directly imported here)
- Any `corpusAPI` usage

**State/refs to remove:**
- `showAnnotateFromGraph` (or similar state for the picker)
- Any pending-annotation state passed from AppShell

**Functions to remove:**
- `handleAnnotateFromGraph` / `onAnnotateFromGraph` callback
- Any logic that opens the AnnotateFromGraphPicker

**JSX to remove:**
- "Add as Annotation" button in the concept header
- `<AnnotateFromGraphPicker>` component rendering

### `frontend/src/components/ConceptAnnotationPanel.jsx` (1147 lines) — RENAME to ConceptLinksPanel.jsx in 58d

**For Phase 58c (removal pass):**
- Remove entire "Annotations" tab content (the `getConceptAnnotations` call, annotation card rendering, sort by votes/subscribed/new for annotations, tag filter, My Corpuses filter, annotation click-through logic)
- Keep "Web Links" tab (becomes primary/default)
- Keep "Superconcepts" tab

**Imports to remove:**
- `corpusAPI`, `documentsAPI`, `annotationsAPI` from api.js
- Any annotation-related sub-components

### `frontend/src/components/ComboTabContent.jsx` (1183 lines)

**Remove:**
- Annotation list rendering and sorting
- Combo vote buttons on annotations
- `getComboAnnotations` API call
- `comboAnnotationVote` / `comboAnnotationUnvote` calls
- Annotation filtering by subconcept edges
- Sort options: "Combo Votes", "Annotation Votes", "Subscribed" (annotation-related sorts)
- Click-through navigation to corpus tabs from annotation cards

**Keep:**
- Combo header, description, subscriber count, owner info
- Subconcept (edge) management (add/remove)
- Subscribe/unsubscribe
- Ownership transfer

### `frontend/src/components/SavedPageOverlay.jsx` (162 lines)

**Remove:**
- Corpus badge rendering on tree cards (the badge data comes from annotation membership)
- Any reference to `getUserSavesByCorpus` (returns corpus badge metadata)

### `frontend/src/App.jsx` (49 lines)

**Remove:**
- `import AcceptInvite` and route `/invite/:token`
- `import DocInviteAccept` and route `/doc-invite/:token`
- `import CitationRedirect` and route `/cite/a/:annotationId`

### `frontend/src/components/LegalPage.jsx` (109 lines)

**Remove:**
- The "Copyright Notices" section that links to `/report-infringement` and `/counter-notice`
- Keep the rest (links to Terms, Privacy, Copyright Policy pages)

### `frontend/src/components/DeleteAccountFlow.jsx`

**Modify:**
- Remove corpus transfer pre-check text/logic (keep combo/superconcept transfer check)

### `frontend/src/components/AdminLegalRemovalsPanel.jsx`

**Remove:**
- Incoming Infringement Notices section
- Counter-Notices section
- Document/annotation target types in the removal form
- Keep: edge/concept/web_link removal form, legal removals audit history, repeat-infringer queue

### `frontend/src/components/SearchField.jsx` (579 lines)

**Remove:**
- Corpus annotation badge rendering on search results (the blue corpus pills)
- Corpus badge tooltip portal logic

---

## 6. API Endpoints to Remove

### /api/corpuses/* (entire route file deleted)

| Method | Path | Controller Function |
|--------|------|-------------------|
| GET | `/` | listCorpuses |
| GET | `/mine` | listMyCorpuses |
| GET | `/:id` | getCorpus |
| POST | `/create` | createCorpus |
| POST | `/:id/update` | updateCorpus |
| POST | `/:id/delete` | deleteCorpus |
| POST | `/:id/transfer-ownership` | transferOwnership |
| POST | `/check-duplicates` | checkDuplicates |
| GET | `/documents/search` | searchDocuments |
| GET | `/subscriptions` | getMySubscriptions |
| POST | `/subscribe` | subscribe |
| POST | `/unsubscribe` | unsubscribe |
| POST | `/annotations/create` | createAnnotation |
| POST | `/annotations/delete` | deleteAnnotation |
| POST | `/annotations/vote` | voteOnAnnotation |
| POST | `/annotations/unvote` | unvoteAnnotation |
| GET | `/annotations/edge/:edgeId` | getAnnotationsForEdge |
| GET | `/annotations/document/:documentId` | getAllDocumentAnnotations |
| POST | `/invite/generate` | generateInviteToken |
| POST | `/invite/accept` | acceptInvite |
| POST | `/invite/delete` | deleteInviteToken |
| POST | `/allowed-users/remove` | removeAllowedUser |
| POST | `/allowed-users/display-name` | setAllowedUserDisplayName |
| POST | `/allowed-users/leave` | leaveCorpus |
| POST | `/documents/invite/accept` | acceptDocumentInvite |
| POST | `/documents/:documentId/invite/generate` | generateDocumentInviteToken |
| GET | `/documents/:documentId/authors` | getDocumentAuthors |
| POST | `/documents/:documentId/authors/remove` | removeDocumentAuthor |
| POST | `/documents/:documentId/authors/leave` | leaveDocumentAuthorship |
| POST | `/documents/:documentId/invite-author` | inviteAuthorToDocument |
| POST | `/documents/favorite/toggle` | toggleDocumentFavorite |
| POST | `/versions/create` | createVersion |
| GET | `/versions/:documentId/history` | getVersionHistory |
| GET | `/orphaned-documents` | getOrphanedDocuments |
| POST | `/rescue-document` | rescueOrphanedDocument |
| POST | `/dismiss-orphan` | dismissOrphanedDocument |
| POST | `/:id/documents/upload` | uploadDocument |
| POST | `/:id/documents/add` | addDocumentToCorpus |
| POST | `/:id/documents/remove` | removeDocumentFromCorpus |
| GET | `/:corpusId/documents/:documentId/annotations` | getDocumentAnnotations |
| GET | `/:corpusId/documents/:documentId/annotations-for-concept/:conceptId` | getAnnotationsForConceptOnDocument |
| POST | `/:id/invite-user` | inviteUserToCorpus |
| GET | `/:corpusId/allowed-users` | listAllowedUsers |
| GET | `/:corpusId/invite-tokens` | getInviteTokens |
| GET | `/:corpusId/removal-log` | getRemovalLog |
| GET | `/:corpusId/allowed-status` | checkAllowedStatus |
| GET | `/:corpusId/document-favorites` | getDocumentFavorites |
| POST/GET | color-set routes (3) | 410 Gone stubs |

### /api/documents/* (entire route file deleted)

| Method | Path | Controller Function |
|--------|------|-------------------|
| GET | `/tags` | listDocumentTags |
| POST | `/tags/create` | createDocumentTag |
| POST | `/tags/assign` | assignDocumentTag |
| POST | `/tags/remove` | removeDocumentTag |
| GET | `/:id/tags` | getDocumentTags |
| GET | `/:id/version-chain` | getVersionChain |
| GET | `/:id/version-annotation-map` | getVersionAnnotationMap |
| POST | `/:id/delete` | deleteDocument |
| GET | `/:id/citations` | getDocumentCitations |
| GET | `/:id/external-links` | getDocumentExternalLinks |
| POST | `/:id/external-links/add` | addDocumentExternalLink |
| POST | `/:id/external-links/:linkId/remove` | removeDocumentExternalLink |
| GET | `/:id` | getDocument |

### /api/messages/* (entire route file deleted)

| Method | Path | Controller Function |
|--------|------|-------------------|
| POST | `/threads/create` | createThread |
| GET | `/threads` | getThreads |
| GET | `/unread-count` | getUnreadCount |
| GET | `/annotations/:annotationId/status` | getAnnotationStatus |
| GET | `/threads/:threadId` | getThread |
| POST | `/threads/:threadId/reply` | replyToThread |
| GET | `/threads/:threadId/messages` | getMessages |

### /api/citations/* (entire route file deleted)

| Method | Path | Controller Function |
|--------|------|-------------------|
| GET | `/resolve/:annotationId` | resolveCitation |

### /api/annotations/* (entire route file deleted)

| Method | Path | Controller Function |
|--------|------|-------------------|
| GET | `/:id/cited-by` | getAnnotationCitedBy |

### /api/legal/* (entire route file deleted)

| Method | Path | Controller Function |
|--------|------|-------------------|
| POST | `/infringement` | submitInfringement |
| POST | `/counter-notice` | submitCounterNotice |

### Endpoints to remove from KEPT route files

| Route file | Method | Path | Reason |
|-----------|--------|------|--------|
| auth.js | POST | `/hide-annotation-warning` | Annotation warning feature removed |
| concepts.js | GET | `/:id/annotations` | Concept annotation aggregation removed |
| votes.js | GET | `/saved-by-corpus` | Corpus badge metadata for Saved Page |
| votes.js | GET | `/tree-order-v2` | Corpus-based tree ordering |
| votes.js | POST | `/tree-order-v2/update` | Corpus-based tree ordering |
| votes.js | GET | `/tab-placements` | Graph tab placement in corpus tree |
| votes.js | POST | `/tab-placements/place` | Graph tab placement in corpus tree |
| votes.js | POST | `/tab-placements/remove` | Graph tab placement in corpus tree |
| votes.js | GET | `/my-annotation-votes` | Annotation votes overlay data |
| combos.js | GET | `/:id/annotations` | Combo annotation aggregation |
| combos.js | POST | `/:id/annotations/vote` | Combo annotation voting |
| combos.js | POST | `/:id/annotations/unvote` | Combo annotation unvoting |
| adminLegal.js | GET | `/legal/notices` | Copyright notice listing |
| adminLegal.js | GET | `/legal/counter-notices` | Counter-notice listing |

---

## 7. Frontend API Client Methods to Remove

File: `frontend/src/services/api.js`

### Entire export blocks to remove:
- `corpusAPI` (lines 275-451) — all 40+ methods
- `documentsAPI` (lines 454-500) — all methods
- `citationsAPI` (lines 503-506) — entire block
- `annotationsAPI` (lines 509-515) — entire block
- `messagesAPI` (lines 565-586) — entire block
- `legalAPI` (lines 661-666) — entire block

### Methods to remove from KEPT blocks:
- `authAPI.hideAnnotationWarning` (line 68)
- `votesAPI.getUserSavesByCorpus` (line 136)
- `votesAPI.getTreeOrderV2` (line 194)
- `votesAPI.updateTreeOrderV2` (line 197)
- `votesAPI.getTabPlacements` (line 263)
- `votesAPI.placeTabInCorpus` (line 266)
- `votesAPI.removeTabFromCorpus` (line 269)
- `votesAPI.getMyAnnotationVotes` (line 237)
- `conceptsAPI.getConceptAnnotations` (lines 116-124)
- `conceptsAPI.findConceptsInText` (line 104) — document concept linking
- `conceptsAPI.getDocumentConceptLinks` (line 108) — document concept linking
- `combosAPI.getComboAnnotations` (line 596)
- `combosAPI.voteAnnotation` (line 620)
- `combosAPI.unvoteAnnotation` (line 623)
- `adminAPI.getNotices` (line 669)
- `adminAPI.getCounterNotices` (line 671)

---

## 8. Database Migrations / Seed Data Updates Needed

### migrate.js sections to remove or replace with DROP TABLE

The following CREATE TABLE / ALTER TABLE blocks become DROP TABLE IF EXISTS CASCADE statements in Phase 58a:

- Lines ~493-506: `corpuses` table + index
- Lines ~515-528: `documents` table + index
- Lines ~530-581: document versioning columns
- Lines ~590-607: `corpus_documents`
- Lines ~609-618: documents body trigram index
- Lines ~628-656: `corpus_subscriptions`
- Lines ~666-693: `document_annotations`
- Lines ~701-714: `annotation_votes`
- Lines ~724-738: `annotation_color_set_votes`
- Lines ~750-798: `corpus_allowed_users` + `corpus_invite_tokens`
- Lines ~807-825: `annotation_removal_log`
- Lines ~827-843: document_annotations.layer column
- Lines ~853-868: `document_concept_links_cache`
- Lines ~877-905: `saved_tree_order_v2`
- Lines ~914-928: `document_favorites`
- Lines ~939-1001: `saved_page_tab_activity` + backfills
- Lines ~1003-1057: nested corpus + user_corpus_tab_placements
- Lines ~1110-1169: `document_tags` + `document_tag_links` (already dropped)
- Lines ~1585-1626: Phase 25a tag migration
- Lines ~1636-1669: `document_authors` + `document_invite_tokens`
- Lines ~1748-1787: message tables
- Lines ~1989-2005: `document_citation_links`
- Lines ~2060-2078: `combo_annotation_votes`
- Lines ~2110-2143: `document_external_links`
- Lines ~1292-1318: `copyright_infringement_notices` + `copyright_counter_notices`

### Seed data to remove
- Lines ~1120-1133: document_tags seeding
- Lines ~1135-1145: PrePrint duplicate cleanup
- Lines ~1206-1231: sidebar_items backfill for corpus subscriptions (keep group + graph_tab backfills)
- Lines ~976-1001: saved_page_tab_activity backfills

### Sidebar items cleanup query needed
```sql
DELETE FROM sidebar_items WHERE item_type = 'corpus';
```

### Phase 45 column to drop
- Lines ~2230-2242: `hide_annotation_warning` column (drop in 58a migration)

---

## 9. Tests That Will Break

No dedicated test files exist in the project (no `__tests__/` directory, no `.test.js` files outside node_modules). Testing is done via the `ORCA_TESTS.md` manual checklist.

The following ORCA_TESTS.md sections become obsolete:
- Section 6: Corpuses (entire section)
- Section 7: Documents (entire section)
- Section 8: Annotations (entire section)
- Section 9: Web Links — KEEP (web links stay)
- Section 10: Messaging (entire section)
- Section 13: Corpus Membership & Invites (entire section)
- Section 14: Document Co-Authorship (entire section)
- Section 21: Orphan Rescue (entire section)
- Section 22: Legal Compliance — parts about document upload copyright
- Section 24.37a: Backend bugs referencing corpus/doc/annotation
- Section 24.37c: Corpus & Document Frontend UX
- Section 24.37f: Annotation creation
- Section 25: Combos — annotation-related tests within this section
- Section 31: Annotation Creation Warning Modal (entire section)

---

## 10. Documentation References (Informational Only)

| File | Retired-feature reference count | Notes |
|------|-------------------------------|-------|
| `ORCA_STATUS.md` | ~845 occurrences | Massive — most of the document describes corpus/document/annotation infrastructure. Phase 58e will move completed phase history to ORCA_HISTORY.md and rewrite the active reference sections. |
| `ORCA_TESTS.md` | ~123 occurrences | ~12 full sections become obsolete (see Section 9 above) |
| `ORCA_HISTORY.md` | ~1114 occurrences | Historical record — no changes needed |
| `CLAUDE.md` | ~2 occurrences | Minimal, mostly in the project description |
| `README.md` | ~5 occurrences | Brief, will need minor update |

---

## 11. Surprises and Open Questions

### 1. `saved_tree_order_v2` depends on `corpuses` FK
The `saved_tree_order_v2` table has `corpus_id INTEGER REFERENCES corpuses(id) ON DELETE CASCADE`. Dropping `corpuses` will cascade-drop all rows. The table itself should be dropped since it serves the corpus-tab-based Saved Page which no longer exists.

### 2. `saved_page_tab_activity` also depends on `corpuses` FK
Same pattern — cascade will clean it up, but the table should be explicitly dropped.

### 3. `sidebar_items` has `item_type = 'corpus'` rows
These must be deleted BEFORE dropping the `corpuses` table (or simultaneously in a transaction), since `sidebar_items` doesn't have an FK to `corpuses` — it uses a polymorphic `(item_type, item_id)` pattern. Orphaned rows won't cascade-delete.

### 4. `concepts.legal_hold` and `edges.legal_hold` STAY
These columns were added by Phase 53b for legal removal of edges/concepts. They should be kept — they're on tables that survive the pivot.

### 5. `concept_links.legal_hold` column STAYS
Added Phase 53b. The concept_links table is the foundation of the new system, so this column stays.

### 6. `legal_removals` and `dmca_strikes` tables — keep but limit scope
These tables don't FK to documents/annotations directly (they use `target_type` + `target_id`). Keep both tables, but the admin code that handles `target_type = 'document_version'` or `'annotation'` becomes dead code. Remove those branches.

### 7. `comboController.js` heavily references annotations
About 83 annotation/corpus/document references. The combo system is KEPT, but `getComboAnnotations` (which queries document_annotations and annotation_votes) must be removed entirely. Combos will need a new purpose or will become "edge collections" without annotations.

### 8. `votesController.js` has corpus-dependent save logic
The `getUserSavesByCorpus` function queries `document_annotations` to build corpus badges. The flat Graph Votes page (Phase 38d) uses annotation membership for badge data. After removing annotations, the Graph Votes page becomes a plain flat list of all trees with NO corpus badges — which is actually simpler.

### 9. `conceptsController.js` "sort by annotations" option
Root concepts and children can be sorted by annotation count. This sort option must be removed (revert to saves/new only).

### 10. `multer`, `pdf-parse`, `mammoth` npm packages become unused
These are only used by `corpusController.js` for document upload. They should be removed from `backend/package.json` after the controller is deleted.

### 11. `check-dormancy.js` npm script
The `package.json` likely has a `"check-dormancy"` script that runs this background job. Remove it.

### 12. `conceptsAPI.findConceptsInText` and `getDocumentConceptLinks` in the concepts route
These endpoints exist on the KEPT `/api/concepts` route for in-document concept linking. They should be removed since documents no longer exist. The backend endpoints are in `conceptsController.js` — look for `findConceptsInText` and `getDocumentConceptLinks` functions.

### 13. SearchField corpus annotation badges
The search endpoint in `conceptsController.js` has a query that JOINs `document_annotations` to surface "annotated in [corpus]" badges on search results. This query block must be removed (simplifies search).

### 14. `ENABLED_DOCUMENT_TAGS` env var becomes unused
Remove from `.env.example` and any documentation.

### 15. `AcceptInvite.jsx` and `DocInviteAccept.jsx` — route-level components
These are mounted at `/invite/:token` and `/doc-invite/:token` in `App.jsx`. Both routes and components must be removed since corpus invites and document co-author invites no longer exist.

### 16. The `CopyrightPolicyPage.jsx` vs `CopyrightPage.jsx` — both exist
`CopyrightPolicyPage.jsx` and `CopyrightPage.jsx` both appear in the components list. The static Copyright Policy page at `/copyright` STAYS (it's the legal document). Only the user-facing REPORTING FORM (`InfringementNoticePage.jsx` and `CounterNoticePage.jsx`) gets deleted. Verify which component renders at `/copyright` vs `/copyright-policy` and keep the correct one.

### 17. `AnnotationVotesOverlay.jsx` — "Browse Link Votes" in Phase 58
Per the plan, the Graph Votes sidebar button will be renamed to "Browse Link Votes" in Phase 58d. The `AnnotationVotesOverlay.jsx` component currently shows the user's annotation votes. In the new system it should show concept_link_votes the user has cast. For Phase 58c it should be DELETED; Phase 58d will build the replacement.

### 18. `SavedPageOverlay.jsx` uses corpus badge data
Currently fetches `getUserSavesByCorpus` for corpus badges on tree cards. After removal, the endpoint changes to just `getUserSaves` with no badge data. The component stays but gets simplified.

### 19. `frontend/src/pages/Concept.jsx` references AnnotationPanel via CorpusTabContent
The `AnnotationPanel` import in Concept.jsx appears to be through the concept annotation panel (ConceptAnnotationPanel), not directly. Double-check that removing AnnotationPanel.jsx doesn't break ConceptAnnotationPanel.jsx (the panel that's being renamed, not deleted).

### 20. `combo_annotation_votes` FK to `document_annotations`
This table has `annotation_id INTEGER REFERENCES document_annotations(id) ON DELETE CASCADE`. Dropping `document_annotations` will cascade-drop all `combo_annotation_votes` rows. Then drop the `combo_annotation_votes` table itself.

---

**END OF DELETION INVENTORY**
