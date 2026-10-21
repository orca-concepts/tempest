import React, { useState, useRef, useEffect } from 'react';

const FONT = '"EB Garamond", Georgia, serif';

// Phase 72c-1: the inline "New question" card opened by the edit-mode "+" button.
// It sits at the top of the root/children grid. onCreate(name) may be async and
// may throw — the error shows inline and the card stays open. No browser dialogs.
const NewQuestionCard = ({ onCreate, onCancel, placeholder = 'New question…' }) => {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => { if (ref.current) ref.current.focus(); }, []);

  const submit = async () => {
    if (saving) return;
    const trimmed = name.trim();
    if (!trimmed) { setError('A question is required.'); return; }
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmed);
      // Parent reloads the grid; the card is unmounted by the parent on success.
    } catch (err) {
      setSaving(false);
      setError(err?.response?.data?.error || 'Could not add question');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
  };

  return (
    <div style={styles.card}>
      <input
        ref={ref}
        type="text"
        value={name}
        onChange={(e) => { setName(e.target.value); setError(null); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={255}
        style={styles.input}
      />
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.buttons}>
        <button type="button" onClick={submit} disabled={saving} style={styles.saveBtn}>
          {saving ? 'Adding…' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} disabled={saving} style={styles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
};

const styles = {
  card: {
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px dashed #999',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '20px',
    fontFamily: FONT,
  },
  input: {
    width: '100%',
    fontFamily: FONT,
    fontSize: '16px',
    color: '#333',
    backgroundColor: '#faf9f6',
    border: '1px solid #e0d9cf',
    borderRadius: '3px',
    padding: '8px 10px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  error: { fontSize: '12px', color: '#c44', fontFamily: FONT },
  buttons: { display: 'flex', gap: '10px' },
  saveBtn: {
    fontSize: '13px', color: '#333', cursor: 'pointer', fontFamily: FONT,
    border: '1px solid #e0d9cf', padding: '3px 12px', borderRadius: '3px', backgroundColor: '#faf9f6',
  },
  cancelBtn: {
    fontSize: '13px', color: '#999', cursor: 'pointer', fontFamily: FONT,
    border: 'none', background: 'none', padding: 0,
  },
};

export default NewQuestionCard;
