import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { feedbackAPI } from '../services/api';
import LinkifiedText from './LinkifiedText';
import OrcidBadge from './OrcidBadge';

// Phase 72e-1: reader feedback panel for one curated question card. A modal
// overlay (Escape closes) with three parts: the question header, a "Suggest a
// change" form (login required; guests get a prompt), and the public feedback
// list. Owners additionally get status controls and Hide/Unhide. Every list/count
// refresh goes through onChanged so the card's badge stays in sync.
// House style throughout: inline styles, explicit fontFamily, no colored buttons,
// no emoji, no italics, all controls are <button>s, no window.confirm/alert.

const FONT = '"EB Garamond", Georgia, serif';

const KIND_LABEL = {
  edit_question: 'Suggested rewording',
  edit_answer: 'Suggested answer change',
  add_precedent: 'Suggested precedent',
  remove_precedent: 'Suggested precedent removal',
  add_subsequent: 'Suggested subsequent',
  remove_subsequent: 'Suggested subsequent removal',
  general: 'Comment',
  new_child: 'Suggested new question',
};

const STATUS_LABEL = { open: 'Open', incorporated: 'Incorporated', declined: 'Declined' };

// Build the picker options for the "Suggest a change" form, filtered to what the
// card actually has (no "change an answer" with no answers, etc.).
function availableKinds(concept) {
  const answers = concept.answers || [];
  const precedents = concept.precedents || [];
  const subsequents = concept.subsequents || [];
  const hasSiblings = true; // siblings eligibility is computed in the form itself
  const opts = [{ value: 'edit_question', label: 'Reword the question' }];
  if (answers.length > 0) opts.push({ value: 'edit_answer', label: 'Change an answer' });
  if (hasSiblings) {
    opts.push({ value: 'add_precedent', label: 'Add a precedent question' });
    opts.push({ value: 'add_subsequent', label: 'Add a subsequent question' });
  }
  if (precedents.length > 0) opts.push({ value: 'remove_precedent', label: 'Remove a precedent question' });
  if (subsequents.length > 0) opts.push({ value: 'remove_subsequent', label: 'Remove a subsequent question' });
  opts.push({ value: 'general', label: 'Something else' });
  return opts;
}

