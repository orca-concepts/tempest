import React, { useState, useEffect, useRef, useCallback } from 'react';
import { votesAPI, combosAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import OrcidBadge from './OrcidBadge';
import LinkCard from './LinkCard';

const ConceptLinksPanel = ({
  conceptId, conceptName, path, currentEdgeId, isGuest, viewMode,
  onRequestLogin, onNavigateToSuperconcept, onOpenConceptTab,
  pendingScrollLinkId, onPendingScrollLinkConsumed,
  collapsible = false,
}) => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(collapsible);
  const [activeTab, setActiveTab] = useState('weblinks');
  const [linksSort, setLinksSort] = useState('top');

  const [editingLinkId, setEditingLinkId] = useState(null);
  const [editingComment, setEditingComment] = useState('');

  const [webLinks, setWebLinks] = useState([]);
  const [webLinksLoading, setWebLinksLoading] = useState(false);
  const [showAddLinkForm, setShowAddLinkForm] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkComment, setNewLinkComment] = useState('');
  const [addLinkError, setAddLinkError] = useState(null);

  const [instanceData, setInstanceData] = useState({});
  const [instancePathNames, setInstancePathNames] = useState({});
  const [superconcepts, setSuperconcepts] = useState([]);
  const linkRefs = useRef({});
  const linksRequestIdRef = useRef(0);
  const isChildrenView = viewMode === 'children';

  // Load web links
  const loadLinks = useCallback(() => {
    const myRequestId = ++linksRequestIdRef.current;
    if (!conceptId) return;
    if (isChildrenView && !currentEdgeId) {
      setWebLinks([]);
      return;
    }
    setWebLinksLoading(true);
    if (isChildrenView && currentEdgeId) {
      votesAPI.getWebLinks(currentEdgeId, linksSort)
        .then(res => {
          if (myRequestId !== linksRequestIdRef.current) return;
          setWebLinks((res.data.webLinks || []).map(link => ({
            ...link, edgeId: currentEdgeId, parentId: null, parentName: null, graphPath: path || [], attributeName: null,
          })));
        })
        .catch(() => { if (myRequestId !== linksRequestIdRef.current) return; setWebLinks([]); })
        .finally(() => { if (myRequestId === linksRequestIdRef.current) setWebLinksLoading(false); });
    } else {
      const pathParam = (path || []).join(',');
      votesAPI.getAllWebLinksForConcept(conceptId, pathParam || undefined)
        .then(res => {
          if (myRequestId !== linksRequestIdRef.current) return;
          const flat = [];
          for (const group of (res.data.groups || [])) {
            for (const link of group.links) {
              flat.push({ ...link, edgeId: group.edgeId, parentId: group.parentId, parentName: group.parentName, graphPath: group.graphPath, attributeName: group.attributeName });
            }
          }
          setWebLinks(flat);
        })
        .catch(() => { if (myRequestId !== linksRequestIdRef.current) return; setWebLinks([]); })
        .finally(() => { if (myRequestId === linksRequestIdRef.current) setWebLinksLoading(false); });
    }
  }, [conceptId, currentEdgeId, isChildrenView, linksSort, path?.join(',')]);

  useEffect(() => { loadLinks(); }, [loadLinks]);

  // Load superconcepts
  useEffect(() => {
    if (!isChildrenView || !currentEdgeId) { setSuperconcepts([]); return; }
    let cancelled = false;
    combosAPI.getCombosByEdge(currentEdgeId)
      .then(res => { if (!cancelled) setSuperconcepts(res.data || []); })
      .catch(() => { if (!cancelled) setSuperconcepts([]); });
    return () => { cancelled = true; };
  }, [currentEdgeId, isChildrenView]);

  useEffect(() => {
    if (activeTab === 'superconcepts' && superconcepts.length === 0) setActiveTab('weblinks');
  }, [superconcepts.length, activeTab]);

  // Scroll helper
  const scrollToAndHighlight = useCallback((targetLinkId) => {
    const el = linkRefs.current[targetLinkId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.backgroundColor = '#fffbcc';
    setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
  }, []);

  // Pending scroll
  useEffect(() => {
    if (!pendingScrollLinkId || webLinksLoading || webLinks.length === 0) return;
    const timer = setTimeout(() => {
      scrollToAndHighlight(pendingScrollLinkId);
      if (onPendingScrollLinkConsumed) onPendingScrollLinkConsumed();
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingScrollLinkId, webLinksLoading, webLinks.length, scrollToAndHighlight]);

  // Instance counts
  useEffect(() => {
    if (webLinks.length === 0) { setInstanceData({}); setInstancePathNames({}); return; }
    let cancelled = false;
    const uniqueUrls = [...new Set(webLinks.map(l => l.url))];
    Promise.all(uniqueUrls.map(url =>
      votesAPI.getWebLinksByUrl(url).then(res => ({ url, links: res.data.links || [], pathNames: res.data.pathNames || {} })).catch(() => ({ url, links: [], pathNames: {} }))
    )).then(results => {
      if (cancelled) return;
      const urlMap = {}; const mergedNames = {};
      results.forEach(r => { urlMap[r.url] = r.links; Object.assign(mergedNames, r.pathNames); });
      setInstancePathNames(mergedNames);
      const newData = {};
      webLinks.forEach(link => {
        const all = (urlMap[link.url] || []).filter(r => r.id !== link.id);
        newData[link.id] = { loading: false, sameConceptInstances: all.filter(r => r.concept_id === conceptId), otherConceptInstances: all.filter(r => r.concept_id !== conceptId), expanded: null };
      });
      setInstanceData(newData);
    });
    return () => { cancelled = true; };
  }, [webLinks, conceptId]);

  const toggleInstanceExpansion = (linkId, type) => {
    setInstanceData(prev => ({ ...prev, [linkId]: { ...prev[linkId], expanded: prev[linkId]?.expanded === type ? null : type } }));
  };

  // Handlers
  const handleToggleLinkVote = async (link) => {
    if (isGuest) { if (onRequestLogin) onRequestLogin(); return; }
    const wasVoted = link.userVoted;
    setWebLinks(links => links.map(l => l.id === link.id ? { ...l, userVoted: !wasVoted, voteCount: wasVoted ? l.voteCount - 1 : l.voteCount + 1 } : l));
    try { if (wasVoted) await votesAPI.removeWebLinkVote(link.id); else await votesAPI.upvoteWebLink(link.id); }
    catch { setWebLinks(links => links.map(l => l.id === link.id ? { ...l, userVoted: wasVoted, voteCount: wasVoted ? l.voteCount + 1 : l.voteCount - 1 } : l)); }
  };
  const handleStartEditComment = (link) => { setEditingLinkId(link.id); setEditingComment(link.comment || ''); };
  const handleCancelEditComment = () => { setEditingLinkId(null); setEditingComment(''); };
  const handleAddLink = async () => {
    const trimmed = newLinkUrl.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/.+/i.test(trimmed)) { setAddLinkError('URL must start with http:// or https://'); return; }
    setAddLinkError(null);
    try {
      const res = await votesAPI.addWebLink(currentEdgeId, trimmed, newLinkTitle.trim() || undefined, newLinkComment.trim() || undefined);
      const newLink = res.data.webLink;
      setWebLinks(prev => [{ ...newLink, edgeId: newLink.edgeId, parentId: null, parentName: null, graphPath: path || [], attributeName: null, addedByUsername: user?.username }, ...prev]);
      setNewLinkUrl(''); setNewLinkTitle(''); setNewLinkComment(''); setShowAddLinkForm(false);
    } catch (err) { setAddLinkError(err.response?.data?.error || 'Failed to add link'); }
  };
  const handleSaveComment = async (linkId) => {
    const prev = webLinks.find(l => l.id === linkId);
    setWebLinks(links => links.map(l => l.id === linkId ? { ...l, comment: editingComment.trim() || null, updatedAt: new Date().toISOString() } : l));
    setEditingLinkId(null); setEditingComment('');
    try { await votesAPI.updateLinkComment(linkId, editingComment.trim() || null); }
    catch { if (prev) setWebLinks(links => links.map(l => l.id === linkId ? { ...l, comment: prev.comment, updatedAt: prev.updatedAt } : l)); }
  };
  const handleRemoveLink = async (linkId) => {
    setWebLinks(links => links.filter(l => l.id !== linkId));
    try { await votesAPI.removeWebLink(linkId); } catch { loadLinks(); }
  };

  const handleInstanceClick = (inst) => {
    if (inst.concept_id === conceptId) {
      const targetLink = webLinks.find(l => l.id === inst.id);
      if (targetLink) { scrollToAndHighlight(inst.id); return; }
    }
    if (onOpenConceptTab) onOpenConceptTab(inst.concept_id, inst.graph_path || [], inst.concept_name, inst.attribute_name, undefined, 'children', inst.id);
  };

  const renderInstanceSnippet = (inst) => {
    const pathParts = (inst.graph_path || []).map(id => instancePathNames[id] || `#${id}`);
    pathParts.push(inst.concept_name);
    const pathDisplay = pathParts.join(' \u2192 ');
    const snippet = inst.comment ? (inst.comment.length > 100 ? inst.comment.substring(0, 100) + '\u2026' : inst.comment) : null;
    return (
      <div key={inst.id} style={styles.instanceRow} onClick={() => handleInstanceClick(inst)}
        onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f5f0e8'; }}
        onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; }}
        title={inst.concept_id === conceptId ? 'Scroll to this link' : 'Open this concept'}>
        <div style={styles.instancePath}>{pathDisplay}</div>
        {snippet && <div style={styles.instanceSnippet}>{snippet}</div>}
      </div>
    );
  };

  // Render
  const renderAddLinkForm = () => {
    if (!showAddLinkForm) return null;
    return (
      <div style={styles.addLinkForm}>
        <input type="text" value={newLinkUrl} onChange={e => { setNewLinkUrl(e.target.value); setAddLinkError(null); }} placeholder="https://..." style={styles.addLinkInput} autoFocus />
        <input type="text" value={newLinkTitle} onChange={e => setNewLinkTitle(e.target.value)} placeholder="Title (optional — auto-fetched if empty)" style={styles.addLinkInput} />
        <textarea value={newLinkComment} onChange={e => setNewLinkComment(e.target.value)} placeholder="Comment (optional)" style={styles.commentTextarea} rows={2} />
        {addLinkError && <div style={styles.addLinkError}>{addLinkError}</div>}
        <div style={styles.commentEditButtons}>
          <span onClick={handleAddLink} style={styles.commentSaveBtn}>Add</span>
          <span onClick={() => { setShowAddLinkForm(false); setAddLinkError(null); setNewLinkUrl(''); setNewLinkTitle(''); setNewLinkComment(''); }} style={styles.commentCancelBtn}>Cancel</span>
        </div>
      </div>
    );
  };

  const renderWebLinksTab = () => {
    const addButton = !isGuest && currentEdgeId && !showAddLinkForm ? (
      <div style={styles.addLinkRow}><span onClick={() => setShowAddLinkForm(true)} style={styles.addLinkBtn}>+ Add Link</span></div>
    ) : null;
    const sortToggle = (
      <div style={styles.sortBar}>
        <span style={{ fontSize: '12px', color: '#999' }}>Sort:</span>
        {['top', 'new'].map((key, i) => (
          <React.Fragment key={key}>
            {i > 0 && <span style={styles.sortSep}>{'\u00b7'}</span>}
            <span onClick={() => setLinksSort(key)} style={linksSort === key ? styles.sortOptionActive : styles.sortOption}>{key === 'top' ? 'Top' : 'New'}</span>
          </React.Fragment>
        ))}
      </div>
    );
    if (webLinksLoading) return <>{addButton}{renderAddLinkForm()}{sortToggle}<p style={styles.placeholder}>Loading...</p></>;
    if (webLinks.length === 0) return <>{addButton}{renderAddLinkForm()}<p style={styles.emptyState}>No links yet</p></>;
    return (
      <>
        {addButton}{renderAddLinkForm()}{sortToggle}
        {webLinks.map((link, idx) => (
          <LinkCard key={link.id} link={link} user={user} isGuest={isGuest} isFirst={idx === 0}
            onVoteToggle={handleToggleLinkVote} onStartEdit={handleStartEditComment} onRemove={handleRemoveLink}
            editingLinkId={editingLinkId} editingComment={editingComment}
            onEditChange={setEditingComment} onSaveComment={handleSaveComment} onCancelEdit={handleCancelEditComment}
            showInstances={true} instanceData={instanceData[link.id]} onToggleInstance={toggleInstanceExpansion}
            renderInstanceSnippet={renderInstanceSnippet}
            cardRef={el => { linkRefs.current[link.id] = el; }} onRequestLogin={onRequestLogin} />
        ))}
      </>
    );
  };

  const renderSuperconceptsTab = () => {
    if (superconcepts.length === 0) return <div style={{ color: '#999', fontSize: '14px', padding: '8px 0' }}>No superconcepts contain this edge.</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {superconcepts.map(sc => {
          const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
          return (
            <div key={sc.id} style={styles.superconceptCard}>
              <span onClick={() => onNavigateToSuperconcept && onNavigateToSuperconcept(sc.id, sc.name)} style={styles.superconceptName}>{sc.name}</span>
              <div style={styles.superconceptOwner}>by {sc.created_by_username || '[deleted user]'}{sc.created_by_orcid_id && <OrcidBadge orcidId={sc.created_by_orcid_id} />}</div>
              {sc.description && <div style={styles.superconceptDescription}>{sc.description}</div>}
              <div style={styles.superconceptStats}>{plural(sc.edge_count, 'concept')} {'\u00b7'} {plural(sc.subscriber_count, 'subscriber')}</div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      {collapsible && <div style={styles.collapseHeader} onClick={() => setCollapsed(prev => !prev)}><span>Links {collapsed ? '\u25b8' : '\u25be'}</span></div>}
      {(!collapsible || !collapsed) && (
        <>
          <div style={styles.tabBar}>
            <span onClick={() => setActiveTab('weblinks')} style={{ ...styles.tab, ...(activeTab === 'weblinks' ? styles.tabActive : {}) }}>Links</span>
            {superconcepts.length > 0 && (
              <><span style={styles.tabSeparator}>|</span><span onClick={() => setActiveTab('superconcepts')} style={{ ...styles.tab, ...(activeTab === 'superconcepts' ? styles.tabActive : {}) }}>Superconcepts ({superconcepts.length})</span></>
            )}
          </div>
          <div style={styles.content}>
            {activeTab === 'weblinks' && renderWebLinksTab()}
            {activeTab === 'superconcepts' && renderSuperconceptsTab()}
          </div>
        </>
      )}
    </div>
  );
};

const styles = {
  container: { fontFamily: '"EB Garamond", Georgia, serif', backgroundColor: '#faf9f6', minHeight: '100%', padding: '0 14px' },
  collapseHeader: { padding: '10px 0', fontSize: '15px', color: '#555', cursor: 'pointer', userSelect: 'none', borderBottom: '1px solid #e0d9cf', marginBottom: '8px' },
  tabBar: { display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0 8px 0', borderBottom: '1px solid #e0d9cf', marginBottom: '16px' },
  tab: { fontSize: '15px', color: '#888', cursor: 'pointer', paddingBottom: '4px', borderBottom: '2px solid transparent', transition: 'color 0.15s' },
  tabActive: { color: '#333', borderBottomColor: '#333' },
  tabSeparator: { color: '#ccc', fontSize: '14px' },
  content: { padding: '8px 0' },
  sortBar: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', fontSize: '13px' },
  sortOption: { color: '#999', cursor: 'pointer', paddingBottom: '2px', borderBottom: '1px solid transparent' },
  sortOptionActive: { color: '#333', borderBottomColor: '#333', cursor: 'pointer', paddingBottom: '2px' },
  sortSep: { color: '#ccc' },
  placeholder: { fontSize: '14px', color: '#999', fontStyle: 'normal', margin: 0 },
  emptyState: { fontSize: '14px', color: '#999', fontStyle: 'normal', textAlign: 'center', padding: '24px 0', margin: 0 },
  addLinkRow: { marginBottom: '10px' },
  addLinkBtn: { fontSize: '13px', color: '#999', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', textDecoration: 'underline' },
  addLinkForm: { marginBottom: '12px', display: 'flex', flexDirection: 'column', gap: '6px' },
  addLinkInput: { width: '100%', fontFamily: '"EB Garamond", Georgia, serif', fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' },
  addLinkError: { fontSize: '12px', color: '#c44' },
  commentTextarea: { width: '100%', fontFamily: '"EB Garamond", Georgia, serif', fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  commentEditButtons: { display: 'flex', gap: '10px', marginTop: '4px' },
  commentSaveBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', border: '1px solid #e0d9cf', padding: '2px 10px', borderRadius: '3px', backgroundColor: '#faf9f6' },
  commentCancelBtn: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceRow: { cursor: 'pointer', padding: '4px 6px', borderRadius: '3px', fontSize: '12px', color: '#555', transition: 'background-color 0.15s' },
  instancePath: { color: '#555', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  instanceSnippet: { fontSize: '11px', color: '#999', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  superconceptCard: { padding: '10px 12px', border: '1px solid #e0d9cf', borderRadius: '4px', backgroundColor: '#faf9f6' },
  superconceptName: { fontFamily: '"EB Garamond", Georgia, serif', fontSize: '15px', color: '#333', cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left', display: 'block', fontWeight: 'normal' },
  superconceptOwner: { fontSize: '13px', color: '#888', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' },
  superconceptDescription: { fontSize: '13px', color: '#666', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  superconceptStats: { fontSize: '12px', color: '#999', marginTop: '4px' },
};

export default ConceptLinksPanel;
