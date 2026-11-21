import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useFirebase } from '@/context/FirebaseContext';
import { useTheme } from '@/context/ThemeContext';
import { authErrorMessage, authModeForPath, validateEmailAddress, validateNewPassword, type AuthMode } from '@/lib/authUi';
import './AuthScreen.css';

type BusyAction = AuthMode | 'google' | 'guest' | 'verification' | 'check-verification' | 'sign-out' | null;

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-[18px] w-[18px]">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5Z" transform="translate(0 4)" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.73 7.18l7.73 6C44.45 37.95 46.98 31.84 46.98 24.55Z" transform="translate(0 1)" />
      <path fill="#FBBC05" d="M10.53 28.59a14.4 14.4 0 0 1-.75-4.59c0-1.59.27-3.13.75-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.53 2.56 10.78l7.97-6.19Z" transform="translate(1)" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.89 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 43.62 14.62 48 24 48Z" transform="translate(0 -2)" />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required = true,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>{label}</label>
      <div className="auth-input-wrap">
        <LockKeyhole aria-hidden="true" className="auth-input-icon" size={18} />
        <input
          id={id}
          name={id}
          className="auth-input auth-input-with-action"
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          minLength={8}
          maxLength={128}
          required={required}
        />
        <button
          className="auth-password-toggle"
          type="button"
          onClick={() => setVisible((shown) => !shown)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  );
}

function BrandMark() {
  return (
    <span className="auth-brand-mark" aria-hidden="true">
      <img src="/favicon.svg" alt="" />
    </span>
  );
}

