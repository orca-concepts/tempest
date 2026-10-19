import React, { useState } from 'react';
import { communitiesAPI } from '../services/api';

// Phase 71: Communities browse + create overlay. Selecting a community sets it
// as the active community (the graph is partitioned per community). Create is
// available to logged-in users; no governance beyond requiring login.
const CommunitiesBrowse = ({
  communities,
  activeCommunityId,
  isGuest,
  onSelect,
  onCreated,
  onBack,
  onRequestLogin,
}) => {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('open'); // Phase 72a: fixed at creation
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (submitting) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await communitiesAPI.createCommunity(trimmed, description.trim() || undefined, mode);
      const created = res.data.community;
      setName('');
      setDescription('');
      setMode('open');
      setShowCreate(false);
      if (onCreated) onCreated(created);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not create community');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <span onClick={onBack} style={styles.back} role="button" tabIndex={0}>
          {'←'} Back
        </span>
        <h2 style={styles.title}>Communities</h2>
        {!isGuest ? (
          <button style={styles.createToggle} onClick={() => setShowCreate((s) => !s)}>
            {showCreate ? 'Cancel' : 'New community'}
          </button>
        ) : (
          <button style={styles.createToggle} onClick={onRequestLogin}>
            Log in to create
          </button>
        )}
      </div>

      <p style={styles.intro}>
        Each community is its own space of questions. Open one to see and add only the
        questions entered there.
      </p>

      {showCreate && !isGuest && (
        <div style={styles.createBox}>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Community name"
            maxLength={255}
            style={styles.input}
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
            style={styles.textarea}
            rows={2}
          />
          <div style={styles.modeRow}>
            {[
              { value: 'open', label: 'Open', hint: 'Anyone logged in adds questions and votes.' },
              { value: 'curated', label: 'Curated', hint: 'Only owners edit; readers leave feedback. No voting.' },
            ].map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setMode(opt.value)}
                style={mode === opt.value ? styles.modeBtnActive : styles.modeBtn}
              >
                <span style={styles.modeBtnLabel}>{opt.label}</span>
                <span style={styles.modeBtnHint}>{opt.hint}</span>
              </button>
            ))}
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button
            style={{ ...styles.createButton, ...(submitting ? styles.disabled : {}) }}
            onClick={handleCreate}
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create community'}
          </button>
        </div>
      )}

      <div style={styles.list}>
        {communities.length === 0 ? (
          <div style={styles.empty}>No communities yet.</div>
        ) : (
          communities.map((c) => {
            const isActive = c.id === activeCommunityId;
            return (
              <div
                key={c.id}
                style={{ ...styles.card, ...(isActive ? styles.cardActive : {}) }}
                onClick={() => onSelect(c)}
                role="button"
                tabIndex={0}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = '#f5f4f0'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = '#fffdf9'; }}
              >
                <div style={styles.cardName}>
                  {c.name}
                  {c.mode === 'curated' && <span style={styles.curatedTag}>Curated</span>}
                  {isActive && <span style={styles.activeTag}>current</span>}
                </div>
                {c.description && <div style={styles.cardDesc}>{c.description}</div>}
                <div style={styles.cardMeta}>
                  {c.root_count} root question{Number(c.root_count) === 1 ? '' : 's'} {'·'} {c.concept_count} total
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const FONT = '"EB Garamond", Georgia, serif';

const styles = {
  container: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '32px 20px',
    fontFamily: FONT,
    color: '#333',
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  back: {
    cursor: 'pointer',
    color: '#888',
    fontSize: '14px',
    textDecoration: 'underline',
  },
  title: {
    fontSize: '26px',
    fontWeight: 'normal',
    margin: 0,
    color: '#222',
  },
  createToggle: {
    marginLeft: 'auto',
    padding: '6px 14px',
    fontFamily: FONT,
    fontSize: '14px',
    backgroundColor: '#faf9f6',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#333',
  },
  intro: {
    fontSize: '15px',
    color: '#666',
    margin: '12px 0 20px',
  },
  createBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '16px',
    border: '1px solid #e0dcd2',
    borderRadius: '8px',
    backgroundColor: '#fffdf9',
    marginBottom: '20px',
  },
  input: {
    padding: '10px 12px',
    fontSize: '16px',
    fontFamily: FONT,
    border: '1px solid #ccc',
    borderRadius: '4px',
    outline: 'none',
    color: '#333',
    backgroundColor: 'white',
  },
  textarea: {
    padding: '10px 12px',
    fontSize: '15px',
    fontFamily: FONT,
    border: '1px solid #ccc',
    borderRadius: '4px',
    outline: 'none',
    color: '#333',
    backgroundColor: 'white',
    resize: 'vertical',
  },
  error: {
    color: '#c33',
    fontSize: '14px',
  },
  modeRow: {
    display: 'flex',
    gap: '8px',
  },
  modeBtn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    textAlign: 'left',
    padding: '8px 10px',
    fontFamily: FONT,
    backgroundColor: '#faf9f6',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#555',
  },
  modeBtnActive: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    textAlign: 'left',
    padding: '8px 10px',
    fontFamily: FONT,
    backgroundColor: '#f0ece4',
    border: '1px solid #999',
    borderRadius: '4px',
    cursor: 'pointer',
    color: '#333',
  },
  modeBtnLabel: {
    fontSize: '15px',
  },
  modeBtnHint: {
    fontSize: '12px',
    color: '#888',
    lineHeight: 1.3,
  },
  curatedTag: {
    fontSize: '11px',
    color: '#555',
    border: '1px solid #cfc9bd',
    borderRadius: '10px',
    padding: '1px 8px',
    backgroundColor: '#f5f0ea',
  },
  createButton: {
    alignSelf: 'flex-start',
    padding: '8px 18px',
    fontFamily: FONT,
    fontSize: '15px',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  disabled: {
    opacity: 0.5,
    cursor: 'default',
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  empty: {
    padding: '40px',
    textAlign: 'center',
    color: '#888',
  },
  card: {
    padding: '14px 16px',
    border: '1px solid #e0dcd2',
    borderRadius: '8px',
    backgroundColor: '#fffdf9',
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },
  cardActive: {
    borderColor: '#999',
    backgroundColor: '#f0ece4',
  },
  cardName: {
    fontSize: '18px',
    color: '#222',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  activeTag: {
    fontSize: '11px',
    color: '#666',
    border: '1px solid #cfc9bd',
    borderRadius: '10px',
    padding: '1px 8px',
  },
  cardDesc: {
    fontSize: '14px',
    color: '#666',
    marginTop: '4px',
  },
  cardMeta: {
    fontSize: '13px',
    color: '#999',
    marginTop: '6px',
  },
};

export default CommunitiesBrowse;
