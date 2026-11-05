import React, { useState, useEffect } from 'react';
import { conceptsAPI, votesAPI, moderationAPI, communitiesAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ConceptGrid from '../components/ConceptGrid';
import SearchField from '../components/SearchField';
import HiddenConceptsView from '../components/HiddenConceptsView';
import SwapModal from '../components/SwapModal';
import CommunityHeaderControls from '../components/CommunityHeaderControls';
import NewQuestionCard from '../components/NewQuestionCard';
import PageFeedbackLauncher from '../components/PageFeedbackLauncher';
import RestructureBar from '../components/RestructureBar';

const ATTR_FILTER_KEY = 'orca_root_attribute_filter';
const ATTR_DISPLAY_ORDER = ['value', 'action', 'tool', 'question'];

const Root = ({
  graphTabId, onNavigate, onOpenConceptTab, isGuest = false, onRequestLogin,
  communityId, communityName,
  communityMode = 'open', communityIsOwner = false, communitySlug = null,
  onCommunitiesChanged,
  onOpenCommunities,
  editMode = false, onToggleEditMode,
  onConceptRenamed, renamedConcept,
  onOpenGraph,
  onOpenVotes,
  // Phase 73: reload graph tabs after a restructure (their paths may have moved).
  onStructureChanged,
  // Phase 72e-2: owner inbox + badges + inbox-driven panel opening.
  onOpenInbox, inboxRefreshKey = 0,
  pendingFeedback = null, onPendingFeedbackConsumed,
}) => {
  // Phase 72e-2: inbox navigation can target a card on the root list, or the
  // root-list page branch panel (pageEdgeId === null).
  const autoOpenCardEdgeId = pendingFeedback && pendingFeedback.cardEdgeId != null ? pendingFeedback.cardEdgeId : null;
  const autoOpenPagePanel = !!(pendingFeedback && Object.prototype.hasOwnProperty.call(pendingFeedback, 'pageEdgeId') && pendingFeedback.pageEdgeId === null);
  // Phase 72a: curated communities are owner-write-only and have no voting.
  const votingAllowed = communityMode !== 'curated';
  const canCreate = communityMode === 'curated' ? communityIsOwner : !isGuest;
  // Phase 72c-1: curated edit mode is available to owners only; it drives inline
  // rename, soft delete, and the "+ New question" affordance.
  const isCurated = communityMode === 'curated';
  const canEditMode = isCurated && communityIsOwner;
  const editing = canEditMode && editMode;
  const [showNewCard, setShowNewCard] = useState(false);
  const [concepts, setConcepts] = useState([]);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortMode, setSortMode] = useState('saves'); // 'saves' | 'new'

  const { user } = useAuth();

  // Nest-under-sibling state
  const [nestMode, setNestMode] = useState(false);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState(() => new Set());
  const [nestTargetEdgeId, setNestTargetEdgeId] = useState(null);
  const [nestPickerOpen, setNestPickerOpen] = useState(false);
  const [nestSubmitting, setNestSubmitting] = useState(false);
  const [nestFeedback, setNestFeedback] = useState(null);

  // Phase 73: curated restructure selection + ungroup target.
  const [restructureSel, setRestructureSel] = useState(() => new Set());
  const [ungroupConcept, setUngroupConcept] = useState(null);

  // Phase 16c: Hidden root concepts state
  const [hiddenCount, setHiddenCount] = useState(0);
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);

  // Phase 38b: Swap modal state for root concepts
  const [swapModalEdge, setSwapModalEdge] = useState(null);

  // Phase 25b: Attribute filter state
  const [availableAttributes, setAvailableAttributes] = useState([]);
  const [attributeFilter, setAttributeFilter] = useState(() => {
    return localStorage.getItem(ATTR_FILTER_KEY) || 'value';
  });

  // Load available attributes on mount
  useEffect(() => {
    conceptsAPI.getAttributes()
      .then(response => {
        const attrs = response.data.attributes;
        setAvailableAttributes(attrs);
        // Validate stored filter against available attributes
        const stored = localStorage.getItem(ATTR_FILTER_KEY);
        const validNames = ['all', ...attrs.map(a => a.name)];
        if (!stored || !validNames.includes(stored)) {
          setAttributeFilter('value');
          localStorage.setItem(ATTR_FILTER_KEY, 'value');
        }
      })
      .catch(err => console.error('Failed to load attributes:', err));
  }, []);

  const handleAttributeFilterChange = (value) => {
    setAttributeFilter(value);
    localStorage.setItem(ATTR_FILTER_KEY, value);
  };

  useEffect(() => {
    loadRootConcepts();
    loadHiddenCount();
  }, [sortMode, user, communityId]);

  // Tab-mgmt fix 3: refresh the root list if a renamed concept appears in it
  // (renamed in this or another tab), so its card title updates without a reload.
  useEffect(() => {
    if (!renamedConcept) return;
    const cid = Number(renamedConcept.conceptId);
    if (concepts.some((c) => Number(c.id) === cid)) loadRootConcepts();
  }, [renamedConcept]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHiddenCount = async () => {
    if (!user) { setHiddenCount(0); return; }
    try {
      // Root-level hidden: parentId is 'null' (string for the URL param), path is empty
      const response = await moderationAPI.getHiddenChildren('null', []);
      setHiddenCount((response.data.hiddenChildren || []).length);
    } catch (err) {
      setHiddenCount(0);
    }
  };

  // `opts.silent` skips the loading flash. Root only renders the grid when
  // `!loading`, so a non-silent reload unmounts ConceptGrid (and any open
  // FeedbackPanel). Feedback actions refresh silently to keep the panel mounted.
  const loadRootConcepts = async (opts = {}) => {
    const silent = !!opts.silent;
    if (!communityId) { setConcepts([]); if (!silent) setLoading(false); return; }
    try {
      if (!silent) setLoading(true);
      const sortParam = sortMode === 'saves' ? undefined : sortMode;
      const response = await conceptsAPI.getRootConcepts(sortParam, communityId);
      setConcepts(response.data.concepts);
      setTotalUsers(response.data.totalUsers);
      setError(null);
    } catch (err) {
      setError('Failed to load root concepts');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Phase 72e-1: refresh card feedback counts without unmounting the panel.
  const refreshFeedbackCounts = () => loadRootConcepts({ silent: true });

  const handleConceptClick = (conceptId) => {
    // Look up the concept name for the tab label
    const concept = concepts.find(c => c.id === conceptId);
    const label = concept ? concept.name : 'Question';

    // Update the graph tab's navigation state
    if (onNavigate && graphTabId) {
      onNavigate(graphTabId, {
        tabType: 'concept',
        conceptId: conceptId,
        path: [],
        viewMode: 'children',
        label,
      });
    }
  };

  const handleVote = async (edgeId, hasVoted, childPath) => {
    try {
      if (hasVoted) {
        await votesAPI.removeVote(edgeId);
      } else {
        await votesAPI.addVote(edgeId, []);
      }
      await loadRootConcepts();
    } catch (err) {
      console.error('Vote failed:', err);
      alert(err.response?.data?.error || 'Failed to vote');
    }
  };

  // Nest-under-sibling: enter selection mode from a right-clicked root card.
  const handleNestUnderSibling = (child) => {
    setNestMode(true);
    setSelectedEdgeIds(new Set([child.edge_id]));
    setNestTargetEdgeId(null);
    setNestPickerOpen(false);
    setNestFeedback(null);
  };

  const toggleNestSelect = (edgeId) => {
    setSelectedEdgeIds((prev) => {
      const next = new Set(prev);
      if (next.has(edgeId)) next.delete(edgeId); else next.add(edgeId);
      return next;
    });
    setNestTargetEdgeId((prev) => (prev === edgeId ? null : prev));
  };

  const cancelNest = () => {
    setNestMode(false);
    setSelectedEdgeIds(new Set());
    setNestTargetEdgeId(null);
    setNestPickerOpen(false);
    setNestSubmitting(false);
    setNestFeedback(null);
  };

  const confirmNest = async () => {
    if (nestSubmitting) return;
    if (selectedEdgeIds.size === 0 || !nestTargetEdgeId) return;
    setNestSubmitting(true);
    setNestFeedback(null);
    try {
      // Root-list page: no parent concept, empty path (backend runs in root mode).
      const res = await conceptsAPI.nestUnderSibling({
        parentConceptId: null,
        path: [],
        selectedEdgeIds: [...selectedEdgeIds],
        targetEdgeId: nestTargetEdgeId,
      });
      cancelNest();
      await loadRootConcepts();
      const c = res?.data || {};
      setNestFeedback(`Nested ${c.copiedEdges ?? ''} question${c.copiedEdges === 1 ? '' : 's'} under ${c.target?.name || 'the selected question'}.`);
      setTimeout(() => setNestFeedback(null), 4000);
    } catch (err) {
      setNestSubmitting(false);
      setNestFeedback(err?.response?.data?.error || 'Could not nest the selected questions.');
    }
  };

  // Phase 73: curated restructure (group / move into / ungroup) on the root list.
  const toggleRestructureSelect = (edgeId) => {
    setRestructureSel((prev) => {
      const next = new Set(prev);
      if (next.has(edgeId)) next.delete(edgeId); else next.add(edgeId);
      return next;
    });
    setUngroupConcept(null);
  };
  const clearRestructureSelection = () => setRestructureSel(new Set());
  const handleUngroup = (child) => { setRestructureSel(new Set()); setUngroupConcept(child); };
  const highlightCard = (edgeId) => {
    if (edgeId == null) return;
    const el = document.getElementById(`qcard-${edgeId}`);
    if (!el) return;
    setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const prev = el.style.backgroundColor;
      el.style.backgroundColor = '#fffbcc';
      setTimeout(() => { el.style.backgroundColor = prev || ''; }, 2000);
    }, 300);
  };
  const handleRestructureDone = async ({ highlightEdgeId } = {}) => {
    setRestructureSel(new Set());
    setUngroupConcept(null);
    await loadRootConcepts();
    if (onStructureChanged) onStructureChanged();
    highlightCard(highlightEdgeId);
  };

  // Clear restructure selection on leaving edit mode or switching community.
  useEffect(() => {
    if (!editing) { setRestructureSel(new Set()); setUngroupConcept(null); }
  }, [editing, communityId]);

  // Phase 16c: Flag a root concept as spam
  const handleFlag = async (child) => {
    if (!user) return;
    const confirmMsg = `Flag "${child.name}" as spam?\n\nOnce 10 users have flagged it, it will be hidden from all users. It can be reviewed and restored from the Hidden panel.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await moderationAPI.flagEdge(child.edge_id, 'spam');
      await loadRootConcepts();
      await loadHiddenCount();
    } catch (err) {
      if (err.response?.status === 400 && err.response?.data?.error?.includes('already flagged')) {
        alert('You have already flagged this question.');
      } else {
        alert(err.response?.data?.error || 'Failed to flag question');
      }
    }
  };

  const handleUnflag = async (child) => {
    if (!user) return;
    try {
      await moderationAPI.unflagEdge(child.edge_id);
      await loadRootConcepts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove flag');
    }
  };

  // Phase 38b: Swap vote on root concepts
  const handleSwapClick = (concept) => {
    setSwapModalEdge({
      edgeId: concept.edge_id,
      conceptName: concept.name,
      conceptId: concept.id,
    });
  };

  const handleSwapModalClose = () => setSwapModalEdge(null);

  // Phase 72c-1: edit-mode handlers (curated owners). These reject on failure so
  // the inline editors (EditableField / NewQuestionCard) show the error in place.
  const handleRename = async (conceptId, newName) => {
    await conceptsAPI.renameConcept(conceptId, newName);
    await loadRootConcepts();
    // Tab-mgmt fix 3: propagate to other open tabs + sidebar labels.
    if (onConceptRenamed) onConceptRenamed(conceptId, newName);
  };

  const handleDeleteEdge = async (edgeId) => {
    await conceptsAPI.softDeleteEdge(edgeId);
    await loadRootConcepts();
  };

  const handleCreateRoot = async (name) => {
    const questionAttr = availableAttributes.find((a) => a.name === 'question') || availableAttributes[0];
    if (!questionAttr) throw new Error('No attribute available');
    await conceptsAPI.createRootConcept(name, questionAttr.id, communityId);
    setShowNewCard(false);
    await loadRootConcepts();
  };

  // Leaving edit mode closes the new-question card.
  useEffect(() => { if (!editing) setShowNewCard(false); }, [editing]);

  const handleSwapVoteChanged = () => {
    // Optimistically clear any save for this edge in local state (mutual exclusivity)
    if (swapModalEdge) {
      const eid = swapModalEdge.edgeId;
      setConcepts(prev => prev.map(c =>
        c.edge_id === eid
          ? {
              ...c,
              user_voted: false,
              vote_count: c.user_voted ? Math.max(0, (parseInt(c.vote_count) || 1) - 1) : (parseInt(c.vote_count) || 0),
              user_swapped: true,
            }
          : c
      ));
    }
    loadRootConcepts();
  };

  return (
    <div style={styles.container}>
      <main style={styles.main}>
        {communityName && (
          <div style={styles.communityTitleRow}>
            <div style={styles.communityTitle}>
              {communityName}
              {communityMode === 'curated' && <span style={styles.curatedTag}>Curated</span>}
            </div>
            <div style={styles.headerControls}>
              {communityId && (
                <button
                  onClick={() => onOpenGraph && onOpenGraph(null, null, [])}
                  style={styles.editToggle}
                  title="Open the whole graph as a collapsible tree"
                >Graph</button>
              )}
              {communityId && votingAllowed && user && !isGuest && onOpenVotes && (
                <button
                  onClick={onOpenVotes}
                  style={styles.editToggle}
                  title="View your saved questions and upvoted links"
                >Votes</button>
              )}
              {canEditMode && (
                <button
                  onClick={onToggleEditMode}
                  style={editMode ? styles.editToggleActive : styles.editToggle}
                  title={editMode ? 'Return to reader view' : 'Edit this community'}
                >{editMode ? 'Done' : 'Edit'}</button>
              )}
              {communityId && (
                <CommunityHeaderControls
                  communityId={communityId}
                  communitySlug={communitySlug}
                  isOwner={communityIsOwner}
                  onCommunitiesChanged={onCommunitiesChanged}
                  communityMode={communityMode}
                  onOpenInbox={onOpenInbox}
                  inboxRefreshKey={inboxRefreshKey}
                />
              )}
            </div>
          </div>
        )}
        {/* Phase 72b: in curated communities the vote-only "N users" count and
            the Votes/New sort toggle are hidden (siblings sort by recency). */}
        {communityId && !loading && !error && (votingAllowed || (hiddenCount > 0 && user)) && (
          <div style={styles.topBar}>
            {votingAllowed ? (
              <div style={styles.totalUsers}>
                {totalUsers} {totalUsers === 1 ? 'user' : 'users'}
              </div>
            ) : <div />}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {hiddenCount > 0 && user && (
                <button
                  onClick={() => setShowHiddenPanel(true)}
                  style={styles.hiddenBadge}
                  title={`${hiddenCount} hidden root question${hiddenCount !== 1 ? 's' : ''} — click to review`}
                >
                  {hiddenCount} hidden
                </button>
              )}
              {votingAllowed && (
                <div style={styles.sortRow}>
                  {[
                    { value: 'saves', label: 'Votes' },
                    { value: 'new', label: 'New' },
                  ].map((opt, i) => (
                    <button
                      key={opt.value}
                      onClick={() => setSortMode(opt.value)}
                      style={{
                        ...styles.sortBtn,
                        ...(sortMode === opt.value ? styles.sortBtnActive : {}),
                        ...(i < 3 ? { borderRight: '1px solid #eee' } : {}),
                      }}
                    >{opt.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 25b: Attribute filter bar — only when multiple attributes enabled */}
        {!loading && !error && availableAttributes.length > 1 && (
          <div style={styles.attributeFilterBar}>
            <button
              style={attributeFilter === 'all' ? styles.attributeFilterBtnActive : styles.attributeFilterBtn}
              onClick={() => handleAttributeFilterChange('all')}
            >
              All
            </button>
            {[...availableAttributes].sort((a, b) => {
              const ai = ATTR_DISPLAY_ORDER.indexOf(a.name);
              const bi = ATTR_DISPLAY_ORDER.indexOf(b.name);
              return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            }).map(attr => (
              <button
                key={attr.id}
                style={attributeFilter === attr.name ? styles.attributeFilterBtnActive : styles.attributeFilterBtn}
                onClick={() => handleAttributeFilterChange(attr.name)}
              >
                {attr.name.charAt(0).toUpperCase() + attr.name.slice(1)}
              </button>
            ))}
          </div>
        )}

        {!communityId && (
          <div style={styles.emptyState}>
            <p style={styles.nudgeHeading}>No community selected</p>
            <p style={styles.nudgeBody}>
              {isGuest
                ? 'Questions live inside communities. Open Communities to explore a space of questions.'
                : 'Questions live inside communities. Open Communities to pick one — or create the first.'}
            </p>
            <button style={styles.nudgeButton} onClick={onOpenCommunities}>
              {isGuest ? 'Browse communities' : 'Open Communities'}
            </button>
          </div>
        )}

        {communityId && loading && <div style={styles.loading}>Loading...</div>}

        {communityId && error && <div style={styles.error}>{error}</div>}

        {communityId && !loading && !error && (() => {
          const filtered = attributeFilter === 'all' || availableAttributes.length <= 1
            ? concepts
            : concepts.filter(c => c.attribute_name === attributeFilter);
          return (filtered.length === 0 && !(editing && showNewCard)) ? (
            <div style={styles.emptyState}>
              <p>{canCreate ? (editing ? 'No root questions yet. Use the + button to add one.' : 'No root questions yet. Type in the search field to create one!') : 'No root questions yet.'}</p>
            </div>
          ) : (
            <>
              {editing && showNewCard && (
                <div style={styles.newCardWrap}>
                  <NewQuestionCard onCreate={handleCreateRoot} onCancel={() => setShowNewCard(false)} placeholder="New root question…" />
                </div>
              )}
              <ConceptGrid
                concepts={filtered}
                onConceptClick={handleConceptClick}
                onVote={(votingAllowed && !isGuest) ? handleVote : undefined}
                onSwapClick={(votingAllowed && !isGuest) ? handleSwapClick : undefined}
                onNestUnderSibling={(canCreate && !editing && communityMode !== 'curated') ? handleNestUnderSibling : undefined}
                onFlag={(votingAllowed && !isGuest) ? handleFlag : undefined}
                onUnflag={(votingAllowed && !isGuest) ? handleUnflag : undefined}
                nestMode={nestMode}
                restructureMode={editing}
                onUngroup={editing ? handleUngroup : undefined}
                selectedEdgeIds={editing ? restructureSel : selectedEdgeIds}
                onToggleSelect={editing ? toggleRestructureSelect : toggleNestSelect}
                showVotes={votingAllowed}
                showAttributeBadge={true}
                path={[]}
                showAnswers={communityMode === 'curated'}
                canManageAnswers={communityIsOwner}
                onAnswersChanged={loadRootConcepts}
                showLinks={communityMode !== 'curated'}
                canAddLink={!isGuest}
                voteSets={[]}
                onLinksChanged={() => loadRootConcepts({ silent: true })}
                onOpenConceptTab={onOpenConceptTab}
                isGuest={isGuest}
                onRequestLogin={onRequestLogin}
                editMode={editing}
                onRename={editing ? handleRename : undefined}
                onDeleteEdge={editing ? handleDeleteEdge : undefined}
                showFeedback={communityMode === 'curated'}
                currentUserId={user?.id || null}
                onFeedbackChanged={refreshFeedbackCounts}
                autoOpenFeedbackEdgeId={autoOpenCardEdgeId}
                onFeedbackAutoOpened={onPendingFeedbackConsumed}
              />
            </>
          );
        })()}
      </main>

      {/* Search field with root concept creation — only when a community is active
          (root listing, search, and creation all require a communityId) */}
      {communityId && (
        <SearchField
          parentId={null}
          path={null}
          viewMode="children"
          onConceptAdded={loadRootConcepts}
          isRootPage={canCreate}
          canCreate={canCreate}
          graphTabId={graphTabId}
          onNavigate={onNavigate}
          isGuest={isGuest}
          communityId={communityId}
          curated={isCurated}
        />
      )}

      {/* Phase 72c-1: edit-mode add-question button (curated owners) */}
      {editing && !showNewCard && (
        <button
          style={styles.addFab}
          onClick={() => setShowNewCard(true)}
          title="Add a root question"
        >+</button>
      )}

      {/* Phase 72e-2: page-level branch suggestions (curated, community root list) */}
      {isCurated && communityId && (
        <PageFeedbackLauncher
          communityId={communityId}
          parentEdgeId={null}
          questionText={communityName}
          isOwner={communityIsOwner}
          isGuest={isGuest}
          onRequestLogin={onRequestLogin}
          onChanged={refreshFeedbackCounts}
          autoOpen={autoOpenPagePanel}
          onAutoOpenConsumed={onPendingFeedbackConsumed}
        />
      )}

      {/* Phase 38b: Swap Modal for root concepts */}
      {swapModalEdge && (
        <SwapModal
          edgeId={swapModalEdge.edgeId}
          conceptName={swapModalEdge.conceptName}
          onClose={handleSwapModalClose}
          onSwapVoteChanged={handleSwapVoteChanged}
        />
      )}

      {/* Phase 16c: Hidden Concepts Panel */}
      {showHiddenPanel && (
        <HiddenConceptsView
          parentId="null"
          path={[]}
          onClose={() => { setShowHiddenPanel(false); loadHiddenCount(); loadRootConcepts(); }}
        />
      )}

      {/* Nest-under-sibling action bar */}
      {nestMode && (() => {
        const displayed = (attributeFilter === 'all' || availableAttributes.length <= 1)
          ? concepts
          : concepts.filter((c) => c.attribute_name === attributeFilter);
        const eligibleTargets = displayed.filter((c) => !selectedEdgeIds.has(c.edge_id));
        const targetConcept = displayed.find((c) => c.edge_id === nestTargetEdgeId);
        return (
          <div style={styles.nestBar}>
            <span style={styles.nestBarText}>
              {selectedEdgeIds.size} question{selectedEdgeIds.size === 1 ? '' : 's'} selected to nest
            </span>
            <div style={{ position: 'relative' }}>
              <button
                style={styles.nestBarPickerButton}
                onClick={() => setNestPickerOpen((o) => !o)}
                disabled={eligibleTargets.length === 0}
                title="Choose the sibling question to nest the selected questions under"
              >
                {targetConcept ? `Under: ${targetConcept.name}` : 'Question to nest under'} {'▾'}
              </button>
              {nestPickerOpen && (
                <div style={styles.nestPickerDropdown}>
                  {eligibleTargets.length === 0 ? (
                    <div style={styles.nestPickerEmpty}>No eligible questions</div>
                  ) : eligibleTargets.map((c) => (
                    <div
                      key={c.edge_id}
                      style={styles.nestPickerItem}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0ece4')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      onClick={() => { setNestTargetEdgeId(c.edge_id); setNestPickerOpen(false); }}
                    >
                      {c.name}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button
              style={{
                ...styles.nestBarConfirm,
                ...((selectedEdgeIds.size === 0 || !nestTargetEdgeId || nestSubmitting) ? styles.nestBarDisabled : {}),
              }}
              onClick={confirmNest}
              disabled={selectedEdgeIds.size === 0 || !nestTargetEdgeId || nestSubmitting}
            >
              {nestSubmitting ? 'Nesting…' : 'Confirm'}
            </button>
            <button style={styles.nestBarCancel} onClick={cancelNest} disabled={nestSubmitting}>
              Cancel
            </button>
            {nestFeedback && <span style={styles.nestBarFeedback}>{nestFeedback}</span>}
          </div>
        );
      })()}

      {!nestMode && nestFeedback && (
        <div style={styles.nestToast}>{nestFeedback}</div>
      )}

      {/* Phase 73: curated restructure action bar (group / move into / ungroup). */}
      {editing && (restructureSel.size > 0 || ungroupConcept) && (
        <RestructureBar
          selectedEdgeIds={restructureSel}
          siblings={concepts}
          ungroupConcept={ungroupConcept}
          onClearSelection={clearRestructureSelection}
          onCloseUngroup={() => setUngroupConcept(null)}
          onDone={handleRestructureDone}
        />
      )}
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100%',
    backgroundColor: '#f5f5f5',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    // Bottom padding clears the fixed Add/Search bar (≈54px tall, 30px above the
    // viewport bottom) so it never overlaps the last card / add-answer form.
    padding: '40px 20px 120px',
    position: 'relative',
  },
  communityTitleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: '10px',
    marginBottom: '16px',
  },
  communityTitle: {
    fontSize: '22px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#222',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  curatedTag: {
    fontSize: '11px',
    color: '#555',
    border: '1px solid #cfc9bd',
    borderRadius: '10px',
    padding: '1px 8px',
    backgroundColor: '#f5f0ea',
  },
  headerControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  editToggle: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  editToggleActive: {
    padding: '6px 14px',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  newCardWrap: {
    maxWidth: '420px',
  },
  addFab: {
    position: 'fixed',
    bottom: '96px',
    right: '28px',
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    border: '1px solid #333',
    backgroundColor: '#faf9f6',
    color: '#333',
    fontSize: '26px',
    lineHeight: '1',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    zIndex: 1001,
  },
  loading: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '16px',
    color: '#666',
  },
  error: {
    padding: '15px',
    backgroundColor: '#fee',
    color: '#c33',
    borderRadius: '4px',
    marginBottom: '20px',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#666',
  },
  nudgeHeading: {
    fontSize: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    marginBottom: '8px',
  },
  nudgeBody: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#666',
    maxWidth: '460px',
    margin: '0 auto 20px',
  },
  nudgeButton: {
    padding: '8px 18px',
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  totalUsers: {
    fontSize: '14px',
    color: '#888',
  },
  topBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  },
  sortRow: {
    display: 'flex',
    gap: '0px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  sortBtn: {
    padding: '3px 10px',
    border: 'none',
    backgroundColor: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  sortBtnActive: {
    backgroundColor: '#333',
    color: 'white',
  },
  hiddenBadge: {
    padding: '4px 10px',
    fontSize: '12px',
    backgroundColor: '#f5f0ea',
    color: '#555',
    border: '1px solid #d4d0c8',
    borderRadius: '12px',
    cursor: 'pointer',
    fontFamily: '"EB Garamond", Georgia, serif',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  attributeFilterBar: {
    display: 'flex',
    gap: '6px',
    marginBottom: '16px',
  },
  attributeFilterBtn: {
    padding: '5px 14px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#f0f0f0',
    border: '1px solid #ddd',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#555',
    transition: 'all 0.2s',
  },
  attributeFilterBtnActive: {
    padding: '5px 14px',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    color: 'white',
    transition: 'all 0.2s',
  },
  nestBar: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '90vw',
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    padding: '12px 18px',
    zIndex: 10002,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  nestBarText: {
    fontSize: '15px',
    color: '#333',
  },
  nestBarPickerButton: {
    padding: '8px 14px',
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    maxWidth: '320px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  nestPickerDropdown: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    marginBottom: '6px',
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    minWidth: '240px',
    maxWidth: '360px',
    maxHeight: '300px',
    overflowY: 'auto',
    zIndex: 10003,
    fontSize: '14px',
  },
  nestPickerItem: {
    padding: '8px 14px',
    cursor: 'pointer',
    color: '#333',
  },
  nestPickerEmpty: {
    padding: '8px 14px',
    color: '#888',
  },
  nestBarConfirm: {
    padding: '8px 18px',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  nestBarDisabled: {
    opacity: 0.45,
    cursor: 'default',
  },
  nestBarCancel: {
    padding: '8px 14px',
    backgroundColor: 'white',
    color: '#555',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  nestBarFeedback: {
    fontSize: '14px',
    color: '#c33',
    width: '100%',
    textAlign: 'center',
  },
  nestToast: {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '8px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
    padding: '12px 18px',
    zIndex: 10002,
    fontFamily: '"EB Garamond", Georgia, serif',
    fontSize: '15px',
    color: '#333',
  },
};

export default Root;
