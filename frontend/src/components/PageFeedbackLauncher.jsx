import React, { useState, useEffect, useRef, useCallback } from 'react';
import { feedbackAPI } from '../services/api';
import PageFeedbackPanel from './PageFeedbackPanel';

// Phase 72e-2: the page-level feedback button — a fixed bottom-corner page-with-
// pencil icon (inline SVG, not an emoji) showing the open count of this page's
// new_child (branch) suggestions. Opens PageFeedbackPanel. Positioned above the
// edit-mode "+" button and the fixed Add / Search bar so it never overlaps them.
// Only rendered in curated communities.

const PageFeedbackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ display: 'block' }}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8" />
    <path d="M8 8h5M8 12h3" />
    <path d="M19 12.5l2.5 2.5-4.5 4.5H14.5v-2.5l4.5-4.5z" />
  </svg>
);

const PageFeedbackLauncher = ({
  communityId,
  parentEdgeId = null,
  questionText,
  isOwner = false,
  isGuest = false,
  onRequestLogin,
  onChanged,
  // Phase 72e-2: inbox navigation can request this page's panel be opened.
  autoOpen = false,
  onAutoOpenConsumed,
}) => {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const reqGen = useRef(0);

  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
      if (onAutoOpenConsumed) onAutoOpenConsumed();
    }
  }, [autoOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stale-State Guard: community/page-keyed count fetch.
  const loadCount = useCallback(async () => {
    if (!communityId) { setCount(0); return; }
    const gen = ++reqGen.current;
    try {
      const res = await feedbackAPI.getPage(communityId, parentEdgeId);
      if (gen !== reqGen.current) return;
      const items = res.data.items || [];
      setCount(items.filter((i) => i.status === 'open' && !i.isHidden).length);
    } catch {
      if (gen !== reqGen.current) return;
      setCount(0);
    }
  }, [communityId, parentEdgeId]);

  useEffect(() => { loadCount(); }, [loadCount]);

  // Refresh the badge after any panel action, and bubble up so card counts refresh.
  const handleChanged = useCallback(async () => {
    await loadCount();
    if (onChanged) await onChanged();
  }, [loadCount, onChanged]);

  if (!communityId) return null;

  return (
    <>
      <button
        type="button"
        style={styles.fab}
        onClick={() => setOpen(true)}
        title="Suggest a new question or branch for this page"
      >
        <PageFeedbackIcon />
        {count > 0 && <span style={styles.count}>{count}</span>}
      </button>
      {open && (
        <PageFeedbackPanel
          communityId={communityId}
          parentEdgeId={parentEdgeId}
          questionText={questionText}
          isOwner={isOwner}
          isGuest={isGuest}
          onRequestLogin={onRequestLogin}
          onClose={() => setOpen(false)}
          onChanged={handleChanged}
        />
      )}
    </>
  );
};

const FONT = '"EB Garamond", Georgia, serif';
const styles = {
  fab: {
    position: 'fixed',
    bottom: '150px',
    right: '28px',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    minHeight: '40px',
    padding: '7px 12px',
    borderRadius: '20px',
    border: '1px solid #333',
    backgroundColor: '#faf9f6',
    color: '#333',
    cursor: 'pointer',
    fontFamily: FONT,
    fontSize: '14px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
    zIndex: 1001,
  },
  count: { fontSize: '13px', color: '#333', fontFamily: FONT },
};

export default PageFeedbackLauncher;
