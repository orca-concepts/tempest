import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { feedbackAPI } from '../services/api';
import LinkifiedText from './LinkifiedText';
import OrcidBadge from './OrcidBadge';

// Phase 72e-2: page-level reader feedback for a curated page — branch (new_child)
// suggestions. A modal overlay (Escape closes, portal to body so it stacks above
// the fixed Add / Search bar). Three parts: the page header, a "Suggest a new
// question or branch" builder (login required; guests get a prompt), and the list
// of existing branch suggestions as nested trees with replies, votes, and owner
// controls. House style throughout: inline styles, explicit fontFamily, no colored
// buttons, no emoji, no italics, all controls <button>s, no window.confirm/alert.

const FONT = '"EB Garamond", Georgia, serif';
const STATUS_LABEL = { open: 'Open', incorporated: 'Incorporated', declined: 'Declined' };

// ─── Branch builder (nested draft editor) ───────────────────────────────────
const emptyNode = () => ({ name: '', answer: null, children: [] });

// Immutable helpers keyed by an index path into the draft forest.
const updateAt = (nodes, path, fn) => {
  if (path.length === 0) return nodes;
  const [i, ...rest] = path;
  return nodes.map((n, idx) => {
    if (idx !== i) return n;
    if (rest.length === 0) return fn(n);
    return { ...n, children: updateAt(n.children, rest, fn) };
  });
};
const removeAt = (nodes, path) => {
  const [i, ...rest] = path;
  if (rest.length === 0) return nodes.filter((_, idx) => idx !== i);
  return nodes.map((n, idx) => (idx === i ? { ...n, children: removeAt(n.children, rest) } : n));
};

const countNodes = (nodes) => nodes.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);

// Convert a draft forest to the API payload (drop answers without a URL).
const toPayload = (nodes) => nodes.map((n) => {
  const out = { name: n.name.trim(), children: toPayload(n.children) };
  if (n.answer && n.answer.url && n.answer.url.trim()) {
    out.answer = {
      url: n.answer.url.trim(),
      title: n.answer.title ? n.answer.title.trim() : undefined,
      publishedOn: n.answer.publishedOn || undefined,
      comment: n.answer.comment ? n.answer.comment.trim() : undefined,
    };
  }
  return out;
});

// Convert an API node tree back to a draft forest (for editing).
const toDraft = (nodes) => (nodes || []).map((n) => ({
  name: n.name || '',
  answer: n.answer ? {
    url: n.answer.url || '', title: n.answer.title || '',
    publishedOn: n.answer.publishedOn || '', comment: n.answer.comment || '',
  } : null,
  children: toDraft(n.children),
}));

const NodeEditor = ({ node, path, onChange, onRemove, depth }) => {
  const setField = (field, value) => onChange((prev) => updateAt(prev, path, (n) => ({ ...n, [field]: value })));
  const setAnswer = (field, value) =>
    onChange((prev) => updateAt(prev, path, (n) => ({ ...n, answer: { ...(n.answer || {}), [field]: value } })));
  const addChild = () => onChange((prev) => updateAt(prev, path, (n) => ({ ...n, children: [...n.children, emptyNode()] })));
  const toggleAnswer = () =>
    onChange((prev) => updateAt(prev, path, (n) => ({ ...n, answer: n.answer ? null : { url: '', title: '', publishedOn: '', comment: '' } })));

  return (
    <div style={{ ...styles.nodeEditor, marginLeft: depth > 0 ? 16 : 0 }}>
      <div style={styles.nodeRow}>
        <input
          type="text"
          value={node.name}
          onChange={(e) => setField('name', e.target.value)}
          placeholder="Suggested question"
          style={styles.input}
          maxLength={255}
        />
        <button type="button" onClick={() => onRemove(path)} style={styles.linkBtnMuted} title="Remove this question">Remove</button>
      </div>
      <div style={styles.nodeActions}>
        <button type="button" onClick={addChild} style={styles.linkBtn}>+ Add child</button>
        <button type="button" onClick={toggleAnswer} style={styles.linkBtn}>{node.answer ? 'Remove answer' : '+ Add answer'}</button>
      </div>
      {node.answer && (
        <div style={styles.answerFields}>
          <input type="text" value={node.answer.url} onChange={(e) => setAnswer('url', e.target.value)} placeholder="Answer URL (https://…)" style={styles.input} />
          <input type="text" value={node.answer.title} onChange={(e) => setAnswer('title', e.target.value)} placeholder="Answer title (optional)" style={styles.input} maxLength={255} />
          <input type="date" value={node.answer.publishedOn} onChange={(e) => setAnswer('publishedOn', e.target.value)} style={styles.dateInput} />
          <textarea value={node.answer.comment} onChange={(e) => setAnswer('comment', e.target.value)} placeholder="Answer comment (optional)" style={styles.textarea} rows={2} maxLength={2000} />
        </div>
      )}
      {node.children.map((child, idx) => (
        <NodeEditor key={idx} node={child} path={[...path, idx]} onChange={onChange} onRemove={onRemove} depth={depth + 1} />
      ))}
    </div>
  );
};

