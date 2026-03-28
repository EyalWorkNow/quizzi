import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, Mail, ShieldCheck, UserCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import BrandLogo from '../components/BrandLogo.tsx';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import {
  confirmStudentPasswordReset,
  registerStudentWithPassword,
  requestStudentPasswordResetCode,
  signInStudentWithPassword,
} from '../lib/studentAuth.ts';
import { trackCtaClick, trackFormInteraction } from '../lib/appAnalytics.ts';

const STUDENT_AUTH_DRAFT_KEY = 'quizzi.student.auth.draft';

type AuthMode = 'login' | 'register';
type PanelMode = 'auth' | 'reset-request' | 'reset-confirm';

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

  const [mode, setMode] = useState<AuthMode>('login');
  const [panelMode, setPanelMode] = useState<PanelMode>('auth');
  const [displayName, setDisplayName] = useState(typeof draft?.displayName === 'string' ? draft.displayName : '');
  const [email, setEmail] = useState(typeof draft?.email === 'string' ? draft.email : '');
  const [password, setPassword] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
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
      resetCode: 'קוד אימות',
      newPassword: 'סיסמה חדשה',
      submitLogin: 'כניסה לסביבת התלמיד',
      submitRegister: 'צור חשבון תלמיד',
      sendResetCode: 'שליחת קוד למייל',
      completeReset: 'איפוס סיסמה וכניסה',
      helper: 'אפשר עדיין להצטרף אנונימית דרך קוד סשן. החשבון הזה הוא שכבה נוספת למעקב והתאמה אישית, ובשלב הזה עובד עם מייל וסיסמה.',
      resetHelper: 'נשלח קוד בן 6 ספרות למייל שלך. הקוד פעיל ל-5 דקות בלבד ומאפשר לקבוע סיסמה חדשה.',
      inviteBanner: 'הוזמנת לכיתה',
      registerNow: 'הרשם עם מייל',
      signInInstead: 'כבר יש לך חשבון? התחבר',
      forgotPassword: 'שכחתי סיסמה',
      backToLogin: 'חזרה להתחברות',
      backHome: 'חזרה לעמוד הבית',
      codeSent: 'אם החשבון קיים, שלחנו עכשיו קוד למייל. אפשר להזין אותו כאן ולקבוע סיסמה חדשה.',
      resetDone: 'הסיסמה עודכנה והחשבון מוכן לכניסה.',
      resetTitle: 'איפוס סיסמה',
      resetRequestTitle: 'צריך קוד חדש למייל?',
      resetConfirmTitle: 'הזינו את הקוד והגדירו סיסמה חדשה',
      emailLooksGood: 'נראה תקין',
      emailNeedsFix: 'כדאי להזין כתובת מייל מלאה',
      emailHint: 'נשתמש במייל הזה כדי לשמור היסטוריה ולהתחבר בעתיד',
      passwordGood: 'אורך הסיסמה מספיק להמשך',
      passwordHint: 'מומלץ לפחות 8 תווים',
      resetCodeHint: 'הקוד צריך להיות בן 6 ספרות ונשאר פעיל ל-5 דקות.',
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
      resetCode: 'رمز التحقق',
      newPassword: 'كلمة مرور جديدة',
      submitLogin: 'ادخل إلى مساحة الطالب',
      submitRegister: 'أنشئ حساب طالب',
      sendResetCode: 'إرسال رمز إلى البريد',
      completeReset: 'إعادة التعيين والدخول',
      helper: 'لا يزال بإمكانك الانضمام بشكل مجهول عبر رمز الجلسة. هذا الحساب طبقة إضافية للمتابعة والتخصيص.',
      resetHelper: 'سنرسل رمزًا مكوّنًا من 6 أرقام إلى بريدك الإلكتروني. الرمز صالح لمدة 5 دقائق فقط.',
      inviteBanner: 'تمت دعوتك إلى صف',
      registerNow: 'أنشئ حسابًا بالبريد',
      signInInstead: 'لديك حساب بالفعل؟ سجّل الدخول',
      forgotPassword: 'نسيت كلمة المرور',
      backToLogin: 'العودة لتسجيل الدخول',
      backHome: 'العودة إلى الصفحة الرئيسية',
      codeSent: 'إذا كان الحساب موجودًا، فقد أرسلنا الآن رمزًا إلى بريدك الإلكتروني.',
      resetDone: 'تم تحديث كلمة المرور والحساب جاهز للدخول.',
      resetTitle: 'إعادة تعيين كلمة المرور',
      resetRequestTitle: 'تحتاج إلى رمز جديد؟',
      resetConfirmTitle: 'أدخل الرمز وحدد كلمة مرور جديدة',
      emailLooksGood: 'يبدو صحيحًا',
      emailNeedsFix: 'أدخل عنوان بريد كامل',
      emailHint: 'سنستخدم هذا البريد لحفظ السجل والدخول لاحقًا',
      passwordGood: 'الطول مناسب للمتابعة',
      passwordHint: 'نوصي بـ 8 أحرف على الأقل',
      resetCodeHint: 'الرمز مكوّن من 6 أرقام ويظل صالحًا لمدة 5 دقائق.',
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
      resetCode: 'Verification Code',
      newPassword: 'New Password',
      submitLogin: 'Enter Student Space',
      submitRegister: 'Create Student Account',
      sendResetCode: 'Send Code to Email',
      completeReset: 'Reset Password and Sign In',
      helper: 'You can still join live games anonymously with a session code. This account adds progress tracking and personalization.',
      resetHelper: 'We will send a 6-digit code to your email. The code stays active for 5 minutes only and lets you set a new password.',
      inviteBanner: 'You were invited to a class',
      registerNow: 'Create account with email',
      signInInstead: 'Already have an account? Sign in',
      forgotPassword: 'Forgot password?',
      backToLogin: 'Back to sign in',
      backHome: 'Back Home',
      codeSent: 'If the account exists, we just sent a code to your email. Enter it here to choose a new password.',
      resetDone: 'Your password was updated and the account is ready to enter.',
      resetTitle: 'Password Reset',
      resetRequestTitle: 'Need a fresh code by email?',
      resetConfirmTitle: 'Enter the code and choose a new password',
      emailLooksGood: 'Looks valid',
      emailNeedsFix: 'Enter a complete email address',
      emailHint: 'We use this email to save your history and sign you in later',
      passwordGood: 'Password length is good to continue',
      passwordHint: 'We recommend at least 8 characters',
      resetCodeHint: 'The code is 6 digits and stays active for 5 minutes.',
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
    resetCode: 'Verification Code',
    newPassword: 'New Password',
    submitLogin: 'Enter Student Space',
    submitRegister: 'Create Student Account',
    sendResetCode: 'Send Code to Email',
    completeReset: 'Reset Password and Sign In',
    helper: 'You can still join live games anonymously with a session code.',
    resetHelper: 'We will send a 6-digit code to your email.',
    inviteBanner: 'You were invited to a class',
    registerNow: 'Create account with email',
    signInInstead: 'Already have an account? Sign in',
    forgotPassword: 'Forgot password?',
    backToLogin: 'Back to sign in',
    backHome: 'Back Home',
    codeSent: 'If the account exists, we sent a code to your email.',
    resetDone: 'Your password was updated.',
    resetTitle: 'Password Reset',
    resetRequestTitle: 'Need a fresh code by email?',
    resetConfirmTitle: 'Enter the code and choose a new password',
    emailLooksGood: 'Looks valid',
    emailNeedsFix: 'Enter a complete email address',
    emailHint: 'We use this email to save your history and sign you in later',
    passwordGood: 'Password length is good to continue',
    passwordHint: 'We recommend at least 8 characters',
    resetCodeHint: 'The code is 6 digits and stays active for 5 minutes.',
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
    const prefilledEmail = String(search.get('email') || '').trim().toLowerCase();
    if (prefilledEmail && !email) {
      setEmail(prefilledEmail);
    }
  }, [search, email]);

  const emailLooksValid = /\S+@\S+\.\S+/.test(email);
  const passwordReady = password.trim().length >= 8;
  const newPasswordReady = newPassword.trim().length >= 8;
  const nameReady = mode === 'login' || displayName.trim().length >= 2;
  const resetCodeReady = /^\d{6}$/.test(resetCode.trim());
  const canSubmitAuth = emailLooksValid && passwordReady && nameReady && !loading;
  const canRequestReset = emailLooksValid && !loading;
  const canConfirmReset = emailLooksValid && resetCodeReady && newPasswordReady && !loading;

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setPanelMode('auth');
    setError('');
    setNotice('');
    setPassword('');
    setResetCode('');
    setNewPassword('');
    void trackCtaClick({
      location: 'student_auth_mode_switch',
      ctaId: 'switch_mode',
      label: nextMode,
    });
  };

  const handleAuthSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
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

  const handleResetRequest = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await requestStudentPasswordResetCode({ email });
      setPanelMode('reset-confirm');
      setResetCode('');
      setNewPassword('');
      setNotice(copy.codeSent);
    } catch (submitError: any) {
      setError(submitError?.message || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleResetConfirm = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      await confirmStudentPasswordReset({
        email,
        code: resetCode,
        password: newPassword,
      });
      window.localStorage.removeItem(STUDENT_AUTH_DRAFT_KEY);
      setNotice(copy.resetDone);
      navigate(nextPath, { replace: true });
    } catch (submitError: any) {
      setError(submitError?.message || 'Password reset failed');
    } finally {
      setLoading(false);
    }
  };

  const openResetFlow = () => {
    setPanelMode('reset-request');
    setError('');
    setNotice('');
    setPassword('');
    setResetCode('');
    setNewPassword('');
    void trackCtaClick({
      location: 'student_auth',
      ctaId: 'forgot_password',
      label: 'forgot_password',
    });
  };

  const goBackToAuth = () => {
    setPanelMode('auth');
    setError('');
    setNotice('');
    setResetCode('');
    setNewPassword('');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#FFF3D6,_#F8F1E7_52%,_#E7EEF8_100%)] px-6 py-10">
      <div className="mx-auto max-w-5xl grid gap-8 lg:grid-cols-[1.1fr_0.9fr] items-stretch">
        <div className="rounded-[2.8rem] border-4 border-brand-dark bg-white p-8 shadow-[10px_10px_0px_0px_#1A1A1A]">
          <BrandLogo onClick={() => navigate('/')} imageClassName="h-12 w-auto" />
          <p className="mt-4 text-xs font-black uppercase tracking-[0.25em] text-brand-orange mb-4">Quizzi Student</p>
          <h1 className="text-4xl md:text-5xl font-black leading-tight text-brand-dark">{copy.title}</h1>
          <p className="mt-4 text-lg font-bold text-brand-dark/70 max-w-2xl">{copy.subtitle}</p>
          {draftRestored ? (
            <div className="mt-5 rounded-[1.4rem] border-2 border-brand-dark bg-brand-yellow/70 p-4">
              <p className="flex items-center gap-2 text-sm font-black">
                <CheckCircle2 className="h-4 w-4" />
                {language === 'he'
                  ? 'החזרנו את הפרטים שהוקלדו קודם כדי שתמשיכו מאיפה שעצרתם.'
                  : language === 'ar'
                    ? 'أعدنا البيانات التي كتبتها سابقًا لتتابع من حيث توقفت.'
                    : 'We restored your last draft so you can continue from where you stopped.'}
              </p>
            </div>
          ) : null}
          {invitedClassName ? (
            <div className="mt-6 rounded-[1.6rem] border-2 border-brand-dark bg-brand-yellow p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/55">{copy.inviteBanner}</p>
              <p className="mt-2 text-xl font-black text-brand-dark">{invitedClassName}</p>
              <p className="mt-1 text-sm font-bold text-brand-dark/70">
                {language === 'he'
                  ? 'השתמש/י באותו מייל מההזמנה כדי שהכיתה תופיע מיד במרחב התלמיד.'
                  : language === 'ar'
                    ? 'استخدم البريد نفسه الموجود في الدعوة لكي يظهر الصف مباشرة في مساحة الطالب.'
                    : 'Use the same email from the invite so the class appears immediately in your student space.'}
              </p>
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
          {panelMode === 'auth' ? (
            <div className="inline-flex rounded-full border-2 border-white/30 p-1 bg-white/10 mb-6">
              {([
                ['login', copy.login],
                ['register', copy.register],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => switchMode(value)}
                  className={`px-5 py-2 rounded-full text-sm font-black transition-colors ${
                    mode === value ? 'bg-white text-brand-dark' : 'text-white/75'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mb-6 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center gap-2 rounded-full border-2 border-white/20 bg-white/10 px-4 py-2 text-sm font-black text-white/80">
                <ShieldCheck className="h-4 w-4" />
                {copy.resetTitle}
              </div>
              <button
                type="button"
                onClick={goBackToAuth}
                className="rounded-full border-2 border-white/30 bg-white/10 px-4 py-2 text-sm font-black text-white"
              >
                {copy.backToLogin}
              </button>
            </div>
          )}

          {panelMode === 'auth' ? (
            <div className="mb-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => switchMode('register')}
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
                onClick={() => switchMode('login')}
                className={`rounded-full border-2 px-4 py-2 text-sm font-black ${
                  mode === 'login'
                    ? 'border-brand-yellow bg-brand-yellow text-brand-dark'
                    : 'border-white/30 bg-white/10 text-white'
                }`}
              >
                {copy.signInInstead}
              </button>
              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={openResetFlow}
                  className="rounded-full border-2 border-white/30 bg-white/10 px-4 py-2 text-sm font-black text-white"
                >
                  {copy.forgotPassword}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="mb-5 rounded-[1.4rem] border-2 border-white/20 bg-white/10 p-4">
              <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-yellow">
                {panelMode === 'reset-request' ? copy.resetRequestTitle : copy.resetConfirmTitle}
              </p>
              <p className="mt-2 text-sm font-medium text-white/75">{copy.resetHelper}</p>
            </div>
          )}

          <form className="space-y-4" onSubmit={panelMode === 'auth' ? handleAuthSubmit : panelMode === 'reset-request' ? handleResetRequest : handleResetConfirm}>
            {panelMode === 'auth' && mode === 'register' ? (
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
                {email
                  ? emailLooksValid ? copy.emailLooksGood : copy.emailNeedsFix
                  : copy.emailHint}
              </p>
            </label>

            {panelMode === 'auth' ? (
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
                  {password ? (passwordReady ? copy.passwordGood : copy.passwordHint) : copy.passwordHint}
                </p>
              </label>
            ) : null}

            {panelMode === 'reset-confirm' ? (
              <>
                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-white/70">
                    <ShieldCheck className="w-4 h-4" />
                    {copy.resetCode}
                  </span>
                  <input
                    value={resetCode}
                    onChange={(event) => setResetCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full rounded-[1.2rem] border-2 border-white/20 bg-white/10 px-4 py-4 text-center text-2xl tracking-[0.35em] font-black text-white placeholder:text-white/45 outline-none focus:border-brand-yellow"
                    placeholder="000000"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                  <p className="mt-2 text-xs font-black text-white/55">{copy.resetCodeHint}</p>
                </label>

                <label className="block">
                  <span className="mb-2 flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-white/70">
                    <KeyRound className="w-4 h-4" />
                    {copy.newPassword}
                  </span>
                  <div className="relative">
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      className="w-full rounded-[1.2rem] border-2 border-white/20 bg-white/10 px-4 py-4 pr-14 text-lg font-bold text-white placeholder:text-white/45 outline-none focus:border-brand-yellow"
                      placeholder="********"
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((current) => !current)}
                      className="absolute inset-y-0 right-4 flex items-center text-white/70"
                    >
                      {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-black text-white/55">
                    {newPassword ? (newPasswordReady ? copy.passwordGood : copy.passwordHint) : copy.passwordHint}
                  </p>
                </label>
              </>
            ) : null}

            {notice ? (
              <div className="rounded-[1.2rem] border-2 border-[#C8F2D3] bg-[#1F5C32] px-4 py-3 text-sm font-bold text-white">
                {notice}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-[1.2rem] border-2 border-[#FFB4A2] bg-[#6E1C1C] px-4 py-3 text-sm font-bold text-white">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={
                panelMode === 'auth'
                  ? !canSubmitAuth
                  : panelMode === 'reset-request'
                    ? !canRequestReset
                    : !canConfirmReset
              }
              className="w-full rounded-[1.4rem] border-2 border-brand-dark bg-brand-yellow px-5 py-4 text-lg font-black text-brand-dark shadow-[4px_4px_0px_0px_#FFFFFF] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading
                ? '...'
                : panelMode === 'auth'
                  ? mode === 'register' ? copy.submitRegister : copy.submitLogin
                  : panelMode === 'reset-request'
                    ? copy.sendResetCode
                    : copy.completeReset}
            </button>
          </form>

          <p className="mt-5 text-sm font-medium text-white/70">
            {panelMode === 'auth' ? copy.helper : copy.resetHelper}
          </p>
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
