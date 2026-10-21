import React, { useState, useEffect } from 'react';
import { conceptsAPI } from '../services/api';

// Phase 72c-2: the precedent / subsequent links row inside a question card in
// curated communities. Two columns list sibling question names.
// - View mode: clicking a name scrolls to that sibling's card and highlights it.
//   The whole row is hidden when both lists are empty (no reader placeholders).
// - Edit mode: both columns always show; empty columns read "No precedent/subsequent
//   questions"; a "+" opens a picker of eligible siblings and each entry gets an "✕"
//   to remove. Adding a precedent P to card C creates P→C; a subsequent S creates C→S.
//   A soft warning flags a subsequent dated earlier than this (its precedent) card.
// All controls are <button>s; errors show inline (no window.confirm/alert).
const CardSequenceSection = ({
  concept,
  siblings = [],
  editMode = false,
  onScrollToCard,
  onChanged,
}) => {
  const [picker, setPicker] = useState(null); // 'precedent' | 'subsequent' | null
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Close the sibling picker on Escape.
  useEffect(() => {
    if (!picker) return;
    const onKey = (e) => { if (e.key === 'Escape') setPicker(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [picker]);

  const precedents = concept.precedents || [];
  const subsequents = concept.subsequents || [];

  if (!editMode && precedents.length === 0 && subsequents.length === 0) return null;

  // Sibling lookup for the soft warning and the eligibility picker.
  const siblingByEdge = new Map(siblings.map((s) => [s.edge_id, s]));

  // A sibling is eligible for either column if it is not this card and has no
  // existing link to this card in either direction (that covers "already linked in
  // that direction" and "its reverse link exists").
  const linkedEdgeIds = new Set([
    ...precedents.map((p) => p.edgeId),
    ...subsequents.map((s) => s.edgeId),
  ]);
  const eligible = siblings.filter(
    (s) => s.edge_id !== concept.edge_id && !linkedEdgeIds.has(s.edge_id)
  );

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPicker(null);
      if (onChanged) await onChanged();
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not update links');
    } finally {
      setBusy(false);
    }
  };

  const addPrecedent = (sibling) => run(() => conceptsAPI.addSequenceLink(sibling.edge_id, concept.edge_id));
  const addSubsequent = (sibling) => run(() => conceptsAPI.addSequenceLink(concept.edge_id, sibling.edge_id));
  const removeLink = (linkId) => run(() => conceptsAPI.removeSequenceLink(linkId));

  // Soft warning: a subsequent should normally be dated later than this card.
  const earlierThanThis = (entry) => {
    const sib = siblingByEdge.get(entry.edgeId);
    const sDate = sib && sib.sortDate;
    return !!(concept.sortDate && sDate && sDate < concept.sortDate);
  };

  const renderColumn = (kind) => {
    const isPrecedent = kind === 'precedent';
    const entries = isPrecedent ? precedents : subsequents;
    const heading = isPrecedent ? 'Precedent questions' : 'Subsequent questions';
    const emptyLabel = isPrecedent ? 'No precedent questions' : 'No subsequent questions';
    return (
      <div style={styles.column}>
        <div style={styles.heading}>{heading}</div>
        {entries.length === 0 && editMode && (
          <div style={styles.empty}>{emptyLabel}</div>
        )}
        {entries.map((entry) => (
          <div key={entry.linkId} style={styles.entryRow}>
            <button
              type="button"
              style={styles.nameBtn}
              onClick={() => onScrollToCard && onScrollToCard(entry.edgeId)}
              title="Go to this question"
            >
              {entry.name}
            </button>
            {editMode && !isPrecedent && earlierThanThis(entry) && (
              <span style={styles.warn} title="This subsequent question is dated earlier than this one">
                dated earlier than its precedent
              </span>
            )}
            {editMode && (
              <button
                type="button"
                style={styles.removeBtn}
                onClick={() => removeLink(entry.linkId)}
                disabled={busy}
                title="Remove this link"
              >✕</button>
            )}
          </div>
        ))}
        {editMode && (
          <div style={styles.addWrap}>
            <button
              type="button"
              style={styles.addBtn}
              onClick={() => { setError(null); setPicker(picker === kind ? null : kind); }}
              disabled={busy}
              title={isPrecedent ? 'Add a precedent question' : 'Add a subsequent question'}
            >+</button>
          </div>
        )}
      </div>
    );
  };

  // The picker renders inline (normal flow, pushing the card taller) rather than
  // absolutely positioned — the card has overflow:hidden, which clipped an
  // absolute dropdown. Full-width option buttons + Cancel; also closes on Escape.
  const renderPicker = () => {
    if (!picker) return null;
    const isPrecedent = picker === 'precedent';
    return (
      <div style={styles.picker}>
        <div style={styles.pickerHeading}>
          {isPrecedent ? 'Add a precedent question' : 'Add a subsequent question'}
        </div>
        {eligible.length === 0 ? (
          <div style={styles.pickerEmpty}>No eligible questions</div>
        ) : eligible.map((s) => (
          <button
            key={s.edge_id}
            type="button"
            style={styles.pickerItem}
            onClick={() => (isPrecedent ? addPrecedent(s) : addSubsequent(s))}
            disabled={busy}
          >
            {s.name}
          </button>
        ))}
        <button type="button" style={styles.pickerCancel} onClick={() => setPicker(null)} disabled={busy}>
          Cancel
        </button>
      </div>
    );
  };

  return (
    <div style={styles.wrap} onClick={(e) => e.stopPropagation()}>
      <div style={styles.columns}>
        {renderColumn('precedent')}
        {renderColumn('subsequent')}
      </div>
      {renderPicker()}
      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
};

const FONT = '"EB Garamond", Georgia, serif';

const styles = {
  wrap: { borderTop: '1px solid #eee', padding: '12px 20px', backgroundColor: '#fafafa', fontFamily: FONT, cursor: 'default' },
  columns: { display: 'flex', gap: '16px', alignItems: 'flex-start' },
  column: { flex: 1, minWidth: 0 },
  heading: { fontSize: '12px', color: '#888', fontFamily: FONT, marginBottom: '6px' },
  empty: { fontSize: '13px', color: '#aaa', fontFamily: FONT },
  entryRow: { display: 'flex', alignItems: 'baseline', gap: '6px', marginBottom: '3px' },
  nameBtn: {
    fontSize: '13px', color: '#333', cursor: 'pointer', fontFamily: FONT,
    textDecoration: 'underline', border: 'none', background: 'none', padding: 0,
    textAlign: 'left', overflowWrap: 'anywhere', wordBreak: 'break-word',
  },
  warn: { fontSize: '11px', color: '#c44', fontFamily: FONT },
  removeBtn: {
    fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: FONT,
    border: 'none', background: 'none', padding: '0 2px', flexShrink: 0, lineHeight: 1,
  },
  addWrap: { marginTop: '4px' },
  addBtn: {
    fontSize: '16px', lineHeight: 1, color: '#555', cursor: 'pointer', fontFamily: FONT,
    border: '1px solid #e0d9cf', background: '#faf9f6', borderRadius: '3px', padding: '0 7px',
  },
  // Inline (normal-flow) picker — pushes the card taller instead of being clipped
  // by the card's overflow:hidden.
  picker: {
    marginTop: '10px', backgroundColor: '#faf9f6', border: '1px solid #d4d0c8',
    borderRadius: '3px', maxHeight: '240px', overflowY: 'auto',
    display: 'flex', flexDirection: 'column',
  },
  pickerHeading: {
    fontSize: '12px', color: '#888', fontFamily: FONT, padding: '7px 12px',
    borderBottom: '1px solid #ece8e0',
  },
  pickerItem: {
    width: '100%', fontSize: '13px', color: '#333', fontFamily: FONT, textAlign: 'left',
    padding: '7px 12px', border: 'none', background: 'none', cursor: 'pointer',
    borderBottom: '1px solid #ece8e0', overflowWrap: 'anywhere', wordBreak: 'break-word',
  },
  pickerEmpty: { fontSize: '13px', color: '#888', fontFamily: FONT, padding: '7px 12px' },
  pickerCancel: {
    width: '100%', fontSize: '13px', color: '#999', fontFamily: FONT, textAlign: 'left',
    padding: '7px 12px', border: 'none', background: 'none', cursor: 'pointer',
  },
  error: { fontSize: '12px', color: '#c44', fontFamily: FONT, marginTop: '6px' },
};

export default CardSequenceSection;
