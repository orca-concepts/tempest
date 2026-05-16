import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

const ResetPasswordPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!token) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.title}>Invalid Reset Link</div>
          <p style={styles.text}>This password reset link is invalid or malformed.</p>
          <button onClick={() => navigate('/')} style={styles.button}>
            Go to Home
          </button>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={styles.title}>Password Reset Successful</div>
          <p style={styles.text}>Your password has been reset. Redirecting...</p>
        </div>
      </div>
    );
  }

  const handleSubmit = async () => {
    setError('');
    if (!newPassword) {
      setError('New password is required');
      return;
    }
    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      await authAPI.resetPassword(token, newPassword);
      setSuccess(true);
      setTimeout(() => navigate('/'), 2000);
    } catch (err) {
      const errorMsg = err.response?.data?.error;
      if (errorMsg === 'invalid_or_expired_token') {
        setError('This link has expired or has already been used. Please request a new password reset.');
      } else {
        setError(errorMsg || 'Password reset failed. Please try again.');
      }
    }
    setLoading(false);
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.title}>Reset Password</div>
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.inputGroup}>
          <label style={styles.label}>New password</label>
          <div style={styles.passwordRow}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password (8+ characters)"
              style={{ ...styles.input, flex: 1 }}
              disabled={loading}
              autoFocus
            />
            <span onClick={() => setShowPassword(!showPassword)} style={styles.passwordToggle}>
              {showPassword ? 'Hide' : 'Show'}
            </span>
          </div>
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Confirm new password</label>
          <input
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            style={styles.input}
            disabled={loading}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
        </div>
        <button
          onClick={handleSubmit}
          style={loading ? { ...styles.button, ...styles.disabledBtn } : styles.button}
          disabled={loading}
        >
          {loading ? 'Resetting...' : 'Reset Password'}
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
  },
  title: {
    fontSize: '20px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    textAlign: 'center',
    borderBottom: '1px solid #d0d0d0',
    paddingBottom: '12px',
  },
  text: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    textAlign: 'center',
    margin: 0,
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },
  label: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    fontWeight: '500',
  },
  input: {
    padding: '8px 12px',
    fontSize: '16px',
    fontFamily: '"EB Garamond", Georgia, serif',
    border: '1px solid #ccc',
    borderRadius: '4px',
    outline: 'none',
    backgroundColor: '#fff',
    color: '#333',
  },
  passwordRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  passwordToggle: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
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
  disabledBtn: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  error: {
    padding: '9px 12px',
    backgroundColor: '#fef0f0',
    color: '#c00',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
};

export default ResetPasswordPage;
