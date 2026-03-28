import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  LoaderCircle,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  User,
} from 'lucide-react';
import { loadTeacherSettings, saveTeacherSettings } from '../lib/localData.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { trackTeacherAuthEvent, toAnalyticsErrorCode } from '../lib/appAnalytics.ts';
import {
  DEMO_AUTH_ENABLED,
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
import BrandLogo from '../components/BrandLogo.tsx';

type AccessMode = 'login' | 'create';
type PendingAction = 'password' | 'google' | 'facebook' | 'logout' | null;
const TEACHER_AUTH_DRAFT_KEY = 'quizzi.teacher.auth.draft';
const TEACHER_PASSWORD_MIN_LENGTH = 8;

function readTeacherAuthDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(TEACHER_AUTH_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const teacherSettings = loadTeacherSettings();
  const targetPath = typeof location.state?.from === 'string' ? location.state.from : '/teacher/dashboard';

  const { t, direction, language } = useAppLanguage();
  const draft = readTeacherAuthDraft();
  const [mode, setMode] = useState<AccessMode>('login');
  const [name, setName] = useState(typeof draft?.name === 'string' ? draft.name : `${teacherSettings.profile.firstName} ${teacherSettings.profile.lastName}`.trim());
  const [school, setSchool] = useState(typeof draft?.school === 'string' ? draft.school : teacherSettings.profile.school);
  const [email, setEmail] = useState(typeof draft?.email === 'string' ? draft.email : DEMO_AUTH_ENABLED ? DEMO_TEACHER_EMAIL : teacherSettings.profile.email || '');
  const [password, setPassword] = useState(DEMO_AUTH_ENABLED ? DEMO_TEACHER_PASSWORD : '');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(typeof location.state?.error === 'string' ? location.state.error : '');
  const [feedback, setFeedback] = useState('');
  const [existingSession, setExistingSession] = useState<TeacherAuthSession | null>(() => loadTeacherAuth());
  const [restoringSession, setRestoringSession] = useState(true);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [draftRestored, setDraftRestored] = useState(Boolean(draft));
  const authFallbackCopy = {
    he: {
      demoUnavailable: 'גישה לחשבון הדמו אינה זמינה בסביבה הזאת.',
      demoTeacher: 'מורת דמו',
      demoSchool: 'אקדמיית Quizzi',
    },
    ar: {
      demoUnavailable: 'الوصول إلى الحساب التجريبي غير متاح في هذه البيئة.',
      demoTeacher: 'معلّمة تجريبية',
      demoSchool: 'أكاديمية Quizzi',
    },
    en: {
      demoUnavailable: 'Demo access is unavailable in this environment.',
      demoTeacher: 'Demo Teacher',
      demoSchool: 'Quizzi Academy',
    },
  }[language];

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        // First check for redirect results (Google Sign-In return)
        const redirectSession = await handleTeacherAuthRedirect();
        if (redirectSession && !cancelled) {
          completeAccess({
            session: redirectSession,
            successMessage: t('auth.heroTitle'), // Or a generic success message
          });
          return;
        }

        const cachedSession = loadTeacherAuth();
        if (!cachedSession) {
          if (!cancelled) {
            setExistingSession(null);
          }
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      TEACHER_AUTH_DRAFT_KEY,
      JSON.stringify({
        name,
        school,
        email,
      }),
    );
  }, [name, school, email]);

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
    if (!DEMO_AUTH_ENABLED) return;
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
    window.localStorage.removeItem(TEACHER_AUTH_DRAFT_KEY);
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
      DEMO_AUTH_ENABLED &&
      normalizedEmail === DEMO_TEACHER_EMAIL.toLowerCase() &&
      password === DEMO_TEACHER_PASSWORD;
    const accessMode: AccessMode = useDemoAccount ? 'login' : mode;
    void trackTeacherAuthEvent({
      action: 'sign_in',
      provider: 'password',
      result: 'attempt',
      mode: accessMode,
    });

    try {
      if (!useDemoAccount && password.trim().length < TEACHER_PASSWORD_MIN_LENGTH) {
        throw new Error(`Password must be at least ${TEACHER_PASSWORD_MIN_LENGTH} characters.`);
      }

      if (accessMode === 'create') {
        if (password !== confirmPassword) {
          throw new Error(t('settings.feedback.passwordsMismatch'));
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
            ? t('auth.createAccountTitle')
            : useDemoAccount
              ? t('auth.enterWithDemoAccount')
              : t('auth.signIn'),
      });
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider: 'password',
        result: 'success',
        mode: accessMode,
      });
    } catch (loginError: any) {
      setError(loginError?.message || t('home.error.failedToJoin'));
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
    if (!DEMO_AUTH_ENABLED) {
      setError(authFallbackCopy.demoUnavailable);
      return;
    }
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
        name: name.trim() || authFallbackCopy.demoTeacher,
        school: school.trim() || authFallbackCopy.demoSchool,
      });
      completeAccess({
        session,
        successMessage: t('auth.enterWithDemoAccount'),
      });
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider: 'password',
        result: 'success',
        mode: 'login',
      });
    } catch (loginError: any) {
      setError(loginError?.message || t('home.error.failedToJoin'));
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
      if (!session) {
        setFeedback(t('auth.signingIn'));
        setError('');
        return;
      }
      completeAccess({
        session,
        successMessage: `${mode === 'login' ? t('auth.signIn') : t('auth.createAccount')} with ${provider === 'google' ? 'Google' : 'Facebook'}.`,
      });
      void trackTeacherAuthEvent({
        action: 'sign_in',
        provider,
        result: 'success',
        mode,
      });
    } catch (socialError: any) {
      setError(socialError?.message || t('home.error.failedToJoin'));
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
      setFeedback(t('auth.signingOut'));
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

  const emailLooksValid = /\S+@\S+\.\S+/.test(email);
  const usingDemoPasswordRules =
    mode === 'login' &&
    DEMO_AUTH_ENABLED &&
    email.trim().toLowerCase() === DEMO_TEACHER_EMAIL.toLowerCase() &&
    password === DEMO_TEACHER_PASSWORD;
  const minimumPasswordLength = usingDemoPasswordRules
    ? DEMO_TEACHER_PASSWORD.length
    : TEACHER_PASSWORD_MIN_LENGTH;
  const passwordReady = password.trim().length >= minimumPasswordLength;
  const confirmReady = mode === 'login' || password === confirmPassword;
  const canSubmit = emailLooksValid && passwordReady && confirmReady && pendingAction === null;

  return (
    <div 
      dir={direction}
      className="h-screen max-h-screen overflow-hidden bg-brand-bg text-brand-dark font-sans selection:bg-brand-orange selection:text-white flex flex-col"
    >
      <nav className="page-shell relative z-20 flex items-center justify-between gap-4 py-5 shrink-0">
        <BrandLogo onClick={() => navigate('/')} imageClassName="h-11 w-auto" />
        <button
          onClick={() => navigate('/')}
          className="w-12 h-12 flex items-center justify-center bg-white border-2 border-brand-dark rounded-full hover:bg-brand-yellow transition-colors shadow-[2px_2px_0px_0px_#1A1A1A]"
        >
          <ArrowLeft className="w-5 h-5 text-brand-dark" />
        </button>
      </nav>

      <main className="page-shell flex-1 overflow-y-auto thin-scrollbar grid grid-cols-1 gap-8 items-start pt-4 pb-16 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-brand-dark text-white rounded-[2.3rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#FF5A36] p-6 sm:p-8 lg:p-10 relative overflow-hidden"
          >
            <div className="absolute top-[-30px] right-[-20px] w-56 h-56 rounded-full bg-white/10" />
            <div className="absolute bottom-[-30px] right-28 w-32 h-32 rounded-full bg-brand-yellow/20" />

            <div className="relative z-10">
              <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-yellow mb-3">{t('auth.teacherAccess')}</p>
              <h1 className="text-[2.9rem] xs:text-[3.3rem] lg:text-6xl font-black leading-[0.95] tracking-tight mb-5">
                {t('auth.heroTitle')}
              </h1>
              <p className="text-base sm:text-lg font-medium text-white/75 max-w-2xl">
                {t('auth.heroBody')}
              </p>
              {draftRestored ? (
                <div className="mt-5 rounded-[1.4rem] border-2 border-white/30 bg-white/10 px-4 py-3">
                  <p className="text-sm font-black">שמירת הטיוטה הקודמת הוחזרה כדי שתוכל/י להמשיך בלי להתחיל מחדש.</p>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-4 mt-8 sm:grid-cols-2 xl:grid-cols-3">
                <BenefitCard title={t('auth.benefit.create.title')} body={t('auth.benefit.create.body')} />
                <BenefitCard title={t('auth.benefit.host.title')} body={t('auth.benefit.host.body')} />
                <BenefitCard title={t('auth.benefit.adapt.title')} body={t('auth.benefit.adapt.body')} />
              </div>
            </div>
          </motion.div>

          {DEMO_AUTH_ENABLED && (
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="bg-white rounded-[2rem] sm:rounded-[2.5rem] border-4 border-brand-dark shadow-[10px_10px_0px_0px_#1A1A1A] p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('auth.demoCredentials')}</p>
                <h2 className="text-3xl font-black">{t('auth.sharedTeacherAccount')}</h2>
              </div>
              <button
                type="button"
                onClick={applyDemoCredentials}
                className="px-5 py-3 rounded-full bg-brand-yellow border-2 border-brand-dark font-black shadow-[2px_2px_0px_0px_#1A1A1A]"
              >
                {t('auth.loadDemoLogin')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <CredentialCard label={t('auth.emailLabel')} value={DEMO_TEACHER_EMAIL} />
              <CredentialCard label={t('auth.passwordLabel')} value={DEMO_TEACHER_PASSWORD} />
            </div>

            <button
              type="button"
              onClick={handleDemoAccess}
              disabled={pendingAction !== null}
              className="mt-5 w-full px-6 py-4 bg-brand-dark text-white border-4 border-brand-dark rounded-[1.75rem] font-black text-lg flex items-center justify-center gap-3 shadow-[6px_6px_0px_0px_#FF5A36] disabled:opacity-60"
            >
              {pendingAction === 'password' ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
              {t('auth.enterWithDemoAccount')}
            </button>
          </motion.div>
          )}
        </section>

        <motion.section
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08 }}
          className="bg-white rounded-[2.2rem] sm:rounded-[3rem] border-4 border-brand-dark shadow-[12px_12px_0px_0px_#1A1A1A] p-6 sm:p-8 lg:p-10"
        >
          <div className="flex items-center justify-between gap-3 mb-8">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-orange mb-2">{t('auth.accessFlow')}</p>
              <h2 className="text-3xl sm:text-4xl font-black tracking-tight">{mode === 'login' ? t('auth.signInTitle') : t('auth.createProfileTitle')}</h2>
            </div>
            <ShieldCheck className="w-10 h-10 text-brand-purple" />
          </div>

          {restoringSession && (
            <div className="mb-6 bg-brand-bg rounded-[1.75rem] border-2 border-brand-dark p-5 flex items-center gap-3">
              <LoaderCircle className="w-5 h-5 animate-spin text-brand-orange" />
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{t('auth.restoringAccess')}</p>
                <p className="font-bold">{t('auth.checkingSession')}</p>
              </div>
            </div>
          )}

          {existingSession && (
            <div className="mb-6 bg-brand-bg rounded-[1.75rem] border-2 border-brand-dark p-5">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-2">{t('auth.currentSession')}</p>
              <p className="font-black text-xl">{existingSession.email}</p>
              <p className="text-sm font-bold text-brand-dark/55 mt-1">
                {t('auth.protectedCookie')}
                {existingSession.expiresAt
                  ? t('auth.validUntil', { time: new Date(existingSession.expiresAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })})
                  : '.'}
              </p>
              <div className="flex flex-wrap gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => navigate('/teacher/dashboard')}
                  className="px-5 py-3 bg-brand-dark text-white border-2 border-brand-dark rounded-full font-black"
                >
                  {t('auth.continueToDashboard')}
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={pendingAction === 'logout'}
                  className="px-5 py-3 bg-white border-2 border-brand-dark rounded-full font-black disabled:opacity-60"
                >
                  {pendingAction === 'logout' ? t('auth.signingOut') : t('auth.signOut')}
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 mb-8 xs:grid-cols-2">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError('');
                setFeedback('');
                setDraftRestored(false);
                if (DEMO_AUTH_ENABLED) {
                  applyDemoCredentials();
                }
              }}
              className={`px-5 py-4 rounded-2xl border-2 border-brand-dark font-black ${mode === 'login' ? 'bg-brand-dark text-white' : 'bg-brand-bg text-brand-dark'}`}
            >
              {t('auth.signIn')}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('create');
                setError('');
                setFeedback('');
                setDraftRestored(false);
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
              {t('auth.createAccount')}
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
                  label={t('auth.displayName')}
                  icon={<User className="w-5 h-5" />}
                  value={name}
                  onChange={(value) => {
                    setDraftRestored(false);
                    setName(value);
                  }}
                  placeholder={t('auth.teacherName')}
                  autoComplete="name"
                />
              <Field
                  label={t('auth.school')}
                  icon={<Sparkles className="w-5 h-5" />}
                  value={school}
                  onChange={(value) => {
                    setDraftRestored(false);
                    setSchool(value);
                  }}
                  placeholder={t('auth.yourSchool')}
                  autoComplete="organization"
                />
            </div>

            <div className="rounded-[2rem] border-2 border-brand-dark bg-brand-bg p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{t('auth.emailAccess')}</p>
                  <h3 className="text-2xl font-black">{mode === 'create' ? t('auth.createAccountTitle') : t('auth.useTeacherLogin')}</h3>
                </div>
                <span className={`px-3 py-2 rounded-full border-2 border-brand-dark text-xs font-black uppercase tracking-[0.15em] ${mode === 'create' ? 'bg-white' : DEMO_AUTH_ENABLED ? 'bg-brand-yellow' : 'bg-brand-bg'}`}>
                  {mode === 'create' ? t('auth.secureSignUp') : DEMO_AUTH_ENABLED ? t('auth.demoReady') : t('auth.secureSignIn')}
                </span>
              </div>

              <div className="space-y-4">
                <Field
                  label={t('auth.emailLabel')}
                  icon={<Mail className="w-5 h-5" />}
                  value={email}
                  onChange={(value) => {
                    setDraftRestored(false);
                    setEmail(value);
                  }}
                  placeholder={DEMO_AUTH_ENABLED ? DEMO_TEACHER_EMAIL : t('auth.teacherEmailPlaceholder')}
                  autoComplete="email"
                  helperText={email ? (emailLooksValid ? 'כתובת המייל נראית תקינה' : 'כדאי להזין כתובת מייל מלאה') : ''}
                />
                <Field
                  label={t('auth.passwordLabel')}
                  icon={<Lock className="w-5 h-5" />}
                  value={password}
                  onChange={setPassword}
                  placeholder={mode === 'login' ? (DEMO_AUTH_ENABLED ? DEMO_TEACHER_PASSWORD : t('auth.enterPassword')) : t('auth.createPassword')}
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  trailingAction={
                    <button type="button" onClick={() => setShowPassword((current) => !current)} className="text-brand-dark/55">
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  }
                  helperText={
                    password
                      ? passwordReady
                        ? 'הסיסמה מוכנה'
                        : `מומלץ להשתמש בלפחות ${minimumPasswordLength} תווים`
                      : ''
                  }
                />
                {mode === 'create' && (
                  <Field
                    label={t('auth.confirmPassword')}
                    icon={<Lock className="w-5 h-5" />}
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder={t('auth.repeatPassword')}
                    type={showConfirmPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    trailingAction={
                      <button type="button" onClick={() => setShowConfirmPassword((current) => !current)} className="text-brand-dark/55">
                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                      </button>
                    }
                    helperText={confirmPassword ? (confirmReady ? 'הסיסמאות תואמות' : 'הסיסמאות עדיין לא תואמות') : ''}
                  />
                )}
              </div>

              <button
                type="submit"
                disabled={!canSubmit}
                className="mt-5 w-full px-6 py-4 sm:py-5 bg-brand-orange text-white border-4 border-brand-dark rounded-[1.75rem] font-black text-lg sm:text-xl flex items-center justify-center gap-3 shadow-[8px_8px_0px_0px_#1A1A1A] disabled:opacity-60"
              >
                {pendingAction === 'password' ? <LoaderCircle className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
                {pendingAction === 'password'
                  ? mode === 'create'
                    ? t('auth.creatingAccount')
                    : t('auth.signingIn')
                  : mode === 'create'
                    ? t('auth.createTeacherAccount')
                    : t('auth.enterTeacherArea')}
              </button>
            </div>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-[2px] flex-1 bg-brand-dark/10" />
            <span className="text-xs font-black uppercase tracking-[0.25em] text-brand-dark/40">{t('auth.socialAccess')}</span>
            <div className="h-[2px] flex-1 bg-brand-dark/10" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SocialAccessButton
              brand="google"
              title="Google"
              body={t('auth.googleFastAccess')}
              loading={pendingAction === 'google'}
              disabled={pendingAction !== null}
              onClick={() => handleSocialAccess('google')}
            />
            <SocialAccessButton
              brand="facebook"
              title="Facebook"
              body={t('auth.facebookActivation')}
              loading={pendingAction === 'facebook'}
              disabled={pendingAction !== null}
              onClick={() => handleSocialAccess('facebook')}
            />
          </div>

          <p className="mt-6 text-sm font-bold text-brand-dark/50">
            {t('auth.serverVerifiedNote')}
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
  trailingAction,
  helperText,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  autoComplete?: string;
  trailingAction?: React.ReactNode;
  helperText?: string;
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
          className="w-full bg-white border-2 border-brand-dark rounded-2xl py-4 pl-12 pr-12 text-base font-bold placeholder:text-brand-dark/30 focus:outline-none focus:ring-4 focus:ring-brand-orange/15"
        />
        {trailingAction ? <div className="absolute right-4 top-1/2 -translate-y-1/2">{trailingAction}</div> : null}
      </div>
      {helperText ? <p className="mt-2 text-xs font-black text-brand-dark/45">{helperText}</p> : null}
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
