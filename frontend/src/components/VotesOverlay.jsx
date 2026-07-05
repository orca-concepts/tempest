import React, { useState, useEffect, useRef } from 'react';
import { votesAPI } from '../services/api';
import ClampedText from './ClampedText';

/**
 * VotesOverlay — Phase 59b: Unified Votes page replacing SavedPageOverlay + LinkVotesOverlay.
 *
 * AD: Display-only. No remove affordance. Click-to-navigate only.
 * AD: Link-voted edges without a save vote appear with full ancestry as context rows.
 *
 * Props:
 *   onBack            — close overlay
 *   onOpenConceptTab  — (conceptId, path, conceptName, attributeName) => void
 *   onNavigateToLink  — (conceptId, path, conceptName, attributeName, scrollToLinkId) => void
 */
const VotesOverlay = ({ onBack, onOpenConceptTab, onNavigateToLink }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsedNodes, setCollapsedNodes] = useState(new Set());
  const genRef = useRef(0); // Stale-state guard

  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await votesAPI.getAllVotes();
        if (gen !== genRef.current) return;
        setData(res.data);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError('Failed to load votes');
        console.error('Failed to load votes:', err);
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
    })();
  }, []);

  const handleEdgeClick = (edge) => {
    const path = edge.parentId === null ? [] : edge.graphPath;
    onOpenConceptTab(edge.childId, path, edge.childName, edge.attributeName);
    onBack();
  };

  const handleLinkClick = (linkVote) => {
    if (onNavigateToLink) {
      onNavigateToLink(
        linkVote.edgeConceptId,
        linkVote.edgePath || [],
        linkVote.edgeConceptName,
        linkVote.edgeAttributeName,
        linkVote.conceptLinkId
      );
      onBack();
    }
  };

  const toggleCollapse = (nodeKey) => {
    setCollapsedNodes(prev => {
      const next = new Set(prev);
      next.has(nodeKey) ? next.delete(nodeKey) : next.add(nodeKey);
      return next;
    });
  };

  const collapseAll = () => {
    if (!data) return;
    const keys = new Set();
    const collect = (node) => {
      const nodeKey = `${node.edgeId}`;
      const hasChildren = (node.children && node.children.length > 0) || (node.linkVotes && node.linkVotes.length > 0);
      if (hasChildren) {
        keys.add(nodeKey);
        if (node.children) node.children.forEach(collect);
      }
    };
    buildTrees().forEach(collect);
    setCollapsedNodes(keys);
  };

  const expandAll = () => setCollapsedNodes(new Set());

  // Build hierarchical tree from all edges
  const buildTrees = () => {
    if (!data) return [];
    const { savedEdges, contextEdges, ancestorEdges, linkVotes } = data;
    const allEdges = [...savedEdges, ...contextEdges, ...ancestorEdges];

    // Deduplicate by edgeId (savedEdges takes priority over context/ancestor)
    const edgeMap = new Map();
    for (const e of allEdges) {
      if (!edgeMap.has(e.edgeId)) {
        edgeMap.set(e.edgeId, { ...e });
      } else if (!e.isContextOnly) {
        // Saved edge overrides context-only
        edgeMap.set(e.edgeId, { ...e });
      }
    }

    // Group link votes by edgeId
    const linksByEdge = {};
    for (const lv of linkVotes) {
      if (!linksByEdge[lv.edgeId]) linksByEdge[lv.edgeId] = [];
      linksByEdge[lv.edgeId].push(lv);
    }

    // Attach linkVotes to edges
    for (const edge of edgeMap.values()) {
      edge.linkVotes = linksByEdge[edge.edgeId] || [];
    }

    // Build parent-children map
    const rootEdges = [];
    const childrenMap = {};
    for (const edge of edgeMap.values()) {
      if (edge.parentId === null) {
        rootEdges.push(edge);
      } else {
        const key = `${edge.parentId}-${JSON.stringify(edge.graphPath)}`;
        if (!childrenMap[key]) childrenMap[key] = [];
        childrenMap[key].push(edge);
      }
    }

    const buildNode = (edge) => {
      const childPath = edge.parentId === null
        ? [edge.childId] : [...edge.graphPath, edge.childId];
      const childKey = `${edge.childId}-${JSON.stringify(childPath)}`;
      const childEdges = childrenMap[childKey] || [];
      childEdges.sort((a, b) => b.voteCount - a.voteCount);
      return { ...edge, children: childEdges.map(buildNode) };
    };

    const trees = rootEdges.map(buildNode);
    trees.sort((a, b) => getTotalVoteCount(b) - getTotalVoteCount(a));
    return trees;
  };

  const getTotalVoteCount = (node) => {
    let total = node.voteCount || 0;
    if (node.children) node.children.forEach(child => { total += getTotalVoteCount(child); });
    return total;
  };

  // Check if a node or any descendant has user save votes or link votes
  const hasUserContent = (node) => {
    if (!node.isContextOnly) return true;
    if (node.linkVotes && node.linkVotes.length > 0) return true;
    if (node.children) return node.children.some(hasUserContent);
    return false;
  };

  const renderNode = (node, depth = 0) => {
    const nodeKey = `${node.edgeId}`;
    const isCollapsed = collapsedNodes.has(nodeKey);
    const hasChildren = (node.children && node.children.length > 0) || (node.linkVotes && node.linkVotes.length > 0);
    const isRoot = node.parentId === null;

    return (
      <div key={nodeKey} style={{ marginLeft: isRoot ? 0 : 24 }}>
        <div style={{ ...styles.nodeRow, ...(isRoot ? styles.rootNodeRow : {}) }}>
          {hasChildren ? (
            <button onClick={() => toggleCollapse(nodeKey)} style={styles.collapseButton}
              title={isCollapsed ? 'Expand' : 'Collapse'}>
              {isCollapsed ? '\u25B8' : '\u25BE'}
            </button>
          ) : (
            <span style={styles.collapseButtonPlaceholder}>{'\u00B7'}</span>
          )}
          {/* Saved indicator: filled bookmark for saved, empty for context-only */}
          <span style={node.isContextOnly ? styles.contextIndicator : styles.savedIndicator}
            title={node.isContextOnly ? 'Context (not saved)' : 'Saved'}>
            {node.isContextOnly ? '\u25CB' : '\u25CF'}
          </span>
          <span
            style={{ ...styles.conceptName, ...(isRoot ? styles.rootConceptName : {}) }}
            onClick={() => handleEdgeClick(node)}
            title={`Click to open ${node.childName}`}
          >
            {node.childName}
          </span>
          {isRoot && node.attributeName && (
            <span style={styles.attributeBadge}>{node.attributeName}</span>
          )}
          <span style={styles.voteCount}>{'\u25B2'} {node.voteCount}</span>
          {node.swapCount > 0 && (
            <span style={styles.swapIndicator} title={`${node.swapCount} swap vote(s)`}>
              {'\u21C4'} {node.swapCount}
            </span>
          )}
        </div>
        {hasChildren && !isCollapsed && (
          <div style={styles.childrenContainer}>
            {/* Link votes under this edge */}
            {node.linkVotes && node.linkVotes.length > 0 && (
              <div style={{ marginLeft: 24 }}>
                {node.linkVotes.map(lv => (
                  <div
                    key={lv.conceptLinkId}
                    style={styles.linkRow}
                    onClick={() => handleLinkClick(lv)}
                    title="Click to navigate and highlight this link"
                  >
                    <span style={styles.linkIcon}>{'\u2197'}</span>
                    <div style={styles.linkContent}>
                      <div style={styles.linkTitle}>{lv.title || lv.url}</div>
                      {lv.comment && (
                        <ClampedText text={lv.comment} lines={2} style={styles.linkComment} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {/* Child edges */}
            {node.children && node.children.map(child => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.headerBar}>
          <button onClick={onBack} style={styles.backButton}>{'\u2190'} Back</button>
          <h2 style={styles.heading}>Votes</h2>
        </div>
        <div style={styles.loading}>Loading votes...</div>
      </div>
    );
  }

  const trees = buildTrees();
  const savedCount = data ? data.savedEdges.length : 0;
  const linkVoteCount = data ? data.linkVotes.length : 0;
  const isEmpty = savedCount === 0 && linkVoteCount === 0;

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>{'\u2190'} Back</button>
        <h2 style={styles.heading}>Votes</h2>
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      {isEmpty ? (
        <div style={styles.emptyState}>
          <p style={styles.emptyText}>No votes yet.</p>
          <p style={styles.emptySubtext}>
            Save questions with the {'\u25B2'} button or upvote links on question pages.
          </p>
        </div>
      ) : (
        <div style={styles.main}>
          <div style={styles.toolbar}>
            <span style={styles.savedCount}>
              {savedCount} graph vote{savedCount !== 1 ? 's' : ''}
              {linkVoteCount > 0 && `, ${linkVoteCount} link vote${linkVoteCount !== 1 ? 's' : ''}`}
            </span>
            {trees.length > 0 && (
              <div style={styles.toolbarButtons}>
                <button onClick={collapseAll} style={styles.toolbarButton}>Collapse All</button>
                <button onClick={expandAll} style={styles.toolbarButton}>Expand All</button>
              </div>
            )}
          </div>
          <div style={styles.treesContainer}>
            {trees.filter(hasUserContent).map(tree => (
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
  container: { minHeight: '100%', backgroundColor: '#faf9f7' },
  headerBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px 0 20px', maxWidth: '1200px', margin: '0 auto' },
  backButton: { padding: '6px 12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif', color: '#555' },
  heading: { margin: 0, fontSize: '22px', fontFamily: '"EB Garamond", Georgia, serif', fontWeight: '600', color: '#333' },
  loading: { textAlign: 'center', padding: '60px', fontSize: '15px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif' },
  errorBar: { padding: '12px 20px', backgroundColor: '#fee', color: '#c33', maxWidth: '1200px', margin: '12px auto 0', borderRadius: '4px', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif' },
  emptyState: { textAlign: 'center', padding: '80px 20px', maxWidth: '1200px', margin: '0 auto' },
  emptyText: { fontSize: '20px', color: '#666', fontFamily: '"EB Garamond", Georgia, serif', marginBottom: '8px' },
  emptySubtext: { fontSize: '15px', color: '#999', fontFamily: '"EB Garamond", Georgia, serif', maxWidth: '500px', margin: '0 auto', lineHeight: 1.6 },
  main: { maxWidth: '1200px', margin: '0 auto', padding: '24px 20px' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  savedCount: { fontSize: '14px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif' },
  toolbarButtons: { display: 'flex', gap: '8px' },
  toolbarButton: { padding: '6px 14px', backgroundColor: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', color: '#555', fontFamily: '"EB Garamond", Georgia, serif' },
  treesContainer: { display: 'flex', flexDirection: 'column', gap: '16px' },
  treeCard: { backgroundColor: 'white', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', padding: '20px', overflow: 'hidden' },
  nodeRow: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', borderRadius: '4px' },
  rootNodeRow: { paddingBottom: '10px', marginBottom: '4px', borderBottom: '1px solid #eee' },
  collapseButton: { background: 'none', border: 'none', cursor: 'pointer', fontSize: '14px', color: '#999', padding: '0 4px', lineHeight: 1, flexShrink: 0, width: '20px', textAlign: 'center' },
  collapseButtonPlaceholder: { fontSize: '14px', color: '#ccc', padding: '0 4px', width: '20px', textAlign: 'center', display: 'inline-block', flexShrink: 0 },
  savedIndicator: { fontSize: '10px', color: '#333', flexShrink: 0, lineHeight: 1 },
  contextIndicator: { fontSize: '10px', color: '#ccc', flexShrink: 0, lineHeight: 1 },
  conceptName: { fontSize: '15px', fontFamily: '"EB Garamond", Georgia, serif', color: '#333', cursor: 'pointer', flex: 1, lineHeight: 1.4 },
  rootConceptName: { fontSize: '18px', fontWeight: '600' },
  attributeBadge: { display: 'inline-block', padding: '1px 7px', background: '#e8f4f8', borderRadius: '4px', fontSize: '11px', color: '#555', flexShrink: 0 },
  voteCount: { fontSize: '13px', color: '#888', flexShrink: 0, fontFamily: '"EB Garamond", Georgia, serif' },
  swapIndicator: { fontSize: '13px', color: '#8050b0', flexShrink: 0, fontFamily: '"EB Garamond", Georgia, serif' },
  childrenContainer: { borderLeft: '1px solid #e8e8e8', marginLeft: '10px' },
  linkRow: { display: 'flex', alignItems: 'flex-start', gap: '6px', padding: '4px 8px', marginBottom: '2px', cursor: 'pointer', borderRadius: '3px', transition: 'background-color 0.15s' },
  linkIcon: { fontSize: '12px', color: '#999', flexShrink: 0, marginTop: '2px' },
  linkContent: { flex: 1, minWidth: 0 },
  linkTitle: { fontSize: '13px', fontFamily: '"EB Garamond", Georgia, serif', color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  linkComment: { fontSize: '12px', fontFamily: '"EB Garamond", Georgia, serif', color: '#888', lineHeight: 1.3, marginTop: '2px', wordBreak: 'break-word' },
};

export default VotesOverlay;
