import React, { useState, useEffect, useRef } from 'react';
import { conceptsAPI } from '../services/api';

// Phase 73: the bottom action bar for restructuring a curated graph (owners, edit
// mode). It owns the group/move/ungroup forms and runs a dryRun preview before
// every Confirm. Selection (card checkboxes) is controlled by the parent; the
// ungroup target is passed in via `ungroupConcept`. On success it calls onDone so
// the parent can silently refresh, highlight, clear selection and reload tabs.
// Styled to match the existing nest bar.

const movedPhrase = (movedCount, descendantCount) => {
  const q = `${movedCount} question${movedCount === 1 ? '' : 's'}`;
  if (!descendantCount) return q;
  return `${q} (and ${descendantCount === 1 ? 'its' : 'their'} ${descendantCount} descendant${descendantCount === 1 ? '' : 's'})`;
};

const seqPhrase = (removed) => {
  const n = removed ? removed.length : 0;
  if (!n) return '';
  return ` ${n} precedent/subsequent link${n === 1 ? '' : 's'} will be removed.`;
};

export default function RestructureBar({
  selectedEdgeIds,
  siblings = [],
  ungroupConcept = null,
  onClearSelection,
  onCloseUngroup,
  onDone,
}) {
  const selSize = selectedEdgeIds ? selectedEdgeIds.size : 0;
  const [phase, setPhase] = useState('menu'); // 'menu' | 'group' | 'move'
  const [name, setName] = useState('');
  const [moveTarget, setMoveTarget] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewErr, setPreviewErr] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionErr, setActionErr] = useState(null);
  const previewSeq = useRef(0);

  const selectedArr = selectedEdgeIds ? [...selectedEdgeIds] : [];

  // Reset the selection-flow form whenever the selection empties.
  useEffect(() => {
    if (selSize === 0) {
      setPhase('menu'); setName(''); setMoveTarget(null); setPickerOpen(false);
      setPreview(null); setPreviewErr(null); setActionErr(null);
    }
  }, [selSize]);

  // Group preview — debounced on the typed name.
  useEffect(() => {
    if (ungroupConcept || phase !== 'group') return;
    const trimmed = name.trim();
    if (!trimmed) { setPreview(null); setPreviewErr(null); setLoadingPreview(false); return; }
    const seq = ++previewSeq.current;
    setLoadingPreview(true); setPreviewErr(null);
    const timer = setTimeout(async () => {
      try {
        const res = await conceptsAPI.groupUnderNewParent({ selectedEdgeIds: selectedArr, name: trimmed, dryRun: true });
        if (seq !== previewSeq.current) return;
        setPreview(res.data); setPreviewErr(null);
      } catch (e) {
        if (seq !== previewSeq.current) return;
        setPreview(null); setPreviewErr(e?.response?.data?.error || 'Could not preview this change.');
      } finally {
        if (seq === previewSeq.current) setLoadingPreview(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [name, phase, ungroupConcept]); // eslint-disable-line react-hooks/exhaustive-deps

  // Move preview — runs when a target is chosen.
  useEffect(() => {
    if (ungroupConcept || phase !== 'move' || !moveTarget) { return; }
    const seq = ++previewSeq.current;
    setLoadingPreview(true); setPreviewErr(null);
    (async () => {
      try {
        const res = await conceptsAPI.moveIntoSibling({ selectedEdgeIds: selectedArr, targetEdgeId: moveTarget, dryRun: true });
        if (seq !== previewSeq.current) return;
        setPreview(res.data); setPreviewErr(null);
      } catch (e) {
        if (seq !== previewSeq.current) return;
        setPreview(null); setPreviewErr(e?.response?.data?.error || 'Could not preview this change.');
      } finally {
        if (seq === previewSeq.current) setLoadingPreview(false);
      }
    })();
  }, [moveTarget, phase, ungroupConcept]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ungroup preview — runs when a card's Ungroup is opened.
  useEffect(() => {
    if (!ungroupConcept) return;
    const seq = ++previewSeq.current;
    setPreview(null); setPreviewErr(null); setActionErr(null); setLoadingPreview(true);
    (async () => {
      try {
        const res = await conceptsAPI.ungroupEdge(ungroupConcept.edge_id, true);
        if (seq !== previewSeq.current) return;
        setPreview(res.data); setPreviewErr(null);
      } catch (e) {
        if (seq !== previewSeq.current) return;
        setPreview(null); setPreviewErr(e?.response?.data?.error || 'Could not preview this change.');
      } finally {
        if (seq === previewSeq.current) setLoadingPreview(false);
      }
    })();
  }, [ungroupConcept && ungroupConcept.edge_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (selSize === 0 && !ungroupConcept) return null;

  const confirmGroup = async () => {
    if (submitting) return;
    setSubmitting(true); setActionErr(null);
    try {
      const res = await conceptsAPI.groupUnderNewParent({ selectedEdgeIds: selectedArr, name: name.trim(), dryRun: false });
      onDone({ highlightEdgeId: res.data.newEdgeId });
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Could not group the selected questions.');
      setSubmitting(false);
    }
  };

  const confirmMove = async () => {
    if (submitting || !moveTarget) return;
    setSubmitting(true); setActionErr(null);
    try {
      await conceptsAPI.moveIntoSibling({ selectedEdgeIds: selectedArr, targetEdgeId: moveTarget, dryRun: false });
      onDone({ highlightEdgeId: moveTarget });
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Could not move the selected questions.');
      setSubmitting(false);
    }
  };

  const confirmUngroup = async () => {
    if (submitting || !ungroupConcept) return;
    setSubmitting(true); setActionErr(null);
    try {
      await conceptsAPI.ungroupEdge(ungroupConcept.edge_id, false);
      onDone({ highlightEdgeId: null });
    } catch (e) {
      setActionErr(e?.response?.data?.error || 'Could not ungroup this question.');
      setSubmitting(false);
    }
  };

  // ---- Ungroup confirm ----
  if (ungroupConcept) {
    const line = preview
      ? `Moves ${preview.movedCount} ${preview.movedCount === 1 ? 'child' : 'children'} up to this level and removes “${ungroupConcept.name}”.`
        + (preview.answersRemoved > 0 ? ` Its ${preview.answersRemoved} answer${preview.answersRemoved === 1 ? '' : 's'} will be removed with it.` : '')
        + (preview.feedbackArchived > 0 ? ` Its ${preview.feedbackArchived} feedback item${preview.feedbackArchived === 1 ? '' : 's'} will be archived.` : '')
        + seqPhrase(preview.removedSequenceLinks)
      : null;
    return (
      <div style={styles.bar}>
        <span style={styles.text}>
          {loadingPreview && !line ? 'Checking…' : (line || `Ungroup “${ungroupConcept.name}”?`)}
        </span>
        <button
          type="button"
          style={{ ...styles.confirm, ...((submitting || !preview) ? styles.disabled : {}) }}
          onClick={confirmUngroup}
          disabled={submitting || !preview}
        >{submitting ? 'Ungrouping…' : 'Ungroup'}</button>
        <button type="button" style={styles.cancel} onClick={onCloseUngroup} disabled={submitting}>Cancel</button>
        {(previewErr || actionErr) && <span style={styles.err}>{previewErr || actionErr}</span>}
      </div>
    );
  }

  // ---- Group form ----
  if (phase === 'group') {
    const line = preview
      ? `Creates “${name.trim()}” here and moves ${movedPhrase(preview.movedCount, preview.descendantCount)} under it.${seqPhrase(preview.removedSequenceLinks)}`
      : null;
    return (
      <div style={styles.bar}>
        <span style={styles.text}>Group {selSize} selected under a new question:</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New goal question…"
          style={styles.input}
          autoFocus
          maxLength={255}
        />
        <button
          type="button"
          style={{ ...styles.confirm, ...((submitting || !preview || !name.trim()) ? styles.disabled : {}) }}
          onClick={confirmGroup}
          disabled={submitting || !preview || !name.trim()}
        >{submitting ? 'Grouping…' : 'Confirm'}</button>
        <button type="button" style={styles.cancel} onClick={() => { setPhase('menu'); setName(''); setPreview(null); setPreviewErr(null); setActionErr(null); }} disabled={submitting}>Cancel</button>
        {line && <span style={styles.previewLine}>{line}</span>}
        {loadingPreview && !line && <span style={styles.text}>Checking…</span>}
        {(previewErr || actionErr) && <span style={styles.err}>{previewErr || actionErr}</span>}
      </div>
    );
  }

  // ---- Move form ----
  if (phase === 'move') {
    const targets = siblings.filter((s) => !(selectedEdgeIds && selectedEdgeIds.has(s.edge_id)));
    const targetName = (siblings.find((s) => s.edge_id === moveTarget) || {}).name;
    const line = preview
      ? `Moves ${movedPhrase(preview.movedCount, preview.descendantCount)} into “${targetName}”.${seqPhrase(preview.removedSequenceLinks)}`
      : null;
    return (
      <div style={styles.bar}>
        <span style={styles.text}>Move {selSize} selected into:</span>
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            style={styles.pickerButton}
            onClick={() => setPickerOpen((o) => !o)}
            disabled={targets.length === 0}
            title="Choose the sibling question to move the selection into"
          >
            {targetName ? `Into: ${targetName}` : 'Choose a question'} {'▾'}
          </button>
          {pickerOpen && (
            <div style={styles.pickerDropdown}>
              {targets.length === 0 ? (
                <div style={styles.pickerEmpty}>No eligible questions</div>
              ) : targets.map((s) => (
                <div
                  key={s.edge_id}
                  style={styles.pickerItem}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f0ece4')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={() => { setMoveTarget(s.edge_id); setPickerOpen(false); }}
                >{s.name}</div>
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          style={{ ...styles.confirm, ...((submitting || !preview || !moveTarget) ? styles.disabled : {}) }}
          onClick={confirmMove}
          disabled={submitting || !preview || !moveTarget}
        >{submitting ? 'Moving…' : 'Confirm'}</button>
        <button type="button" style={styles.cancel} onClick={() => { setPhase('menu'); setMoveTarget(null); setPreview(null); setPreviewErr(null); setActionErr(null); }} disabled={submitting}>Cancel</button>
        {line && <span style={styles.previewLine}>{line}</span>}
        {loadingPreview && !line && <span style={styles.text}>Checking…</span>}
        {(previewErr || actionErr) && <span style={styles.err}>{previewErr || actionErr}</span>}
      </div>
    );
  }

  // ---- Selection menu ----
  return (
    <div style={styles.bar}>
      <span style={styles.text}>{selSize} selected</span>
      <span style={styles.sep}>·</span>
      <button type="button" style={styles.menuButton} onClick={() => { setPhase('group'); setPreview(null); setPreviewErr(null); setActionErr(null); }}>Group under a new question</button>
      <span style={styles.sep}>·</span>
      <button type="button" style={styles.menuButton} onClick={() => { setPhase('move'); setMoveTarget(null); setPreview(null); setPreviewErr(null); setActionErr(null); }}>Move into…</button>
      <span style={styles.sep}>·</span>
      <button type="button" style={styles.menuButton} onClick={onClearSelection}>Clear</button>
    </div>
  );
}

const styles = {
  bar: {
    position: 'fixed',
    bottom: '90px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
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
  text: { fontSize: '15px', color: '#333' },
  sep: { color: '#aaa' },
  menuButton: {
    padding: '6px 12px',
    backgroundColor: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  input: {
    padding: '7px 10px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    minWidth: '220px',
  },
  pickerButton: {
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
  pickerDropdown: {
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
  pickerItem: { padding: '8px 14px', cursor: 'pointer', color: '#333' },
  pickerEmpty: { padding: '8px 14px', color: '#888' },
  confirm: {
    padding: '8px 18px',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  disabled: { opacity: 0.45, cursor: 'default' },
  cancel: {
    padding: '8px 14px',
    backgroundColor: 'white',
    color: '#555',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  previewLine: {
    fontSize: '14px',
    color: '#333',
    width: '100%',
    textAlign: 'center',
  },
  err: {
    fontSize: '14px',
    color: '#c33',
    width: '100%',
    textAlign: 'center',
  },
};
