import React, { useState, useEffect, useRef, useCallback } from 'react';
import { votesAPI } from '../services/api';
import LinkCard from './LinkCard';
import LinkifiedText from './LinkifiedText';
import OrcidBadge from './OrcidBadge';

// Phase 72f: the in-card / own-page link section for OPEN communities. It replaces
// the side ConceptLinksPanel in children view. Collapsed it shows the question's
// TOP link (highest vote count, ties newest) with a one-line comment and a vote
// button; "Show N more links" expands the full list inside the card using the
// existing LinkCard (all features intact), a Top / New sort toggle, and the
// add-link form for logged-in users. "Show fewer" collapses it again.
//
// Two modes:
//   - 'card' (ConceptGrid): the top link and count come from props (topLink,
//     linkCount) the page already loaded in one query; the full list loads on
//     demand only when expanded.
//   - 'page' (Concept.jsx own-page section under the title): there is no provided
//     topLink, so the edge's links are loaded eagerly (GET /web-links/:edgeId) and
//     the preview + count are derived from that list.
const CardLinksSection = ({
  edgeId,
  conceptId,
  path = [],
  mode = 'card',
  topLink = null,
  linkCount = 0,
  isGuest = false,
  user = null,
  onRequestLogin,
  allowAddLink = false,
  voteSets = [],
  onChanged,
  onOpenConceptTab,
  pendingScrollLinkId = null,
  onPendingScrollLinkConsumed,
}) => {
  const eager = mode === 'page';

  // Local copy of the provided top link so a collapsed-preview vote can update
  // optimistically before the parent's silent refresh lands (card mode).
  const [localTop, setLocalTop] = useState(topLink);
  useEffect(() => { setLocalTop(topLink); }, [topLink]);

  const [expanded, setExpanded] = useState(false);
  const [webLinks, setWebLinks] = useState(null); // null = not loaded yet
  const [linksLoading, setLinksLoading] = useState(false);
  const [sort, setSort] = useState('top');

  const [instanceData, setInstanceData] = useState({});
  const [instancePathNames, setInstancePathNames] = useState({});
  const linkRefs = useRef({});
  const requestIdRef = useRef(0);

  // Add-link form state (mirrors ConceptLinksPanel's form).
  const [showAddForm, setShowAddForm] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newComment, setNewComment] = useState('');
  const [addError, setAddError] = useState(null);
  const [affirmed, setAffirmed] = useState(false);
  const [unsafeUrl, setUnsafeUrl] = useState(false);
  const [unsafeUrlValue, setUnsafeUrlValue] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  const lastFetchedUrlRef = useRef('');
  const abortControllerRef = useRef(null);

  const loaded = webLinks != null;

  const computeTop = (list) => {
    if (!list || list.length === 0) return null;
    return list.slice().sort((a, b) =>
      (b.voteCount - a.voteCount) || (new Date(b.createdAt) - new Date(a.createdAt))
    )[0];
  };

  const previewLink = loaded ? computeTop(webLinks) : localTop;
  const totalCount = loaded ? webLinks.length : linkCount;
  const moreCount = Math.max(0, totalCount - 1);

  // Load the edge's full link list. Stale-State Guard: a request-generation ref
  // discards responses from superseded fetches.
  const loadLinks = useCallback((sortKey) => {
    if (!edgeId) { setWebLinks([]); return Promise.resolve(); }
    const myId = ++requestIdRef.current;
    setLinksLoading(true);
    return votesAPI.getWebLinks(edgeId, sortKey)
      .then((res) => {
        if (myId !== requestIdRef.current) return;
        setWebLinks(res.data.webLinks || []);
      })
      .catch(() => { if (myId === requestIdRef.current) setWebLinks([]); })
      .finally(() => { if (myId === requestIdRef.current) setLinksLoading(false); });
  }, [edgeId]);

  // Page mode loads eagerly so the preview + count come from live data.
  useEffect(() => {
    if (!eager) return;
    setWebLinks(null);
    setExpanded(false);
    loadLinks('top');
  }, [eager, edgeId, loadLinks]);

  // When the sort changes while expanded, refetch in that order.
  useEffect(() => {
    if (!expanded || !loaded) return;
    loadLinks(sort);
  }, [sort]); // eslint-disable-line react-hooks/exhaustive-deps

  // Instance counts for the expanded LinkCards ("Other questions with this link").
  useEffect(() => {
    if (!webLinks || webLinks.length === 0) { setInstanceData({}); setInstancePathNames({}); return; }
    let cancelled = false;
    const uniqueUrls = [...new Set(webLinks.map((l) => l.url))];
    Promise.all(uniqueUrls.map((url) =>
      votesAPI.getWebLinksByUrl(url)
        .then((res) => ({ url, links: res.data.links || [], pathNames: res.data.pathNames || {} }))
        .catch(() => ({ url, links: [], pathNames: {} }))
    )).then((results) => {
      if (cancelled) return;
      const urlMap = {}; const mergedNames = {};
      results.forEach((r) => { urlMap[r.url] = r.links; Object.assign(mergedNames, r.pathNames); });
      setInstancePathNames(mergedNames);
      const next = {};
      webLinks.forEach((link) => {
        const all = (urlMap[link.url] || []).filter((r) => r.id !== link.id);
        next[link.id] = { loading: false, otherConceptInstances: all.filter((r) => r.edge_id !== edgeId), expanded: {} };
      });
      setInstanceData(next);
    });
    return () => { cancelled = true; };
  }, [webLinks, edgeId]);

  const toggleInstanceExpansion = (linkId, type) => {
    setInstanceData((prev) => {
      const cur = prev[linkId]?.expanded || {};
      return { ...prev, [linkId]: { ...prev[linkId], expanded: { ...cur, [type]: !cur[type] } } };
    });
  };

  const scrollToAndHighlight = useCallback((targetLinkId) => {
    const el = linkRefs.current[targetLinkId];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.style.backgroundColor = '#fffbcc';
    setTimeout(() => { el.style.backgroundColor = ''; }, 2000);
  }, []);

  // Deep link (/link/:id) — expand and highlight this edge's targeted link.
  useEffect(() => {
    if (!pendingScrollLinkId) return;
    // Expand so the full list (and its refs) render.
    if (!expanded) { setExpanded(true); if (!loaded) loadLinks(sort); }
    if (linksLoading || !webLinks || webLinks.length === 0) return;
    const target = webLinks.find((l) => l.id === pendingScrollLinkId);
    if (!target) return;
    const timer = setTimeout(() => {
      scrollToAndHighlight(pendingScrollLinkId);
      if (onPendingScrollLinkConsumed) onPendingScrollLinkConsumed();
    }, 300);
    return () => clearTimeout(timer);
  }, [pendingScrollLinkId, linksLoading, webLinks, expanded, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleExpand = () => {
    if (!loaded) loadLinks(sort);
    setExpanded(true);
  };
  const handleCollapse = () => {
    setExpanded(false);
    setShowAddForm(false);
  };

  // Vote toggle inside the expanded list (one vote tally per link).
  const handleListVote = async (link) => {
    if (isGuest) { if (onRequestLogin) onRequestLogin(); return; }
    const wasVoted = link.userVoted;
    setWebLinks((links) => (links || []).map((l) =>
      l.id === link.id ? { ...l, userVoted: !wasVoted, voteCount: wasVoted ? l.voteCount - 1 : l.voteCount + 1 } : l));
    try {
      if (wasVoted) await votesAPI.removeWebLinkVote(link.id); else await votesAPI.upvoteWebLink(link.id);
      if (onChanged) onChanged();
    } catch {
      setWebLinks((links) => (links || []).map((l) =>
        l.id === link.id ? { ...l, userVoted: wasVoted, voteCount: wasVoted ? l.voteCount + 1 : l.voteCount - 1 } : l));
    }
  };

  // Vote toggle on the collapsed preview. When the list is loaded it routes to
  // handleListVote; otherwise it optimistically updates the local top copy.
  const handlePreviewVote = async () => {
    if (isGuest) { if (onRequestLogin) onRequestLogin(); return; }
    if (!previewLink) return;
    if (loaded) { handleListVote(previewLink); return; }
    const wasVoted = previewLink.userVoted;
    setLocalTop((t) => t && { ...t, userVoted: !wasVoted, voteCount: wasVoted ? t.voteCount - 1 : t.voteCount + 1 });
    try {
      if (wasVoted) await votesAPI.removeWebLinkVote(previewLink.id); else await votesAPI.upvoteWebLink(previewLink.id);
      if (onChanged) onChanged();
    } catch {
      setLocalTop((t) => t && { ...t, userVoted: wasVoted, voteCount: wasVoted ? t.voteCount + 1 : t.voteCount - 1 });
    }
  };

  // Title preview for the add-link form.
  const fetchTitlePreview = useCallback((candidate) => {
    const trimmed = (candidate || '').trim();
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
    setPreviewLoading(true); setPreviewError(false); setPreviewResult(null);
    votesAPI.previewTitle(trimmed)
      .then((res) => {
        if (controller.signal.aborted) return;
        const t = res.data.title || '';
        setPreviewResult(t);
        if (t) setNewTitle(t);
        setPreviewLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err.response?.status === 403 && err.response?.data?.code === 'unsafe_url') {
          setUnsafeUrl(true); setUnsafeUrlValue(trimmed); setPreviewLoading(false); return;
        }
        setPreviewError(true); setPreviewLoading(false);
      });
  }, []);

  const resetAddForm = () => {
    setShowAddForm(false); setAddError(null);
    setNewUrl(''); setNewTitle(''); setNewComment(''); setAffirmed(false);
    setUnsafeUrl(false); setUnsafeUrlValue('');
    setPreviewResult(null); setPreviewError(false); setPreviewLoading(false);
    lastFetchedUrlRef.current = '';
    if (abortControllerRef.current) abortControllerRef.current.abort();
  };

  const handleAdd = async () => {
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    if (!/^https?:\/\/.+/i.test(trimmed)) { setAddError('URL must start with http:// or https://'); return; }
    setAddError(null);
    try {
      await votesAPI.addWebLink(edgeId, trimmed, newTitle.trim() || undefined, newComment.trim() || undefined);
      resetAddForm();
      await loadLinks(sort);
      if (onChanged) onChanged();
    } catch (err) {
      if (err.response?.status === 403 && err.response?.data?.code === 'unsafe_url') {
        setUnsafeUrl(true); setUnsafeUrlValue(trimmed); return;
      }
      setAddError(err.response?.data?.error || 'Failed to add link');
    }
  };

  const handleListChanged = async () => {
    await loadLinks(sort);
    if (onChanged) onChanged();
  };

  const renderInstanceSnippet = (inst) => {
    const ancestorParts = (inst.graph_path || []).map((id) => instancePathNames[id] || `#${id}`);
    const snippet = inst.comment ? (inst.comment.length > 100 ? inst.comment.substring(0, 100) + '…' : inst.comment) : null;
    const handleClick = () => {
      if (inst.concept_id === conceptId && webLinks && webLinks.some((l) => l.id === inst.id)) {
        scrollToAndHighlight(inst.id); return;
      }
      if (onOpenConceptTab) onOpenConceptTab(inst.concept_id, inst.graph_path || [], inst.concept_name, inst.attribute_name, undefined, 'children', inst.id);
    };
    return (
      <div key={inst.id} style={styles.instanceRow} onClick={handleClick}
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f5f0e8'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
        title="Open this question">
        <div style={styles.instancePath}>
          {ancestorParts.length > 0 && <span>{ancestorParts.join(' → ')} {'→ '}</span>}
          <span style={{ fontWeight: '600' }}>{inst.concept_name}</span>
        </div>
        {snippet && <div style={styles.instanceSnippet}>{snippet}</div>}
      </div>
    );
  };

  const renderAddForm = () => (
    <div style={styles.addForm}>
      <input
        type="text"
        value={newUrl}
        onChange={(e) => { setNewUrl(e.target.value); setAddError(null); if (unsafeUrl && e.target.value.trim() !== unsafeUrlValue) { setUnsafeUrl(false); setUnsafeUrlValue(''); } }}
        onBlur={() => fetchTitlePreview(newUrl)}
        onPaste={(e) => { const pasted = e.clipboardData.getData('text'); setTimeout(() => fetchTitlePreview(pasted), 0); }}
        placeholder="https://..."
        style={styles.input}
      />
      {unsafeUrl && <div style={styles.unsafeUrlError}>This URL was flagged by Google Safe Browsing as potentially unsafe. It cannot be posted to Orca.</div>}
      {!unsafeUrl && previewLoading && <div style={styles.previewStatus}>Fetching title...</div>}
      {!unsafeUrl && previewError && <div style={styles.previewStatus}>Couldn't fetch title — you can enter one manually</div>}
      {!unsafeUrl && previewResult && !previewLoading && <div style={styles.previewBox}>{previewResult}</div>}
      <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title (optional — auto-fetched if empty)" style={styles.input} />
      <textarea value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Comment (optional)" style={styles.textarea} rows={2} />
      {addError && <div style={styles.formError}>{addError}</div>}
      <label style={styles.affirmLabel}>
        <input type="checkbox" checked={affirmed} onChange={(e) => setAffirmed(e.target.checked)} style={styles.affirmCheckbox} />
        <span style={styles.affirmText}>
          I affirm this URL points to content that is publicly available through legitimate means (e.g., open access publication, the publisher's website, an institutional or preprint repository), and that posting this link does not violate any agreement, embargo, or known prohibition.
        </span>
      </label>
      <div style={styles.formButtons}>
        <button
          type="button"
          disabled={!(affirmed && !unsafeUrl)}
          onClick={affirmed && !unsafeUrl ? handleAdd : undefined}
          style={affirmed && !unsafeUrl ? styles.saveBtn : { ...styles.saveBtn, opacity: 0.4, cursor: 'default' }}
        >Add</button>
        <button type="button" onClick={resetAddForm} style={styles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );

  // Expand control: the "Show N more links" affordance (card mode and page mode),
  // plus an add affordance on the own page when there is nothing to expand.
  const canExpandMore = moreCount > 0;
  const showAddOnlyExpander = !canExpandMore && eager && allowAddLink;

  // Nothing to show at all (no preview, no expander): render nothing (readers of
  // an empty question in a card, or guests on a question with no links).
  if (!previewLink && !canExpandMore && !showAddOnlyExpander) return null;

  return (
    <div style={styles.wrap} onClick={(e) => e.stopPropagation()}>
      {!expanded && previewLink && (
        <div style={styles.preview}>
          <a href={previewLink.url} target="_blank" rel="noopener noreferrer" style={styles.previewTitle}>
            {previewLink.title || previewLink.url}
          </a>
          {previewLink.comment && (
            <LinkifiedText text={previewLink.comment} lines={1} style={styles.previewComment} />
          )}
          <div style={styles.previewBottom}>
            <button
              type="button"
              onClick={handlePreviewVote}
              style={{ ...styles.voteBtn, ...(previewLink.userVoted ? styles.voteBtnActive : {}) }}
              title={isGuest ? 'Log in to vote on links' : (previewLink.userVoted ? 'Remove vote' : 'Upvote')}
            >{'▲'} {previewLink.voteCount}</button>
            <span style={styles.previewMeta}>
              {previewLink.addedByUsername}{previewLink.authorOrcidId && <OrcidBadge orcidId={previewLink.authorOrcidId} />}
            </span>
          </div>
        </div>
      )}

      {!expanded && (canExpandMore || showAddOnlyExpander) && (
        <div style={styles.expandRow}>
          <button type="button" onClick={handleExpand} style={styles.expandBtn}>
            {canExpandMore
              ? `Show ${moreCount} more link${moreCount === 1 ? '' : 's'}`
              : 'Add a link'}
          </button>
        </div>
      )}

      {expanded && (
        <div style={styles.expandedList}>
          <div style={styles.listTopRow}>
            <div style={styles.sortBar}>
              <span style={styles.sortLabel}>Sort:</span>
              {['top', 'new'].map((key, i) => (
                <React.Fragment key={key}>
                  {i > 0 && <span style={styles.sortSep}>{'·'}</span>}
                  <button type="button" onClick={() => setSort(key)} style={sort === key ? styles.sortOptionActive : styles.sortOption}>
                    {key === 'top' ? 'Top' : 'New'}
                  </button>
                </React.Fragment>
              ))}
            </div>
            <button type="button" onClick={handleCollapse} style={styles.expandBtn}>Show fewer</button>
          </div>
          {allowAddLink && (
            showAddForm ? renderAddForm() : (
              <div style={styles.addRow}>
                <button type="button" onClick={() => setShowAddForm(true)} style={styles.addBtn}>+ Add Link</button>
              </div>
            )
          )}
          {linksLoading && (!webLinks || webLinks.length === 0) ? (
            <p style={styles.placeholder}>Loading...</p>
          ) : (webLinks && webLinks.length === 0) ? (
            <p style={styles.placeholder}>No links yet</p>
          ) : (
            (webLinks || []).map((link, idx) => (
              <LinkCard
                key={link.id}
                link={link}
                user={user}
                isGuest={isGuest}
                isFirst={idx === 0}
                votingAllowed
                onVoteToggle={handleListVote}
                showInstances
                instanceData={instanceData[link.id]}
                onToggleInstance={toggleInstanceExpansion}
                renderInstanceSnippet={renderInstanceSnippet}
                cardRef={(el) => { linkRefs.current[link.id] = el; }}
                onRequestLogin={onRequestLogin}
                conceptId={conceptId}
                conceptPath={path}
                voteSets={voteSets}
                onCopySuccess={handleListChanged}
                onRemoveSuccess={handleListChanged}
                onAddendumSuccess={handleListChanged}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
};

const FONT = '"EB Garamond", Georgia, serif';

const styles = {
  wrap: { borderTop: '1px solid #eee', padding: '12px 20px', backgroundColor: '#fafafa', fontFamily: FONT, cursor: 'default' },
  preview: { display: 'flex', flexDirection: 'column', gap: '3px' },
  previewTitle: { fontSize: '14px', color: '#333', textDecoration: 'underline', fontFamily: FONT, fontWeight: '500', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  previewComment: { fontSize: '13px', color: '#555', fontFamily: FONT, lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  previewBottom: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' },
  previewMeta: { fontSize: '12px', color: '#aaa', fontFamily: FONT, display: 'inline-flex', alignItems: 'center', gap: '4px' },
  voteBtn: { fontSize: '12px', color: '#888', cursor: 'pointer', fontFamily: FONT, border: '1px solid #ddd', borderRadius: '4px', padding: '2px 8px', backgroundColor: '#f0f0f0' },
  voteBtnActive: { backgroundColor: '#333', color: '#faf9f6', borderColor: '#333' },
  expandRow: { marginTop: '8px' },
  expandBtn: { fontSize: '13px', color: '#777', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  expandedList: { display: 'flex', flexDirection: 'column' },
  listTopRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' },
  sortBar: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' },
  sortLabel: { fontSize: '12px', color: '#999', fontFamily: FONT },
  sortOption: { color: '#999', cursor: 'pointer', fontFamily: FONT, border: 'none', background: 'none', padding: 0, fontSize: '13px', borderBottom: '1px solid transparent' },
  sortOptionActive: { color: '#333', cursor: 'pointer', fontFamily: FONT, border: 'none', background: 'none', padding: 0, fontSize: '13px', borderBottom: '1px solid #333' },
  sortSep: { color: '#ccc' },
  placeholder: { fontSize: '14px', color: '#999', margin: '4px 0' },
  addRow: { marginBottom: '8px' },
  addBtn: { fontSize: '13px', color: '#999', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  addForm: { marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' },
  input: { width: '100%', fontFamily: FONT, fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', fontFamily: FONT, fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  formError: { fontSize: '12px', color: '#c44', fontFamily: FONT },
  unsafeUrlError: { fontSize: '12px', color: '#c44', fontFamily: FONT, backgroundColor: '#fdf0f0', padding: '8px 10px', borderRadius: '3px', lineHeight: 1.4 },
  previewStatus: { fontSize: '11px', color: '#999', fontFamily: FONT },
  previewBox: { fontSize: '12px', color: '#555', fontFamily: FONT, backgroundColor: '#f0ede8', padding: '6px 8px', borderRadius: '3px', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  affirmLabel: { display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', marginTop: '4px' },
  affirmCheckbox: { marginTop: '3px', flexShrink: 0 },
  affirmText: { fontSize: '11px', color: '#666', fontFamily: FONT, lineHeight: 1.4 },
  formButtons: { display: 'flex', gap: '10px', marginTop: '4px' },
  saveBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: FONT, border: '1px solid #e0d9cf', padding: '2px 10px', borderRadius: '3px', backgroundColor: '#faf9f6' },
  cancelBtn: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: FONT, border: 'none', background: 'none', padding: 0 },
  instanceRow: { cursor: 'pointer', padding: '4px 6px', borderRadius: '3px', fontSize: '12px', color: '#555', transition: 'background-color 0.15s' },
  instancePath: { color: '#555', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  instanceSnippet: { fontSize: '11px', color: '#999', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
};

export default CardLinksSection;