export default function AuthScreen() {
  const { user, signInWithGoogle, signInWithEmail, createAccount, signInAsGuest, sendPasswordReset, resendVerification, refreshVerification, signOut } = useFirebase();
  const { resolvedTheme, setTheme } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>(() => authModeForPath(location.pathname));
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [notice, setNotice] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    const nextMode = authModeForPath(location.pathname);
    setMode(nextMode);
    setErrorMessage('');
    setNotice('');
  }, [location.pathname]);

  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
  }, [user?.email, email]);

  useEffect(() => {
    if (user && mode !== 'reset' && (user.isAnonymous || user.emailVerified)) {
      navigate('/', { replace: true });
    }
  }, [mode, user, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setTimeout(() => setResendCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const chooseMode = (nextMode: AuthMode) => {
    setErrorMessage('');
    setNotice('');
    setMode(nextMode);
    const path = nextMode === 'reset' ? '/forgot-password' : nextMode === 'sign-up' ? '/signup' : '/login';
    navigate(path);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage('');
    setNotice('');

    const emailError = validateEmailAddress(email);
    if (emailError) {
      setErrorMessage(emailError);
      return;
    }

    if (mode === 'reset') {
      setBusy('reset');
      try {
        await sendPasswordReset(email.trim());
        setNotice('If there’s an account for this address, we’ve sent a password reset link. Check your inbox and spam folder.');
      } catch (error) {
        setErrorMessage(authErrorMessage(error, 'reset'));
      } finally {
        setBusy(null);
      }
      return;
    }

    if (mode === 'sign-up' && !displayName.trim()) {
      setErrorMessage('Enter your name.');
      return;
    }
    const passwordError = mode === 'sign-up' ? validateNewPassword(password) : !password ? 'Enter your password.' : null;
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    setBusy(mode);
    try {
      if (mode === 'sign-up') {
        await createAccount(email.trim(), password, displayName.trim(), rememberMe);
      } else {
        await signInWithEmail(email.trim(), password, rememberMe);
      }
    } catch (error) {
      setErrorMessage(authErrorMessage(error, mode));
    } finally {
      setBusy(null);
    }
  };

  const handleGoogle = async () => {
    setErrorMessage('');
    setNotice('');
    setBusy('google');
    try {
      await signInWithGoogle();
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'google'));
    } finally {
      setBusy(null);
    }
  };

  const handleGuestSignIn = async () => {
    setErrorMessage('');
    setNotice('');
    setBusy('guest');
    try {
      await signInAsGuest();
    } catch {
      setErrorMessage('Guest access is unavailable right now. Please try another sign-in option.');
    } finally {
      setBusy(null);
    }
  };

  const handleResendVerification = async () => {
    setErrorMessage('');
    setNotice('');
    setBusy('verification');
    try {
      await resendVerification();
      setNotice('A fresh verification link is on its way. Check your inbox and spam folder.');
      setResendCooldown(30);
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'verify'));
    } finally {
      setBusy(null);
    }
  };

  const handleCheckVerification = async () => {
    setErrorMessage('');
    setNotice('');
    setBusy('check-verification');
    try {
      const verified = await refreshVerification();
      if (verified) setNotice('Email verified. Opening your workspace…');
      else setErrorMessage('We haven’t received the verification yet. Open the link in your email, then check again.');
    } catch (error) {
      setErrorMessage(authErrorMessage(error, 'verify'));
    } finally {
      setBusy(null);
    }
  };

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  const isVerifying = Boolean(user && !user.isAnonymous && !user.emailVerified);
  const heading = mode === 'reset' ? 'Reset your password' : mode === 'sign-up' ? 'Create your account' : 'Welcome back';
  const subheading = mode === 'reset'
    ? 'We’ll email you a secure link to choose a new password.'
    : mode === 'sign-up'
      ? 'Create an account and verify your email to get started.'
      : 'Sign in to pick up right where you left off.';

  return (
    <main className="auth-screen">
      <aside className="auth-visual" aria-hidden="true">
        <div className="auth-visual-top">
          <BrandMark />
          <span className="auth-wordmark">Your AI workspace</span>
        </div>
        <div className="auth-visual-copy">
          <span className="auth-eyebrow"><Sparkles size={14} /> A little more room to think</span>
          <h1>Make space for<br />your next idea.</h1>
          <p>Bring your projects, research, and creative work into one calm, capable workspace.</p>
          <div className="auth-visual-rule" />
          <div className="auth-visual-note"><ShieldCheck size={16} /> Private by design. Ready when you are.</div>
        </div>
        <div className="auth-visual-footer">A thoughtful place to get things moving.</div>
        <div className="auth-orbit auth-orbit-one" />
        <div className="auth-orbit auth-orbit-two" />
      </aside>

      <section className="auth-content">
        <header className="auth-mobile-header">
          <div className="auth-mobile-brand"><BrandMark /><span>Your AI workspace</span></div>
          <button className="auth-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}>
            {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </header>

        <div className="auth-panel">
          <div className="auth-panel-tools">
            <div className="auth-mobile-eyebrow"><span className="auth-dot" /> Secure sign-in</div>
            <button className="auth-theme-toggle auth-desktop-theme-toggle" type="button" onClick={toggleTheme} aria-label={`Switch to ${resolvedTheme === 'dark' ? 'light' : 'dark'} theme`}>
              {resolvedTheme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>

          {isVerifying ? (
            <div className="auth-form-area auth-verify-area">
              <span className="auth-icon-badge"><Mail size={22} /></span>
              <p className="auth-eyebrow auth-eyebrow-light">One quick step</p>
              <h2>Verify your email</h2>
              <p className="auth-description">We sent a verification link to <strong>{user?.email || email}</strong>. Confirm your address to open your workspace.</p>
              {errorMessage && <div className="auth-message auth-message-error" role="alert">{errorMessage}</div>}
              {notice && <div className="auth-message auth-message-success" role="status"><CheckCircle2 size={17} />{notice}</div>}
              <button className="auth-primary-button" type="button" onClick={handleCheckVerification} disabled={busy !== null}>
                {busy === 'check-verification' ? <LoaderCircle className="auth-spinner" size={18} /> : <>I’ve verified my email <ArrowRight size={17} /></>}
              </button>
              <button className="auth-text-button auth-resend-button" type="button" onClick={handleResendVerification} disabled={busy !== null || resendCooldown > 0}>
                {busy === 'verification' ? 'Sending…' : resendCooldown > 0 ? `Resend link in ${resendCooldown}s` : 'Resend verification email'}
              </button>
              <div className="auth-verify-divider" />
              <button className="auth-back-button" type="button" onClick={() => signOut()} disabled={busy !== null}>
                <ArrowLeft size={16} /> Use another account
              </button>
            </div>
          ) : (
            <div className="auth-form-area">
              <p className="auth-eyebrow auth-eyebrow-light">{mode === 'reset' ? 'Account recovery' : mode === 'sign-up' ? 'Create an account' : 'Secure sign-in'}</p>
              <h2>{heading}</h2>
              <p className="auth-description">{subheading}</p>

              {mode !== 'reset' && (
                <button className="auth-google-button" type="button" onClick={handleGoogle} disabled={busy !== null}>
                  {busy === 'google' ? <LoaderCircle className="auth-spinner" size={18} /> : <GoogleMark />}
                  <span>{busy === 'google' ? 'Connecting to Google…' : 'Continue with Google'}</span>
                </button>
              )}

              {mode !== 'reset' && <div className="auth-divider"><span>or continue with email</span></div>}

              <form className="auth-form" onSubmit={handleSubmit} noValidate>
                {mode === 'sign-up' && (
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="displayName">Your name</label>
                    <div className="auth-input-wrap">
                      <input
                        id="displayName"
                        name="displayName"
                        className="auth-input"
                        type="text"
                        autoComplete="name"
                        maxLength={100}
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}

                <div className="auth-field">
                  <label className="auth-label" htmlFor="email">Email address</label>
                  <div className="auth-input-wrap">
                    <Mail aria-hidden="true" className="auth-input-icon" size={18} />
                    <input
                      id="email"
                      name="email"
                      className="auth-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      maxLength={254}
                      spellCheck={false}
                      autoCapitalize="none"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>
                </div>

                {mode !== 'reset' && (
                  <PasswordField
                    id="password"
                    label="Password"
                    value={password}
                    onChange={setPassword}
                    autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
                  />
                )}

                {mode !== 'reset' && (
                  <div className="auth-form-options">
                    <label className="auth-remember-label">
                      <input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} />
                      <span className="auth-checkmark" aria-hidden="true" />
                      Remember me
                    </label>
                    {mode === 'sign-in' && <button className="auth-text-button" type="button" onClick={() => chooseMode('reset')}>Forgot password?</button>}
                  </div>
                )}


                {errorMessage && <div className="auth-message auth-message-error" role="alert">{errorMessage}</div>}
                {notice && <div className="auth-message auth-message-success" role="status"><CheckCircle2 size={17} />{notice}</div>}

                <button className="auth-primary-button" type="submit" disabled={busy !== null}>
                  {busy === mode ? <LoaderCircle className="auth-spinner" size={18} /> : <>{mode === 'reset' ? 'Send reset link' : mode === 'sign-up' ? 'Create account' : 'Sign in'} <ArrowRight size={17} /></>}
                </button>
              </form>

              {mode === 'sign-in' && (
                <p className="auth-switch-copy">New here?<button className="auth-text-button" type="button" onClick={() => chooseMode('sign-up')}>Create an account</button></p>
              )}
              {mode === 'sign-up' && (
                <p className="auth-switch-copy">Already have an account?<button className="auth-text-button" type="button" onClick={() => chooseMode('sign-in')}>Sign in</button></p>
              )}

              {mode === 'sign-in' && (
                <button className="auth-skip-button" type="button" onClick={handleGuestSignIn} disabled={busy !== null}>
                  {busy === 'guest' ? <LoaderCircle className="auth-spinner" size={17} /> : <ArrowRight size={16} />}
                  <span>{busy === 'guest' ? 'Starting a guest session…' : 'Skip for now'}</span>
                </button>
              )}

              {mode === 'reset' && (
                <button className="auth-back-button auth-reset-back" type="button" onClick={() => chooseMode('sign-in')}><ArrowLeft size={16} /> Back to sign in</button>
              )}
            </div>
          )}

          <footer className="auth-panel-footer"><ShieldCheck size={15} /> Your password is secured by Firebase Authentication.</footer>
        </div>
      </section>
    </main>
  );
}