const BranchBuilder = ({ initialNodes, initialComment, onSubmit, onCancel, submitLabel }) => {
  const [nodes, setNodes] = useState(() => (initialNodes && initialNodes.length ? initialNodes : [emptyNode()]));
  const [comment, setComment] = useState(initialComment || '');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const total = countNodes(nodes);
  const submit = async () => {
    if (busy) return;
    setError(null);
    if (nodes.some((n) => hasEmptyName(n))) { setError('Every suggested question needs text.'); return; }
    if (total > 50) { setError('A suggestion can have at most 50 questions.'); return; }
    setBusy(true);
    try {
      await onSubmit({ nodes: toPayload(nodes), comment: comment.trim() });
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not submit');
      setBusy(false);
    }
  };

  return (
    <div style={styles.form}>
      {nodes.map((node, idx) => (
        <NodeEditor
          key={idx}
          node={node}
          path={[idx]}
          onChange={setNodes}
          onRemove={(p) => setNodes((prev) => removeAt(prev, p))}
          depth={0}
        />
      ))}
      <button type="button" onClick={() => setNodes((prev) => [...prev, emptyNode()])} style={styles.linkBtn}>+ Add another question</button>
      <label style={styles.fieldLabel}>
        <span style={styles.fieldLabelText}>Comment (optional)</span>
        <textarea value={comment} onChange={(e) => setComment(e.target.value)} style={styles.textarea} rows={3} maxLength={2000} />
      </label>
      <div style={styles.countNote}>{total} question{total === 1 ? '' : 's'} (max 50)</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.formButtons}>
        <button type="button" onClick={submit} disabled={busy} style={styles.primaryBtn}>
          {busy ? 'Submitting…' : (submitLabel || 'Submit suggestion')}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} style={styles.cancelBtn}>Cancel</button>
      </div>
    </div>
  );
};

const hasEmptyName = (node) => !node.name.trim() || node.children.some(hasEmptyName);

// ─── Display of a submitted branch's nodes ──────────────────────────────────
const NodeView = ({ node, depth }) => (
  <div style={{ ...styles.nodeView, marginLeft: depth > 0 ? 16 : 0 }}>
    <div style={styles.nodeViewName}>{node.name}</div>
    {node.answer && (
      <div style={styles.answerView}>
        <span style={styles.answerIcon}>{'↗'}</span>
        <div style={styles.answerBody}>
          <div style={styles.answerTitleRow}>
            <a href={node.answer.url} target="_blank" rel="noopener noreferrer" style={styles.answerTitle} title={node.answer.url}>
              {node.answer.title || node.answer.url}
            </a>
            {node.answer.publishedOn && <span style={styles.answerDate}>{node.answer.publishedOn}</span>}
          </div>
          {node.answer.comment && <LinkifiedText text={node.answer.comment} lines={2} style={styles.answerComment} />}
        </div>
      </div>
    )}
    {(node.children || []).map((c) => <NodeView key={c.id} node={c} depth={depth + 1} />)}
  </div>
);

const timeStr = (d) => { try { return new Date(d).toLocaleDateString(); } catch { return ''; } };

