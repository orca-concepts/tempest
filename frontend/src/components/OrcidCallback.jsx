import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';

const OrcidCallback = () => {
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [status, setStatus] = useState('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (authLoading) return;

    const code = searchParams.get('code');
    const error = searchParams.get('error');
    const state = searchParams.get('state');

    if (error) {
      setStatus('error');
      setErrorMessage('ORCID authorization was denied or failed');
      return;
    }

    if (!code) {
      setStatus('error');
      setErrorMessage('No authorization code received from ORCID');
      return;
    }

    // ── Registration flow (state=register) ──
    if (state === 'register') {
      if (exchangedRef.current) return;
      exchangedRef.current = true;

      const handleRegistration = async () => {
        try {
          const redirectUri = `${window.location.origin}/orcid/callback`;
          const response = await authAPI.beginOrcidRegistration(code, redirectUri);
          // Store in sessionStorage so LoginModal can pick it up
          sessionStorage.setItem('orca_pending_orcid_registration', JSON.stringify(response.data));
          navigate('/', { replace: true, state: { openSignupStep2: true } });
        } catch (err) {
          exchangedRef.current = false;
          const errorData = err.response?.data;
          if (errorData?.error === 'already_registered') {
            setStatus('error');
            setErrorMessage('This ORCID iD is already linked to an account. Please log in instead.');
          } else {
            setStatus('error');
            setErrorMessage(errorData?.message || "Couldn't verify your ORCID iD. Please try again.");
          }
        }
      };

      handleRegistration();
      return;
    }

    // ── Existing link-to-account flow (state=link or no state) ──
    if (!user) {
      setStatus('error');
      setErrorMessage('You must be logged in to connect an ORCID');
      return;
    }

    // If ORCID is already connected, this is a back-button loop
    if (user.orcidId) {
      window.history.go(-2);
      return;
    }

    if (exchangedRef.current) return;
    exchangedRef.current = true;

    const exchangeCode = async () => {
      try {
        await authAPI.orcidCallback(code);
        await refreshUser();
        navigate(`/profile/${user.id}`, { replace: true });
      } catch (err) {
        exchangedRef.current = false;
        setStatus('error');
        setErrorMessage(err.response?.data?.error || 'Failed to connect ORCID');
      }
    };

    exchangeCode();
  }, [authLoading, user]);

  if (authLoading || status === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <p style={styles.loadingText}>Connecting your ORCID...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <p style={styles.errorText}>{errorMessage}</p>
        <button onClick={() => navigate('/', { replace: true })} style={styles.continueButton}>
          Continue to Orca
        </button>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    backgroundColor: '#faf9f7',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
  },
  card: {
    backgroundColor: 'white',
    border: '1px solid #e0e0e0',
    borderRadius: '8px',
    padding: '32px 40px',
    maxWidth: '420px',
    width: '100%',
    textAlign: 'center',
  },
  loadingText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  errorText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#c44',
    lineHeight: '1.5',
    margin: '0 0 16px 0',
  },
  continueButton: {
    padding: '8px 20px',
    border: '1px solid #333',
    borderRadius: '4px',
    backgroundColor: '#333',
    color: 'white',
    cursor: 'pointer',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default OrcidCallback;
