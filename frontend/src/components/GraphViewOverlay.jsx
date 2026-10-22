import React, { useState, useEffect, useRef, useMemo } from 'react';
import { conceptsAPI } from '../services/api';
import ClampedText from './ClampedText';

/**
 * GraphViewOverlay — Phase 72d: the whole graph as a collapsible tree.
 *
 * Full-pane overlay (styled like VotesOverlay). Opened from the page header in
 * both community modes, guests included. Scope is one root's graph (when
 * rootConceptId is given) or the whole community. Question rows navigate the
 * current tab to that question and close the overlay; a per-branch ▸/▾ toggle
 * (its own button, separate from the question text) expands/collapses without
 * navigating. Curated communities nest each question's answers as rows; open
 * communities show a muted "N links" count.
 *
 * Props:
 *   onBack           — close the overlay
 *   communityId      — active community
 *   rootConceptId    — graph_path[0] of the current question (or the concept
 *                      itself if it is a root); null → every root in the community
 *   currentConceptId — the question the overlay was opened from (for highlight), or null
 *   currentPath      — that question's graph_path (root-to-parent inclusive), or []
 *   onNavigate       — (conceptId, path, name) => void; navigates the current tab
 */
const EXPAND_ALL_THRESHOLD = 150;

const GraphViewOverlay = ({
  onBack,
  communityId,
  rootConceptId = null,
  currentConceptId = null,
  currentPath = [],
  onNavigate,
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());
  const genRef = useRef(0); // Stale-state guard
  const currentRowRef = useRef(null);

  // ─── Fetch (stale-state guarded) ───────────────────────────
  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await conceptsAPI.getGraph(communityId, rootConceptId);
        if (gen !== genRef.current) return;
        setData(res.data);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError('Failed to load the graph');
        console.error('Failed to load graph:', err);
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
    })();
  }, [communityId, rootConceptId]);

  // ─── Escape closes ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const curated = data?.mode === 'curated';
  const nodes = data?.nodes || [];

  // ─── Tree structure (memoized) ─────────────────────────────
  const { roots, childrenByParent, nodeByEdge, currentEdgeId, collapsible } = useMemo(() => {
    const nodeByEdge = new Map(nodes.map((n) => [n.edgeId, n]));
    const childrenByParent = new Map();
    const roots = [];
    for (const n of nodes) {
      const p = n.parentEdgeId;
      if (p == null || !nodeByEdge.has(p)) {
        roots.push(n);
      } else {
        if (!childrenByParent.has(p)) childrenByParent.set(p, []);
        childrenByParent.get(p).push(n);
      }
    }

    const cmp = curated
      ? (a, b) => {
          // Phase 72b recency: open questions (null sortDate) first by newest
          // created; then answered by sortDate desc, then created desc.
          const ra = a.sortDate, rb = b.sortDate;
          const aOpen = !ra, bOpen = !rb;
          if (aOpen !== bOpen) return aOpen ? -1 : 1;
          if (!aOpen && !bOpen && ra !== rb) return ra < rb ? 1 : -1;
          if (a.createdAt < b.createdAt) return 1;
          if (a.createdAt > b.createdAt) return -1;
          return 0;
        }
      : (a, b) => {
          // Open: save count desc, then newest.
          const sa = a.saveCount || 0, sb = b.saveCount || 0;
          if (sa !== sb) return sb - sa;
          if (a.createdAt < b.createdAt) return 1;
          if (a.createdAt > b.createdAt) return -1;
          return 0;
        };
    roots.sort(cmp);
    for (const list of childrenByParent.values()) list.sort(cmp);

    // The edge the overlay was opened from (for highlight / expansion), matched
    // by concept + its graph_path (root-to-parent inclusive).
    let currentEdgeId = null;
    if (currentConceptId != null) {
      const key = (currentPath || []).join(',');
      for (const n of nodes) {
        if (n.conceptId === currentConceptId && (n.graphPath || []).join(',') === key) {
          currentEdgeId = n.edgeId;
          break;
        }
      }
    }

    // Edges that have something to collapse (child questions, or answers in
    // curated communities).
    const collapsible = new Set();
    for (const n of nodes) {
      const hasKids = (childrenByParent.get(n.edgeId) || []).length > 0;
      const hasAnswers = curated && (n.answers || []).length > 0;
      if (hasKids || hasAnswers) collapsible.add(n.edgeId);
    }

    return { roots, childrenByParent, nodeByEdge, currentEdgeId, collapsible };
  }, [nodes, curated, currentConceptId, currentPath]);

  // ─── Initial expansion (runs once per fetch) ───────────────
  useEffect(() => {
    if (!data) return;
    if (nodes.length <= EXPAND_ALL_THRESHOLD) {
      setCollapsedNodes(new Set()); // everything expanded
      return;
    }
    // Large graph: collapse everything, then open the ancestor chain down to
    // the current question so it is visible (below the current path stays
    // collapsed). Opened from the root page (no current) → only roots visible.
    const collapsed = new Set(collapsible);
    if (currentEdgeId != null) {
      let p = nodeByEdge.get(currentEdgeId)?.parentEdgeId;
      while (p != null && nodeByEdge.has(p)) {
        collapsed.delete(p);
        p = nodeByEdge.get(p).parentEdgeId;
      }
    }
    setCollapsedNodes(collapsed);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Scroll the current question into view once rendered ───
  useEffect(() => {
    if (!data || currentEdgeId == null) return;
    const t = setTimeout(() => {
      if (currentRowRef.current) {
        currentRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
    return () => clearTimeout(t);
  }, [data, currentEdgeId, collapsedNodes]);

  const toggleCollapse = (edgeId) => {
    setCollapsedNodes((prev) => {
      const next = new Set(prev);
      next.has(edgeId) ? next.delete(edgeId) : next.add(edgeId);
      return next;
    });
  };

  const expandAll = () => setCollapsedNodes(new Set());
  const collapseAll = () => setCollapsedNodes(new Set(collapsible));

  const handleQuestionClick = (node) => {
    if (onNavigate) onNavigate(node.conceptId, node.graphPath || [], node.name);
    onBack();
  };

  // ─── Render one question node (and its answers + children) ─
  const renderNode = (node, depth = 0) => {
    const kids = childrenByParent.get(node.edgeId) || [];
    const answers = curated ? (node.answers || []) : [];
    const hasBranch = kids.length > 0 || answers.length > 0;
    const isCollapsed = collapsedNodes.has(node.edgeId);
    const isCurrent = node.edgeId === currentEdgeId;
    const isRoot = depth === 0;

    return (
      <div key={node.edgeId} style={{ marginLeft: isRoot ? 0 : 24 }}>
        <div
          ref={isCurrent ? currentRowRef : null}
          style={{
            ...styles.nodeRow,
            ...(isRoot ? styles.rootNodeRow : {}),
            ...(isCurrent ? styles.currentRow : {}),
          }}
        >
          {hasBranch ? (
            <button
              onClick={() => toggleCollapse(node.edgeId)}
              style={styles.collapseButton}
              title={isCollapsed ? 'Expand' : 'Collapse'}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span style={styles.collapseButtonPlaceholder}>{'·'}</span>
          )}
          <button
            style={{ ...styles.conceptName, ...(isRoot ? styles.rootConceptName : {}) }}
            onClick={() => handleQuestionClick(node)}
            title={`Open ${node.name}`}
          >
            {node.name}
          </button>
          {!curated && node.linkCount > 0 && (
            <span style={styles.linkCount}>
              {node.linkCount} link{node.linkCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {hasBranch && !isCollapsed && (
          <div style={styles.childrenContainer}>
            {/* Curated: answers nested under their question. */}
            {answers.length > 0 && (
              <div style={{ marginLeft: 24 }}>
                {answers.map((ans) => (
                  <div key={ans.id} style={styles.answerRow}>
                    <span style={styles.answerIcon}>{'↗'}</span>
                    <div style={styles.answerContent}>
                      <div style={styles.answerTitleRow}>
                        <a
                          href={ans.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={styles.answerTitle}
                          title={ans.url}
                        >
                          {ans.title || ans.url}
                        </a>
                        {ans.publishedOn && (
                          <span style={styles.answerDate}>{ans.publishedOn}</span>
                        )}
                      </div>
                      {ans.comment && (
                        <ClampedText text={ans.comment} lines={2} style={styles.answerComment} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {kids.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>{'←'} Back</button>
          <h2 style={styles.heading}>Graph</h2>
        </div>
        <div style={styles.loading}>Loading graph...</div>
      </div>
    );
  }

  const isEmpty = nodes.length === 0;

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>{'←'} Back</button>
        <h2 style={styles.heading}>Graph</h2>
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      {isEmpty ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>This graph has no questions yet.</p>
        </div>
      ) : (
        <div style={styles.main}>
          <div style={styles.toolbar}>
            <span style={styles.countLabel}>
              {nodes.length} question{nodes.length !== 1 ? 's' : ''}
            </span>
            <div style={styles.toolbarButtons}>
              <button onClick={collapseAll} style={styles.toolbarButton}>Collapse all</button>
              <button onClick={expandAll} style={styles.toolbarButton}>Expand all</button>
            </div>
          </div>
          {data.truncated && (
            <div style={styles.truncationNote}>
              This graph is large; only the first {nodes.length} questions are shown.
            </div>
          )}
          <div style={styles.treesContainer}>
            {roots.map((tree) => (
              <div key={tree.edgeId} style={styles.treeCard}>
                {renderNode(tree)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const styles = {
  // position/zIndex: own stacking context above the fixed Add / Search bar
  // (z 1000), so the overlay is never underlapped by it (Phase 72e-1 fix 3).
  container: { minHeight: '100%', backgroundColor: '#faf9f7', position: 'relative', zIndex: 10050 },
  headerBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px 0 20px', maxWidth: '1200px', margin: '0 auto' },
  backButton: { padding: '6px 12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif', color: '#555' },
  heading: { margin: 0, fontSize: '22px', fontFamily: '"EB Garamond", Georgia, serif', fontWeight: '600', color: '#333' },
  loading: { textAlign: 'center', padding: '60px', fontSize: '15px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif' },
  errorBar: { padding: '12px 20px', backgroundColor: '#fee', color: '#c33', maxWidth: '1200px', margin: '12px auto 0', borderRadius: '4px', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif' },
  emptyState: { textAlign: 'center', padding: '80px 20px', maxWidth: '1200px', margin: '0 auto' },
  emptyText: { fontSize: '20px', color: '#666', fontFamily: '"EB Garamond", Georgia, serif', marginBottom: '8px' },
  main: { maxWidth: '1200px', margin: '0 auto', padding: '24px 20px' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  countLabel: { fontSize: '14px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif' },
  toolbarButtons: { display: 'flex', gap: '8px' },
  toolbarButton: { padding: '6px 14px', backgroundColor: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', color: '#555', fontFamily: '"EB Garamond", Georgia, serif' },
  truncationNote: { fontSize: '13px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif', marginBottom: '12px' },
  treesContainer: { display: 'flex', flexDirection: 'column', gap: '16px' },
  treeCard: { backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '20px', overflow: 'hidden' },
  nodeRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', borderRadius: '4px' },
  rootNodeRow: { paddingBottom: '10px', marginBottom: '4px', borderBottom: '1px solid #eee' },
  currentRow: { backgroundColor: '#f3eeda' },
  collapseButton: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#999', padding: '0 4px', lineHeight: 1, flexShrink: 0, width: '20px', textAlign: 'center', fontFamily: '"EB Garamond", Georgia, serif' },
  collapseButtonPlaceholder: { fontSize: '14px', color: '#ccc', padding: '0 4px', width: '20px', textAlign: 'center', display: 'inline-block', flexShrink: 0 },
  conceptName: { fontSize: '15px', fontFamily: '"EB Garamond", Georgia, serif', color: '#333', cursor: 'pointer', flex: 1, lineHeight: 1.4, background: 'none', border: 'none', textAlign: 'left', padding: 0 },
  rootConceptName: { fontSize: '18px', fontWeight: '600' },
  linkCount: { fontSize: '13px', color: '#888', flexShrink: 0, fontFamily: '"EB Garamond", Georgia, serif' },
  childrenContainer: { borderLeft: '1px solid #e8e8e8', marginLeft: '10px' },
  answerRow: { display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '4px 8px', marginBottom: '2px', borderRadius: '3px' },
  answerIcon: { fontSize: '12px', color: '#999', flexShrink: 0, marginTop: '3px' },
  answerContent: { flex: 1, minWidth: 0 },
  answerTitleRow: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
  answerTitle: { fontSize: '13px', fontFamily: '"EB Garamond", Georgia, serif', color: '#444', textDecoration: 'underline', wordBreak: 'break-word' },
  answerDate: { fontSize: '12px', color: '#999', flexShrink: 0, fontFamily: '"EB Garamond", Georgia, serif' },
  answerComment: { fontSize: '12px', fontFamily: '"EB Garamond", Georgia, serif', color: '#888', lineHeight: 1.35, marginTop: '2px', wordBreak: 'break-word' },
};

export default GraphViewOverlay;
