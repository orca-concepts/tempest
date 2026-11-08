import React, { useState, useEffect, useRef, useMemo } from 'react';
import { feedbackAPI } from '../services/api';
import ClampedText from './ClampedText';

// Phase 72e-2: owner feedback inbox for a whole community. Full-pane overlay
// styled like the Graph / Votes overlays (← Back, title, filters). Lists every
// feedback item (all kinds) newest-first, with per-status filters (Open /
// Incorporated / Declined / Archived) and counts. A live item links to its card
// or page panel via onNavigate(nav); archived items are read-only and show their
// snapshot. House style: inline styles, explicit fontFamily, no colored buttons,
// no emoji, no italics, all controls <button>s.

const FONT = '"EB Garamond", Georgia, serif';
const KIND_LABEL = {
  edit_question: 'Reword question',
  edit_answer: 'Answer change',
  new_child: 'New question / branch',
  general: 'Comment',
};
const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'incorporated', label: 'Incorporated' },
  { key: 'declined', label: 'Declined' },
  { key: 'archived', label: 'Archived' },
];

const timeStr = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ''; } };

const FeedbackInboxOverlay = ({ communityId, onBack, onNavigate }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('open');
  const genRef = useRef(0);

  useEffect(() => {
    const gen = ++genRef.current;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await feedbackAPI.getInbox(communityId);
        if (gen !== genRef.current) return;
        setData(res.data);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError('Failed to load the inbox');
      } finally {
        if (gen === genRef.current) setLoading(false);
      }
    })();
  }, [communityId]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onBack(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const counts = data?.counts || { open: 0, incorporated: 0, declined: 0, archived: 0, total: 0 };
  const items = useMemo(() => {
    const all = data?.items || [];
    if (filter === 'archived') return all.filter((i) => i.archived);
    return all.filter((i) => !i.archived && i.status === filter);
  }, [data, filter]);

  const click = (item) => {
    if (item.archived || !item.nav) return;
    if (onNavigate) onNavigate(item.nav);
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerBar}>
        <button onClick={onBack} style={styles.backButton}>{'←'} Back</button>
        <h2 style={styles.heading}>Feedback inbox</h2>
      </div>

      {error && <div style={styles.errorBar}>{error}</div>}

      <div style={styles.main}>
        <div style={styles.filterRow}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{ ...styles.filterBtn, ...(filter === f.key ? styles.filterBtnActive : {}) }}
            >
              {f.label} ({counts[f.key] || 0})
            </button>
          ))}
        </div>

        {loading ? (
          <div style={styles.loading}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={styles.empty}>No {filter} feedback.</div>
        ) : (
          <div style={styles.list}>
            {items.map((item) => {
              const clickable = !item.archived && !!item.nav;
              return (
                <div
                  key={item.id}
                  style={{ ...styles.item, ...(clickable ? styles.itemClickable : {}) }}
                >
                  <div style={styles.itemHead}>
                    <span style={styles.kindLabel}>{KIND_LABEL[item.kind] || 'Suggestion'}</span>
                    {item.archived && <span style={styles.statusLabel}>Archived</span>}
                    {!item.archived && item.status !== 'open' && (
                      <span style={styles.statusLabel}>{item.status === 'incorporated' ? 'Incorporated' : 'Declined'}</span>
                    )}
                    {item.isHidden && <span style={styles.hiddenLabel}>Hidden</span>}
                    <span style={styles.voteCount}>{'▲'} {item.voteCount}</span>
                    <span style={styles.time}>{timeStr(item.createdAt)}</span>
                  </div>
                  <div style={styles.about}>
                    About: {item.snapshot?.questionText || '(unknown)'}
                  </div>
                  {item.comment && <ClampedText text={item.comment} lines={2} style={styles.comment} />}
                  <div style={styles.actionRow}>
                    {clickable ? (
                      <button type="button" onClick={() => click(item)} style={styles.openBtn}>Open</button>
                    ) : (
                      <span style={styles.muted}>{item.archived ? 'Read-only (archived)' : 'No page to open'}</span>
                    )}
                    <span style={styles.author}>{item.author ? item.author.username : '[deleted]'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: { minHeight: '100%', backgroundColor: '#faf9f7', position: 'relative', zIndex: 10050 },
  headerBar: { display: 'flex', alignItems: 'center', gap: '16px', padding: '16px 20px 0 20px', maxWidth: '1000px', margin: '0 auto' },
  backButton: { padding: '6px 12px', border: '1px solid #ddd', borderRadius: '4px', backgroundColor: 'white', cursor: 'pointer', fontSize: '14px', fontFamily: FONT, color: '#555' },
  heading: { margin: 0, fontSize: '22px', fontFamily: FONT, fontWeight: '600', color: '#333' },
  errorBar: { padding: '12px 20px', backgroundColor: '#fee', color: '#c33', maxWidth: '1000px', margin: '12px auto 0', borderRadius: '4px', fontSize: '14px', fontFamily: FONT },
  main: { maxWidth: '1000px', margin: '0 auto', padding: '20px' },
  filterRow: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' },
  filterBtn: { padding: '6px 14px', backgroundColor: '#f0f0f0', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '13px', color: '#555', fontFamily: FONT },
  filterBtnActive: { backgroundColor: '#333', color: 'white', borderColor: '#333' },
  loading: { textAlign: 'center', padding: '60px', fontSize: '15px', color: '#888', fontFamily: FONT },
  empty: { textAlign: 'center', padding: '60px', fontSize: '15px', color: '#888', fontFamily: FONT },
  list: { display: 'flex', flexDirection: 'column', gap: '12px' },
  item: { backgroundColor: 'white', border: '1px solid #e8e4dc', borderRadius: '6px', padding: '14px' },
  itemClickable: {},
  itemHead: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' },
  kindLabel: { fontSize: '12px', color: '#555', fontFamily: FONT, backgroundColor: '#f0ede8', borderRadius: '10px', padding: '1px 9px' },
  statusLabel: { fontSize: '12px', color: '#555', fontFamily: FONT, border: '1px solid #cfc9bd', borderRadius: '10px', padding: '1px 9px' },
  hiddenLabel: { fontSize: '12px', color: '#999', fontFamily: FONT },
  voteCount: { fontSize: '12px', color: '#777', fontFamily: FONT },
  time: { fontSize: '12px', color: '#aaa', fontFamily: FONT, marginLeft: 'auto' },
  about: { fontSize: '15px', color: '#333', fontFamily: FONT, lineHeight: 1.4, overflowWrap: 'anywhere' },
  comment: { fontSize: '13px', color: '#666', fontFamily: FONT, lineHeight: 1.4, marginTop: '4px', overflowWrap: 'anywhere' },
  actionRow: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' },
  openBtn: { fontSize: '13px', color: '#333', cursor: 'pointer', fontFamily: FONT, border: '1px solid #333', background: 'transparent', padding: '4px 14px', borderRadius: '4px' },
  author: { fontSize: '12px', color: '#888', fontFamily: FONT },
  muted: { fontSize: '12px', color: '#999', fontFamily: FONT },
};

export default FeedbackInboxOverlay;