const BranchItem = ({ item, isOwner, canModerate, onChanged, isGuest, onRequestLogin }) => {
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
    try { await fn(); await onChanged(); }
    catch (err) { setLocalErr(err?.response?.data?.error || 'Action failed'); }
    finally { setBusy(false); }
  };

  const vote = () => run(() => feedbackAPI.vote(item.id));
  const del = () => run(() => feedbackAPI.remove(item.id));
  const setStatus = (status) => run(async () => { await feedbackAPI.setStatus(item.id, status, statusReply.trim() || undefined); setStatusReply(''); });
  const hide = (hidden) => run(() => feedbackAPI.hide(item.id, hidden));
  const postReply = () => run(async () => { await feedbackAPI.addReply(item.id, replyBody.trim()); setReplyBody(''); setShowReply(false); });
  const editReply = (replyId) => run(async () => { await feedbackAPI.editReply(replyId, replyEditBody.trim()); setEditingReplyId(null); setReplyEditBody(''); });
  const delReply = (replyId) => run(() => feedbackAPI.removeReply(replyId));
  const hideReply = (replyId, hidden) => run(() => feedbackAPI.hideReply(replyId, hidden));

  if (editing) {
    return (
      <div style={styles.item}>
        <BranchBuilder
          initialNodes={toDraft(item.nodes)}
          initialComment={item.comment || ''}
          submitLabel="Save"
          onSubmit={async ({ nodes, comment }) => {
            await feedbackAPI.edit(item.id, { nodes, comment });
            setEditing(false);
            await onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div style={{ ...styles.item, ...(item.isHidden ? styles.itemHidden : {}) }}>
      <div style={styles.itemHead}>
        <span style={styles.kindLabel}>Suggested new question{(item.nodes || []).length > 1 || (item.nodes || []).some((n) => (n.children || []).length) ? 's' : ''}</span>
        {item.status !== 'open' && <span style={styles.statusLabel}>{STATUS_LABEL[item.status]}</span>}
        {item.isHidden && <span style={styles.hiddenLabel}>Hidden</span>}
      </div>

      <div style={styles.nodesWrap}>
        {(item.nodes || []).map((n) => <NodeView key={n.id} node={n} depth={0} />)}
      </div>

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
        >▲ {item.voteCount}</button>
        <button type="button" onClick={isGuest ? onRequestLogin : () => setShowReply((v) => !v)} style={styles.linkBtn}>Reply</button>
        {item.canEdit && (
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

      {isOwner && (
        <div style={styles.ownerControls}>
          <textarea value={statusReply} onChange={(e) => setStatusReply(e.target.value)} placeholder="Optional reply with your decision…" style={styles.textarea} rows={2} maxLength={2000} />
          <div style={styles.ownerButtons}>
            {item.status !== 'incorporated' && <button type="button" onClick={() => setStatus('incorporated')} disabled={busy} style={styles.ownerBtn}>Mark incorporated</button>}
            {item.status !== 'declined' && <button type="button" onClick={() => setStatus('declined')} disabled={busy} style={styles.ownerBtn}>Decline</button>}
            {item.status !== 'open' && <button type="button" onClick={() => setStatus('open')} disabled={busy} style={styles.ownerBtn}>Reopen</button>}
          </div>
        </div>
      )}

      {localErr && <div style={styles.error}>{localErr}</div>}
    </div>
  );
};

const PageFeedbackPanel = ({
  communityId,
  parentEdgeId = null,
  questionText,
  isOwner = false,
  isGuest = false,
  onRequestLogin,
  onClose,
  onChanged,
}) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showBuilder, setShowBuilder] = useState(false);
  const reqGen = useRef(0);

  // Stale-State Guard: community/page-keyed fetch, bail on stale setters.
  const load = useCallback(async () => {
    const gen = ++reqGen.current;
    setLoading(true);
    try {
      const res = await feedbackAPI.getPage(communityId, parentEdgeId);
      if (gen !== reqGen.current) return;
      setData(res.data);
      setError(null);
    } catch (err) {
      if (gen !== reqGen.current) return;
      setError('Could not load suggestions');
    } finally {
      if (gen === reqGen.current) setLoading(false);
    }
  }, [communityId, parentEdgeId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const refresh = useCallback(async () => {
    await load();
    if (onChanged) await onChanged();
  }, [load, onChanged]);

  const requestLogin = useCallback(() => {
    onClose();
    if (onRequestLogin) onRequestLogin();
  }, [onClose, onRequestLogin]);

  const archived = !!(data && data.archived);
  const canModerate = !!(data && data.canModerate);

  return createPortal((
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div style={styles.headerTitle}>{questionText || 'Community root'}</div>
          <button type="button" onClick={onClose} style={styles.closeBtn} title="Close">✕</button>
        </div>
        <div style={styles.subHeader}>Suggest a new question or branch</div>

        <div style={styles.suggestSection}>
          {archived ? (
            <div style={styles.muted}>This question has been removed; suggestions are archived.</div>
          ) : isGuest ? (
            <button type="button" onClick={requestLogin} style={styles.primaryBtn}>Log in to suggest a new question</button>
          ) : !showBuilder ? (
            <button type="button" onClick={() => setShowBuilder(true)} style={styles.primaryBtn}>Suggest a new question or branch</button>
          ) : (
            <BranchBuilder
              onSubmit={async ({ nodes, comment }) => {
                await feedbackAPI.createNewChild({ edgeId: parentEdgeId, communityId, nodes, comment });
                setShowBuilder(false);
                await refresh();
              }}
              onCancel={() => setShowBuilder(false)}
            />
          )}
        </div>

        <div style={styles.list}>
          {loading && <div style={styles.muted}>Loading…</div>}
          {error && <div style={styles.error}>{error}</div>}
          {!loading && !error && data && data.items.length === 0 && (
            <div style={styles.muted}>No suggestions yet.</div>
          )}
          {!loading && !error && data && data.items.map((item) => (
            <BranchItem
              key={item.id}
              item={item}
              isOwner={isOwner}
              canModerate={canModerate}
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
    backgroundColor: '#faf9f6', borderRadius: '8px', width: '100%', maxWidth: '600px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.3)', fontFamily: FONT, padding: '20px',
  },
  header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' },
  headerTitle: { fontSize: '20px', color: '#222', fontFamily: FONT, overflowWrap: 'anywhere' },
  closeBtn: { fontSize: '16px', color: '#888', border: 'none', background: 'none', cursor: 'pointer', fontFamily: FONT, lineHeight: 1, flexShrink: 0 },
  subHeader: { fontSize: '13px', color: '#888', fontFamily: FONT, marginTop: '2px', marginBottom: '14px' },
  suggestSection: { marginBottom: '18px', borderBottom: '1px solid #e8e4dc', paddingBottom: '16px' },
  form: { display: 'flex', flexDirection: 'column', gap: '8px' },
  nodeEditor: { border: '1px solid #e8e4dc', borderRadius: '4px', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'white' },
  nodeRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  nodeActions: { display: 'flex', gap: '12px' },
  answerFields: { display: 'flex', flexDirection: 'column', gap: '5px', paddingLeft: '8px', borderLeft: '2px solid #ece8e0' },
  fieldLabel: { display: 'flex', flexDirection: 'column', gap: '3px' },
  fieldLabelText: { fontSize: '12px', color: '#666', fontFamily: FONT },
  input: { width: '100%', fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box' },
  textarea: { width: '100%', fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '6px 8px', outline: 'none', boxSizing: 'border-box', resize: 'vertical' },
  dateInput: { fontFamily: FONT, fontSize: '14px', color: '#333', backgroundColor: 'white', border: '1px solid #d4d0c8', borderRadius: '3px', padding: '5px 8px', outline: 'none', width: 'fit-content' },
  countNote: { fontSize: '12px', color: '#999', fontFamily: FONT },
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
  nodesWrap: { marginBottom: '6px' },
  nodeView: { marginTop: '4px' },
  nodeViewName: { fontSize: '14px', color: '#333', fontFamily: FONT, lineHeight: 1.4, overflowWrap: 'anywhere' },
  answerView: { display: 'flex', alignItems: 'flex-start', gap: '6px', marginTop: '2px', marginLeft: '8px' },
  answerIcon: { fontSize: '12px', color: '#999', flexShrink: 0, marginTop: '3px' },
  answerBody: { flex: 1, minWidth: 0 },
  answerTitleRow: { display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' },
  answerTitle: { fontSize: '13px', fontFamily: FONT, color: '#444', textDecoration: 'underline', wordBreak: 'break-word' },
  answerDate: { fontSize: '12px', color: '#999', flexShrink: 0, fontFamily: FONT },
  answerComment: { fontSize: '12px', fontFamily: FONT, color: '#888', lineHeight: 1.35, marginTop: '2px', wordBreak: 'break-word' },
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

export default PageFeedbackPanel;
