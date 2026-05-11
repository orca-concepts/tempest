import React, { useState, useEffect, useRef, useCallback } from 'react';
import { conceptsAPI, votesAPI } from '../services/api';

const CopyLinkPicker = ({ link, conceptId, conceptPath, onClose, onCopySuccess }) => {
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState(null);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState(null);
  const requestIdRef = useRef(0);

  const loadSubtree = useCallback(async () => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await conceptsAPI.getSubtree(conceptId, (conceptPath || []).join(','));
      if (myRequestId !== requestIdRef.current) return;
      setTree(res.data.edges || []);
      setTruncated(res.data.truncated || false);
    } catch {
      if (myRequestId !== requestIdRef.current) return;
      setError('Failed to load descendants');
      setTree([]);
    } finally {
      if (myRequestId === requestIdRef.current) setLoading(false);
    }
  }, [conceptId, conceptPath]);

  useEffect(() => { loadSubtree(); }, [loadSubtree]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.document.addEventListener('keydown', handleKey);
    return () => window.document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Build tree structure: group edges by parent_id
  const childrenOf = (parentId) => tree.filter(e => e.parent_id === parentId);
  const roots = childrenOf(conceptId);

  const toggleExpand = (edgeId) => {
    setExpanded(prev => ({ ...prev, [edgeId]: !prev[edgeId] }));
  };

  const handleCopy = async () => {
    if (!selected) return;
    setCopying(true);
    setCopyError(null);
    try {
      await votesAPI.copyWebLink(link.id, selected.edge_id);
      if (onCopySuccess) onCopySuccess(selected.concept_name);
      onClose();
    } catch (err) {
      setCopyError(err.response?.data?.error || 'Failed to copy link');
    } finally {
      setCopying(false);
    }
  };

  const renderNode = (edge, depth = 0) => {
    const children = childrenOf(edge.child_id);
    const hasChildren = children.length > 0;
    const isExpanded = expanded[edge.edge_id];
    const isSelected = selected?.edge_id === edge.edge_id;

    return (
      <div key={edge.edge_id}>
        <div
          style={{
            ...styles.node,
            paddingLeft: 12 + depth * 20,
            backgroundColor: isSelected ? '#f0ece4' : 'transparent',
          }}
          onClick={() => setSelected(edge)}
          onMouseEnter={e => { if (!isSelected) e.currentTarget.style.backgroundColor = '#faf5ed'; }}
          onMouseLeave={e => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span
            style={{ ...styles.chevron, visibility: hasChildren ? 'visible' : 'hidden' }}
            onClick={(e) => { e.stopPropagation(); toggleExpand(edge.edge_id); }}
          >
            {isExpanded ? '\u25be' : '\u25b8'}
          </span>
          <span style={styles.nodeName}>{edge.concept_name}</span>
          {edge.attribute_name && <span style={styles.attrBadge}>[{edge.attribute_name}]</span>}
        </div>
        {isExpanded && hasChildren && children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <span style={styles.title}>Copy link to descendant</span>
          <span style={styles.closeBtn} onClick={onClose}>{'\u2715'}</span>
        </div>
        <div style={styles.linkPreview}>
          <div style={styles.linkTitle}>{link.title || link.url}</div>
          <div style={styles.linkUrl}>{link.url}</div>
        </div>

        {loading ? (
          <div style={styles.status}>Loading descendants...</div>
        ) : error ? (
          <div style={styles.status}>{error}</div>
        ) : roots.length === 0 ? (
          <div style={styles.status}>No descendants found</div>
        ) : (
          <>
            {truncated && <div style={styles.truncationNotice}>Showing first 500 descendants. Deeper nodes may be omitted.</div>}
            <div style={styles.treeContainer}>
              {roots.map(edge => renderNode(edge))}
            </div>
          </>
        )}

        {copyError && <div style={styles.copyError}>{copyError}</div>}

        <div style={styles.footer}>
          <span onClick={onClose} style={styles.cancelBtn}>Cancel</span>
          <span
            onClick={selected && !copying ? handleCopy : undefined}
            style={selected && !copying ? styles.confirmBtn : styles.confirmBtnDisabled}
          >
            {copying ? 'Copying...' : 'Copy here'}
          </span>
        </div>
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)', zIndex: 10000,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    backgroundColor: '#faf9f6', borderRadius: '6px', border: '1px solid #d4d0c8',
    width: '460px', maxWidth: '90vw', maxHeight: '70vh', display: 'flex', flexDirection: 'column',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
  },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 16px', borderBottom: '1px solid #e0d9cf',
  },
  title: { fontSize: '16px', fontFamily: '"EB Garamond", Georgia, serif', fontWeight: '600', color: '#333' },
  closeBtn: { fontSize: '14px', color: '#999', cursor: 'pointer', padding: '2px 4px' },
  linkPreview: { padding: '10px 16px', borderBottom: '1px solid #e0d9cf', backgroundColor: '#f5f2ec' },
  linkTitle: { fontSize: '13px', fontFamily: '"EB Garamond", Georgia, serif', color: '#333', fontWeight: '500', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  linkUrl: { fontSize: '11px', color: '#aaa', marginTop: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  status: { padding: '30px 16px', textAlign: 'center', fontSize: '14px', color: '#888', fontFamily: '"EB Garamond", Georgia, serif' },
  truncationNotice: { padding: '6px 16px', fontSize: '12px', color: '#999', fontFamily: '"EB Garamond", Georgia, serif', borderBottom: '1px solid #e0d9cf' },
  treeContainer: { flex: 1, overflowY: 'auto', padding: '6px 0' },
  node: {
    display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 8px',
    cursor: 'pointer', transition: 'background-color 0.1s',
  },
  chevron: { fontSize: '12px', color: '#888', cursor: 'pointer', width: '14px', textAlign: 'center', flexShrink: 0 },
  nodeName: { fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif', color: '#333' },
  attrBadge: { fontSize: '11px', fontFamily: '"EB Garamond", Georgia, serif', color: '#888', flexShrink: 0 },
  copyError: { padding: '6px 16px', fontSize: '12px', color: '#c44', fontFamily: '"EB Garamond", Georgia, serif' },
  footer: {
    display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '12px 16px',
    borderTop: '1px solid #e0d9cf',
  },
  cancelBtn: { fontSize: '13px', color: '#888', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', padding: '4px 12px' },
  confirmBtn: {
    fontSize: '13px', color: '#333', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #333', padding: '4px 14px', borderRadius: '3px', backgroundColor: '#faf9f6',
  },
  confirmBtnDisabled: {
    fontSize: '13px', color: '#ccc', cursor: 'default', fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ddd', padding: '4px 14px', borderRadius: '3px', backgroundColor: '#faf9f6',
  },
};

export default CopyLinkPicker;
