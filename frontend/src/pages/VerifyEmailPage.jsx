import React, { useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const VerifyEmailPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const status = searchParams.get('status');
  const reason = searchParams.get('reason');

  useEffect(() => {
    if (status === 'success') {
      const timer = setTimeout(() => navigate('/'), 2000);
      return () => clearTimeout(timer);
    }
  }, [status, navigate]);

  const renderContent = () => {
    if (status === 'success') {
      return (
        <>
          <div style={styles.title}>Email Verified</div>
          <p style={styles.text}>Your email has been verified successfully. Redirecting...</p>
        </>
      );
    }

    if (status === 'error') {
      let message = 'An error occurred during email verification.';
      if (reason === 'invalid_token') {
        message = 'This verification link is invalid.';
      } else if (reason === 'expired_or_used') {
        message = 'This verification link has expired or was already used.';
      }

      return (
        <>
          <div style={styles.title}>Verification Failed</div>
          <p style={styles.text}>{message}</p>
          <p style={styles.subtext}>A "request new verification email" feature is coming soon.</p>
          <button onClick={() => navigate('/')} style={styles.button}>
            Return to Home
          </button>
        </>
      );
    }

    // No status param — direct visit
    return (
      <>
        <div style={styles.title}>Email Verification</div>
        <p style={styles.text}>Check your email for a verification link.</p>
        <button onClick={() => navigate('/')} style={styles.button}>
          Return to Home
        </button>
      </>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {renderContent()}
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
    backgroundColor: '#faf9f6',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    width: '100%',
    maxWidth: '380px',
    padding: '28px 32px 32px',
    fontFamily: '"EB Garamond", Georgia, serif',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    textAlign: 'center',
  },
  title: {
    fontSize: '20px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    borderBottom: '1px solid #d0d0d0',
    paddingBottom: '12px',
  },
  text: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    margin: 0,
    lineHeight: '1.5',
  },
  subtext: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    margin: 0,
  },
  button: {
    padding: '10px',
    fontSize: '15px',
    fontWeight: '500',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
  },
};

export default VerifyEmailPage;
