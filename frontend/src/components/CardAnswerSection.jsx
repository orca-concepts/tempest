import React, { useState, useRef, useCallback } from 'react';
import { votesAPI } from '../services/api';
import LinkifiedText from './LinkifiedText';

// Phase 72b: the answer section rendered inside a question card in curated
// communities. Reader view shows each answer's title (external link), publication
// date, and comment. Owners get an inline "Add answer" form and a per-answer
// "Remove" with an inline confirm. There are no vote controls here.
const CardAnswerSection = ({
  answers = [],
  edgeId,
  canManage = false,
  isGuest = false,
  onRequestLogin,
  onChanged,
}) => {
  const [showForm, setShowForm] = useState(false);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [comment, setComment] = useState('');
  const [publishedOn, setPublishedOn] = useState('');
  const [affirmed, setAffirmed] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingId, setConfirmingId] = useState(null);

  // Title preview (mirrors the add-link form in ConceptLinksPanel)
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [previewResult, setPreviewResult] = useState(null);
  const [unsafeUrl, setUnsafeUrl] = useState(false);
  const [unsafeUrlValue, setUnsafeUrlValue] = useState('');
  const lastFetchedUrlRef = useRef('');
  const abortControllerRef = useRef(null);

  const fetchTitlePreview = useCallback((candidate) => {
    const trimmed = (candidate || '').trim();
    if (trimmed === lastFetchedUrlRef.current) return;
    if (!trimmed) return;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return;
    } catch { return; }

    lastFetchedUrlRef.current = trimmed;
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setPreviewLoading(true);
    setPreviewError(false);
    setPreviewResult(null);

    votesAPI.previewTitle(trimmed)
      .then((res) => {
        if (controller.signal.aborted) return;
        const t = res.data.title || '';
        setPreviewResult(t);
        if (t) setTitle(t);
        setPreviewLoading(false);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err.response?.status === 403 && err.response?.data?.code === 'unsafe_url') {
          setUnsafeUrl(true);
          setUnsafeUrlValue(trimmed);
          setPreviewLoading(false);
          return;
        }
        setPreviewError(true);
        setPreviewLoading(false);
      });
  }, []);

  const resetForm = () => {
    setShowForm(false);
    setUrl(''); setTitle(''); setComment(''); setPublishedOn('');
    setAffirmed(false); setFormError(null); setSubmitting(false);
    setPreviewResult(null); setPreviewError(false); setPreviewLoading(false);
    setUnsafeUrl(false); setUnsafeUrlValue('');
    lastFetchedUrlRef.current = '';
    if (abortControllerRef.current) abortControllerRef.current.abort();
  };

  const handleAdd = async () => {
    if (submitting) return;
    const trimmed = url.trim();
    if (!trimmed) { setFormError('A URL is required.'); return; }
    if (!/^https?:\/\/.+/i.test(trimmed)) { setFormError('URL must start with http:// or https://'); return; }
    if (!publishedOn) { setFormError('A publication date is required.'); return; }
    setFormError(null);
    setSubmitting(true);
    try {
      await votesAPI.addWebLink(edgeId, trimmed, title.trim() || undefined, comment.trim() || undefined, publishedOn);
      resetForm();
      if (onChanged) onChanged();
    } catch (err) {
      setSubmitting(false);
      if (err.response?.status === 403 && err.response?.data?.code === 'unsafe_url') {
        setUnsafeUrl(true);
        setUnsafeUrlValue(trimmed);
        return;
      }
      setFormError(err.response?.data?.error || 'Failed to add answer');
    }
  };

  const handleRemove = async (answerId) => {
    try {
      await votesAPI.removeWebLink(answerId);
      setConfirmingId(null);
      if (onChanged) onChanged();
    } catch (err) {
      setFormError(err.response?.data?.error || 'Failed to remove answer');
      setConfirmingId(null);
    }
  };

  const hasAnswers = answers && answers.length > 0;
  // Reader with no answers: render nothing. Owners always see the add affordance.
  if (!hasAnswers && !canManage) return null;

  return (
    <div style={styles.wrap} onClick={(e) => e.stopPropagation()}>
      {hasAnswers && (
        <div style={styles.list}>
          {answers.map((a) => (
            <div key={a.id} id={`answer-${a.id}`} style={styles.answerRow}>
              <div style={styles.answerTopRow}>
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={styles.answerTitle}
                  >
                    {a.title || a.url}
                  </a>
                ) : (
                  <span style={styles.answerTitle}>{a.title}</span>
                )}
                {a.publishedOn && <span style={styles.answerDate}>{a.publishedOn}</span>}
              </div>
              {a.comment && (
                <LinkifiedText text={a.comment} lines={3} style={styles.answerComment} />
              )}
              {canManage && (
                <div style={styles.answerActions}>
                  {confirmingId === a.id ? (
                    <>
                      <span style={styles.confirmPrompt}>Remove this answer?</span>
                      <button type="button" onClick={() => handleRemove(a.id)} style={styles.actionBtn}>Yes</button>
                      <button type="button" onClick={() => setConfirmingId(null)} style={styles.actionBtnMuted}>No</button>
                    </>
                  ) : (
                    <button type="button" onClick={() => setConfirmingId(a.id)} style={styles.actionBtnMuted}>Remove</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {canManage && !showForm && (
        <div style={styles.addRow}>
          <button type="button" onClick={() => setShowForm(true)} style={styles.addBtn}>+ Add answer</button>
        </div>
      )}

      {canManage && showForm && (
        <div style={styles.form}>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setFormError(null);
              if (unsafeUrl && e.target.value.trim() !== unsafeUrlValue) { setUnsafeUrl(false); setUnsafeUrlValue(''); }
            }}
            onBlur={() => fetchTitlePreview(url)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData('text');
              setTimeout(() => fetchTitlePreview(pasted), 0);
            }}
            placeholder="https://..."
            style={styles.input}
          />
          {unsafeUrl && (
            <div style={styles.unsafeUrlError}>This URL was flagged by Google Safe Browsing as potentially unsafe. It cannot be posted to Orca.</div>
          )}
          {!unsafeUrl && previewLoading && <div style={styles.previewStatus}>Fetching title...</div>}
          {!unsafeUrl && previewError && <div style={styles.previewStatus}>Couldn't fetch title — you can enter one manually</div>}
          {!unsafeUrl && previewResult && !previewLoading && <div style={styles.previewBox}>{previewResult}</div>}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional — auto-fetched if empty)"
            style={styles.input}
          />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comment (optional)"
            style={styles.textarea}
            rows={2}
          />
          <label style={styles.dateLabel}>
            <span style={styles.dateLabelText}>Publication date</span>
            <input
              type="date"
              value={publishedOn}
              onChange={(e) => { setPublishedOn(e.target.value); setFormError(null); }}
              style={styles.dateInput}
            />
          </label>
          {formError && <div style={styles.formError}>{formError}</div>}
          <label style={styles.affirmLabel}>
            <input type="checkbox" checked={affirmed} onChange={(e) => setAffirmed(e.target.checked)} style={styles.affirmCheckbox} />
            <span style={styles.affirmText}>
              I affirm this URL points to content that is publicly available through legitimate means (e.g., open access publication, the publisher's website, an institutional or preprint repository), and that posting this link does not violate any agreement, embargo, or known prohibition.
            </span>
          </label>
          <div style={styles.formButtons}>
            <button
              type="button"
              disabled={!(affirmed && !unsafeUrl && !submitting)}
              onClick={affirmed && !unsafeUrl && !submitting ? handleAdd : undefined}
              style={affirmed && !unsafeUrl && !submitting ? styles.saveBtn : { ...styles.saveBtn, opacity: 0.4, cursor: 'default' }}
            >
              {submitting ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={resetForm} style={styles.cancelBtn}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
};

const FONT = '"EB Garamond", Georgia, serif';

const styles = {
  wrap: { borderTop: '1px solid #eee', padding: '12px 20px', backgroundColor: '#fafafa', fontFamily: FONT, cursor: 'default' },
  list: { display: 'flex', flexDirection: 'column', gap: '10px' },
  answerRow: { transition: 'background-color 0.2s', borderRadius: '3px' },
  answerTopRow: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' },
  answerTitle: { fontSize: '14px', color: '#333', textDecoration: 'underline', fontFamily: FONT, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  answerDate: { fontSize: '12px', color: '#888', fontFamily: FONT, flexShrink: 0 },
  answerComment: { fontSize: '13px', color: '#555', fontFamily: FONT, lineHeight: 1.4, marginTop: '3px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  answerActions: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '4px' },
  confirmPrompt: { fontSize: '12px', color: '#666', fontFamily: FONT },
  // Link-style buttons: reset the native button chrome so they render as the
  // plain underlined text they were as spans, but stay keyboard-accessible.
  actionBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  actionBtnMuted: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  addRow: { marginTop: '10px' },
  addBtn: { fontSize: '13px', color: '#999', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  form: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' },
  input: { width: '100%', fontFamily: FONT, fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', fontFamily: FONT, fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  dateLabel: { display: 'flex', alignItems: 'center', gap: '8px' },
  dateLabelText: { fontSize: '12px', color: '#666', fontFamily: FONT },
  dateInput: { fontFamily: FONT, fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '5px 8px', outline: 'none' },
  formError: { fontSize: '12px', color: '#c44', fontFamily: FONT },
  unsafeUrlError: { fontSize: '12px', color: '#c44', fontFamily: FONT, backgroundColor: '#fdf0f0', padding: '8px 10px', borderRadius: '3px', lineHeight: 1.4 },
  previewStatus: { fontSize: '11px', color: '#999', fontFamily: FONT },
  previewBox: { fontSize: '12px', color: '#555', fontFamily: FONT, backgroundColor: '#f0ede8', padding: '6px 8px', borderRadius: '3px', lineHeight: 1.4, overflowWrap: 'anywhere', wordBreak: 'break-word' },
  affirmLabel: { display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', marginTop: '4px' },
  affirmCheckbox: { marginTop: '3px', flexShrink: 0 },
  affirmText: { fontSize: '11px', color: '#666', fontFamily: FONT, lineHeight: 1.4 },
  formButtons: { display: 'flex', gap: '10px', marginTop: '4px' },
  saveBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: FONT, border: '1px solid #e0d9cf', padding: '2px 10px', borderRadius: '3px', backgroundColor: '#faf9f6' },
  cancelBtn: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: FONT, border: 'none', background: 'none', padding: 0 },
};

export default CardAnswerSection;
