import React, { useState, useEffect } from 'react';
import { conceptsAPI, votesAPI, moderationAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import ConceptGrid from '../components/ConceptGrid';
import SearchField from '../components/SearchField';
import HiddenConceptsView from '../components/HiddenConceptsView';
import SwapModal from '../components/SwapModal';

const ATTR_FILTER_KEY = 'orca_root_attribute_filter';
const ATTR_DISPLAY_ORDER = ['value', 'action', 'tool', 'question'];

const Root = ({ graphTabId, onNavigate, isGuest = false }) => {
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
  }, [sortMode, user]);

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

  const loadRootConcepts = async () => {
    try {
      setLoading(true);
      const sortParam = sortMode === 'saves' ? undefined : sortMode;
      const response = await conceptsAPI.getRootConcepts(sortParam);
      setConcepts(response.data.concepts);
      setTotalUsers(response.data.totalUsers);
      setError(null);
    } catch (err) {
      setError('Failed to load root concepts');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

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
        {!loading && !error && (
          <div style={styles.topBar}>
            <div style={styles.totalUsers}>
              {totalUsers} {totalUsers === 1 ? 'user' : 'users'}
            </div>
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

        {loading && <div style={styles.loading}>Loading...</div>}

        {error && <div style={styles.error}>{error}</div>}

        {!loading && !error && (() => {
          const filtered = attributeFilter === 'all' || availableAttributes.length <= 1
            ? concepts
            : concepts.filter(c => c.attribute_name === attributeFilter);
          return filtered.length === 0 ? (
            <div style={styles.emptyState}>
              <p>{isGuest ? 'No root questions yet.' : 'No root questions yet. Type in the search field to create one!'}</p>
            </div>
          ) : (
            <ConceptGrid
              concepts={filtered}
              onConceptClick={handleConceptClick}
              onVote={isGuest ? undefined : handleVote}
              onSwapClick={isGuest ? undefined : handleSwapClick}
              onNestUnderSibling={isGuest ? undefined : handleNestUnderSibling}
              onFlag={isGuest ? undefined : handleFlag}
              onUnflag={isGuest ? undefined : handleUnflag}
              nestMode={nestMode}
              selectedEdgeIds={selectedEdgeIds}
              onToggleSelect={toggleNestSelect}
              showVotes={true}
              showAttributeBadge={true}
              path={[]}
            />
          );
        })()}
      </main>

      {/* Search field with root concept creation */}
      <SearchField
        parentId={null}
        path={null}
        viewMode="children"
        onConceptAdded={loadRootConcepts}
        isRootPage={!isGuest}
        graphTabId={graphTabId}
        onNavigate={onNavigate}
        isGuest={isGuest}
      />

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
    padding: '40px 20px',
    position: 'relative',
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
