import React, { useState } from 'react';
import { communitiesAPI } from '../services/api';
import OrcidBadge from './OrcidBadge';

// Phase 72a: community header controls — a Share button (copies the /c/:slug
// share URL) for everyone, and an owners panel (add/remove owners) for owners.
const CommunityHeaderControls = ({ communityId, communitySlug, isOwner, onCommunitiesChanged }) => {
  const [shareCopied, setShareCopied] = useState(false);
  const [ownersOpen, setOwnersOpen] = useState(false);
  const [owners, setOwners] = useState([]);
  const [ownersLoading, setOwnersLoading] = useState(false);
  const [newOwner, setNewOwner] = useState('');
  const [ownerError, setOwnerError] = useState('');
  const [busy, setBusy] = useState(false);

  const shareUrl = communitySlug
    ? `${window.location.origin}/c/${communitySlug}`
    : window.location.origin;

  const handleShare = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = shareUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const loadOwners = async () => {
    if (!communitySlug) return;
    setOwnersLoading(true);
    try {
      const res = await communitiesAPI.getCommunityBySlug(communitySlug);
      setOwners(res.data.community.owners || []);
    } catch {
      setOwners([]);
    } finally {
      setOwnersLoading(false);
    }
  };

  const openOwners = () => {
    setOwnersOpen(true);
    setOwnerError('');
    setNewOwner('');
    loadOwners();
  };

  const handleAddOwner = async () => {
    const username = newOwner.trim();
    if (!username || busy) return;
    setBusy(true);
    setOwnerError('');
    try {
      await communitiesAPI.addOwner(communityId, username);
      setNewOwner('');
      await loadOwners();
      if (onCommunitiesChanged) onCommunitiesChanged();
    } catch (err) {
      setOwnerError(err.response?.data?.error || 'Could not add owner');
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveOwner = async (userId) => {
    if (busy) return;
    setBusy(true);
    setOwnerError('');
    try {
      await communitiesAPI.removeOwner(communityId, userId);
      await loadOwners();
      if (onCommunitiesChanged) onCommunitiesChanged();
    } catch (err) {
      setOwnerError(err.response?.data?.error || 'Could not remove owner');
    } finally {
      setBusy(false);
    }
  };

  const isLastOwner = owners.length <= 1;

  return (
    <div style={styles.row}>
      <button style={styles.button} onClick={handleShare} title="Copy this community's share link">
        {shareCopied ? 'Copied!' : 'Share'}
      </button>
      {isOwner && (
        <button style={styles.button} onClick={openOwners} title="Manage community owners">
          Owners
        </button>
      )}

      {ownersOpen && (
        <div style={styles.overlay} onClick={() => setOwnersOpen(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div style={styles.modalTitle}>Community owners</div>
            {ownersLoading ? (
              <div style={styles.muted}>Loading…</div>
            ) : (
              <div style={styles.ownerList}>
                {owners.map((o) => (
                  <div key={o.userId} style={styles.ownerItem}>
                    <span style={styles.ownerName}>
                      {o.username || '[deleted user]'}
                      {o.orcidId && <OrcidBadge orcidId={o.orcidId} />}
                    </span>
                    <button
                      style={{ ...styles.removeBtn, ...(isLastOwner ? styles.removeBtnDisabled : {}) }}
                      onClick={() => handleRemoveOwner(o.userId)}
                      disabled={isLastOwner || busy}
                      title={isLastOwner ? 'A community must keep at least one owner' : 'Remove this owner'}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.addRow}>
              <input
                type="text"
                value={newOwner}
                onChange={(e) => setNewOwner(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddOwner(); }}
                placeholder="Add owner by username"
                style={styles.input}
              />
              <button
                style={{ ...styles.button, ...(busy ? styles.disabled : {}) }}
                onClick={handleAddOwner}
                disabled={busy}
              >
                Add
              </button>
            </div>
            {ownerError && <div style={styles.error}>{ownerError}</div>}
            <div style={styles.closeRow}>
              <button style={styles.button} onClick={() => setOwnersOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FONT = '"EB Garamond", Georgia, serif';
const styles = {
  row: { display: 'flex', alignItems: 'center', gap: '8px' },
  button: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: FONT,
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  disabled: { opacity: 0.5, cursor: 'default' },
  overlay: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.3)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 10000,
  },
  modal: {
    backgroundColor: '#faf9f6',
    border: '1px solid #d4d0c8',
    borderRadius: '6px',
    padding: '24px',
    maxWidth: '420px',
    width: '90%',
    fontFamily: FONT,
  },
  modalTitle: { fontSize: '18px', color: '#222', marginBottom: '14px' },
  muted: { fontSize: '14px', color: '#888' },
  ownerList: { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' },
  ownerItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 10px', border: '1px solid #e0dcd2', borderRadius: '4px', backgroundColor: '#fffdf9',
  },
  ownerName: { fontSize: '15px', color: '#333', display: 'flex', alignItems: 'center', gap: '6px' },
  removeBtn: {
    padding: '3px 10px', fontSize: '13px', fontFamily: FONT,
    backgroundColor: 'transparent', color: '#555', border: '1px solid #ccc',
    borderRadius: '4px', cursor: 'pointer',
  },
  removeBtnDisabled: { opacity: 0.4, cursor: 'default' },
  addRow: { display: 'flex', gap: '8px', marginBottom: '8px' },
  input: {
    flex: 1, padding: '8px 10px', fontSize: '14px', fontFamily: FONT,
    border: '1px solid #ccc', borderRadius: '4px', outline: 'none',
    color: '#333', backgroundColor: 'white',
  },
  error: { fontSize: '13px', color: '#c33', marginBottom: '8px' },
  closeRow: { display: 'flex', justifyContent: 'flex-end' },
};

export default CommunityHeaderControls;