// Shared form for creating a new item and for editing an existing one. In edit
// mode the kind and target are fixed; only the proposal fields and comment change.
const FeedbackForm = ({ concept, initial, onSubmit, onCancel }) => {
  const editing = !!initial;
  const kinds = availableKinds(concept);
  const [kind, setKind] = useState(initial ? initial.kind : (kinds[0] ? kinds[0].value : 'general'));
  const [comment, setComment] = useState(initial ? (initial.comment || '') : '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // edit_question
  const [name, setName] = useState(
    initial && initial.kind === 'edit_question'
      ? (initial.proposal?.name || '')
      : (concept.name || '')
  );

  // edit_answer
  const answers = concept.answers || [];
  const [targetLinkId, setTargetLinkId] = useState(
    initial && initial.kind === 'edit_answer' ? initial.targetLinkId : (answers[0] ? answers[0].id : null)
  );
  const selectedAnswer = answers.find((a) => a.id === targetLinkId) || null;
  const initialAns = initial && initial.kind === 'edit_answer' ? (initial.proposal || {}) : null;
  const [ansTitle, setAnsTitle] = useState(initialAns ? (initialAns.title || '') : '');
  const [ansUrl, setAnsUrl] = useState(initialAns ? (initialAns.url || '') : '');
  const [ansComment, setAnsComment] = useState(initialAns ? (initialAns.comment || '') : '');
  const [ansDate, setAnsDate] = useState(initialAns ? (initialAns.publishedOn || '') : '');

  // On picking an answer (create mode), prefill the fields from it.
  useEffect(() => {
    if (editing || kind !== 'edit_answer' || !selectedAnswer) return;
    setAnsTitle(selectedAnswer.title || '');
    setAnsUrl(selectedAnswer.url || '');
    setAnsComment(selectedAnswer.comment || '');
    setAnsDate(selectedAnswer.publishedOn || '');
  }, [targetLinkId, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  // sequence kinds — eligible sibling options come from the card's own data.
  const precedents = concept.precedents || [];
  const subsequents = concept.subsequents || [];
  const linkedEdgeIds = new Set([
    ...precedents.map((p) => p.edgeId),
    ...subsequents.map((s) => s.edgeId),
  ]);
  const siblingOptions = (concept._siblings || []).filter(
    (s) => s.edge_id !== concept.edge_id && !linkedEdgeIds.has(s.edge_id)
  );
  const [targetEdgeId, setTargetEdgeId] = useState(null);

  const sequenceOptions = (() => {
    if (kind === 'add_precedent' || kind === 'add_subsequent') {
      return siblingOptions.map((s) => ({ edgeId: s.edge_id, name: s.name }));
    }
    if (kind === 'remove_precedent') return precedents.map((p) => ({ edgeId: p.edgeId, name: p.name }));
    if (kind === 'remove_subsequent') return subsequents.map((s) => ({ edgeId: s.edgeId, name: s.name }));
    return [];
  })();

  // Reset the sequence target whenever the kind changes.
  useEffect(() => {
    if (editing) return;
    setTargetEdgeId(sequenceOptions[0] ? sequenceOptions[0].edgeId : null);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSequence = ['add_precedent', 'remove_precedent', 'add_subsequent', 'remove_subsequent'].includes(kind);

  const submit = async () => {
    if (busy) return;
    setError(null);
    const payload = { comment: comment.trim() };
    if (kind === 'edit_question') {
      if (!name.trim()) { setError('Enter the reworded question.'); return; }
      payload.proposal = { name: name.trim() };
    } else if (kind === 'edit_answer') {
      if (!editing && !targetLinkId) { setError('Choose an answer.'); return; }
      const prop = {};
      if (ansTitle.trim()) prop.title = ansTitle.trim();
      if (ansUrl.trim()) prop.url = ansUrl.trim();
      prop.comment = ansComment.trim();
      if (ansDate) prop.publishedOn = ansDate;
      payload.proposal = prop;
      if (!editing) payload.targetLinkId = targetLinkId;
    } else if (isSequence) {
      if (!editing) {
        if (!targetEdgeId) { setError('Choose a question.'); return; }
        payload.targetEdgeId = targetEdgeId;
      }
    } else if (kind === 'general') {
      if (!payload.comment) { setError('Enter a comment.'); return; }
    }
    if (!editing) payload.kind = kind;
    setBusy(true);
    try {
      await onSubmit(payload);
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not submit');
      setBusy(false);
    }
  };

  return (
    <div style={styles.form}>
      {!editing && (
        <label style={styles.fieldLabel}>
          <span style={styles.fieldLabelText}>What would you like to suggest?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} style={styles.select}>
            {kinds.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </label>
      )}

      {kind === 'edit_question' && (
        <label style={styles.fieldLabel}>
          <span style={styles.fieldLabelText}>Proposed question</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} style={styles.input} maxLength={255} />
        </label>
      )}

      {kind === 'edit_answer' && (
        <>
          {!editing && (
            <label style={styles.fieldLabel}>
              <span style={styles.fieldLabelText}>Which answer?</span>
              <select
                value={targetLinkId || ''}
                onChange={(e) => setTargetLinkId(parseInt(e.target.value, 10))}
                style={styles.select}
              >
                {answers.map((a) => (
                  <option key={a.id} value={a.id}>{a.title || a.url}</option>
                ))}
              </select>
            </label>
          )}
          <label style={styles.fieldLabel}>
            <span style={styles.fieldLabelText}>Proposed title</span>
            <input type="text" value={ansTitle} onChange={(e) => setAnsTitle(e.target.value)} style={styles.input} maxLength={255} />
          </label>
          <label style={styles.fieldLabel}>
            <span style={styles.fieldLabelText}>Proposed URL</span>
            <input type="text" value={ansUrl} onChange={(e) => setAnsUrl(e.target.value)} style={styles.input} placeholder="https://..." />
          </label>
          <label style={styles.fieldLabel}>
            <span style={styles.fieldLabelText}>Proposed comment</span>
            <textarea value={ansComment} onChange={(e) => setAnsComment(e.target.value)} style={styles.textarea} rows={2} maxLength={2000} />
          </label>
          <label style={styles.fieldLabel}>
            <span style={styles.fieldLabelText}>Proposed publication date</span>
            <input type="date" value={ansDate} onChange={(e) => setAnsDate(e.target.value)} style={styles.dateInput} />
          </label>
        </>
      )}

      {isSequence && !editing && (
        <label style={styles.fieldLabel}>
          <span style={styles.fieldLabelText}>Which question?</span>
          {sequenceOptions.length === 0 ? (
            <span style={styles.muted}>No eligible questions.</span>
          ) : (
            <select
              value={targetEdgeId || ''}
              onChange={(e) => setTargetEdgeId(parseInt(e.target.value, 10))}
              style={styles.select}
            >
              {sequenceOptions.map((o) => (
                <option key={o.edgeId} value={o.edgeId}>{o.name}</option>
              ))}
            </select>
          )}
        </label>
      )}

      <label style={styles.fieldLabel}>
        <span style={styles.fieldLabelText}>Comment{kind === 'general' ? '' : ' (optional)'}</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} style={styles.textarea} rows={3} maxLength={2000} />
      </label>

      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.formButtons}>
        <button type="button" onClick={submit} disabled={busy} style={styles.primaryBtn}>
          {busy ? 'Submitting…' : (editing ? 'Save' : 'Submit suggestion')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={styles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
};

// A short "before → after" summary of what an item proposes.
const ProposalSummary = ({ item }) => {
  const snap = item.snapshot || {};
  const prop = item.proposal || {};
  if (item.kind === 'edit_question') {
    return (
      <div style={styles.proposal}>
        <div style={styles.beforeAfter}><span style={styles.baLabel}>From</span> {snap.questionText}</div>
        <div style={styles.beforeAfter}><span style={styles.baLabel}>To</span> {prop.name}</div>
      </div>
    );
  }
  if (item.kind === 'edit_answer') {
    const ans = snap.answer || {};
    return (
      <div style={styles.proposal}>
        <div style={styles.beforeAfter}><span style={styles.baLabel}>Answer</span> {ans.title || ans.url || '(untitled)'}</div>
        {prop.title !== undefined && <div style={styles.beforeAfter}><span style={styles.baLabel}>Title →</span> {prop.title}</div>}
        {prop.url !== undefined && <div style={styles.beforeAfter}><span style={styles.baLabel}>URL →</span> {prop.url}</div>}
        {prop.publishedOn !== undefined && <div style={styles.beforeAfter}><span style={styles.baLabel}>Date →</span> {prop.publishedOn}</div>}
        {prop.comment !== undefined && prop.comment !== '' && <div style={styles.beforeAfter}><span style={styles.baLabel}>Comment →</span> {prop.comment}</div>}
      </div>
    );
  }
  if (['add_precedent', 'remove_precedent', 'add_subsequent', 'remove_subsequent'].includes(item.kind)) {
    const verb = item.kind.startsWith('add') ? 'Add' : 'Remove';
    const rel = item.kind.includes('precedent') ? 'precedent' : 'subsequent';
    return (
      <div style={styles.proposal}>
        <div style={styles.beforeAfter}><span style={styles.baLabel}>{verb} {rel}</span> {snap.siblingName}</div>
      </div>
    );
  }
  return null;
};

const timeStr = (d) => {
  try { return new Date(d).toLocaleDateString(); } catch { return ''; }
};

const FeedbackItem = ({ item, isOwner, canModerate, currentUserId, onChanged, onError, isGuest, onRequestLogin }) => {
  const [showReply, setShowReply] = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [editingReplyId, setEditingReplyId] = useState(null);
  const [replyEditBody, setReplyEditBody] = useState('');
  const [statusReply, setStatusReply] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localErr, setLocalErr] = useState(null);

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setLocalErr(null);
    try {
      await fn();
      await onChanged();
    } catch (err) {
      setLocalErr(err?.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const vote = () => run(() => feedbackAPI.vote(item.id));
  const del = () => run(() => feedbackAPI.remove(item.id));
  const setStatus = (status) => run(async () => {
    await feedbackAPI.setStatus(item.id, status, statusReply.trim() || undefined);
    setStatusReply('');
  });
  const hide = (hidden) => run(() => feedbackAPI.hide(item.id, hidden));
  const postReply = () => run(async () => {
    await feedbackAPI.addReply(item.id, replyBody.trim());
    setReplyBody('');
    setShowReply(false);
  });
  const editReply = (replyId) => run(async () => {
    await feedbackAPI.editReply(replyId, replyEditBody.trim());
    setEditingReplyId(null);
    setReplyEditBody('');
  });
  const delReply = (replyId) => run(() => feedbackAPI.removeReply(replyId));
  const hideReply = (replyId, hidden) => run(() => feedbackAPI.hideReply(replyId, hidden));

  return (
    <div style={{ ...styles.item, ...(item.isHidden ? styles.itemHidden : {}) }}>
      <div style={styles.itemHead}>
        <span style={styles.kindLabel}>{KIND_LABEL[item.kind] || 'Suggestion'}</span>
        {item.status !== 'open' && <span style={styles.statusLabel}>{STATUS_LABEL[item.status]}</span>}
        {item.isHidden && <span style={styles.hiddenLabel}>Hidden</span>}
      </div>

      <ProposalSummary item={item} />

      {item.comment && <LinkifiedText text={item.comment} lines={6} style={styles.comment} />}

      <div style={styles.metaRow}>
        <span style={styles.metaAuthor}>
          {item.author ? item.author.username : '[deleted]'}
          {item.author && item.author.orcidId && <OrcidBadge orcidId={item.author.orcidId} />}
        </span>
        <span style={styles.metaTime}>{timeStr(item.createdAt)}</span>
        <button
          type="button"
          onClick={isGuest ? onRequestLogin : vote}
          disabled={busy}
          style={{ ...styles.voteBtn, ...(item.userVoted ? styles.voteBtnActive : {}) }}
          title={isGuest ? 'Log in to vote' : 'Upvote this suggestion'}
        >
          ▲ {item.voteCount}
        </button>
        <button
          type="button"
          onClick={isGuest ? onRequestLogin : () => setShowReply((v) => !v)}
          style={styles.linkBtn}
        >Reply</button>
        {item.canEdit && !editing && (
          <>
            <button type="button" onClick={() => setEditing(true)} style={styles.linkBtn}>Edit</button>
            {confirmDelete ? (
              <>
                <span style={styles.confirmText}>Delete?</span>
                <button type="button" onClick={del} disabled={busy} style={styles.linkBtn}>Yes</button>
                <button type="button" onClick={() => setConfirmDelete(false)} style={styles.linkBtnMuted}>No</button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} style={styles.linkBtnMuted}>Delete</button>
            )}
          </>
        )}
        {canModerate && (
          <button type="button" onClick={() => hide(!item.isHidden)} disabled={busy} style={styles.linkBtnMuted}>
            {item.isHidden ? 'Unhide' : 'Hide'}
          </button>
        )}
      </div>

      {editing && (
        <FeedbackForm
          concept={{ name: item.snapshot?.questionText, edge_id: null, answers: [], precedents: [], subsequents: [] }}
          initial={item}
          onSubmit={async (payload) => {
            await feedbackAPI.edit(item.id, { comment: payload.comment, proposal: payload.proposal });
            setEditing(false);
            await onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}

      {/* Replies */}
      {item.replies && item.replies.length > 0 && (
        <div style={styles.replies}>
          {item.replies.map((r) => (
            <div key={r.id} style={{ ...styles.reply, ...(r.isHidden ? styles.itemHidden : {}) }}>
              {editingReplyId === r.id ? (
                <div style={styles.replyEdit}>
                  <textarea value={replyEditBody} onChange={(e) => setReplyEditBody(e.target.value)} style={styles.textarea} rows={2} maxLength={2000} />
                  <div style={styles.formButtons}>
                    <button type="button" onClick={() => editReply(r.id)} disabled={busy} style={styles.primaryBtn}>Save</button>
                    <button type="button" onClick={() => setEditingReplyId(null)} style={styles.cancelBtn}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <LinkifiedText text={r.body} lines={6} style={styles.comment} />
                  <div style={styles.metaRow}>
                    <span style={styles.metaAuthor}>
                      {r.author ? r.author.username : '[deleted]'}
                      {r.author && r.author.orcidId && <OrcidBadge orcidId={r.author.orcidId} />}
                      {r.isOwnerReply && <span style={styles.ownerTag}>Owner</span>}
                    </span>
                    <span style={styles.metaTime}>{timeStr(r.createdAt)}</span>
                    {r.canEdit && (
                      <>
                        <button type="button" onClick={() => { setEditingReplyId(r.id); setReplyEditBody(r.body); }} style={styles.linkBtn}>Edit</button>
                        <button type="button" onClick={() => delReply(r.id)} disabled={busy} style={styles.linkBtnMuted}>Delete</button>
                      </>
                    )}
                    {canModerate && (
                      <button type="button" onClick={() => hideReply(r.id, !r.isHidden)} disabled={busy} style={styles.linkBtnMuted}>
                        {r.isHidden ? 'Unhide' : 'Hide'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {showReply && (
        <div style={styles.replyBox}>
          <textarea value={replyBody} onChange={(e) => setReplyBody(e.target.value)} placeholder="Write a reply…" style={styles.textarea} rows={2} maxLength={2000} />
          <div style={styles.formButtons}>
            <button type="button" onClick={postReply} disabled={busy || !replyBody.trim()} style={styles.primaryBtn}>Reply</button>
            <button type="button" onClick={() => { setShowReply(false); setReplyBody(''); }} style={styles.cancelBtn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Owner status controls */}
      {isOwner && (
        <div style={styles.ownerControls}>
          <textarea
            value={statusReply}
            onChange={(e) => setStatusReply(e.target.value)}
            placeholder="Optional reply with your decision…"
            style={styles.textarea}
            rows={2}
            maxLength={2000}
          />
          <div style={styles.ownerButtons}>
            {item.status !== 'incorporated' && (
              <button type="button" onClick={() => setStatus('incorporated')} disabled={busy} style={styles.ownerBtn}>Mark incorporated</button>
            )}
            {item.status !== 'declined' && (
              <button type="button" onClick={() => setStatus('declined')} disabled={busy} style={styles.ownerBtn}>Decline</button>
            )}
            {item.status !== 'open' && (
              <button type="button" onClick={() => setStatus('open')} disabled={busy} style={styles.ownerBtn}>Reopen</button>
            )}
          </div>
        </div>
      )}

      {localErr && <div style={styles.error}>{localErr}</div>}
    </div>
  );
};

const FeedbackPanel = ({
  concept,
  siblings = [],
  isOwner = false,
  isGuest = false,
  currentUserId = null,
  onRequestLogin,
  onClose,
  onChanged,
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const reqGen = useRef(0);

  const edgeId = concept.edge_id;

  // Stale-State Guard: edge-keyed fetch, bail out of stale setters.
  const load = useCallback(async () => {
    const gen = ++reqGen.current;
    setLoading(true);
    try {
      const res = await feedbackAPI.getForEdge(edgeId);
      if (gen !== reqGen.current) return;
      setData(res.data);
      setError(null);
    } catch (err) {
      if (gen !== reqGen.current) return;
      setError('Could not load feedback');
    } finally {
      if (gen === reqGen.current) setLoading(false);
    }
  }, [edgeId]);

  useEffect(() => { load(); }, [load]);

  // Escape closes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Refresh this panel's list AND the card's open count after any mutation.
  const refresh = useCallback(async () => {
    await load();
    if (onChanged) await onChanged();
  }, [load, onChanged]);

  // The sequence picker needs the sibling grid; stash it on a throwaway copy of
  // the concept so FeedbackForm can read concept._siblings.
  const conceptForForm = { ...concept, _siblings: siblings };

  const canModerate = !!(data && data.canModerate);

  // Close this panel BEFORE opening the login modal — otherwise the modal renders
  // behind the feedback overlay and is unusable (Phase 72e-1 fix).
  const requestLogin = useCallback(() => {
    onClose();
    if (onRequestLogin) onRequestLogin();
  }, [onClose, onRequestLogin]);

  // Portal to document.body so the overlay escapes the card/tab subtree and always
  // stacks above the fixed Add / Search bar (Phase 72e-1 fix 3).
  return createPortal((
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerTitle}>{concept.name}</div>
          <button type="button" onClick={onClose} style={styles.closeBtn} title="Close">✕</button>
        </div>
        <div style={styles.subHeader}>Reader feedback</div>

        {/* Suggest a change */}
        <div style={styles.suggestSection}>
          {isGuest ? (
            <button type="button" onClick={requestLogin} style={styles.primaryBtn}>Log in to suggest a change</button>
          ) : !showForm ? (
            <button type="button" onClick={() => setShowForm(true)} style={styles.primaryBtn}>Suggest a change</button>
          ) : (
            <FeedbackForm
              concept={conceptForForm}
              onSubmit={async (payload) => {
                await feedbackAPI.create({ edgeId, ...payload });
                setShowForm(false);
                await refresh();
              }}
              onCancel={() => setShowForm(false)}
            />
          )}
        </div>

        {/* Feedback list */}
        <div style={styles.list}>
          {loading && <div style={styles.muted}>Loading…</div>}
          {error && <div style={styles.error}>{error}</div>}
          {!loading && !error && data && data.items.length === 0 && (
            <div style={styles.muted}>No feedback yet.</div>
          )}
          {!loading && !error && data && data.items.map((item) => (
            <FeedbackItem
              key={item.id}
              item={item}
              isOwner={isOwner}
              canModerate={canModerate}
              currentUserId={currentUserId}
              onChanged={refresh}
              isGuest={isGuest}
              onRequestLogin={requestLogin}
            />
          ))}
        </div>
      </div>
    </div>
  ), document.body);
};

const styles = {
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center',
    alignItems: 'flex-start', zIndex: 10050, overflowY: 'auto', padding: '40px 16px',
  },
  panel: {
    backgroundColor: '#faf9f6', borderRadius: '8px', width: '100%', maxWidth: '560px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)', fontFamily: FONT, padding: '20px',
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
  headerTitle: { fontSize: '20px', color: '#222', fontFamily: FONT, overflowWrap: 'anywhere' },
  closeBtn: { fontSize: '16px', color: '#888', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT, lineHeight: 1, flexShrink: 0 },
  subHeader: { fontSize: '13px', color: '#888', fontFamily: FONT, marginTop: '2px', marginBottom: '14px' },
  suggestSection: { marginBottom: '18px', borderBottom: '1px solid #e8e4dc', paddingBottom: '16px' },
  form: { display: 'flex', flexDirection: 'column', gap: '8px' },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: '3px' },
  fieldLabelText: { fontSize: '12px', color: '#666', fontFamily: FONT },
  input: { width: '100%', fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' },
  select: { width: '100%', fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '6px 8px', outline: 'none' },
  dateInput: { fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '5px 8px', outline: 'none', width: 'fit-content' },
  formButtons: { display: 'flex', gap: '10px', marginTop: '4px' },
  primaryBtn: { fontSize: '13px', color: '#faf9f6', backgroundColor: '#333', cursor: 'pointer', fontFamily: FONT, border: '1px solid #333', padding: '6px 14px', borderRadius: '3px' },
  cancelBtn: { fontSize: '13px', color: '#777', cursor: 'pointer', fontFamily: FONT, border: '1px solid #d4d0c8', background: 'white', padding: '6px 14px', borderRadius: '3px' },
  list: { display: 'flex', flexDirection: 'column', gap: '14px' },
  item: { border: '1px solid #e8e4dc', borderRadius: '5px', padding: '12px', backgroundColor: 'white' },
  itemHidden: { opacity: 0.6, borderStyle: 'dashed' },
  itemHead: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' },
  kindLabel: { fontSize: '12px', color: '#555', fontFamily: FONT, backgroundColor: '#f0ede8', borderRadius: '10px', padding: '1px 9px' },
  statusLabel: { fontSize: '12px', color: '#555', fontFamily: FONT, border: '1px solid #cfc9bd', borderRadius: '10px', padding: '1px 9px' },
  hiddenLabel: { fontSize: '12px', color: '#999', fontFamily: FONT },
  proposal: { marginBottom: '6px' },
  beforeAfter: { fontSize: '13px', color: '#333', fontFamily: FONT, lineHeight: 1.4, overflowWrap: 'anywhere' },
  baLabel: { color: '#999', fontSize: '12px' },
  comment: { fontSize: '14px', color: '#444', fontFamily: FONT, lineHeight: 1.45, marginTop: '4px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  metaRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px' },
  metaAuthor: { fontSize: '12px', color: '#666', fontFamily: FONT },
  metaTime: { fontSize: '12px', color: '#aaa', fontFamily: FONT },
  ownerTag: { fontSize: '11px', color: '#555', fontFamily: FONT, border: '1px solid #cfc9bd', borderRadius: '8px', padding: '0 6px', marginLeft: '5px' },
  voteBtn: { fontSize: '12px', color: '#555', backgroundColor: '#f0f0f0', border: '1px solid #ddd', borderRadius: '3px', padding: '2px 8px', cursor: 'pointer', fontFamily: FONT },
  voteBtnActive: { backgroundColor: '#333', color: '#faf9f6', borderColor: '#333' },
  linkBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  linkBtnMuted: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: FONT, textDecoration: 'underline', border: 'none', background: 'none', padding: 0 },
  confirmText: { fontSize: '12px', color: '#666', fontFamily: FONT },
  replies: { marginTop: '10px', marginLeft: '12px', borderLeft: '2px solid #ece8e0', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '10px' },
  reply: {},
  replyEdit: { display: 'flex', flexDirection: 'column', gap: '6px' },
  replyBox: { marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' },
  ownerControls: { marginTop: '12px', borderTop: '1px solid #ece8e0', paddingTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' },
  ownerButtons: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
  ownerBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: FONT, border: '1px solid #d4d0c8', background: 'white', padding: '5px 12px', borderRadius: '3px' },
  muted: { fontSize: '13px', color: '#999', fontFamily: FONT },
  error: { fontSize: '12px', color: '#c44', fontFamily: FONT, marginTop: '6px' },
};

export default FeedbackPanel;
