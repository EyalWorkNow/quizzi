import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { loadTeacherSettings, saveTeacherSettings } from '../lib/localData.ts';
import { trackTeacherAuthEvent, toAnalyticsErrorCode } from '../lib/appAnalytics.ts';
import {
  DEMO_TEACHER_EMAIL,
  DEMO_TEACHER_PASSWORD,
  loadTeacherAuth,
  refreshTeacherSession,
  registerTeacherWithPassword,
  signInTeacherWithPassword,
  signInTeacherWithProvider,
  handleTeacherAuthRedirect,
  signOutTeacher,
  type TeacherAuthSession,
} from '../lib/teacherAuth.ts';

type AccessMode = 'login' | 'create';
type PendingAction = 'password' | 'google' | 'facebook' | 'logout' | null;

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const teacherSettings = loadTeacherSettings();
  const targetPath = typeof location.state?.from === 'string' ? location.state.from : '/teacher/dashboard';

  const [mode, setMode] = useState<AccessMode>('login');
  const [name, setName] = useState(`${teacherSettings.profile.firstName} ${teacherSettings.profile.lastName}`.trim());
  const [school, setSchool] = useState(teacherSettings.profile.school);
  const [email, setEmail] = useState(DEMO_TEACHER_EMAIL);
  const [password, setPassword] = useState(DEMO_TEACHER_PASSWORD);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [existingSession, setExistingSession] = useState<TeacherAuthSession | null>(() => loadTeacherAuth());
  const [restoringSession, setRestoringSession] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const socialLabel = useMemo(() => (mode === 'login' ? 'Continue with' : 'Create with'), [mode]);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        // First check for redirect results (Google Sign-In return)
        const redirectSession = await handleTeacherAuthRedirect();
        if (redirectSession && !cancelled) {
          completeAccess({
            session: redirectSession,
            successMessage: 'Signed in successfully via Google.',
          });
          return;
        }

        const session = await refreshTeacherSession();
        if (!cancelled) {
          setExistingSession(session);
        }
      } catch (err: any) {
        console.error('Session restoration failed:', err);
        if (!cancelled) {
          setExistingSession(null);
          setError(err?.message || '');
        }
      } finally {
        if (!cancelled) {
          setRestoringSession(false);
        }
      }
    };

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const persistSchool = (value: string) => {
    const settings = loadTeacherSettings();
    saveTeacherSettings({
      ...settings,
      profile: {
        ...settings.profile,
        school: value.trim() || settings.profile.school,
      },
    });
  };

  const applyDemoCredentials = () => {
    setMode('login');
    setEmail(DEMO_TEACHER_EMAIL);
    setPassword(DEMO_TEACHER_PASSWORD);
    setConfirmPassword('');
    setError('');
    setFeedback('');
  };

  const completeAccess = ({
    session,
    successMessage,
  }: {
    session: TeacherAuthSession;
    successMessage: string;
  }) => {
    if (school.trim()) {
      persistSchool(school);
    }
    setExistingSession(session);
    setFeedback(successMessage);
    setError('');
    navigate(targetPath);
  };

  const handlePasswordAccess = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setFeedback('');
    setPendingAction('password');
    const normalizedEmail = email.trim().toLowerCase();
    const useDemoAccount =
      normalizedEmail === DEMO_TEACHER_EMAIL.toLowerCase() && password === DEMO_TEACHER_PASSWORD;
    const accessMode: AccessMode = useDemoAccount ? 'login' : mode;
    void trackTeacherAuthEvent({
      action: 'sign_in',
      provider: 'password',
      result: 'attempt',
      mode: accessMode,
    });

    try {
      if (accessMode === 'create') {
        if (password !== confirmPassword) {
          throw new Error('Password confirmation does not match.');
        }
      }

      const session =
        accessMode === 'create'
          ? await registerTeacherWithPassword({
              email,
              password,
              name,
              school,
            })
          : await signInTeacherWithPassword({
              email,
              password,
              name,
              school,
            });
      completeAccess({
        session,
        successMessage:
          accessMode === 'create'
            ? 'Teacher account created and signed in.'
            : useDemoAccount
              ? 'Signed in with the demo teacher account.'
              : 'Signed in successfully.',
      });
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider: 'password',
        result: 'success',
        mode: accessMode,
      });
    } catch (loginError: any) {
      setError(loginError?.message || 'Unable to sign in right now.');
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider: 'password',
        result: 'failure',
        mode: accessMode,
        errorCode: toAnalyticsErrorCode(loginError),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleDemoAccess = async () => {
    applyDemoCredentials();
    setPendingAction('password');
    void trackTeacherAuthEvent({
      action: 'sign_in',
      provider: 'password',
      result: 'attempt',
      mode: 'login',
    });

    try {
      const session = await signInTeacherWithPassword({
        email: DEMO_TEACHER_EMAIL,
        password: DEMO_TEACHER_PASSWORD,
        name: name.trim() || 'Demo Teacher',
        school: school.trim() || 'Quizzi Academy',
      });
      completeAccess({
        session,
        successMessage: 'Signed in with the demo teacher account.',
      });
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider: 'password',
        result: 'success',
        mode: 'login',
      });
    } catch (loginError: any) {
      setError(loginError?.message || 'Demo sign-in is unavailable right now.');
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider: 'password',
        result: 'failure',
        mode: 'login',
        errorCode: toAnalyticsErrorCode(loginError),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleSocialAccess = async (provider: 'google' | 'facebook') => {
    setError('');
    setFeedback('');
    setPendingAction(provider);
    void trackTeacherAuthEvent({
      action: 'sign_in',
      provider,
      result: 'attempt',
      mode,
    });

    try {
      const session = await signInTeacherWithProvider({
        provider,
      });
      completeAccess({
        session,
        successMessage: `${mode === 'login' ? 'Signed in' : 'Account created'} with ${provider === 'google' ? 'Google' : 'Facebook'}.`,
      });
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider,
        result: 'success',
        mode,
      });
    } catch (socialError: any) {
      setError(socialError?.message || 'Social access is unavailable right now.');
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider,
        result: 'failure',
        mode,
        errorCode: toAnalyticsErrorCode(socialError),
      });
    } finally {
      setPendingAction(null);
    }
  };

  const handleLogout = async () => {
    setPendingAction('logout');
    setError('');
    try {
      await signOutTeacher();
      setExistingSession(null);
      setFeedback('Signed out.');
      void trackTeacherAuthEvent({
        action: 'sign_out',
        provider: existingSession?.provider || 'password',
        result: 'success',
        mode,
      });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-brand-dark font-sans selection:bg-brand-orange selection:text-white overflow-x-clip">
      <nav className="page-shell relative z-20 flex items-center justify-between gap-4 py-5">
        <div className="text-3xl font-black tracking-tight flex items-center gap-1 cursor-pointer" onClick={() => navigate('/')}>
          <span className="text-brand-orange">Quiz</span>zi
        </div>
        <button
          onClick={() => navigate('/')}
          className="w-12 h-12 flex items-center justify-center bg-white border-2 border-brand-dark rounded-full hover:bg-brand-yellow transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
        >
          <ArrowLeft className="w-5 h-5 text-brand-dark" />
        </button>
      </nav>

      <main className="page-shell grid grid-cols-1 gap-8 items-start pt-4 pb-16 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-brand-dark text-white rounded-[2.3rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#FF5A36] p-6 sm:p-8 lg:p-10 relative overflow-hidden"
          >
            <div className="absolute top-[-30px] right-[-20px] w-56 h-56 rounded-full bg-white/10" />
            <div className="absolute bottom-[-30px] right-28 w-32 h-32 rounded-full bg-brand-yellow/20" />

            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">Teacher Access</p>
              <h1 className="text-[2.9rem] xs:text-[3.3rem] lg:text-6xl font-black leading-[0.95] tracking-tight mb-5">
                Move from quiz creation to live analytics without friction.
              </h1>
              <p className="text-base sm:text-lg font-medium text-white/75 max-w-2xl">
                One entry point for pack creation, live hosting, class analytics, and student-specific follow-up games.
              </p>

              <div className="grid grid-cols-1 gap-4 mt-8 sm:grid-cols-2 xl:grid-cols-3">
                <BenefitCard title="Create" body="Generate or edit question packs from uploaded material." />
                <BenefitCard title="Host" body="Launch a live lobby, watch players join, and run the session." />
                <BenefitCard title="Adapt" body="Open a student drill-down and build a same-material follow-up game." />
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-[2rem] sm:rounded-[2.5rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Demo Credentials</p>
                <h2 className="text-3xl font-black">Shared teacher account</h2>
              </div>
              <button
                type="button"
                onClick={applyDemoCredentials}
                className="px-5 py-3 rounded-full bg-brand-yellow border-2 border-brand-dark font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                Load Demo Login
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CredentialCard label="Email" value={DEMO_TEACHER_EMAIL} />
              <CredentialCard label="Password" value={DEMO_TEACHER_PASSWORD} />
            </div>

            <button
              type="button"
              onClick={handleDemoAccess}
              disabled={pendingAction !== null}
              className="mt-5 w-full px-6 py-4 bg-brand-dark text-white border-4 border-brand-dark rounded-[1.75rem] font-black text-lg flex items-center justify-center gap-3 shadow-[6px_6px_0px_0px_#FF5A36] disabled:opacity-60"
            >
              {pendingAction === 'password' ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              Enter With Demo Account
            </button>
          </motion.div>
        </section>

        <motion.section
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08 }}
          className="bg-white rounded-[2.2rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#1A1A1A] p-6 sm:p-8 lg:p-10"
        >
          <div className="flex items-center justify-between gap-3 mb-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">Access Flow</p>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{mode === 'login' ? 'Sign in to teacher studio' : 'Create your teacher profile'}</h2>
            </div>
            <ShieldCheck className="w-10 h-10 text-brand-purple" />
          </div>

          {restoringSession && (
            <div className="mb-6 bg-brand-bg rounded-[1.75rem] border-2 border-brand-dark p-5 flex items-center gap-3">
              <LoaderCircle className="w-5 h-5 animate-spin text-brand-orange" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Restoring Access</p>
                <p className="font-bold">Checking whether a secure teacher session is already active.</p>
              </div>
            </div>
          )}

          {existingSession && (
            <div className="mb-6 bg-brand-bg rounded-[1.75rem] border-2 border-brand-dark p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">Current Session</p>
              <p className="font-black text-xl">{existingSession.email}</p>
              <p className="text-sm font-bold text-brand-dark/55 mt-1">
                Protected with an HTTP-only cookie
                {existingSession.expiresAt
                  ? ` and valid until ${new Date(existingSession.expiresAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}.`
                  : '.'}
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => navigate('/teacher/dashboard')}
                  className="px-5 py-3 bg-brand-dark text-white border-2 border-brand-dark rounded-full font-black"
                >
                  Continue to Dashboard
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={pendingAction === 'logout'}
                  className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black disabled:opacity-60"
                >
                  {pendingAction === 'logout' ? 'Signing Out...' : 'Sign Out'}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 mb-8 xs:grid-cols-2">
            <button
              type="button"
              onClick={applyDemoCredentials}
              className={`px-5 py-4 rounded-2xl border-2 border-brand-dark font-black ${mode === 'login' ? 'bg-brand-dark text-white' : 'bg-brand-bg text-brand-dark'}`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('create');
                setError('');
                setFeedback('');
                if (email === DEMO_TEACHER_EMAIL) {
                  setEmail(teacherSettings.profile.email || '');
                }
                if (password === DEMO_TEACHER_PASSWORD) {
                  setPassword('');
                }
                setConfirmPassword('');
              }}
              className={`px-5 py-4 rounded-2xl border-2 border-brand-dark font-black ${mode === 'create' ? 'bg-brand-dark text-white' : 'bg-brand-bg text-brand-dark'}`}
            >
              Create Account
            </button>
          </div>

          {feedback && (
            <div className="mb-5 bg-[#e5fff0] border-2 border-brand-dark rounded-2xl p-4 flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="font-bold">{feedback}</span>
            </div>
          )}

          {error && (
            <div className="mb-5 bg-[#fff1ef] border-2 border-brand-dark rounded-2xl p-4">
              <p className="font-bold text-brand-dark">{error}</p>
            </div>
          )}

          <form onSubmit={handlePasswordAccess} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field
                label="Display Name"
                icon={<User className="w-5 h-5" />}
                value={name}
                onChange={setName}
                placeholder="Teacher name"
                autoComplete="name"
              />
              <Field
                label="School"
                icon={<Sparkles className="w-5 h-5" />}
                value={school}
                onChange={setSchool}
                placeholder="Your school"
                autoComplete="organization"
              />
            </div>

            <div className="rounded-[2rem] border-2 border-brand-dark bg-brand-bg p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Email Access</p>
                  <h3 className="text-2xl font-black">{mode === 'create' ? 'Create a teacher account' : 'Use the demo teacher login'}</h3>
                </div>
                <span className={`px-3 py-2 rounded-full border-2 border-brand-dark text-xs font-black uppercase tracking-[0.15em] ${mode === 'create' ? 'bg-white' : 'bg-brand-yellow'}`}>
                  {mode === 'create' ? 'Secure Sign-Up' : 'Demo Ready'}
                </span>
              </div>

              <div className="space-y-4">
                <Field
                  label="Email"
                  icon={<Mail className="w-5 h-5" />}
                  value={email}
                  onChange={setEmail}
                  placeholder={DEMO_TEACHER_EMAIL}
                  autoComplete="email"
                />
                <Field
                  label="Password"
                  icon={<Lock className="w-5 h-5" />}
                  value={password}
                  onChange={setPassword}
                  placeholder={mode === 'login' ? DEMO_TEACHER_PASSWORD : 'Create a password'}
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                />
                {mode === 'create' && (
                  <Field
                    label="Confirm Password"
                    icon={<Lock className="w-5 h-5" />}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Repeat your password"
                    type="password"
                    autoComplete="new-password"
                  />
                )}
              </div>

              <button
                type="submit"
                disabled={pendingAction !== null}
                className="mt-5 w-full px-6 py-4 sm:py-5 bg-brand-orange text-white border-4 border-brand-dark rounded-[1.75rem] font-black text-lg sm:text-xl flex items-center justify-center gap-3 shadow-[8px_8px_0px_0px_#1A1A1A] disabled:opacity-60"
              >
                {pendingAction === 'password' ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                {pendingAction === 'password'
                  ? mode === 'create'
                    ? 'Creating Account...'
                    : 'Signing In...'
                  : mode === 'create'
                    ? 'Create Teacher Account'
                    : 'Enter Teacher Area'}
              </button>
            </div>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-[2px] flex-1 bg-brand-dark/10" />
            <span className="text-xs font-black uppercase tracking-[0.25em] text-brand-dark/40">Or use social access</span>
            <div className="h-[2px] flex-1 bg-brand-dark/10" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SocialAccessButton
              brand="google"
              title={`${socialLabel} Google`}
              body="Fast and secure access with your Google account."
              loading={pendingAction === 'google'}
              disabled={pendingAction !== null}
              onClick={() => handleSocialAccess('google')}
            />
            <SocialAccessButton
              brand="facebook"
              title={`${socialLabel} Facebook`}
              body="Requires provider activation. Use email registration until Facebook sign-in is configured."
              loading={pendingAction === 'facebook'}
              disabled={pendingAction !== null}
              onClick={() => handleSocialAccess('facebook')}
            />
          </div>

          <p className="mt-6 text-sm font-bold text-brand-dark/50">
            Teacher routes are now verified on the server. If a session expires or the cookie is missing, direct navigation will send you back here before opening the workspace.
          </p>
        </motion.section>
      </main>
    </div>
  );
}

function Field({
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = 'text',
  autoComplete,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{label}</span>
      <div className="relative">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-dark/35">{icon}</div>
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="w-full bg-white border-2 border-brand-dark rounded-2xl py-4 pl-12 pr-4 text-base font-bold placeholder:text-brand-dark/30 focus:outline-none focus:ring-4 focus:ring-brand-orange/15"
        />
      </div>
    </label>
  );
}

function BenefitCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[1.75rem] border-2 border-white/10 bg-white/10 p-5">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-yellow mb-2">{title}</p>
      <p className="font-medium text-white/75">{body}</p>
    </div>
  );
}

function CredentialCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg p-4">
      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40 mb-2">{label}</p>
      <p className="text-xl font-black">{value}</p>
    </div>
  );
}

function SocialAccessButton({
  brand,
  title,
  body,
  loading,
  disabled,
  onClick,
}: {
  brand: 'google' | 'facebook';
  title: string;
  body: string;
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  const badgeClass = brand === 'google' ? 'bg-white text-[#DB4437]' : 'bg-[#1877F2] text-white';
  const borderClass = brand === 'google' ? 'bg-brand-bg' : 'bg-[#e8f1ff]';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`text-left rounded-[1.75rem] border-2 border-brand-dark ${borderClass} p-5 shadow-[4px_4px_0px_0px_#1A1A1A] disabled:opacity-60`}
    >
      <div className="flex items-center gap-4 mb-4">
        <div className={`w-12 h-12 rounded-full border-2 border-brand-dark flex items-center justify-center font-black text-xl ${badgeClass}`}>
          {loading ? <LoaderCircle className="w-5 h-5 animate-spin" /> : brand === 'google' ? 'G' : 'f'}
        </div>
        <div>
          <p className="text-xl font-black">{title}</p>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/40">{brand}</p>
        </div>
      </div>
      <p className="font-medium text-brand-dark/70">{body}</p>
    </button>
  );
}
