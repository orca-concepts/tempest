import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authAPI, combosAPI } from '../services/api';

const DeleteAccountFlow = ({ onClose }) => {
  const { user, logout } = useAuth();
  const [step, setStep] = useState(null); // null = loading, 1, 2
  const [ownedCombos, setOwnedCombos] = useState([]);
  const [resolvedCombos, setResolvedCombos] = useState(new Set());
  const [confirmUsername, setConfirmUsername] = useState('');
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Load owned combos on mount
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const comboRes = await combosAPI.getMyCombos().catch(() => ({ data: { combos: [] } }));
        const combos = comboRes.data.combos || comboRes.data || [];
        if (cancelled) return;
        if (combos.length === 0) {
          setOwnedCombos([]);
          setStep(2);
          return;
        }
        setOwnedCombos(combos);
        setStep(1);
      } catch {
        if (!cancelled) {
          setError('Failed to load your data');
          setStep(1);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const allResolved = ownedCombos.length === 0 || ownedCombos.every(c => resolvedCombos.has(c.id));

  const handleDeleteAccount = useCallback(async () => {
    setDeleting(true);
    setError('');
    try {
      await authAPI.deleteAccount();
      onClose();
      setTimeout(() => logout(), 0);
      return;
    } catch (err) {
      const status = err.response?.status;
      const data = err.response?.data;
      if (status === 400 && data?.ownedCombos) {
        setOwnedCombos(data.ownedCombos);
        setResolvedCombos(new Set());
        setStep(1);
        setError(data.error);
      } else {
        setError(data?.error || 'Something went wrong. Please try again.');
      }
      setDeleting(false);
    }
  }, [logout]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.document.addEventListener('keydown', handleKeyDown);
    return () => window.document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (step === null) {
    return (
      <div style={styles.overlay}>
        <div style={styles.container}>
          <p style={styles.text}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        <div style={styles.header}>
          <h2 style={styles.heading}>
            {step === 1 ? 'Transfer Ownership' : 'Delete Your Account'}
          </h2>
          <button onClick={onClose} style={styles.closeButton}>{'\u2715'}</button>
        </div>

        {error && <p style={styles.error}>{error}</p>}

        {/* Step 1: Situation ownership */}
        {step === 1 && (
          <div>
            <p style={styles.text}>
              Transfer ownership of the situations below before deleting your account.
              Use each situation's tab in the sidebar to transfer ownership.
            </p>

            {ownedCombos.length > 0 && (
              <div style={styles.corpusList}>
                {ownedCombos.map(combo => {
                  const resolved = resolvedCombos.has(combo.id);
                  return (
                    <div key={combo.id} style={{ ...styles.corpusRow, opacity: resolved ? 0.5 : 1 }}>
                      <span style={{ ...styles.corpusName, textDecoration: resolved ? 'line-through' : 'none' }}>
                        {combo.name}
                      </span>
                      {resolved ? (
                        <span style={styles.resolvedLabel}>Done</span>
                      ) : (
                        <span style={styles.noMembersNote}>Transfer via situation tab</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={styles.buttonRow}>
              <button onClick={onClose} style={styles.actionButton}>Cancel</button>
              <button
                onClick={() => { setError(''); setStep(2); }}
                style={styles.actionButton}
                disabled={!allResolved}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Final confirmation */}
        {step === 2 && (
          <div>
            <p style={styles.text}>
              This will permanently delete your account. Your votes, subscriptions, and saved items will be removed.
              Questions and links you created will remain but will no longer be attributed to you. This cannot be undone.
            </p>
            <label style={styles.label}>Type your username to confirm:</label>
            <input
              type="text"
              value={confirmUsername}
              onChange={e => setConfirmUsername(e.target.value)}
              placeholder={user?.username}
              style={styles.input}
              autoFocus
            />
            <div style={styles.buttonRow}>
              <button onClick={onClose} style={styles.actionButton}>Cancel</button>
              <button
                onClick={handleDeleteAccount}
                style={styles.actionButton}
                disabled={confirmUsername !== user?.username || deleting}
              >
                {deleting ? 'Deleting...' : 'Permanently Delete My Account'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  overlay: {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  container: {
    backgroundColor: '#faf9f6',
    borderRadius: '8px',
    padding: '32px',
    maxWidth: '520px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
    border: '1px solid #ccc',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '16px',
  },
  heading: {
    margin: 0,
    fontSize: '20px',
    fontFamily: '"EB Garamond", Georgia, serif',
    fontWeight: '600',
    color: '#333',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#999',
    padding: '0 4px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  text: {
    fontSize: '15px',
    lineHeight: '1.5',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    marginBottom: '16px',
  },
  error: {
    fontSize: '14px',
    color: '#333',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#f0ece4',
    padding: '8px 12px',
    borderRadius: '4px',
    marginBottom: '12px',
    border: '1px solid #ccc',
  },
  corpusList: {
    marginBottom: '20px',
  },
  corpusRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid #eee',
    gap: '12px',
    flexWrap: 'wrap',
  },
  corpusName: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '600',
    minWidth: '80px',
  },
  resolvedLabel: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  noMembersNote: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#999',
  },
  actionButton: {
    padding: '6px 14px',
    backgroundColor: 'transparent',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    marginTop: '20px',
  },
  label: {
    display: 'block',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    marginBottom: '6px',
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    backgroundColor: 'white',
    color: '#333',
    boxSizing: 'border-box',
  },
};

export default DeleteAccountFlow;
