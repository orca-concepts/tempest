import React, { useState, useEffect, useRef, useCallback } from 'react';
import { votesAPI, combosAPI } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import OrcidBadge from './OrcidBadge';
import LinkCard from './LinkCard';
import MentionsPanel from './MentionsPanel';

const ConceptLinksPanel = ({
  conceptId, conceptName, path, currentEdgeId, isGuest, viewMode,
  onRequestLogin, onNavigateToSituation, onOpenConceptTab,
  pendingScrollLinkId, onPendingScrollLinkConsumed,
  collapsible = false,
  conceptMentionCount = 0,
  voteSets = [],
}) => {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(collapsible);
  const [activeTab, setActiveTab] = useState('weblinks');
  const [linksSort, setLinksSort] = useState('top');

  const [webLinks, setWebLinks] = useState([]);
  const [webLinksLoading, setWebLinksLoading] = useState(false);
  const [showAddLinkForm, setShowAddLinkForm] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState('');
  const [newLinkTitle, setNewLinkTitle] = useState('');
  const [newLinkComment, setNewLinkComment] = useState('');
  const [addLinkError, setAddLinkError] = useState(null);
  const [affirmed, setAffirmed] = useState(false);
  const [unsafeUrl, setUnsafeUrl] = useState(false);
  const [unsafeUrlValue, setUnsafeUrlValue] = useState('');

  // Title preview state
  const [titlePreviewLoading, setTitlePreviewLoading] = useState(false);
  const [titlePreviewError, setTitlePreviewError] = useState(false);
  const [titlePreviewResult, setTitlePreviewResult] = useState(null);
  const lastFetchedUrlRef = useRef('');
  const abortControllerRef = useRef(null);

  const [instanceData, setInstanceData] = useState({});
  const [instancePathNames, setInstancePathNames] = useState({});
  const [situations, setSituations] = useState([]);
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

  // Situations retired from the UI: never load combos for this edge.
  useEffect(() => {
    setSituations([]);
  }, [currentEdgeId, isChildrenView]);

  useEffect(() => {
    if (activeTab === 'situations' && situations.length === 0) setActiveTab('weblinks');
  }, [situations.length, activeTab]);

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
        newData[link.id] = { loading: false, sameConceptInstances: all.filter(r => r.concept_id === conceptId), otherConceptInstances: all.filter(r => r.concept_id !== conceptId), expanded: {} };
      });
      setInstanceData(newData);
    });
    return () => { cancelled = true; };
  }, [webLinks, conceptId]);

  const toggleInstanceExpansion = (linkId, type) => {
    setInstanceData(prev => {
      const cur = prev[linkId]?.expanded || {};
      return { ...prev, [linkId]: { ...prev[linkId], expanded: { ...cur, [type]: !cur[type] } } };
    });
  };

  // Title preview fetch
  const fetchTitlePreview = useCallback((url) => {
    const trimmed = url.trim();
    if (trimmed === lastFetchedUrlRef.current) return;
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    } catch { return; }

    lastFetchedUrlRef.current = trimmed;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setTitlePreviewLoading(true);
    setTitlePreviewError(false);
    setTitlePreviewResult(null);

    votesAPI.previewTitle(trimmed)
      .then(res => {
        if (controller.signal.aborted) return;
        const title = res.data.title || '';
        setTitlePreviewResult(title);
        if (title) setNewLinkTitle(title);
        setTitlePreviewLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err.response?.status === 403 && err.response?.data?.code === 'unsafe_url') {
          setUnsafeUrl(true);
          setUnsafeUrlValue(trimmed);
          setTitlePreviewLoading(false);
          return;
        }
        setTitlePreviewError(true);
        setTitlePreviewLoading(false);
      });
  }, []);

  // Handlers
  const handleToggleLinkVote = async (link) => {
    if (isGuest) { if (onRequestLogin) onRequestLogin(); return; }
    const wasVoted = link.userVoted;
    setWebLinks(links => links.map(l => l.id === link.id ? { ...l, userVoted: !wasVoted, voteCount: wasVoted ? l.voteCount - 1 : l.voteCount + 1 } : l));
    try { if (wasVoted) await votesAPI.removeWebLinkVote(link.id); else await votesAPI.upvoteWebLink(link.id); }
    catch { setWebLinks(links => links.map(l => l.id === link.id ? { ...l, userVoted: wasVoted, voteCount: wasVoted ? l.voteCount + 1 : l.voteCount - 1 } : l)); }
  };
  const handleAddLink = async () => {
    const trimmed = newLinkUrl.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/.+/i.test(trimmed)) { setAddLinkError('URL must start with http:// or https://'); return; }
    setAddLinkError(null);
    try {
      const res = await votesAPI.addWebLink(currentEdgeId, trimmed, newLinkTitle.trim() || undefined, newLinkComment.trim() || undefined);
      const newLink = res.data.webLink;
      setWebLinks(prev => [{ ...newLink, edgeId: newLink.edgeId, parentId: null, parentName: null, graphPath: path || [], attributeName: null, addedByUsername: user?.username }, ...prev]);
      setNewLinkUrl(''); setNewLinkTitle(''); setNewLinkComment(''); setShowAddLinkForm(false); setAffirmed(false);
      setTitlePreviewResult(null); setTitlePreviewError(false); setTitlePreviewLoading(false);
      lastFetchedUrlRef.current = '';
    } catch (err) {
      if (err.response?.status === 403 && err.response?.data?.code === 'unsafe_url') {
        setUnsafeUrl(true);
        setUnsafeUrlValue(trimmed);
        return;
      }
      setAddLinkError(err.response?.data?.error || 'Failed to add link');
    }
  };
  const handleCloseAddForm = () => {
    setShowAddLinkForm(false); setAddLinkError(null); setNewLinkUrl(''); setNewLinkTitle(''); setNewLinkComment('');
    setAffirmed(false); setUnsafeUrl(false); setUnsafeUrlValue('');
    setTitlePreviewResult(null); setTitlePreviewError(false); setTitlePreviewLoading(false);
    lastFetchedUrlRef.current = '';
    if (abortControllerRef.current) abortControllerRef.current.abort();
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
        <input
          type="text"
          value={newLinkUrl}
          onChange={e => { setNewLinkUrl(e.target.value); setAddLinkError(null); if (unsafeUrl && e.target.value.trim() !== unsafeUrlValue) { setUnsafeUrl(false); setUnsafeUrlValue(''); } }}
          onBlur={() => fetchTitlePreview(newLinkUrl)}
          onPaste={e => {
            const pasted = e.clipboardData.getData('text');
            // The paste event fires before onChange updates the value,
            // so use the pasted text directly
            setTimeout(() => fetchTitlePreview(pasted), 0);
          }}
          placeholder="https://..."
          style={styles.addLinkInput}
          autoFocus
        />
        {unsafeUrl && (
          <div style={styles.unsafeUrlError}>This URL was flagged by Google Safe Browsing as potentially unsafe. It cannot be posted to Orca.</div>
        )}
        {!unsafeUrl && titlePreviewLoading && (
          <div style={styles.titlePreviewStatus}>Fetching title...</div>
        )}
        {!unsafeUrl && titlePreviewError && (
          <div style={styles.titlePreviewStatus}>Couldn't fetch title — you can enter one manually</div>
        )}
        {!unsafeUrl && titlePreviewResult && !titlePreviewLoading && (
          <div style={styles.titlePreviewBox}>{titlePreviewResult}</div>
        )}
        <input type="text" value={newLinkTitle} onChange={e => setNewLinkTitle(e.target.value)} placeholder="Title (optional — auto-fetched if empty)" style={styles.addLinkInput} />
        <textarea value={newLinkComment} onChange={e => setNewLinkComment(e.target.value)} placeholder="Comment (optional)" style={styles.commentTextarea} rows={2} />
        {addLinkError && <div style={styles.addLinkError}>{addLinkError}</div>}
        <label style={styles.affirmLabel}>
          <input type="checkbox" checked={affirmed} onChange={e => setAffirmed(e.target.checked)} style={styles.affirmCheckbox} />
          <span style={styles.affirmText}>
            I affirm this URL points to content that is publicly available through legitimate means (e.g., open access publication, the publisher's website, an institutional or preprint repository), and that posting this link does not violate any agreement, embargo, or known prohibition.
          </span>
        </label>
        <div style={styles.commentEditButtons}>
          <span onClick={affirmed && !unsafeUrl ? handleAddLink : undefined} style={affirmed && !unsafeUrl ? styles.commentSaveBtn : { ...styles.commentSaveBtn, opacity: 0.4, cursor: 'default' }}>Add</span>
          <span onClick={handleCloseAddForm} style={styles.commentCancelBtn}>Cancel</span>
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
            onVoteToggle={handleToggleLinkVote}
            showInstances={true} instanceData={instanceData[link.id]} onToggleInstance={toggleInstanceExpansion}
            renderInstanceSnippet={renderInstanceSnippet}
            cardRef={el => { linkRefs.current[link.id] = el; }} onRequestLogin={onRequestLogin}
            conceptId={conceptId} conceptPath={path} onCopySuccess={() => loadLinks()}
            voteSets={voteSets}
            onRemoveSuccess={() => loadLinks()} onAddendumSuccess={() => loadLinks()} />
        ))}
      </>
    );
  };

  const renderSituationsTab = () => {
    if (situations.length === 0) return <div style={{ color: '#999', fontSize: '14px', padding: '8px 0' }}>No situations contain this edge.</div>;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {situations.map(sc => {
          const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
          return (
            <div key={sc.id} style={styles.situationCard}>
              <span onClick={() => onNavigateToSituation && onNavigateToSituation(sc.id, sc.name)} style={styles.situationName}>{sc.name}</span>
              <div style={styles.situationOwner}>by {sc.created_by_username || '[deleted user]'}{sc.created_by_orcid_id && <OrcidBadge orcidId={sc.created_by_orcid_id} />}</div>
              {sc.description && <div style={styles.situationDescription}>{sc.description}</div>}
              <div style={styles.situationStats}>{plural(sc.edge_count, 'concept')} {'\u00b7'} {'\u25b2'} {plural(sc.vote_count, 'vote')}</div>
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
            <><span style={styles.tabSeparator}>|</span><span onClick={() => setActiveTab('mentions')} style={{ ...styles.tab, ...(activeTab === 'mentions' ? styles.tabActive : {}), ...(conceptMentionCount === 0 && activeTab !== 'mentions' ? { color: '#ccc' } : {}) }}>Mentioned by ({conceptMentionCount})</span></>
          </div>
          <div style={styles.content}>
            {activeTab === 'weblinks' && renderWebLinksTab()}
            {activeTab === 'mentions' && (
              <MentionsPanel
                targetType="concept"
                targetId={conceptId}
                targetPath={path || []}
                emptyStateNoun="concept"
                expanded={true}
              />
            )}
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
  unsafeUrlError: { fontSize: '12px', color: '#c44', fontFamily: '"EB Garamond", Georgia, serif', backgroundColor: '#fdf0f0', padding: '8px 10px', borderRadius: '3px', lineHeight: 1.4 },
  commentTextarea: { width: '100%', fontFamily: '"EB Garamond", Georgia, serif', fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  commentEditButtons: { display: 'flex', gap: '10px', marginTop: '4px' },
  commentSaveBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', border: '1px solid #e0d9cf', padding: '2px 10px', borderRadius: '3px', backgroundColor: '#faf9f6' },
  commentCancelBtn: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif' },
  titlePreviewStatus: { fontSize: '11px', color: '#999', fontFamily: '"EB Garamond", Georgia, serif' },
  titlePreviewBox: { fontSize: '12px', color: '#555', fontFamily: '"EB Garamond", Georgia, serif', backgroundColor: '#f0ede8', padding: '6px 8px', borderRadius: '3px', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  affirmLabel: { display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', marginTop: '4px' },
  affirmCheckbox: { marginTop: '3px', flexShrink: 0 },
  affirmText: { fontSize: '11px', color: '#666', fontFamily: '"EB Garamond", Georgia, serif', lineHeight: 1.4 },
  instanceRow: { cursor: 'pointer', padding: '4px 6px', borderRadius: '3px', fontSize: '12px', color: '#555', transition: 'background-color 0.15s' },
  instancePath: { color: '#555', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  instanceSnippet: { fontSize: '11px', color: '#999', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  situationCard: { padding: '10px 12px', border: '1px solid #e0d9cf', borderRadius: '4px', backgroundColor: '#faf9f6' },
  situationName: { fontFamily: '"EB Garamond", Georgia, serif', fontSize: '15px', color: '#333', cursor: 'pointer', background: 'none', border: 'none', padding: 0, textAlign: 'left', display: 'block', fontWeight: 'normal' },
  situationOwner: { fontSize: '13px', color: '#888', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '4px' },
  situationDescription: { fontSize: '13px', color: '#666', marginTop: '4px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  situationStats: { fontSize: '12px', color: '#999', marginTop: '4px' },
};

export default ConceptLinksPanel;
