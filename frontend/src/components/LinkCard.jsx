import React, { useState, useEffect, useRef } from 'react';

// Clamped text with "Show more" / "Show less" toggle
const ClampedText = ({ text, lines = 3, style = {} }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) setOverflows(ref.current.scrollHeight > ref.current.clientHeight + 1); }, [text]);
  if (!text || !text.trim()) return null;
  const clampStyle = !expanded ? { display: '-webkit-box', WebkitLineClamp: lines, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : {};
  return (
    <div>
      <div ref={ref} style={{ ...style, ...clampStyle }}>{text}</div>
      {overflows && (
        <span onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
          style={s.toggleLink}>{expanded ? 'Show less' : 'Show more'}</span>
      )}
    </div>
  );
};

const wasEdited = (link) => {
  if (!link.updatedAt || !link.createdAt) return false;
  return Math.abs(new Date(link.updatedAt).getTime() - new Date(link.createdAt).getTime()) > 2000;
};

/**
 * LinkCard — reusable link card.
 *
 * Props:
 *   link, user, isGuest, isFirst, contextLabel,
 *   onVoteToggle, onStartEdit, onRemove,
 *   editingLinkId, editingComment, onEditChange, onSaveComment, onCancelEdit,
 *   showInstances, instanceData, onToggleInstance, renderInstanceSnippet,
 *   cardRef, onRequestLogin,
 *   clickable      — if true, clicking the card body (except the title link) triggers onCardClick
 *   onCardClick    — (link) => void, called when clickable=true and card is clicked
 *   readOnlyVote   — if true, vote count is shown as plain text with no click handler
 */
