import React, { useState, useEffect, useCallback } from 'react';
import CopyLinkPicker from './CopyLinkPicker';
import LinkifiedText from './LinkifiedText';
import OrcidBadge from './OrcidBadge';
import MentionsPanel from './MentionsPanel';
import { getSetColor } from './VoteSetBar';
import { votesAPI } from '../services/api';

/**
 * LinkCard — reusable link card.
 *
 * Props:
 *   link, user, isGuest, isFirst, contextLabel,
 *   onVoteToggle,
 *   showInstances, instanceData, onToggleInstance, renderInstanceSnippet,
 *   cardRef, onRequestLogin,
 *   clickable      — if true, clicking the card body (except the title link) triggers onCardClick
 *   onCardClick    — (link) => void, called when clickable=true and card is clicked
 *   readOnlyVote   — if true, vote count is shown as plain text with no click handler
 *   onRemoveSuccess — callback after successful removal
 *   onAddendumSuccess — callback after successful addendum
 */
const LinkCard = ({
  link, user, isGuest, isFirst = false,
  contextLabel,
  onVoteToggle,
  showInstances = false, instanceData, onToggleInstance, renderInstanceSnippet,
  cardRef, onRequestLogin,
  clickable = false, onCardClick,
  readOnlyVote = false,
  conceptId, conceptPath, onCopySuccess,
  onRemoveSuccess, onAddendumSuccess,
  voteSets = [],
  onSourceClick,
}) => {
  const isCreator = user && link.addedBy === user.id;
  // Phase 69: a link gets a vote-set's color dot if ≥1 member of that set upvoted
  // it. Gated naturally — voteSets is empty unless the concept has active sets.
  const voterIds = link.voterUserIds || [];
  const linkSetIndices = voteSets
    .filter((set) => Array.isArray(set.userIds) && set.userIds.some((uid) => voterIds.includes(uid)))
    .map((set) => set.setIndex);
  const [showCopyPicker, setShowCopyPicker] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [removeError, setRemoveError] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [showAddendumModal, setShowAddendumModal] = useState(false);
  const [addendumBody, setAddendumBody] = useState('');
  const [addendumError, setAddendumError] = useState(null);
  const [addendumSubmitting, setAddendumSubmitting] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [mentionsExpanded, setMentionsExpanded] = useState(false);
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

  const handleRemove = async () => {
    setRemoving(true);
    setRemoveError(null);
    try {
      await votesAPI.removeWebLink(link.id);
      setShowRemoveModal(false);
      if (onRemoveSuccess) onRemoveSuccess();
    } catch (err) {
      setRemoveError("Couldn't remove this link. It may have been placed on legal hold.");
    } finally {
      setRemoving(false);
    }
  };

  const handleAddAddendum = async () => {
    setAddendumSubmitting(true);
    setAddendumError(null);
    try {
      await votesAPI.addConceptLinkAddendum(link.id, addendumBody.trim());
      setShowAddendumModal(false);
      setAddendumBody('');
      if (onAddendumSuccess) onAddendumSuccess();
    } catch (err) {
      setAddendumError("Couldn't add addendum. Please try again.");
    } finally {
      setAddendumSubmitting(false);
    }
  };

  // Escape key closes modals
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { setShowRemoveModal(false); setShowAddendumModal(false); }
  }, []);

  useEffect(() => {
    if (showRemoveModal || showAddendumModal) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [showRemoveModal, showAddendumModal, handleKeyDown]);

  const cardStyle = {
    ...(isFirst ? s.cardFirst : s.card),
    ...(clickable ? { cursor: 'pointer' } : {}),
  };

  return (
    <div ref={cardRef} style={cardStyle} onClick={handleCardBodyClick}
      onMouseEnter={clickable ? e => { e.currentTarget.style.backgroundColor = '#f8f5ee'; } : undefined}
      onMouseLeave={clickable ? e => { e.currentTarget.style.backgroundColor = ''; } : undefined}>
      {contextLabel && <div style={s.contextLabel}>{contextLabel}</div>}
      {link.isInherited && link.sourceConceptName && (
        <div style={s.sourceLabel}>
          <span
            onClick={e => { e.stopPropagation(); if (onSourceClick) onSourceClick(link); }}
            style={s.sourceLabelLink}
            title="Go to where this link was placed"
          >{'↙'} from {link.sourceConceptName}</span>
        </div>
      )}
      <a href={link.url} target="_blank" rel="noopener noreferrer" style={s.title}
        onClick={e => e.stopPropagation()}>{link.title || link.url}</a>
      {link.title && <div style={s.url}>{link.url}</div>}
      {link.comment && (
        <div style={s.commentBlock}>
          <LinkifiedText text={link.comment} lines={3} style={s.commentText} />
          <span style={s.commentMeta}>{link.addedByUsername}</span>
        </div>
      )}
      {link.addenda && link.addenda.length > 0 && (
        <div style={s.addendaBlock}>
          {link.addenda.map((a) => (
            <div key={a.id} style={s.addendumItem}>
              <div style={s.addendumHeader}>Addendum — {new Date(a.createdAt).toLocaleString()}</div>
              <LinkifiedText text={a.body} lines={3} style={s.commentText} />
            </div>
          ))}
        </div>
      )}
      {linkSetIndices.length > 0 && (
        <div style={s.voteSetDotsRow}>
          {linkSetIndices.map((setIndex) => {
            const color = getSetColor(setIndex);
            return (
              <span
                key={setIndex}
                style={{ ...s.voteSetDot, backgroundColor: color.hex }}
                title={`${color.name} vote set`}
              />
            );
          })}
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
          {link.addedByUsername}{link.authorOrcidId && <OrcidBadge orcidId={link.authorOrcidId} />}
          <span onClick={e => { e.stopPropagation(); const url = `${window.location.origin}/link/${link.id}`; navigator.clipboard.writeText(url).then(() => { setShareCopied(true); setTimeout(() => setShareCopied(false), 2000); }).catch(() => {}); }} style={s.editBtn}>{shareCopied ? 'Copied!' : 'Share'}</span>
          {!readOnlyVote && isCreator && <span onClick={e => { e.stopPropagation(); setShowAddendumModal(true); setAddendumError(null); setAddendumBody(''); }} style={s.editBtn}>Add addendum</span>}
          {!readOnlyVote && isCreator && conceptId && <span onClick={e => { e.stopPropagation(); setShowCopyPicker(true); }} style={s.editBtn}>Copy</span>}
          {!readOnlyVote && isCreator && <span onClick={e => { e.stopPropagation(); setShowRemoveModal(true); setRemoveError(null); }} style={s.editBtn}>Remove</span>}
        </span>
      </div>
      {showCopyPicker && (
        <CopyLinkPicker
          link={link}
          conceptId={conceptId}
          conceptPath={conceptPath}
          onClose={() => setShowCopyPicker(false)}
          onCopySuccess={(destName) => { setShowCopyPicker(false); if (onCopySuccess) onCopySuccess(destName); }}
        />
      )}
      {showRemoveModal && (
        <div style={s.modalOverlay} onClick={e => { e.stopPropagation(); if (!removeError) setShowRemoveModal(false); }}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>Permanently remove this link?</div>
            <div style={s.modalBody}>Other users' votes on it will be lost. This cannot be undone.</div>
            {removeError && <div style={s.modalError}>{removeError}</div>}
            <div style={s.modalButtons}>
              {removeError ? (
                <span onClick={() => setShowRemoveModal(false)} style={s.modalCancelBtn}>Close</span>
              ) : (
                <>
                  <span onClick={() => setShowRemoveModal(false)} style={s.modalCancelBtn}>Cancel</span>
                  <span onClick={handleRemove} style={removing ? { ...s.modalRemoveBtn, opacity: 0.5 } : s.modalRemoveBtn}>
                    {removing ? 'Removing...' : 'Remove permanently'}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {showAddendumModal && (
        <div style={s.modalOverlay} onClick={e => { e.stopPropagation(); setShowAddendumModal(false); }}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            <div style={s.modalTitle}>Add addendum</div>
            <textarea
              value={addendumBody}
              onChange={e => setAddendumBody(e.target.value)}
              style={s.textarea}
              rows={3}
              placeholder="Write an addendum..."
              autoFocus
              maxLength={2000}
            />
            <div style={s.charCount}>{addendumBody.length} / 2000</div>
            {addendumError && <div style={s.modalError}>{addendumError}</div>}
            <div style={s.modalButtons}>
              <span onClick={() => setShowAddendumModal(false)} style={s.modalCancelBtn}>Cancel</span>
              <span
                onClick={!addendumBody.trim() || addendumSubmitting ? undefined : handleAddAddendum}
                style={!addendumBody.trim() || addendumSubmitting ? { ...s.modalRemoveBtn, opacity: 0.5, cursor: 'default' } : s.modalRemoveBtn}
              >
                {addendumSubmitting ? 'Posting...' : 'Post addendum'}
              </span>
            </div>
          </div>
        </div>
      )}
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
          <div style={s.instanceColumn}>
            <span
              style={(link.mentionCount || 0) > 0 ? s.instanceToggle : s.instanceToggleDisabled}
              onClick={(link.mentionCount || 0) > 0 ? (e) => { e.stopPropagation(); setMentionsExpanded(p => !p); } : undefined}
            >
              Mentioned by ({link.mentionCount || 0}) {(link.mentionCount || 0) > 0 ? (mentionsExpanded ? '\u25be' : '\u25b8') : ''}
            </span>
            {mentionsExpanded && (link.mentionCount || 0) > 0 && (
              <div style={s.instanceList}>
                <MentionsPanel targetType="link" targetId={link.id} emptyStateNoun="link" expanded={true} />
              </div>
            )}
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
  sourceLabel: { fontSize: '11px', marginBottom: '2px', fontFamily: '"EB Garamond", Georgia, serif' },
  sourceLabelLink: { color: '#888', cursor: 'pointer', textDecoration: 'underline' },
  title: { fontSize: '14px', color: '#333', textDecoration: 'underline', fontWeight: '500', display: 'block', marginBottom: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  url: { fontSize: '12px', color: '#aaa', marginBottom: '4px', overflowWrap: 'anywhere', wordBreak: 'break-word' },
  commentBlock: { fontSize: '12px', color: '#555', marginTop: '4px', marginBottom: '2px', lineHeight: 1.4 },
  commentText: { display: 'block', marginBottom: '2px', overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: 1.4 },
  commentMeta: { fontSize: '11px', color: '#aaa' },
  editBtn: { marginLeft: '8px', fontSize: '12px', color: '#999', cursor: 'pointer', textDecoration: 'underline' },
  textarea: { width: '100%', fontFamily: '"EB Garamond", Georgia, serif', fontSize: '13px', color: '#333', backgroundColor: '#faf9f6', border: '1px solid #e0d9cf', borderRadius: '3px', padding: '6px 8px', resize: 'vertical', outline: 'none', boxSizing: 'border-box' },
  bottomRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px' },
  voteSetDotsRow: { display: 'flex', gap: '4px', marginTop: '6px' },
  voteSetDot: { width: '10px', height: '10px', borderRadius: '50%', display: 'inline-block' },
  vote: { fontSize: '12px', fontFamily: '"EB Garamond", Georgia, serif' },
  meta: { fontSize: '12px', color: '#aaa' },
  toggleLink: { fontSize: '11px', color: '#999', cursor: 'pointer', textDecoration: 'underline', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceRow: { marginTop: '6px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' },
  instanceColumn: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: 0 },
  instanceToggle: { fontSize: '12px', color: '#888', cursor: 'pointer', textDecoration: 'underline', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceToggleDisabled: { fontSize: '12px', color: '#ccc', cursor: 'default', fontFamily: '"EB Garamond", Georgia, serif' },
  instanceList: { marginTop: '4px', marginLeft: '8px', borderLeft: '2px solid #e0d9cf', paddingLeft: '10px', display: 'flex', flexDirection: 'column', gap: '8px' },
  // Addenda display
  addendaBlock: { marginTop: 8, paddingTop: 8, borderTop: '1px solid #ece6db' },
  addendumItem: { marginBottom: 8, fontSize: '12px', color: '#555', lineHeight: 1.4 },
  addendumHeader: { color: '#999', fontSize: '11px', marginBottom: 2, fontFamily: '"EB Garamond", Georgia, serif' },
  charCount: { fontSize: '11px', color: '#aaa', textAlign: 'right', marginTop: 2, fontFamily: '"EB Garamond", Georgia, serif' },
  // Modals
  modalOverlay: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000 },
  modalBox: { backgroundColor: '#faf9f6', border: '1px solid #d4d0c8', borderRadius: '6px', padding: '24px', maxWidth: '400px', width: '90%', fontFamily: '"EB Garamond", Georgia, serif' },
  modalTitle: { fontSize: '16px', fontWeight: '600', color: '#333', marginBottom: '10px' },
  modalBody: { fontSize: '14px', color: '#555', lineHeight: 1.5, marginBottom: '16px' },
  modalError: { fontSize: '13px', color: '#c44', marginBottom: '12px', lineHeight: 1.4 },
  modalButtons: { display: 'flex', gap: '10px', justifyContent: 'flex-end' },
  modalCancelBtn: { fontSize: '13px', color: '#888', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', padding: '4px 14px', border: '1px solid #ccc', borderRadius: '3px', backgroundColor: 'transparent' },
  modalRemoveBtn: { fontSize: '13px', color: '#333', cursor: 'pointer', fontFamily: '"EB Garamond", Georgia, serif', padding: '4px 14px', border: '1px solid #999', borderRadius: '3px', backgroundColor: 'transparent' },
};

export default LinkCard;
