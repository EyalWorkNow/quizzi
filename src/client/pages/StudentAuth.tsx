import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Mail, UserCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import { 
  registerStudentWithPassword, 
  signInStudentWithPassword,
  signInStudentWithProvider,
  handleStudentAuthRedirect,
} from '../lib/studentAuth.ts';
import { trackCtaClick, trackFormInteraction } from '../lib/appAnalytics.ts';

const STUDENT_AUTH_DRAFT_KEY = 'quizzi.student.auth.draft';

function readStudentAuthDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STUDENT_AUTH_DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function StudentAuth() {
  const { language } = useAppLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const search = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedMode = String(search.get('mode') || '').trim().toLowerCase();
  const draft = readStudentAuthDraft();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [displayName, setDisplayName] = useState(typeof draft?.displayName === 'string' ? draft.displayName : '');
  const [email, setEmail] = useState(typeof draft?.email === 'string' ? draft.email : '');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [draftRestored, setDraftRestored] = useState(Boolean(draft));

  const invitedClassName = String(search.get('class_name') || '').trim();
  const invitedClassId = String(search.get('class_id') || '').trim();
  const nextPath = useMemo(
    () => String((location.state as any)?.from || (invitedClassId ? `/student/me/classes/${invitedClassId}` : '/student/me')),
    [location.state, invitedClassId],
  );

  const copy = {
    he: {
      title: 'סביבת תלמיד',
      subtitle: 'התחברות עם מייל שומרת היסטוריה, תרגול אדפטיבי ומעקב התקדמות לאורך זמן, בלי לפגוע בכניסה האנונימית לסשן חי.',
      login: 'התחברות',
      register: 'הרשמה',
      displayName: 'שם מלא',
      email: 'אימייל',
      password: 'סיסמה',
      submitLogin: 'כניסה לסביבת התלמיד',
      submitRegister: 'צור חשבון תלמיד',
      helper: 'אפשר עדיין להצטרף אנונימית דרך קוד סשן. החשבון הזה הוא שכבה נוספת למעקב והתאמה אישית, ובשלב הזה עובד עם מייל וסיסמה.',
      inviteBanner: 'הוזמנת לכיתה',
      registerNow: 'הרשם עם מייל',
      signInInstead: 'כבר יש לך חשבון? התחבר',
      backHome: 'חזרה לעמוד הבית',
      cards: [
        ['היסטוריה', 'היסטוריית סשנים והתקדמות לאורך זמן.'],
        ['תרגול', 'תרגול אדפטיבי שמותאם בדיוק ללומד/ת.'],
        ['סנכרון מורה', 'שיוך לכיתה ואנליטיקות מדויקות יותר.'],
      ],
    },
    ar: {
      title: 'مساحة الطالب',
      subtitle: 'تسجيل الدخول بالبريد الإلكتروني يحفظ السجل والتدريب التكيفي وتتبع التقدم على المدى الطويل دون المساس بالانضمام المجهول للجلسة الحية.',
      login: 'تسجيل الدخول',
      register: 'إنشاء حساب',
      displayName: 'الاسم الكامل',
      email: 'البريد الإلكتروني',
      password: 'كلمة المرور',
      submitLogin: 'ادخل إلى مساحة الطالب',
      submitRegister: 'أنشئ حساب طالب',
      helper: 'لا يزال بإمكانك الانضمام بشكل مجهول عبر رمز الجلسة. هذا الحساب طبقة إضافية للمتابعة والتخصيص، وفي هذه المرحلة يعمل بالبريد الإلكتروني وكلمة المرور.',
      inviteBanner: 'تمت دعوتك إلى صف',
      registerNow: 'أنشئ حسابًا بالبريد',
      signInInstead: 'لديك حساب بالفعل؟ سجّل الدخول',
      backHome: 'العودة إلى الصفحة الرئيسية',
      cards: [
        ['السجل', 'سجل جلسات وتقدم طويل المدى.'],
        ['التدريب', 'تدريب تكيفي مضبوط على المتعلم/ة.'],
        ['مزامنة المعلم', 'ربط مع الصف وتحليلات أدق.'],
      ],
    },
    en: {
      title: 'Student Space',
      subtitle: 'Email sign-in keeps your history, adaptive practice, and long-term progress in one place without replacing anonymous live joins.',
      login: 'Sign In',
      register: 'Create Account',
      displayName: 'Full Name',
      email: 'Email',
      password: 'Password',
      submitLogin: 'Enter Student Space',
      submitRegister: 'Create Student Account',
      helper: 'You can still join live games anonymously with a session code. This account is the extra layer for progress tracking and personalization, and in this version it uses email and password.',
      inviteBanner: 'You were invited to a class',
      registerNow: 'Create account with email',
      signInInstead: 'Already have an account? Sign in',
      backHome: 'Back Home',
      cards: [
        ['History', 'Long-term session history and progress.'],
        ['Practice', 'Adaptive practice tuned to the learner.'],
        ['Teacher Sync', 'Roster matching and better class analytics.'],
      ],
    },
  }[language] || {
    title: 'Student Space',
    subtitle: 'Email sign-in keeps your history, adaptive practice, and long-term progress in one place without replacing anonymous live joins.',
    login: 'Sign In',
    register: 'Create Account',
    displayName: 'Full Name',
    email: 'Email',
    password: 'Password',
    submitLogin: 'Enter Student Space',
    submitRegister: 'Create Student Account',
    helper: 'You can still join live games anonymously with a session code. This account is the extra layer for progress tracking and personalization, and in this version it uses email and password.',
    inviteBanner: 'You were invited to a class',
    registerNow: 'Create account with email',
    signInInstead: 'Already have an account? Sign in',
    backHome: 'Back Home',
    cards: [],
  };

  useEffect(() => {
    if (requestedMode === 'register' || invitedClassId || invitedClassName) {
      setMode('register');
    }
  }, [requestedMode, invitedClassId, invitedClassName]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      STUDENT_AUTH_DRAFT_KEY,
      JSON.stringify({
        displayName,
        email,
      }),
    );
  }, [displayName, email]);

  useEffect(() => {
    handleStudentAuthRedirect()
      .then((session) => {
        if (session) {
          navigate(nextPath, { replace: true });
        }
      })
      .catch((redirectError: any) => {
        setError(redirectError?.message || 'Google sign-in could not be completed.');
      });
  }, [navigate, nextPath]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      if (mode === 'register') {
        await registerStudentWithPassword({ email, password, displayName });
      } else {
        await signInStudentWithPassword({ email, password });
      }
      window.localStorage.removeItem(STUDENT_AUTH_DRAFT_KEY);
      navigate(nextPath, { replace: true });
    } catch (submitError: any) {
      setError(submitError?.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const prefilledEmail = String(search.get('email') || '').trim().toLowerCase();
    if (prefilledEmail && !email) {
      setEmail(prefilledEmail);
    }
  }, [search, email]);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError('');
    try {
      const session = await signInStudentWithProvider({ provider: 'google' });
      if (session) {
        window.localStorage.removeItem(STUDENT_AUTH_DRAFT_KEY);
        navigate(nextPath, { replace: true });
      }
    } catch (submitError: any) {
      setError(submitError?.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const emailLooksValid = /\S+@\S+\.\S+/.test(email);
  const passwordReady = password.trim().length >= 6;
  const nameReady = mode === 'login' || displayName.trim().length >= 2;
  const canSubmit = emailLooksValid && passwordReady && nameReady && !loading;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#FFF3D6,_#F8F1E7_52%,_#E7EEF8_100%)] px-6 py-10">
      <div className="mx-auto max-w-5xl grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-stretch">
        <div className="rounded-[2.8rem] border-4 border-brand-dark bg-white p-8 shadow-[10px_10px_0px_0px_#1A1A1A]">
          <p className="text-xs font-black uppercase tracking-[0.25em] text-brand-orange mb-4">Quizzi Student</p>
          <h1 className="text-4xl md:text-5xl font-black leading-tight text-brand-dark">{copy.title}</h1>
          <p className="mt-4 text-lg font-bold text-brand-dark/70 max-w-2xl">{copy.subtitle}</p>
          {draftRestored ? (
            <div className="mt-5 rounded-[1.4rem] border-2 border-brand-dark bg-brand-yellow/70 p-4">
              <p className="flex items-center gap-2 text-sm font-black">
                <CheckCircle2 className="h-4 w-4" />
                החזרנו את הפרטים שהוקלדו קודם כדי שתמשיכו מאיפה שעצרתם.
              </p>
            </div>
          ) : null}
          {invitedClassName ? (
            <div className="mt-6 rounded-[1.6rem] border-2 border-brand-dark bg-brand-yellow p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/55">{copy.inviteBanner}</p>
              <p className="mt-2 text-xl font-black text-brand-dark">{invitedClassName}</p>
              <p className="mt-1 text-sm font-bold text-brand-dark/70">Use the same email from the invite and the class will appear in your student space waiting for your approval.</p>
            </div>
          ) : null}
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {copy.cards.map(([title, body]) => (
              <div key={title} className="rounded-[1.8rem] border-2 border-brand-dark bg-brand-bg p-4">
                <p className="font-black text-lg">{title}</p>
                <p className="mt-2 text-sm font-medium text-brand-dark/65">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-[2.8rem] border-4 border-brand-dark bg-brand-dark p-8 text-white shadow-[10px_10px_0px_0px_#FF5A36]"
        >
          <div className="inline-flex rounded-full border-2 border-white/30 p-1 bg-white/10 mb-6">
            {([
              ['login', copy.login],
              ['register', copy.register],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  void trackCtaClick({
                    location: 'student_auth_mode_switch',
                    ctaId: 'switch_mode',
                    label: value,
                  });
                }}
                className={`px-5 py-2 rounded-full text-sm font-black transition-colors ${
                  mode === value ? 'bg-white text-brand-dark' : 'text-white/75'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleGoogleLogin()}
              disabled={loading}
              className="flex min-w-[220px] items-center justify-center gap-3 rounded-full border-2 border-white/30 bg-white/10 px-4 py-2 text-sm font-black text-white disabled:opacity-60"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              {language === 'he' ? 'המשך עם Google' : language === 'ar' ? 'المتابعة عبر Google' : 'Continue with Google'}
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className={`rounded-full border-2 px-4 py-2 text-sm font-black ${
                mode === 'register'
                  ? 'border-brand-yellow bg-brand-yellow text-brand-dark'
                  : 'border-white/30 bg-white/10 text-white'
              }`}
            >
              {copy.registerNow}
            </button>
            <button
              type="button"
              onClick={() => setMode('login')}
              className={`rounded-full border-2 px-4 py-2 text-sm font-black ${
                mode === 'login'
                  ? 'border-brand-yellow bg-brand-yellow text-brand-dark'
                  : 'border-white/30 bg-white/10 text-white'
              }`}
            >
              {copy.signInInstead}
            </button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === 'register' ? (
              <label className="block">
                <span className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-white/70">
                  <UserCircle2 className="w-4 h-4" />
                  {copy.displayName}
                </span>
                <input
                  value={displayName}
                  onFocus={() => void trackFormInteraction({ formId: 'student_auth', field: 'display_name', action: 'focus' })}
                  onChange={(event) => {
                    setDraftRestored(false);
                    void trackFormInteraction({ formId: 'student_auth', field: 'display_name', action: 'change' });
                    setDisplayName(event.target.value);
                  }}
                  className="w-full rounded-[1.2rem] border-2 border-white/20 bg-white/10 px-4 py-4 text-lg font-bold text-white placeholder:text-white/45 outline-none focus:border-brand-yellow"
                  placeholder={copy.displayName}
                  autoComplete="name"
                />
              </label>
            ) : null}

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-white/70">
                <Mail className="w-4 h-4" />
                {copy.email}
              </span>
              <input
                type="email"
                value={email}
                onFocus={() => void trackFormInteraction({ formId: 'student_auth', field: 'email', action: 'focus' })}
                onChange={(event) => {
                  setDraftRestored(false);
                  void trackFormInteraction({ formId: 'student_auth', field: 'email', action: 'change' });
                  setEmail(event.target.value);
                }}
                className="w-full rounded-[1.2rem] border-2 border-white/20 bg-white/10 px-4 py-4 text-lg font-bold text-white placeholder:text-white/45 outline-none focus:border-brand-yellow"
                placeholder="student@example.com"
                autoComplete="email"
              />
              <p className="mt-2 text-xs font-black text-white/55">
                {email ? (emailLooksValid ? 'נראה תקין' : 'כדאי להזין כתובת מייל מלאה') : 'נשתמש במייל הזה כדי לשמור היסטוריה ולהתחבר בעתיד'}
              </p>
            </label>

            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-white/70">
                <KeyRound className="w-4 h-4" />
                {copy.password}
              </span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onFocus={() => void trackFormInteraction({ formId: 'student_auth', field: 'password', action: 'focus' })}
                  onChange={(event) => {
                    void trackFormInteraction({ formId: 'student_auth', field: 'password', action: 'change' });
                    setPassword(event.target.value);
                  }}
                  className="w-full rounded-[1.2rem] border-2 border-white/20 bg-white/10 px-4 py-4 pr-14 text-lg font-bold text-white placeholder:text-white/45 outline-none focus:border-brand-yellow"
                  placeholder="********"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-4 flex items-center text-white/70"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              <p className="mt-2 text-xs font-black text-white/55">
                {password ? (passwordReady ? 'אורך הסיסמה מספיק להמשך' : 'מומלץ לפחות 6 תווים') : 'הסיסמה משמשת רק לכניסה לסביבת התלמיד'}
              </p>
            </label>

            {error ? (
              <div className="rounded-[1.2rem] border-2 border-[#FFB4A2] bg-[#6E1C1C] px-4 py-3 text-sm font-bold text-white">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full rounded-[1.4rem] border-2 border-brand-dark bg-brand-yellow px-5 py-4 text-lg font-black text-brand-dark shadow-[4px_4px_0px_0px_#FFFFFF] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? '...' : mode === 'register' ? copy.submitRegister : copy.submitLogin}
            </button>
          </form>

          <p className="mt-5 text-sm font-medium text-white/70">{copy.helper}</p>
          <button
            type="button"
            onClick={() => navigate('/')}
            className="mt-6 inline-flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-brand-yellow"
          >
            {copy.backHome}
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>
      </div>
    </div>
  );
}