const LinkCard = ({
  link, user, isGuest, isFirst = false,
  contextLabel,
  onVoteToggle, onStartEdit, onRemove,
  editingLinkId, editingComment, onEditChange, onSaveComment, onCancelEdit,
  showInstances = false, instanceData, onToggleInstance, renderInstanceSnippet,
  cardRef, onRequestLogin,
  clickable = false, onCardClick,
  readOnlyVote = false,
}) => {
  const isCreator = user && link.addedBy === user.id;
  const isEditing = editingLinkId === link.id;
  const iData = instanceData || {};
  const sameCount = (iData.sameConceptInstances || []).length;
  const otherCount = (iData.otherConceptInstances || []).length;
  const hasFetched = !!iData.sameConceptInstances;

  const handleVote = (e) => {
    e.stopPropagation();
    if (isGuest) { if (onRequestLogin) onRequestLogin(); return; }
    if (onVoteToggle) onVoteToggle(link);
  };

  const handleCardBodyClick = (e) => {
    if (!clickable || !onCardClick) return;
    // Don't trigger card click if the user clicked an <a> link (the title)
    if (e.target.tagName === 'A' || e.target.closest('a')) return;
    onCardClick(link);
  };

  const cardStyle = {
    ...(isFirst ? s.cardFirst : s.card),
    ...(clickable ? { cursor: 'pointer' } : {}),
  };

  return (
    <div ref={cardRef} style={cardStyle} onClick={handleCardBodyClick}
      onMouseEnter={clickable ? e => { e.currentTarget.style.backgroundColor = '#f8f5ee'; } : undefined}
      onMouseLeave={clickable ? e => { e.currentTarget.style.backgroundColor = ''; } : undefined}>
      {contextLabel && <div style={s.contextLabel}>{contextLabel}</div>}
      <a href={link.url} target="_blank" rel="noopener noreferrer" style={s.title}
        onClick={e => e.stopPropagation()}>{link.title || link.url}</a>
      {link.title && <div style={s.url}>{link.url}</div>}
      {link.comment && !isEditing && (
        <div style={s.commentBlock}>
          <ClampedText text={link.comment} lines={3} style={s.commentText} />
          <span style={s.commentMeta}>{link.addedByUsername}{wasEdited(link) && <span style={s.editedTag}>(edited)</span>}</span>
        </div>
      )}
      {isEditing && (
        <div style={s.editArea}>
          <textarea value={editingComment} onChange={e => onEditChange && onEditChange(e.target.value)}
            style={s.textarea} rows={2} placeholder="Add a comment..." autoFocus />
          <div style={s.editButtons}>
            <span onClick={() => onSaveComment && onSaveComment(link.id)} style={s.saveBtn}>Save</span>
            <span onClick={() => onCancelEdit && onCancelEdit()} style={s.cancelBtn}>Cancel</span>
          </div>
        </div>
      )}
      <div style={s.bottomRow}>
        {readOnlyVote ? (
          <span style={{ ...s.vote, color: '#888' }}>{'\u25b2'} {link.voteCount}</span>
        ) : (
          <span onClick={handleVote}
            style={{ ...s.vote, cursor: 'pointer', color: link.userVoted ? '#333' : '#888', fontWeight: link.userVoted ? '600' : 'normal' }}
            title={link.userVoted ? 'Remove vote' : 'Upvote'}>{'\u25b2'} {link.voteCount}</span>
        )}
        <span style={s.meta}>
          {link.addedByUsername}
          {!readOnlyVote && isCreator && !isEditing && onStartEdit && <span onClick={e => { e.stopPropagation(); onStartEdit(link); }} style={s.editBtn}>{link.comment ? 'Edit' : 'Add comment'}</span>}
          {!readOnlyVote && isCreator && !isEditing && onRemove && <span onClick={e => { e.stopPropagation(); onRemove(link.id); }} style={{ ...s.editBtn, color: '#999' }}>Remove</span>}
        </span>
      </div>
      {showInstances && hasFetched && (
        <div style={s.instanceRow}>
          <div style={s.instanceColumn}>
            <span
              style={sameCount > 0 ? s.instanceToggle : s.instanceToggleDisabled}
              onClick={sameCount > 0 ? () => onToggleInstance && onToggleInstance(link.id, 'same') : undefined}
            >
              This concept ({sameCount}) {sameCount > 0 ? (iData.expanded?.same ? '\u25be' : '\u25b8') : ''}
            </span>
            {iData.expanded?.same && sameCount > 0 && renderInstanceSnippet && <div style={s.instanceList}>{iData.sameConceptInstances.map(renderInstanceSnippet)}</div>}
          </div>
          <div style={s.instanceColumn}>
            <span
              style={otherCount > 0 ? s.instanceToggle : s.instanceToggleDisabled}
              onClick={otherCount > 0 ? () => onToggleInstance && onToggleInstance(link.id, 'other') : undefined}
            >
              All concepts ({otherCount}) {otherCount > 0 ? (iData.expanded?.other ? '\u25be' : '\u25b8') : ''}
            </span>
            {iData.expanded?.other && otherCount > 0 && renderInstanceSnippet && <div style={s.instanceList}>{iData.otherConceptInstances.map(renderInstanceSnippet)}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

const s = {
  cardFirst: { paddingBottom: '12px', borderRadius: '3px', transition: 'background-color 0.3s' },
  card: { paddingTop: '12px', paddingBottom: '12px', borderTop: '1px solid #ece6db', borderRadius: '3px', transition: 'background-color 0.3s' },
  contextLabel: { fontSize: '11px', color: '#999', marginBottom: '2px', fontFamily: '"EB Garamond", Georgia, serif' },
  title: { fontSize: '14px', color: '#333', textDecoration: 'underline', fontWeight: '500', display: 'block', marginBottom: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  url: { fontSize: '12px', color: '#aaa', marginBottom: '4px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  commentBlock: { fontSize: '12px', color: '#555', marginTop: '4px', marginBottom: '2px', lineHeight: 1.4 },
  commentText: { display: 'block', marginBottom: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: 1.4 },
  commentMeta: { fontSize: '11px', color: '#aaa' },
  editedTag: { marginLeft: '4px', fontSize: '11px', color: '#bbb' },
  editBtn: { marginLeft: '8px', fontSize: '12px', color: '#999', cursor: 'pointer', textDecoration: 'underline' },
  editArea: { marginTop: '6px', marginBottom: '4px' },
  textarea: { width: '100%', fontFamily: '"EB Garamond", Georgia, serif', fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  editButtons: { display: 'flex', gap: '10px', marginTop: '4px' },
  saveBtn: { fontSize: '12px', color: '#333', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', border: '1px solid #e0d9cf', padding: '2px 10px', borderRadius: '3px', backgroundColor: '#faf9f6' },
  cancelBtn: { fontSize: '12px', color: '#999', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif' },
  bottomRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' },
  vote: { fontSize: '12px', fontFamily: '"EB Garamond", Georgia, serif' },
  meta: { fontSize: '12px', color: '#aaa' },
  toggleLink: { fontSize: '11px', color: '#999', cursor: 'pointer', textDecoration: 'underline', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceRow: { marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' },
  instanceColumn: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 },
  instanceToggle: { fontSize: '12px', color: '#888', cursor: 'pointer', textDecoration: 'underline', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceToggleDisabled: { fontSize: '12px', color: '#ccc', cursor: 'default', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceList: { marginTop: '4px', marginLeft: '8px', borderLeft: '2px solid #e0d9cf', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '8px' },
};

export default LinkCard;
