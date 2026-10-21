import React, { useState, useRef, useEffect } from 'react';

const FONT = '"EB Garamond", Georgia, serif';

// Phase 72c-1: a single click-to-edit field used by curated edit mode (question
// titles, answer title/url/comment/date). In view it renders `children` (or the
// value). Clicking enters edit: a text/date input or textarea, prefilled. Enter
// (single-line) or blur commits; Escape cancels. onSave may be async and may
// throw — on rejection the field stays open and shows the error inline. No
// browser dialogs. Explicit fontFamily per house style.
const EditableField = ({
  value,
  onSave,
  type = 'text',          // 'text' | 'textarea' | 'date'
  placeholder = '',
  inputStyle = {},
  displayStyle = {},
  displayTitle = 'Click to edit',
  emptyLabel = '—',
  children,
}) => {
  const [editing, setEditing] = useState(false);
  const [buffer, setBuffer] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (editing && ref.current) {
      ref.current.focus();
      if (type !== 'date' && typeof ref.current.select === 'function') ref.current.select();
    }
  }, [editing, type]);

  const begin = (e) => {
    e.stopPropagation();
    setBuffer(value || '');
    setError(null);
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setBuffer(value || '');
    setError(null);
  };

  const commit = async () => {
    if (saving) return;
    const next = type === 'textarea' ? buffer : buffer.trim();
    if (next === (value || '')) { cancel(); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
      setSaving(false);
      setEditing(false);
    } catch (err) {
      setSaving(false);
      setError(err?.response?.data?.error || err?.message || 'Could not save');
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && type !== 'textarea') { e.preventDefault(); commit(); }
  };

  if (!editing) {
    return (
      <span
        onClick={begin}
        title={displayTitle}
        style={{ cursor: 'text', borderBottom: '1px dashed #bbb', ...displayStyle }}
      >
        {children != null ? children : (value || emptyLabel)}
      </span>
    );
  }

  const commonProps = {
    ref,
    value: buffer,
    onChange: (e) => setBuffer(e.target.value),
    onKeyDown: handleKeyDown,
    onBlur: commit,
    onClick: (e) => e.stopPropagation(),
    placeholder,
    disabled: saving,
    style: {
      fontFamily: FONT,
      border: '1px solid #e0d9cf',
      borderRadius: '3px',
      padding: '4px 6px',
      backgroundColor: '#faf9f6',
      color: '#333',
      outline: 'none',
      boxSizing: 'border-box',
      ...inputStyle,
    },
  };

  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-block', width: '100%' }}>
      {type === 'textarea' ? (
        <textarea rows={2} {...commonProps} />
      ) : type === 'date' ? (
        <input type="date" {...commonProps} />
      ) : (
        <input type="text" {...commonProps} />
      )}
      {error && <div style={{ fontSize: '11px', color: '#c44', fontFamily: FONT, marginTop: '2px' }}>{error}</div>}
    </span>
  );
};

export default EditableField;
