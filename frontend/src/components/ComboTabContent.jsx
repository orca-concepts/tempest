import React, { useState, useEffect, useRef, useCallback } from 'react';
import { combosAPI, conceptsAPI, usersAPI } from '../services/api';
import OrcidBadge from './OrcidBadge';
import LinkCard from './LinkCard';

const ComboTabContent = ({ comboId, user, isGuest, onUnsubscribe, onRequestLogin, onOpenConceptTab, refreshKey }) => {
  const [combo, setCombo] = useState(null);
  const [edges, setEdges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Aggregated links state (Phase 58d-2)
  const [comboLinks, setComboLinks] = useState([]);
  const [comboLinksLoading, setComboLinksLoading] = useState(false);
  const [comboLinksSort, setComboLinksSort] = useState('top');

  // Owner: add subconcept state
  const [showAddPicker, setShowAddPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedConcept, setSelectedConcept] = useState(null);
  const [conceptContexts, setConceptContexts] = useState([]);
  const [contextsLoading, setContextsLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const searchTimerRef = useRef(null);
  const comboLinksRequestIdRef = useRef(0);

  // Transfer ownership state (Phase 42c)
  const [transferSearch, setTransferSearch] = useState('');
  const [transferResults, setTransferResults] = useState([]);
  const [transferConfirm, setTransferConfirm] = useState(null); // { id, username }
  const [transferFeedback, setTransferFeedback] = useState('');
  const transferTimerRef = useRef(null);
  const transferBlurTimerRef = useRef(null);
  const [transferInputFocused, setTransferInputFocused] = useState(false);

  // Path name resolution cache
  const [pathNames, setPathNames] = useState({});
  const [shareCopied, setShareCopied] = useState(false);

  const isOwner = user && combo && user.id === combo.created_by;

  // Load combo data
  const loadCombo = useCallback(async () => {
    try {
      const res = await combosAPI.getCombo(comboId);
      setCombo(res.data.combo);
      setEdges(res.data.edges || []);

      // Resolve path names for edges
      const allIds = new Set();
      (res.data.edges || []).forEach(e => {
        (e.graph_path || []).forEach(id => allIds.add(id));
        if (e.parent_id) allIds.add(e.parent_id);
      });
      if (allIds.size > 0) {
        try {
          const namesRes = await conceptsAPI.getConceptNames(Array.from(allIds).join(','));
          const nameMap = {};
          (namesRes.data.concepts || []).forEach(c => { nameMap[c.id] = c.name; });
          setPathNames(prev => ({ ...prev, ...nameMap }));
        } catch (err) { /* non-critical */ }
      }
    } catch (err) {
      setError('Failed to load superconcept');
      console.error('Failed to load combo:', err);
    }
  }, [comboId]);

  // Initial load (and reload when refreshKey changes — e.g., after edge added from graph view)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadCombo();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [comboId, loadCombo, refreshKey]);

  // Load aggregated links for the combo (Phase 58d-2)
  const loadComboLinks = useCallback(async () => {
    const myRequestId = ++comboLinksRequestIdRef.current;
    setComboLinksLoading(true);
    try {
      const res = await combosAPI.getComboLinks(comboId, comboLinksSort);
      if (myRequestId !== comboLinksRequestIdRef.current) return;
      setComboLinks(res.data.links || []);
    } catch {
      if (myRequestId !== comboLinksRequestIdRef.current) return;
      setComboLinks([]);
    } finally {
      if (myRequestId === comboLinksRequestIdRef.current) setComboLinksLoading(false);
    }
  }, [comboId, comboLinksSort]);

  useEffect(() => { if (!loading && combo) loadComboLinks(); }, [loading, combo, loadComboLinks]);

  // Search debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        setSearchLoading(true);
        const res = await conceptsAPI.searchConcepts(searchQuery.trim());
        setSearchResults(res.data.results || []);
      } catch (err) {
        console.error('Search failed:', err);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  // Load contexts when a concept is selected in picker
  const handleSelectSearchResult = async (concept) => {
    setSelectedConcept(concept);
    setAddError('');
    setContextsLoading(true);
    try {
      const res = await conceptsAPI.getConceptParents(concept.id);
      const parents = (res.data.parents || []).map(p => ({
        edge_id: p.edge_id,
        parent_name: p.name,
        graph_path: p.graph_path || [],
        attribute_name: p.attribute_name,
        isRoot: false,
      }));

      // Check for root edge
      let rootEdge = null;
      try {
        const rootRes = await conceptsAPI.getRootConcepts();
        const rootConcepts = rootRes.data.concepts || rootRes.data || [];
        const rootMatch = rootConcepts.find(rc => rc.id === concept.id);
        if (rootMatch) {
          const rootEdgeId = rootMatch.edge_id || rootMatch.edgeId;
          if (rootEdgeId) {
            rootEdge = {
              edge_id: rootEdgeId,
              parent_name: null,
              graph_path: [],
              attribute_name: rootMatch.attribute_name || rootMatch.attributeName,
              isRoot: true,
            };
          }
        }
      } catch (err) { /* non-critical */ }

      const allContexts = rootEdge ? [rootEdge, ...parents] : parents;
      setConceptContexts(allContexts);

      // Resolve path names
      const ids = new Set();
      allContexts.forEach(ctx => {
        (ctx.graph_path || []).forEach(id => ids.add(id));
      });
      if (ids.size > 0) {
        try {
          const namesRes = await conceptsAPI.getConceptNames(Array.from(ids).join(','));
          const nameMap = {};
          (namesRes.data.concepts || []).forEach(c => { nameMap[c.id] = c.name; });
          setPathNames(prev => ({ ...prev, ...nameMap }));
        } catch (err) { /* non-critical */ }
      }
    } catch (err) {
      console.error('Failed to load contexts:', err);
      setConceptContexts([]);
    } finally {
      setContextsLoading(false);
    }
  };

  const handleAddEdge = async (edgeId) => {
    setAddError('');
    try {
      await combosAPI.addEdge(comboId, edgeId);
      // Reset picker
      setShowAddPicker(false);
      setSearchQuery('');
      setSearchResults([]);
      setSelectedConcept(null);
      setConceptContexts([]);
      // Reload data
      await loadCombo();
    } catch (err) {
      if (err.response?.status === 409) {
        setAddError('This concept in this context is already in the superconcept');
      } else {
        setAddError(err.response?.data?.error || 'Failed to add concept');
      }
    }
  };

  const handleRemoveEdge = async (edgeId) => {
    try {
      await combosAPI.removeEdge(comboId, edgeId);
      await loadCombo();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to remove concept');
    }
  };

  const handleUnsubscribe = () => {
    if (window.confirm(`Unsubscribe from "${combo?.name}"? This removes the superconcept tab from your sidebar.`)) {
      if (onUnsubscribe) onUnsubscribe(comboId);
    }
  };

  const handleShareLink = async () => {
    const url = `${window.location.origin}/superconcept/${comboId}`;
    try {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  };

  // Transfer ownership search (Phase 42c)
  const handleTransferSearch = (value) => {
    setTransferSearch(value);
    setTransferFeedback('');
    setTransferConfirm(null);
    if (transferTimerRef.current) clearTimeout(transferTimerRef.current);
    if (value.length < 2) {
      setTransferResults([]);
      return;
    }
    transferTimerRef.current = setTimeout(async () => {
      try {
        const res = await usersAPI.searchUsers(value);
        setTransferResults(res.data.users || []);
      } catch {
        setTransferResults([]);
      }
    }, 300);
  };

  const handleTransferConfirm = async () => {
    if (!transferConfirm) return;
    try {
      await combosAPI.transferOwnership(comboId, transferConfirm.id);
      setTransferSearch('');
      setTransferResults([]);
      setTransferConfirm(null);
      setTransferFeedback('');
      loadCombo();
    } catch (err) {
      setTransferFeedback(err.response?.data?.error || 'Transfer failed');
      setTransferConfirm(null);
    }
  };

  // Build path string for an edge
  const buildPathString = (edge) => {
    if (edge.isRoot) return `[root] [${edge.attribute_name}]`;
    const parts = (edge.graph_path || []).slice(0, -1).map(id => pathNames[id] || `#${id}`);
    if (edge.parent_name) parts.push(edge.parent_name);
    else if (edge.graph_path?.length > 0) {
      const lastId = edge.graph_path[edge.graph_path.length - 1];
      parts.push(pathNames[lastId] || `#${lastId}`);
    }
    return parts.length > 0 ? parts.join(' \u2192 ') : '[root]';
  };

  const relativeTime = (dateStr) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) {
    return <div style={styles.loadingContainer}>Loading superconcept...</div>;
  }

  if (error) {
    return <div style={styles.loadingContainer}>{error}</div>;
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h2 style={styles.comboName}>{combo?.name}</h2>
          {combo?.description && (
            <p style={styles.comboDescription}>{combo.description}</p>
          )}
          <div style={styles.metaLine}>
            Created by {combo?.creator_username || '[deleted user]'}<OrcidBadge orcidId={combo?.creator_orcid_id} />
            {' \u00B7 '}
            {edges.length} concept{edges.length !== 1 ? 's' : ''}
            {' \u00B7 '}
            {combo?.subscriber_count || 0} subscriber{combo?.subscriber_count != 1 ? 's' : ''}
          </div>
        </div>
        <div style={styles.headerRight}>
          <button onClick={handleShareLink} style={styles.shareButton} title="Copy shareable link to clipboard">
            {shareCopied ? 'Copied!' : 'Share'}
          </button>
          <button onClick={handleUnsubscribe} style={styles.unsubscribeButton}>Unsubscribe</button>
        </div>
      </div>

      {/* Owner controls */}
      {/* Subconcepts section — list visible to everyone, add/remove owner-only */}
      {(edges.length > 0 || isOwner) && (
        <div style={styles.ownerSection}>
          <div style={styles.ownerSectionHeader}>
            <span style={styles.ownerSectionTitle}>Subconcepts</span>
            {isOwner && (
              <button
                onClick={() => { setShowAddPicker(!showAddPicker); setAddError(''); setSelectedConcept(null); setSearchQuery(''); setSearchResults([]); }}
                style={styles.addButton}
              >
                {showAddPicker ? 'Cancel' : '+ Add Concept'}
              </button>
            )}
          </div>

          {edges.length === 0 && isOwner && !showAddPicker && (
            <div style={styles.emptyHint}>No concepts added yet. Click "+ Add Concept" to get started.</div>
          )}

          {edges.length > 0 && (
            <div style={styles.subconcepts}>
              {edges.map(edge => (
                <div key={edge.edge_id} style={styles.subconceptRow}>
                  <div style={styles.subconceptInfo}>
                    <span
                      style={{ ...styles.subconceptName, cursor: 'pointer' }}
                      onClick={() => onOpenConceptTab && onOpenConceptTab(edge.concept_id, edge.graph_path || [], edge.concept_name, edge.attribute_name)}
                      title="Open in graph tab"
                    >{edge.concept_name}</span>
                    <span style={styles.attrBadge}>[{edge.attribute_name}]</span>
                    <span style={styles.subconceptPath}>{buildPathString(edge)}</span>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => handleRemoveEdge(edge.edge_id)}
                      style={styles.removeButton}
                      title="Remove from superconcept"
                    >{'\u2715'}</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add subconcept picker */}
          {showAddPicker && (
            <div style={styles.pickerArea}>
              <input
                type="text"
                placeholder="Search for a concept..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSelectedConcept(null); setConceptContexts([]); setAddError(''); }}
                style={styles.searchInput}
                autoFocus
              />
              {addError && <div style={styles.errorText}>{addError}</div>}
              {searchLoading && <div style={styles.hint}>Searching...</div>}

              {/* Search results */}
              {!selectedConcept && searchResults.length > 0 && (
                <div style={styles.searchResultsList}>
                  {searchResults.map(r => (
                    <div
                      key={r.id}
                      style={styles.searchResultItem}
                      onClick={() => handleSelectSearchResult(r)}
                    >
                      {r.name}
                    </div>
                  ))}
                </div>
              )}

              {/* Context picker for selected concept */}
              {selectedConcept && (
                <div style={styles.contextPicker}>
                  <div style={styles.contextPickerHeader}>
                    Select a context for <strong style={{ fontWeight: '600' }}>{selectedConcept.name}</strong>:
                    <button onClick={() => { setSelectedConcept(null); setConceptContexts([]); setAddError(''); }} style={styles.backLink}>← Back to results</button>
                  </div>
                  {contextsLoading ? (
                    <div style={styles.hint}>Loading contexts...</div>
                  ) : conceptContexts.length === 0 ? (
                    <div style={styles.hint}>No contexts found for this concept.</div>
                  ) : (
                    <div style={styles.contextList}>
                      {conceptContexts.map(ctx => (
                        <div
                          key={ctx.edge_id}
                          style={styles.contextItem}
                          onClick={() => handleAddEdge(ctx.edge_id)}
                        >
                          <span>
                            {ctx.isRoot ? '[root]' : buildPathString(ctx)}
                            {' \u2192 '}{selectedConcept.name}
                          </span>
                          <span style={styles.attrBadge}>[{ctx.attribute_name}]</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Transfer ownership (Phase 42c) */}
      {isOwner && (
        <div style={styles.transferSection}>
          <div style={styles.ownerSectionTitle}>Transfer ownership</div>
          {transferConfirm ? (
            <div>
              <div style={{ fontSize: '14px', fontFamily: "'EB Garamond', Georgia, serif", color: '#333', marginBottom: '10px' }}>
                Transfer ownership of "{combo?.name}" to {transferConfirm.username}?
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleTransferConfirm} style={styles.transferActionButton}>Confirm</button>
                <button onClick={() => setTransferConfirm(null)} style={styles.transferActionButton}>Cancel</button>
              </div>
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Search by username or ORCID"
                value={transferSearch}
                onChange={e => handleTransferSearch(e.target.value)}
                onFocus={() => { setTransferInputFocused(true); if (transferBlurTimerRef.current) clearTimeout(transferBlurTimerRef.current); }}
                onBlur={() => { transferBlurTimerRef.current = setTimeout(() => setTransferInputFocused(false), 200); }}
                style={styles.transferInput}
              />
              {transferFeedback && (
                <div style={{ fontSize: '13px', fontFamily: "'EB Garamond', Georgia, serif", color: '#333', marginTop: '6px' }}>{transferFeedback}</div>
              )}
              {transferInputFocused && transferResults.length > 0 && (
                <div style={styles.transferDropdown}>
                  {transferResults.map(u => (
                    <div key={u.id} style={styles.transferResultRow}>
                      <span style={{ fontSize: '14px', fontFamily: "'EB Garamond', Georgia, serif", color: '#333' }}>
                        {u.username}
                      </span>
                      <OrcidBadge orcidId={u.orcidId} />
                      <button
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => {
                          setTransferConfirm({ id: u.id, username: u.username });
                          setTransferResults([]);
                          setTransferSearch('');
                          setTransferInputFocused(false);
                        }}
                        style={styles.transferActionButton}
                      >
                        Transfer
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Aggregated links (Phase 58d-2) */}
      {edges.length > 0 && (
        <div style={{ marginTop: '16px' }}>
          <div style={styles.sortBar}>
            <span style={{ fontSize: '12px', color: '#999', fontFamily: "'EB Garamond', Georgia, serif" }}>Sort:</span>
            {['top', 'new'].map((key, i) => (
              <React.Fragment key={key}>
                {i > 0 && <span style={styles.sortSep}>{'\u00b7'}</span>}
                <span onClick={() => setComboLinksSort(key)}
                  style={comboLinksSort === key ? styles.sortOptionActive : styles.sortOption}>
                  {key === 'top' ? 'Top' : 'New'}
                </span>
              </React.Fragment>
            ))}
          </div>
          {comboLinksLoading ? (
            <div style={styles.emptyState}>Loading links...</div>
          ) : comboLinks.length === 0 ? (
            <div style={styles.emptyState}>No links in this superconcept yet. Add a link to one of its subconcepts to see it here.</div>
          ) : (
            comboLinks.map((link, idx) => (
              <LinkCard key={link.id} isFirst={idx === 0}
                link={{ ...link, voteCount: Number(link.vote_count) || 0, addedBy: link.added_by, addedByUsername: link.added_by_username, createdAt: link.created_at }}
                user={user} isGuest={isGuest}
                contextLabel={`From ${link.concept_name}`}
                readOnlyVote={true} clickable={true}
                onCardClick={(l) => { if (onOpenConceptTab) onOpenConceptTab(l.concept_id || link.concept_id, link.graph_path || [], link.concept_name, link.attribute_name, undefined, 'children', l.id || link.id); }}
                showInstances={false} onRequestLogin={onRequestLogin} />
            ))
          )}
        </div>
      )}

    </div>
  );
};

const styles = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '20px',
  },
  loadingContainer: {
    padding: '60px',
    textAlign: 'center',
    fontFamily: "'EB Garamond', Georgia, serif",
    fontSize: '15px',
    color: '#888',
  },
  // Header
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e0e0e0',
  },
  headerLeft: {
    flex: 1,
    minWidth: 0,
  },
  headerRight: {
    flexShrink: 0,
    marginLeft: '16px',
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  comboName: {
    margin: '0 0 4px 0',
    fontSize: '22px',
    fontFamily: "'EB Garamond', Georgia, serif",
    fontWeight: '600',
    color: '#333',
  },
  comboDescription: {
    margin: '0 0 6px 0',
    fontSize: '14px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#666',
    lineHeight: '1.4',
  },
  metaLine: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#999',
  },
  shareButton: {
    padding: '4px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: '#f0f0f0',
    color: '#555',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  unsubscribeButton: {
    padding: '4px 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#666',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
  },
  // Owner section
  ownerSection: {
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e0e0e0',
  },
  ownerSectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  ownerSectionTitle: {
    fontSize: '14px',
    fontFamily: "'EB Garamond', Georgia, serif",
    fontWeight: '600',
    color: '#555',
  },
  addButton: {
    padding: '3px 10px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
  },
  emptyHint: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#999',
    padding: '8px 0',
  },
  subconcepts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  subconceptRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 8px',
    borderRadius: '4px',
    backgroundColor: '#faf9f6',
  },
  subconceptInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flex: 1,
    minWidth: 0,
    flexWrap: 'wrap',
  },
  subconceptName: {
    fontSize: '14px',
    fontFamily: "'EB Garamond', Georgia, serif",
    fontWeight: '600',
    color: '#333',
  },
  subconceptPath: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#999',
  },
  removeButton: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    color: '#999',
    padding: '2px 4px',
    fontFamily: "'EB Garamond', Georgia, serif",
    flexShrink: 0,
  },
  // Transfer ownership (Phase 42c)
  transferSection: {
    marginBottom: '16px',
    paddingBottom: '12px',
    borderBottom: '1px solid #e0e0e0',
  },
  transferInput: {
    width: '100%',
    padding: '6px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    backgroundColor: 'white',
    color: '#333',
    boxSizing: 'border-box',
    marginTop: '6px',
  },
  transferDropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '100%',
    backgroundColor: 'white',
    border: '1px solid #ddd',
    borderRadius: '4px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
    zIndex: 100,
    maxHeight: '200px',
    overflowY: 'auto',
  },
  transferResultRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 10px',
    borderBottom: '1px solid #f0f0f0',
  },
  transferActionButton: {
    padding: '3px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: '#333',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    marginLeft: 'auto',
  },
  // Picker
  pickerArea: {
    marginTop: '8px',
    padding: '10px',
    border: '1px solid #ddd',
    borderRadius: '6px',
    backgroundColor: 'white',
  },
  searchInput: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: "'EB Garamond', Georgia, serif",
    outline: 'none',
    boxSizing: 'border-box',
  },
  errorText: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#c33',
    marginTop: '4px',
  },
  hint: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#999',
    marginTop: '6px',
  },
  searchResultsList: {
    marginTop: '6px',
    border: '1px solid #eee',
    borderRadius: '4px',
    maxHeight: '200px',
    overflowY: 'auto',
  },
  searchResultItem: {
    padding: '6px 10px',
    fontSize: '14px',
    fontFamily: "'EB Garamond', Georgia, serif",
    cursor: 'pointer',
    borderBottom: '1px solid #f0f0f0',
    color: '#333',
  },
  contextPicker: {
    marginTop: '8px',
  },
  contextPickerHeader: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#555',
    marginBottom: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  backLink: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    padding: 0,
    textDecoration: 'underline',
  },
  contextList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  contextItem: {
    padding: '6px 10px',
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    cursor: 'pointer',
    borderRadius: '4px',
    border: '1px solid #eee',
    color: '#333',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
  },
  attrBadge: {
    fontSize: '11px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    padding: '1px 5px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    whiteSpace: 'nowrap',
  },
  // Filter bar
  filterBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    alignItems: 'center',
    marginBottom: '10px',
    padding: '8px 0',
  },
  filterBadgeActive: {
    padding: '2px 8px',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    borderRadius: '10px',
    backgroundColor: '#333',
    color: 'white',
    border: '1px solid #333',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },
  filterBadge: {
    padding: '2px 8px',
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    borderRadius: '10px',
    backgroundColor: 'transparent',
    color: '#999',
    border: '1px solid #ddd',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    opacity: 0.7,
  },
  showAllLink: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    cursor: 'pointer',
    textDecoration: 'underline',
    marginLeft: '4px',
  },
  // Sort bar
  sortBar: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '4px',
    marginBottom: '6px',
    padding: '4px 0',
  },
  matchLabel: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    marginLeft: '16px',
    paddingRight: '2px',
  },
  matchHelper: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    marginBottom: '12px',
    padding: '0 0 4px 0',
  },
  sortOption: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  sortOptionActive: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#333',
    fontWeight: '600',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
  },
  sortSep: {
    color: '#ccc',
    fontSize: '13px',
  },
  docLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    flexWrap: 'wrap',
    marginBottom: '4px',
  },
  docTitleLink: {
    fontSize: '15px',
    fontFamily: "'EB Garamond', Georgia, serif",
    fontWeight: '600',
    color: '#333',
    cursor: 'pointer',
    textDecoration: 'underline',
    textDecorationColor: '#ccc',
  },
  corpusNameLabel: {
    fontSize: '12px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#999',
  },
  quoteBlock: {
    fontSize: '14px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#555',
    paddingLeft: '12px',
    borderLeft: '2px solid #ddd',
    margin: '4px 0',
    lineHeight: '1.4',
  },
  commentBlock: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#666',
    margin: '4px 0',
    lineHeight: '1.4',
  },
  conceptBadgeLine: {
    margin: '4px 0',
  },
  conceptBadge: {
    fontSize: '11px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#666',
    padding: '1px 7px',
    border: '1px solid #ddd',
    borderRadius: '10px',
    whiteSpace: 'nowrap',
  },
  bottomRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '6px',
  },
  voteArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  voteButton: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
    border: '1px solid #ddd',
    backgroundColor: 'transparent',
  },
  voteButtonActive: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: 'white',
    cursor: 'pointer',
    padding: '2px 6px',
    borderRadius: '3px',
    border: '1px solid #333',
    backgroundColor: '#333',
  },
  voteCountReadonly: {
    fontSize: '13px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#888',
    padding: '2px 6px',
  },
  corpusVoteCount: {
    fontSize: '11px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#aaa',
  },
  meta: {
    fontSize: '11px',
    fontFamily: "'EB Garamond', Georgia, serif",
    color: '#aaa',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px',
    fontSize: '15px',
    color: '#888',
    fontFamily: "'EB Garamond', Georgia, serif",
  },
};

export default ComboTabContent;
