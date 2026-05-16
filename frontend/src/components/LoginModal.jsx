import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authAPI } from '../services/api';
import { CURRENT_TOS_VERSION } from '../config/constants';

/**
 * LoginModal — inline modal overlay for password login, ORCID-first registration, and forgot password.
 * Props:
 *   - isOpen: boolean
 *   - onClose: () => void
 *   - initialTab: 'login' | 'signup' (default 'login')
 *   - notice: optional string shown above the form
 *   - pendingOrcidData: optional object from OrcidCallback for step 2 of registration
 *   - onClearPendingOrcid: callback to clear the pending data after use
 */
const LoginModal = ({ isOpen, onClose, initialTab = 'login', notice, pendingOrcidData, onClearPendingOrcid }) => {
  const { login, registerWithOrcid, forgotPassword } = useAuth();

  // 'login' | 'signup' | 'forgot'
  const [mode, setMode] = useState(initialTab === 'signup' ? 'signup' : 'login');

  // Login state
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Signup state (ORCID-first, Phase 61c)
  const [signupStep, setSignupStep] = useState(1); // 1=ORCID prompt, 2=details form
  const [orcidData, setOrcidData] = useState(null); // { orcidId, name, verifiedEmails, unverifiedEmails }
  const [username, setUsername] = useState('');
  const [signUpEmail, setSignUpEmail] = useState('');
  const [signUpPassword, setSignUpPassword] = useState('');
  const [signUpConfirm, setSignUpConfirm] = useState('');
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [tosAccepted, setTosAccepted] = useState(false);

  // Forgot state (email-based, Phase 61c)
  const [forgotStep, setForgotStep] = useState(1); // 1=identifier, 2=confirmation
  const [forgotIdentifier, setForgotIdentifier] = useState('');

  // Shared state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  // Reset when opened or initialTab changes
  useEffect(() => {
    if (isOpen) {
      setMode(initialTab === 'signup' ? 'signup' : 'login');
      resetAll();
      // If opened with pending ORCID data from callback, jump to step 2
      if (pendingOrcidData) {
        setMode('signup');
        setSignupStep(2);
        setOrcidData(pendingOrcidData);
        // Pre-fill email from ORCID
        const emails = pendingOrcidData.verifiedEmails || pendingOrcidData.unverifiedEmails || [];
        if (emails.length > 0) {
          setSignUpEmail(emails[0]);
        }
      }
    }
  }, [isOpen, initialTab, pendingOrcidData]);

  // Escape key to close
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      window.document.addEventListener('keydown', handleKeyDown);
      return () => window.document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  const resetAll = () => {
    setIdentifier('');
    setPassword('');
    setShowPassword(false);
    setSignupStep(1);
    setOrcidData(null);
    setUsername('');
    setSignUpEmail('');
    setSignUpPassword('');
    setSignUpConfirm('');
    setShowSignUpPassword(false);
    setTosAccepted(false);
    setForgotStep(1);
    setForgotIdentifier('');
    setError('');
    setLoading(false);
    setSuccessMessage('');
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    resetAll();
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  // ── LOGIN ──
  const handleLogin = async (e) => {
    e && e.preventDefault();
    setError('');
    if (!identifier.trim() || !password) {
      setError('Username/email and password are required');
      return;
    }
    setLoading(true);
    const result = await login(identifier.trim(), password);
    if (result.success) {
      onClose();
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── SIGNUP Step 1: Initiate ORCID OAuth ──
  const handleOrcidSignup = async () => {
    setError('');
    setLoading(true);
    try {
      const response = await authAPI.getOrcidAuthorizeUrl();
      const authorizeUrl = response.data.url;
      // Add state=register so the callback knows this is registration
      const separator = authorizeUrl.includes('?') ? '&' : '?';
      window.location.href = `${authorizeUrl}${separator}state=register`;
    } catch (err) {
      setError('Could not connect to ORCID. Please try again.');
      setLoading(false);
    }
  };

  // ── SIGNUP Step 2: Create account ──
  const handleSignupCreate = async () => {
    setError('');
    if (!username.trim()) {
      setError('Username is required');
      return;
    }
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(username.trim())) {
      setError('Username must be 1-30 characters, alphanumeric and underscores only');
      return;
    }
    if (!signUpEmail.trim()) {
      setError('Email address is required');
      return;
    }
    const atIdx = signUpEmail.indexOf('@');
    if (atIdx < 1 || signUpEmail.indexOf('.', atIdx) === -1) {
      setError('Please enter a valid email address');
      return;
    }
    if (!signUpPassword) {
      setError('Password is required');
      return;
    }
    if (signUpPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (signUpPassword !== signUpConfirm) {
      setError('Passwords do not match');
      return;
    }
    if (!tosAccepted) {
      setError('You must accept the Terms of Service and Privacy Policy');
      return;
    }
    setLoading(true);
    const result = await registerWithOrcid({
      orcidId: orcidData.orcidId,
      email: signUpEmail.trim(),
      password: signUpPassword,
      username: username.trim(),
      tosAccepted: true,
      tosVersion: CURRENT_TOS_VERSION,
      verifiedEmailsFromOrcid: orcidData.verifiedEmails || [],
    });
    if (result.success) {
      if (onClearPendingOrcid) onClearPendingOrcid();
      // Clear sessionStorage
      try { sessionStorage.removeItem('orca_pending_orcid_registration'); } catch {}
      if (result.emailVerificationStatus === 'pending') {
        setSuccessMessage('Account created! Please check your email to verify your address.');
        setTimeout(() => onClose(), 2500);
      } else {
        onClose();
      }
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  // ── FORGOT PASSWORD ──
  const handleForgotSubmit = async () => {
    setError('');
    if (!forgotIdentifier.trim()) {
      setError('Please enter your username or email');
      return;
    }
    setLoading(true);
    const result = await forgotPassword(forgotIdentifier.trim());
    if (result.success) {
      setForgotStep(2);
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  if (!isOpen) return null;

  const passwordToggle = (show, setShow) => (
    <span
      onClick={() => setShow(!show)}
      style={styles.passwordToggle}
    >
      {show ? 'Hide' : 'Show'}
    </span>
  );

  // ── RENDER: Login ──
  const renderLogin = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Username or email</label>
        <input
          type="text"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="Username or email"
          style={styles.input}
          disabled={loading}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
        />
      </div>
      <div style={styles.inputGroup}>
        <label style={styles.label}>Password</label>
        <div style={styles.passwordRow}>
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            style={{ ...styles.input, flex: 1 }}
            disabled={loading}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
          />
          {passwordToggle(showPassword, setShowPassword)}
        </div>
      </div>
      <button
        onClick={handleLogin}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Logging in...' : 'Log In'}
      </button>
      <div style={styles.linksRow}>
        <span onClick={() => switchMode('forgot')} style={styles.link}>Forgot password?</span>
      </div>
      <div style={styles.switchRow}>
        <span style={styles.switchText}>Don't have an account? </span>
        <span onClick={() => switchMode('signup')} style={styles.link}>Sign up</span>
      </div>
    </div>
  );

  // ── RENDER: Signup Step 1 (ORCID prompt) ──
  const renderSignupStep1 = () => (
    <div style={styles.form}>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.orcidExplanation}>
        Orca uses ORCID to verify researcher identity. You'll authenticate with ORCID first, then create your account.
      </div>
      <button
        onClick={handleOrcidSignup}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Connecting...' : 'Sign up with ORCID'}
      </button>
      <div style={styles.orcidNote}>
        Don't have an ORCID iD?{' '}
        <a href="https://orcid.org/register" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>
          Register at orcid.org
        </a>
      </div>
      <div style={styles.switchRow}>
        <span style={styles.switchText}>Already have an account? </span>
        <span onClick={() => switchMode('login')} style={styles.link}>Log in</span>
      </div>
    </div>
  );

  // ── RENDER: Signup Step 2 (details form) ──
  const renderSignupStep2 = () => {
    const emailIsVerified = orcidData?.verifiedEmails?.map(e => e.toLowerCase()).includes(signUpEmail.trim().toLowerCase());
    let emailNote = '';
    if (signUpEmail.trim()) {
      if (emailIsVerified) {
        emailNote = 'ORCID has verified this email — no email verification needed.';
      } else {
        emailNote = "We'll send you a verification email after sign-up.";
      }
    }

    return (
      <div style={styles.form}>
        {successMessage && <div style={styles.success}>{successMessage}</div>}
        {error && <div style={styles.error}>{error}</div>}
        <div style={styles.orcidBadge}>
          Registering with ORCID {orcidData?.orcidId}
          {orcidData?.name ? ` (${orcidData.name})` : ''}
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Email address</label>
          <input
            type="email"
            value={signUpEmail}
            onChange={(e) => setSignUpEmail(e.target.value)}
            placeholder="Email address"
            style={styles.input}
            disabled={loading}
          />
          {emailNote && <div style={styles.fieldNote}>{emailNote}</div>}
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value.slice(0, 30))}
            placeholder="Username"
            maxLength={30}
            style={styles.input}
            disabled={loading}
            autoFocus
          />
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Password</label>
          <div style={styles.passwordRow}>
            <input
              type={showSignUpPassword ? 'text' : 'password'}
              value={signUpPassword}
              onChange={(e) => setSignUpPassword(e.target.value)}
              placeholder="Password (8+ characters)"
              style={{ ...styles.input, flex: 1 }}
              disabled={loading}
            />
            {passwordToggle(showSignUpPassword, setShowSignUpPassword)}
          </div>
        </div>
        <div style={styles.inputGroup}>
          <label style={styles.label}>Confirm password</label>
          <input
            type={showSignUpPassword ? 'text' : 'password'}
            value={signUpConfirm}
            onChange={(e) => setSignUpConfirm(e.target.value)}
            placeholder="Confirm password"
            style={styles.input}
            disabled={loading}
          />
        </div>
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '14px', fontFamily: '"EB Garamond", Georgia, serif', lineHeight: 1.4, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={tosAccepted}
            onChange={(e) => setTosAccepted(e.target.checked)}
            disabled={loading}
            style={{ marginTop: '3px', flexShrink: 0 }}
          />
          <span>
            I have read and agree to the{' '}
            <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Terms of Service</a>,{' '}
            <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Privacy Policy</a>, and{' '}
            <a href="/copyright-policy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Copyright Policy</a>.
            I confirm I am at least 18 years old.
          </span>
        </label>
        <button
          onClick={handleSignupCreate}
          style={(loading || !tosAccepted) ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
          disabled={loading || !tosAccepted}
        >
          {loading ? 'Creating account...' : 'Create Account'}
        </button>
        <div style={styles.linksRow}>
          <span
            onClick={() => { setSignupStep(1); setOrcidData(null); setError(''); }}
            style={styles.link}
          >
            Back
          </span>
        </div>
      </div>
    );
  };

  // ── RENDER: Forgot Step 1 (identifier) ──
  const renderForgotStep1 = () => (
    <div style={styles.form}>
      <div style={styles.confirmText}>Enter your username or email to receive a password reset link.</div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.inputGroup}>
        <label style={styles.label}>Username or email</label>
        <input
          type="text"
          value={forgotIdentifier}
          onChange={(e) => setForgotIdentifier(e.target.value)}
          placeholder="Username or email"
          style={styles.input}
          disabled={loading}
          autoFocus
          onKeyDown={(e) => e.key === 'Enter' && handleForgotSubmit()}
        />
      </div>
      <button
        onClick={handleForgotSubmit}
        style={loading ? { ...styles.submitBtn, ...styles.disabledBtn } : styles.submitBtn}
        disabled={loading}
      >
        {loading ? 'Sending...' : 'Send Reset Link'}
      </button>
      <div style={styles.linksRow}>
        <span onClick={() => switchMode('login')} style={styles.link}>Back to log in</span>
      </div>
    </div>
  );

  // ── RENDER: Forgot Step 2 (confirmation) ──
  const renderForgotStep2 = () => (
    <div style={styles.form}>
      <div style={styles.success}>
        If an account exists with that username or email, we've sent a password reset email. Check your inbox.
      </div>
      <button
        onClick={() => switchMode('login')}
        style={styles.submitBtn}
      >
        Back to Log In
      </button>
    </div>
  );

  // Mode title
  const modeTitle = mode === 'login' ? 'Log In' : mode === 'signup' ? 'Sign Up' : 'Reset Password';

  return (
    <div style={styles.backdrop} onClick={handleBackdropClick}>
      <div style={styles.modal}>
        {/* Title */}
        <div style={styles.title}>{modeTitle}</div>

        {/* Notice (e.g. pending invite) */}
        {notice && <div style={styles.notice}>{notice}</div>}

        {/* Login */}
        {mode === 'login' && renderLogin()}

        {/* Signup */}
        {mode === 'signup' && signupStep === 1 && renderSignupStep1()}
        {mode === 'signup' && signupStep === 2 && renderSignupStep2()}

        {/* Forgot Password */}
        {mode === 'forgot' && forgotStep === 1 && renderForgotStep1()}
        {mode === 'forgot' && forgotStep === 2 && renderForgotStep2()}
      </div>
    </div>
  );
};

const styles = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  modal: {
    backgroundColor: '#faf9f6',
    border: '1px solid #d0d0d0',
    borderRadius: '6px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    width: '100%',
    maxWidth: '380px',
    padding: '28px 32px 32px',
    fontFamily: '"EB Garamond", Georgia, serif',
  },
  title: {
    fontSize: '20px',
    fontWeight: '600',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#333',
    textAlign: 'center',
    marginBottom: '20px',
    borderBottom: '1px solid #d0d0d0',
    paddingBottom: '12px',
  },
  notice: {
    padding: '10px 12px',
    backgroundColor: '#f5f0e8',
    border: '1px solid #e0d8c8',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    marginBottom: '16px',
    lineHeight: '1.4',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
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
  submitBtn: {
    padding: '10px',
    fontSize: '15px',
    fontWeight: '500',
    fontFamily: '"EB Garamond", Georgia, serif',
    backgroundColor: '#333',
    color: '#faf9f6',
    border: '1px solid #333',
    borderRadius: '4px',
    cursor: 'pointer',
    marginTop: '4px',
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
  success: {
    padding: '9px 12px',
    backgroundColor: '#f0fef4',
    color: '#080',
    borderRadius: '4px',
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    lineHeight: '1.4',
  },
  confirmText: {
    fontSize: '15px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    textAlign: 'center',
  },
  linksRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  link: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  switchRow: {
    textAlign: 'center',
    marginTop: '4px',
  },
  switchText: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
  },
  orcidExplanation: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    lineHeight: '1.5',
    textAlign: 'center',
  },
  orcidNote: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    textAlign: 'center',
  },
  orcidBadge: {
    fontSize: '14px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#555',
    padding: '8px 12px',
    backgroundColor: '#f5f5f0',
    border: '1px solid #e0ddd8',
    borderRadius: '4px',
    textAlign: 'center',
  },
  fieldNote: {
    fontSize: '13px',
    fontFamily: '"EB Garamond", Georgia, serif',
    color: '#888',
    lineHeight: '1.3',
  },
};

export default LoginModal;
