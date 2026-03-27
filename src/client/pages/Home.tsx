import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  MessageSquareText,
  Play,
  QrCode,
  RotateCcw,
  ScanLine,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { extractNickname } from '../components/Avatar.tsx';
import JoinScannerModal from '../components/JoinScannerModal.tsx';
import {
  trackCtaClick,
  trackFaqInteraction,
  trackFeedbackSubmission,
  trackFormInteraction,
  trackPageScrollDepth,
  trackStudentJoinEvent,
  trackTeacherAuthEvent,
  toAnalyticsErrorCode,
} from '../lib/appAnalytics.ts';
import { announceParticipantJoin } from '../lib/firebaseRealtime.ts';
import { isValidSessionPin, sanitizeSessionPin } from '../lib/joinCodes.ts';
import { apiFetch } from '../lib/api.ts';
import {
  clearJoinedParticipantSession,
  getOrCreateStudentIdentityKey,
  getParticipantToken,
  storeJoinedParticipantSession,
} from '../lib/studentSession.ts';
import {
  loadTeacherAuth,
  isTeacherAuthenticated,
  refreshTeacherSession,
  signOutTeacher,
} from '../lib/teacherAuth.ts';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import {
  isStudentAuthenticated,
  loadStudentAuth,
  refreshStudentSession,
  signOutStudent,
} from '../lib/studentAuth.ts';

const AVATARS = [
  'avatar_1.png',
  'avatar_2.png',
  'avatar_3.png',
  'avatar_4.png',
  'avatar_5.png',
  'avatar_6.png',
  'avatar_7.png',
  'avatar_8.png',
  'avatar_9.png',
  'avatar_10.png',
];
const HOME_PIN_KEY = 'quizzi.home.pin';
const HOME_NICKNAME_KEY = 'quizzi.home.nickname';
const HOME_AVATAR_KEY = 'quizzi.home.avatar';
const SCROLL_MILESTONES = [25, 50, 75, 100] as const;
const FAQ_ITEMS = [
  {
    id: 'join-fast',
    questionHe: 'איך מצטרפים הכי מהר לסשן?',
    answerHe: 'מקלידים קוד משחק בן 6 ספרות, בוחרים שם ואווטאר, ונכנסים מייד. אם יש QR, אפשר גם לסרוק ולדלג על ההקלדה.',
  },
  {
    id: 'student-space',
    questionHe: 'צריך חשבון כדי להשתתף?',
    answerHe: 'לא. אפשר להצטרף אנונימית לסשן חי. חשבון תלמיד מוסיף היסטוריה, תרגול מותאם אישית ומעקב אישי לאורך זמן.',
  },
  {
    id: 'teacher-value',
    questionHe: 'מה המערכת נותנת למרצה או לבית ספר?',
    answerHe: 'המערכת נותנת אירוח משחקים חיים, מעקב השתתפות, אנליטיקות לתלמידים ולכיתות, ומסלולי המשך לתרגול אחרי הסשן.',
  },
] as const;
const QUICK_VALUE_ITEMS = [
  { label: 'זמן הצטרפות', value: 'פחות מדקה' },
  { label: 'הטמעה בכיתה', value: 'ללא הדרכה ארוכה' },
  { label: 'איתות אנליטי', value: 'מיידי מהשיעור הראשון' },
];

function readSavedSeat() {
  if (typeof window === 'undefined') return null;
  const sessionPin = sanitizeSessionPin(window.localStorage.getItem('session_pin') || '');
  const storedNickname = window.localStorage.getItem('nickname') || '';
  const teamName = window.localStorage.getItem('team_name') || '';
  const avatar = window.localStorage.getItem('avatar') || '';
  const token = getParticipantToken();

  if (!isValidSessionPin(sessionPin) || !storedNickname || !token) {
    return null;
  }

  return {
    sessionPin,
    nickname: extractNickname(storedNickname),
    teamName,
    avatar,
  };
}

export default function Home() {
  const { pin: routePinParam } = useParams();
  const [pin, setPin] = useState(() => localStorage.getItem(HOME_PIN_KEY) || '');
  const [nickname, setNickname] = useState(() => localStorage.getItem(HOME_NICKNAME_KEY) || '');
  const [selectedAvatar, setSelectedAvatar] = useState(() => localStorage.getItem(HOME_AVATAR_KEY) || AVATARS[0]);
  const [error, setError] = useState('');
  const [joining, setJoining] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerSupported, setScannerSupported] = useState(false);
  const [joinAssistMessage, setJoinAssistMessage] = useState('');
  const [teacherSignedIn, setTeacherSignedIn] = useState(() => isTeacherAuthenticated());
  const [studentAuth, setStudentAuth] = useState(() => loadStudentAuth());
  const [savedSeat, setSavedSeat] = useState(() => readSavedSeat());
  const [expandedFaq, setExpandedFaq] = useState<string | null>(FAQ_ITEMS[0].id);
  const [feedbackScore, setFeedbackScore] = useState<'positive' | 'neutral' | 'negative' | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const { t, language, direction } = useAppLanguage();
  const nicknameInputRef = useRef<HTMLInputElement | null>(null);
  const autoResolvedPinRef = useRef('');
  const trackedScrollDepthsRef = useRef<Set<number>>(new Set());
  const formStartedRef = useRef(false);
  const navigate = useNavigate();
  const sessionPinReady = isValidSessionPin(pin);
  const nicknameReady = nickname.trim().length >= 2;
  const canJoin = sessionPinReady && nicknameReady && !joining;

  useEffect(() => {
    localStorage.setItem(HOME_PIN_KEY, pin);
  }, [pin]);

  useEffect(() => {
    localStorage.setItem(HOME_NICKNAME_KEY, nickname);
  }, [nickname]);

  useEffect(() => {
    localStorage.setItem(HOME_AVATAR_KEY, selectedAvatar);
  }, [selectedAvatar]);

  // Student Auth Restore
  useEffect(() => {
    let cancelled = false;

    // Refresh existing session
    if (isStudentAuthenticated()) {
      refreshStudentSession()
        .then((session) => {
          if (!cancelled && session) {
            setStudentAuth(session);
          }
        })
        .catch(() => {
          if (!cancelled) setStudentAuth(null);
        });
    }

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!isTeacherAuthenticated()) {
      setTeacherSignedIn(false);
      return () => {
        cancelled = true;
      };
    }

    refreshTeacherSession()
      .then((session) => {
        if (!cancelled) {
          setTeacherSignedIn(!!session);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTeacherSignedIn(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const BarcodeDetectorClass = (window as Window & { BarcodeDetector?: unknown }).BarcodeDetector;
    setScannerSupported(Boolean(BarcodeDetectorClass && navigator.mediaDevices?.getUserMedia));
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const scrollTop = window.scrollY;
      const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
      const percent = maxScroll <= 0 ? 100 : Math.min(100, Math.round((scrollTop / maxScroll) * 100));

      setShowBackToTop(scrollTop > 480);

      SCROLL_MILESTONES.forEach((milestone) => {
        if (percent >= milestone && !trackedScrollDepthsRef.current.has(milestone)) {
          trackedScrollDepthsRef.current.add(milestone);
          void trackPageScrollDepth('/', milestone);
        }
      });
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const markJoinFormStarted = (field: 'pin' | 'nickname' | 'avatar') => {
    if (!formStartedRef.current) {
      formStartedRef.current = true;
      void trackFormInteraction({
        formId: 'home_join',
        field,
        action: 'focus',
      });
    }
  };

  const handleTrackedNavigate = (path: string, ctaId: string, label: string, location: string) => {
    void trackCtaClick({ location, ctaId, label });
    navigate(path);
  };

  const joinSession = async (nextPin = pin) => {
    const sessionPin = sanitizeSessionPin(nextPin);
    const trimmedNickname = nickname.trim();

    setError('');
    if (!isValidSessionPin(sessionPin)) {
      void trackFormInteraction({ formId: 'home_join', field: 'pin', action: 'error' });
      setError(t('home.error.pinSixDigits'));
      return;
    }
    if (trimmedNickname.length < 2) {
      void trackFormInteraction({ formId: 'home_join', field: 'nickname', action: 'error' });
      setError(t('home.error.nicknameMinLength'));
      return;
    }

    setJoining(true);
    void trackStudentJoinEvent({
      result: 'attempt',
      pinLength: sessionPin.length,
    });

    try {
      const fullNickname = selectedAvatar.endsWith('.png') 
        ? `[${selectedAvatar}] ${trimmedNickname}`
        : `${selectedAvatar} ${trimmedNickname}`;
      const identityKey = getOrCreateStudentIdentityKey();
      const res = await apiFetch(`/api/sessions/${sessionPin}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: fullNickname,
          identity_key: identityKey,
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('home.error.failedToJoin'));

      storeJoinedParticipantSession({
        participantId: Number(data.participant_id),
        sessionId: Number(data.session_id),
        sessionPin,
        nickname: fullNickname,
        avatar: selectedAvatar,
        participantToken: String(data.participant_token || ''),
        identityKey: String(data.identity_key || identityKey),
        teamName: data.team_name || null,
        gameType: data.game_type || null,
      });
      setSavedSeat(readSavedSeat());

      void announceParticipantJoin(sessionPin, {
        participantId: Number(data.participant_id),
        nickname: fullNickname,
        teamId: Number(data.team_id || 0),
        teamName: data.team_name || null,
        seatIndex: Number(data.seat_index || 0),
        createdAt: new Date().toISOString(),
        online: true,
        studentUserId: Number(data.student_user_id || 0) || null,
        classStudentId: Number(data.class_student_id || 0) || null,
        joinMode: String(data.join_mode || 'anonymous'),
        displayNameSnapshot: String(data.display_name_snapshot || fullNickname),
        accountLinked: Boolean(data.account_linked),
        profileMode: String(data.profile_mode || (data.account_linked ? 'longitudinal' : 'session-only')),
        classStudentName: String(data.class_student_name || ''),
        classStudentEmail: String(data.class_student_email || ''),
        inviteStatus: String(data.invite_status || ''),
      });

      void trackStudentJoinEvent({
        result: 'success',
        pinLength: sessionPin.length,
      });
      void trackFormInteraction({ formId: 'home_join', field: 'submit', action: 'complete' });
      navigate(`/student/session/${sessionPin}/play`);
    } catch (err: any) {
      setError(err.message);
      void trackStudentJoinEvent({
        result: 'failure',
        pinLength: sessionPin.length,
        errorCode: toAnalyticsErrorCode(err),
      });
    } finally {
      setJoining(false);
    }
  };

  const handleResumeSavedSession = () => {
    if (!savedSeat) return;
    void trackCtaClick({
      location: 'saved_session',
      ctaId: 'resume_saved_session',
      label: 'resume_saved_session',
    });
    navigate(`/student/session/${savedSeat.sessionPin}/play`);
  };

  const handleClearSavedSession = () => {
    void trackCtaClick({
      location: 'saved_session',
      ctaId: 'clear_saved_session',
      label: 'clear_saved_session',
    });
    clearJoinedParticipantSession();
    setSavedSeat(null);
    setJoinAssistMessage(t('home.status.savedCleared'));
  };

  useEffect(() => {
    const routePin = sanitizeSessionPin(routePinParam || '');
    if (!isValidSessionPin(routePin) || autoResolvedPinRef.current === routePin) {
      return;
    }

    autoResolvedPinRef.current = routePin;
    setPin(routePin);
    setError('');

    if (nickname.trim().length >= 2) {
      setJoinAssistMessage(t('home.assist.detectedJoining', { pin: routePin }));
      void joinSession(routePin);
      return;
    }

    setJoinAssistMessage(t('home.assist.detectedAddNick', { pin: routePin }));
    window.setTimeout(() => {
      nicknameInputRef.current?.focus();
    }, 40);
  }, [routePinParam]);

  const handleJoin = async (e: FormEvent) => {
    e.preventDefault();
    await joinSession();
  };

  const handleDetectedPin = (detectedPin: string) => {
    const sessionPin = sanitizeSessionPin(detectedPin);
    if (!isValidSessionPin(sessionPin)) {
      return;
    }

    setScannerOpen(false);
    setPin(sessionPin);
    setError('');

    if (nickname.trim().length >= 2) {
      setJoinAssistMessage(t('home.assist.scannedJoining', { pin: sessionPin }));
      void joinSession(sessionPin);
      return;
    }

    setJoinAssistMessage(t('home.assist.scannedAddNick', { pin: sessionPin }));
    window.setTimeout(() => {
      nicknameInputRef.current?.focus();
    }, 40);
  };

  const handleLogout = async () => {
    const provider = loadTeacherAuth()?.provider || 'password';
    await signOutTeacher();
    void trackTeacherAuthEvent({
      action: 'sign_out',
      provider,
      result: 'success',
      mode: 'login',
    });
    setTeacherSignedIn(false);
    navigate('/');
  };

  const handleStudentLogout = async () => {
    await signOutStudent();
    setStudentAuth(null);
  };

  const heroTitle = `${t('home.hero.title1')} ${t('home.hero.title2')}`;
  const trimmedNickname = nickname.trim();
  const studentSpaceLabel =
    language === 'he' ? 'סביבת תלמיד' : language === 'ar' ? 'مساحة الطالب' : 'Student Space';
  const studentSpaceBody =
    language === 'he'
      ? 'שמור/י היסטוריה, תרגול אדפטיבי ומעקב אישי עם חשבון תלמיד, בלי לוותר על ההצטרפות האנונימית לסשן חי.'
      : language === 'ar'
        ? 'احتفظ/ي بالسجل والتدريب التكيفي والمتابعة الشخصية عبر حساب طالب، من دون التخلي عن الانضمام المجهول للجلسة الحية.'
        : 'Keep history, adaptive practice, and personal progress in a student account without giving up anonymous live joins.';
  const studentEmailSignInLabel =
    language === 'he' ? 'כניסה עם מייל' : language === 'ar' ? 'الدخول بالبريد الإلكتروني' : 'Email Sign In';
  const studentCreateAccountLabel =
    language === 'he' ? 'הרשמת תלמיד' : language === 'ar' ? 'إنشاء حساب طالب' : 'Create Student Account';
  const feedbackPrompt =
    language === 'he'
      ? 'מה חסר לך כאן כדי להתחיל מהר יותר?'
      : language === 'ar'
        ? 'ما الذي ينقصك هنا كي تبدأ أسرع؟'
        : 'What is missing here that would help you start faster?';
  const feedbackThanks =
    language === 'he'
      ? 'תודה, שמרנו את המשוב שלך.'
      : language === 'ar'
        ? 'شكرًا، تم حفظ الملاحظات.'
        : 'Thanks, your feedback was saved.';

  const submitFeedback = () => {
    if (!feedbackScore || feedbackSubmitted) return;
    void trackFeedbackSubmission({
      score: feedbackScore,
      messageLength: feedbackMessage.trim().length,
    });
    setFeedbackSubmitted(true);
  };

  return (
    <div 
      className="min-h-screen bg-brand-bg font-sans text-brand-dark flex flex-col selection:bg-brand-orange selection:text-white"
      data-no-translate="true"
      dir={direction}
    >
      <nav className="page-shell relative z-20 flex flex-wrap items-center justify-between gap-4 py-5 shrink-0">
        <div className="text-3xl font-black tracking-tight flex items-center gap-1">
          <span className="text-brand-orange">Quiz</span>zi
        </div>
        <div className="hidden md:flex items-center gap-10 font-bold text-lg">
          <button onClick={() => navigate('/explore')} className="hover:text-brand-orange transition-colors flex items-center gap-1">{t('nav.explore')}</button>
          <button onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')} className="hover:text-brand-orange transition-colors">{teacherSignedIn ? t('nav.teacherStudio') : t('nav.forTeachers')}</button>
          <button onClick={() => navigate('/contact')} className="hover:text-brand-orange transition-colors">{t('nav.contact')}</button>
        </div>
        <div className="action-row w-full md:w-auto md:justify-end">
          <button onClick={() => navigate('/student/auth')} className="action-pill font-bold px-6 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">
            {studentSpaceLabel}
          </button>
          {teacherSignedIn ? (
            <>
              <button onClick={() => navigate('/teacher/dashboard')} className="action-pill font-bold px-6 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">{t('nav.dashboard')}</button>
              <button onClick={handleLogout} className="action-pill font-bold px-6 py-3 rounded-full bg-brand-orange text-white border-2 border-brand-orange hover:bg-orange-600 transition-colors">{t('nav.logout')}</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate('/auth')} className="action-pill font-bold px-6 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">{t('nav.login')}</button>
              <button onClick={() => navigate('/auth')} className="action-pill font-bold px-6 py-3 rounded-full bg-brand-orange text-white border-2 border-brand-orange hover:bg-orange-600 transition-colors">{t('nav.createAccount')}</button>
            </>
          )}
        </div>
      </nav>

      <main className="page-shell relative z-10 flex-1 overflow-y-auto thin-scrollbar py-4 pb-10 sm:py-6 sm:pb-12">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.06fr)_minmax(320px,0.94fr)] lg:gap-12">
          <motion.section
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            className="min-w-0"
          >
            <div className="rounded-[2.8rem] border-2 border-brand-dark bg-white/90 p-5 shadow-[10px_10px_0px_0px_#1A1A1A] backdrop-blur-sm sm:p-7 lg:p-8">
              <div className="max-w-2xl">
                <div className="mb-4 flex flex-wrap gap-2">
                  <span className="rounded-full border-2 border-brand-dark bg-brand-bg px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] shadow-[3px_3px_0px_0px_#1A1A1A]">
                    {t('home.hero.badge')}
                  </span>
                  {sessionPinReady ? (
                    <span className="rounded-full border-2 border-emerald-300 bg-emerald-50 px-4 py-2 text-[11px] font-black uppercase tracking-[0.2em] text-brand-dark shadow-[3px_3px_0px_0px_#b7e7c8]">
                      {t('home.hero.pinReadyBadge')}
                    </span>
                  ) : null}
                </div>

                <h1 className="max-w-[12ch] text-balance text-[clamp(2rem,4vw,4.4rem)] font-black leading-[0.95] tracking-tight">
                  {heroTitle}
                </h1>
                <p className="mt-3 max-w-[56ch] text-balance text-base font-medium leading-relaxed text-brand-dark/72 sm:text-lg">
                  {t('home.hero.subtitle')}
                </p>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {QUICK_VALUE_ITEMS.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[1.5rem] border-2 border-brand-dark bg-white px-4 py-4 shadow-[4px_4px_0px_0px_#1A1A1A]"
                    >
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45">{item.label}</p>
                      <p className="mt-2 text-lg font-black">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 inline-flex max-w-[56ch] items-start gap-3 rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg px-4 py-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <Sparkles className="w-5 h-5 shrink-0 text-brand-orange mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-1">{studentSpaceLabel}</p>
                    <p className="text-sm font-bold text-brand-dark/72">{studentSpaceBody}</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {studentAuth ? (
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-black text-brand-dark">שלום, {studentAuth.displayName}</span>
                          <button
                            onClick={handleStudentLogout}
                            className="text-[11px] font-black uppercase tracking-wider text-brand-orange hover:underline"
                          >
                            {language === 'he' ? 'התנתק' : 'Logout'}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => handleTrackedNavigate('/student/auth', 'student_sign_in', studentEmailSignInLabel, 'student_space')}
                            className="flex items-center gap-2 rounded-full border-2 border-brand-dark bg-white px-4 py-1.5 text-xs font-black shadow-[3px_3px_0px_0px_#1A1A1A] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#1A1A1A]"
                          >
                            {studentEmailSignInLabel}
                          </button>
                          <button
                            onClick={() =>
                              handleTrackedNavigate(
                                '/student/auth?mode=register',
                                'student_register',
                                studentCreateAccountLabel,
                                'student_space',
                              )
                            }
                            className="flex items-center gap-2 rounded-full border-2 border-brand-dark bg-brand-yellow px-4 py-1.5 text-xs font-black text-brand-dark shadow-[3px_3px_0px_0px_#1A1A1A] transition-all hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[2px_2px_0px_0px_#1A1A1A]"
                          >
                            {studentCreateAccountLabel}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {joinAssistMessage ? (
                <div className="mt-5 rounded-[1.6rem] border-2 border-brand-dark bg-brand-yellow px-4 py-4 shadow-[4px_4px_0px_0px_#1A1A1A]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-white">
                      <CheckCircle2 className="w-5 h-5 text-brand-orange" />
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/50">
                        {t('home.assist.detected')}
                      </p>
                      <p className="font-black leading-snug">{joinAssistMessage}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div role="alert" aria-live="single" className="mt-5 rounded-[1.6rem] border-2 border-red-200 bg-red-50 px-4 py-4 font-bold text-red-500 shadow-sm">
                  {error}
                </div>
              ) : null}

              <motion.form
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                onSubmit={handleJoin}
                className="mt-6 flex flex-col gap-5"
              >
                <div className="rounded-[2.1rem] border-2 border-brand-dark bg-brand-bg/70 p-4 sm:p-5">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-orange mb-2">
                        {t('home.section.joinDetails')}
                      </p>
                      <p className="text-lg font-black leading-tight sm:text-xl">
                        {t('home.section.joinDetailsBody')}
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label htmlFor="game-pin" className="flex min-w-0 flex-col gap-2">
                      <span className="px-1 text-sm font-black uppercase tracking-[0.12em] text-brand-dark/55">
                        {t('home.form.pin')}
                      </span>
                      <input
                        id="game-pin"
                        type="text"
                        placeholder={t('home.form.pin')}
                        aria-label="Enter Game PIN"
                        value={pin}
                        onFocus={() => markJoinFormStarted('pin')}
                        onChange={(e) => {
                          markJoinFormStarted('pin');
                          void trackFormInteraction({ formId: 'home_join', field: 'pin', action: 'change' });
                          setPin(sanitizeSessionPin(e.target.value));
                        }}
                        maxLength={6}
                        required
                        inputMode="numeric"
                        dir="ltr"
                        className="w-full min-w-0 rounded-[1.6rem] border-2 border-brand-dark bg-white px-5 py-4 text-xl font-black tracking-[0.22em] placeholder:tracking-normal placeholder:text-brand-dark/35 focus:outline-none focus:ring-4 focus:ring-brand-orange/20 sm:px-6 sm:text-2xl"
                      />
                    </label>

                    <label htmlFor="nickname" className="flex min-w-0 flex-col gap-2">
                      <span className="px-1 text-sm font-black uppercase tracking-[0.12em] text-brand-dark/55">
                        {t('home.form.nickname')}
                      </span>
                      <input
                        id="nickname"
                        ref={nicknameInputRef}
                        type="text"
                        placeholder={t('home.form.nickname')}
                        aria-label="Enter your nickname"
                        value={nickname}
                        onFocus={() => markJoinFormStarted('nickname')}
                        onChange={(e) => {
                          markJoinFormStarted('nickname');
                          void trackFormInteraction({ formId: 'home_join', field: 'nickname', action: 'change' });
                          setNickname(e.target.value);
                        }}
                        maxLength={12}
                        required
                        className="w-full min-w-0 rounded-[1.6rem] border-2 border-brand-dark bg-white px-5 py-4 text-xl font-black placeholder:text-brand-dark/35 focus:outline-none focus:ring-4 focus:ring-brand-orange/20 sm:px-6 sm:text-2xl"
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <JoinStatusChip
                      ready={sessionPinReady}
                      text={sessionPinReady ? t('home.status.pinReady', { pin }) : t('home.status.pinWait')}
                    />
                    <JoinStatusChip
                      ready={nicknameReady}
                      text={nicknameReady ? t('home.status.nicknameReady', { nickname: trimmedNickname }) : t('home.status.nicknameWait')}
                    />
                  </div>
                </div>

                <div className="rounded-[2.1rem] border-2 border-brand-dark bg-white p-4 sm:p-5">
                  <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(220px,260px)] lg:items-start">
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple mb-2">
                        {t('home.avatar.identify')}
                      </p>
                      <p className="text-sm font-medium text-brand-dark/65 sm:text-base">
                        {t('home.status.avatarNotice')}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center gap-3 rounded-full border-2 border-brand-dark bg-brand-bg px-3 py-2 shadow-[3px_3px_0px_0px_#1A1A1A]">
                        <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-2 border-brand-dark bg-white">
                          <img src={`/avatars/${selectedAvatar}`} alt="" className="h-full w-full object-cover" />
                        </span>
                        <span className="max-w-[160px] truncate font-black">
                          {trimmedNickname || t('home.form.nickname')}
                        </span>
                      </div>
                      <button
                        type="submit"
                        disabled={!canJoin}
                        className="w-full rounded-[1.5rem] border-2 border-brand-dark bg-brand-orange px-6 py-3 text-base font-black text-white shadow-[5px_5px_0px_0px_#1A1A1A] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#e84d2a] hover:shadow-[3px_3px_0px_0px_#1A1A1A] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-x-0 disabled:hover:translate-y-0 disabled:hover:shadow-[5px_5px_0px_0px_#1A1A1A] sm:text-lg"
                      >
                        {joining ? t('home.form.joining') : t('home.form.join')}
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 sm:gap-3">
                    {AVATARS.map((avatar) => (
                      <button
                        key={avatar}
                        type="button"
                        aria-label={`Select avatar ${avatar}`}
                        aria-pressed={selectedAvatar === avatar}
                        onClick={() => setSelectedAvatar(avatar)}
                        onClickCapture={() => {
                          markJoinFormStarted('avatar');
                          void trackFormInteraction({ formId: 'home_join', field: 'avatar', action: 'change' });
                        }}
                        className={`overflow-hidden rounded-[1.35rem] border-2 bg-white transition-all focus:outline-none focus-visible:ring-8 focus-visible:ring-brand-purple/10 ${
                          selectedAvatar === avatar
                            ? 'border-brand-dark bg-brand-purple/15 shadow-[4px_4px_0px_0px_#1A1A1A] -translate-y-0.5'
                            : 'border-brand-dark/10 hover:border-brand-dark hover:shadow-[3px_3px_0px_0px_#1A1A1A]'
                        }`}
                      >
                        <div className="aspect-square w-full min-w-0">
                          <img
                            src={`/avatars/${avatar}`}
                            alt="Avatar selection"
                            className="h-full w-full object-cover"
                          />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className={`grid gap-3 ${savedSeat ? 'xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]' : ''}`}>
                  <div className={`rounded-[1.8rem] border-2 border-brand-dark p-4 ${joinAssistMessage ? 'bg-brand-yellow/50' : 'bg-white'}`}>
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-bg">
                        <QrCode className="w-5 h-5 text-brand-purple" />
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45">
                          {t('home.assist.fastLane')}
                        </p>
                        <p className="font-black leading-snug">
                          {t('home.assist.skipTyping')}
                        </p>
                        <p className="mt-2 text-sm font-medium text-brand-dark/65">
                          {scannerSupported ? t('home.assist.scanNotice') : t('home.assist.cameraNotice')}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <button
                        type="button"
                        onClick={() => {
                          setError('');
                          void trackCtaClick({
                            location: 'join_assist',
                            ctaId: 'open_scanner',
                            label: 'open_scanner',
                          });
                          setScannerOpen(true);
                        }}
                        className="flex w-full items-center justify-center gap-3 rounded-[1.4rem] border-2 border-brand-dark bg-white px-5 py-4 text-base font-black shadow-[4px_4px_0px_0px_#1A1A1A] sm:text-lg"
                      >
                        <ScanLine className="w-5 h-5 text-brand-orange" />
                        {t('home.action.scan')}
                      </button>
                    </div>
                  </div>

                  {savedSeat ? (
                    <div className="rounded-[1.8rem] border-2 border-brand-dark bg-white p-4">
                      <div className="flex h-full flex-col gap-4">
                        <div className="min-w-0">
                          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple">
                            {t('home.saved.title')}
                          </p>
                          <p className="mb-1 text-2xl font-black text-brand-dark">{savedSeat.nickname}</p>
                          <p className="font-bold text-brand-dark/60">
                            {t('home.saved.sessionLine', { pin: savedSeat.sessionPin })}
                            {savedSeat.teamName ? ` • ${savedSeat.teamName}` : ''}
                          </p>
                        </div>
                        <div className="mt-auto flex flex-col gap-3">
                          <button
                            type="button"
                            onClick={handleResumeSavedSession}
                            className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-brand-dark bg-brand-dark px-5 py-3 font-black text-white shadow-[4px_4px_0px_0px_#FF5A36]"
                          >
                            <Play className="w-4 h-4 fill-current" />
                            {t('home.saved.continue')}
                          </button>
                          <button
                            type="button"
                            onClick={handleClearSavedSession}
                            className="flex w-full items-center justify-center gap-2 rounded-full border-2 border-brand-dark bg-white px-5 py-3 font-black"
                          >
                            <RotateCcw className="w-4 h-4" />
                            {t('home.saved.clear')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </motion.form>
            </div>

            <section className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="rounded-[2.2rem] border-2 border-brand-dark bg-white p-5 shadow-[8px_8px_0px_0px_#1A1A1A] sm:p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple">FAQ</p>
                    <h2 className="text-2xl font-black">שאלות שחוסכות בלגן לפני שמתחילים</h2>
                  </div>
                </div>
                <div className="space-y-3">
                  {FAQ_ITEMS.map((item) => {
                    const expanded = expandedFaq === item.id;
                    return (
                      <div key={item.id} className="rounded-[1.5rem] border-2 border-brand-dark bg-brand-bg/60 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => {
                            const nextExpanded = expanded ? null : item.id;
                            setExpandedFaq(nextExpanded);
                            void trackFaqInteraction({ questionId: item.id, expanded: !expanded });
                          }}
                          className="flex w-full items-center justify-between gap-4 text-right"
                        >
                          <span className="text-lg font-black">{item.questionHe}</span>
                          <ChevronDown className={`h-5 w-5 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        {expanded ? (
                          <p className="mt-3 max-w-[62ch] text-sm font-medium leading-7 text-brand-dark/70">{item.answerHe}</p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[2.2rem] border-2 border-brand-dark bg-brand-yellow/45 p-5 shadow-[8px_8px_0px_0px_#1A1A1A] sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-brand-dark bg-white">
                    <MessageSquareText className="h-5 w-5 text-brand-orange" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45">Feedback</p>
                    <h2 className="text-2xl font-black">מה חסר כאן?</h2>
                    <p className="mt-2 text-sm font-medium leading-7 text-brand-dark/70">{feedbackPrompt}</p>
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => setFeedbackScore('positive')}
                    className={`rounded-[1.3rem] border-2 px-3 py-3 font-black ${feedbackScore === 'positive' ? 'border-brand-dark bg-white' : 'border-brand-dark/20 bg-white/70'}`}
                  >
                    <ThumbsUp className="mx-auto mb-2 h-5 w-5" />
                    ברור
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackScore('neutral')}
                    className={`rounded-[1.3rem] border-2 px-3 py-3 font-black ${feedbackScore === 'neutral' ? 'border-brand-dark bg-white' : 'border-brand-dark/20 bg-white/70'}`}
                  >
                    <MessageSquareText className="mx-auto mb-2 h-5 w-5" />
                    כמעט
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeedbackScore('negative')}
                    className={`rounded-[1.3rem] border-2 px-3 py-3 font-black ${feedbackScore === 'negative' ? 'border-brand-dark bg-white' : 'border-brand-dark/20 bg-white/70'}`}
                  >
                    <ThumbsDown className="mx-auto mb-2 h-5 w-5" />
                    חסר
                  </button>
                </div>

                <textarea
                  value={feedbackMessage}
                  onChange={(event) => setFeedbackMessage(event.target.value)}
                  placeholder="למשל: חסר וידאו קצר, דוגמה לכיתה, או הסבר ברור יותר למורים."
                  className="mt-4 min-h-28 w-full rounded-[1.5rem] border-2 border-brand-dark bg-white px-4 py-4 text-sm font-medium outline-none focus:ring-4 focus:ring-brand-orange/20"
                />

                <button
                  type="button"
                  disabled={!feedbackScore || feedbackSubmitted}
                  onClick={submitFeedback}
                  className="mt-4 w-full rounded-[1.4rem] border-2 border-brand-dark bg-brand-dark px-5 py-3 text-base font-black text-white shadow-[4px_4px_0px_0px_#FF5A36] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {feedbackSubmitted ? feedbackThanks : 'שלחו משוב קצר'}
                </button>

                <button
                  type="button"
                  onClick={() => handleTrackedNavigate('/contact', 'contact_sales', 'contact_sales', 'feedback_panel')}
                  className="mt-3 w-full rounded-[1.4rem] border-2 border-brand-dark bg-white px-5 py-3 text-base font-black shadow-[4px_4px_0px_0px_#1A1A1A]"
                >
                  רוצים שנחזור אליכם?
                </button>
              </div>
            </section>
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="relative min-w-0"
          >
            <div className="relative flex min-h-[420px] items-center justify-center overflow-hidden rounded-[2.8rem] border-2 border-brand-dark/5 bg-brand-bg/60 px-6 py-8 sm:min-h-[520px] sm:px-8 sm:py-10 lg:min-h-[640px] lg:px-8 lg:py-12">
              <div className="absolute h-[520px] w-[520px] rounded-full border-[3px] border-brand-dark/5 sm:h-[620px] sm:w-[620px] lg:h-[720px] lg:w-[720px]" />
              <div className="absolute h-[320px] w-[320px] rounded-full border-[3px] border-brand-dark/5 sm:h-[430px] sm:w-[430px] lg:h-[500px] lg:w-[500px]" />

              <motion.div
                animate={{ y: [-10, 10, -10], rotate: [0, 10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-6 top-8 text-brand-yellow sm:left-10 sm:top-12 lg:left-12 lg:top-16"
              >
                <svg width="54" height="54" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
              </motion.div>

              <motion.div
                animate={{ y: [10, -10, 10], rotate: [0, -10, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute bottom-20 right-6 text-brand-yellow sm:bottom-24 sm:right-8 lg:bottom-28 lg:right-10"
              >
                <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
              </motion.div>

              <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center justify-center gap-6 sm:max-w-[520px] sm:gap-8 lg:max-w-[560px]">
                <div className="relative flex w-full items-end justify-center pt-4 sm:pt-6">
                  <motion.div
                    initial={{ scale: 0.84, rotate: -6 }}
                    animate={{ scale: 1, rotate: 8 }}
                    transition={{ type: 'spring', bounce: 0.34, duration: 1 }}
                    className="relative z-10 flex h-[220px] w-[220px] items-center justify-center rounded-[3rem] border-4 border-brand-dark bg-brand-purple shadow-[16px_16px_0px_0px_#1A1A1A] sm:h-[290px] sm:w-[290px] lg:h-[360px] lg:w-[360px] lg:rounded-[4rem]"
                  >
                    <Sparkles className="h-24 w-24 text-white sm:h-32 sm:w-32 lg:h-40 lg:w-40" />
                  </motion.div>

                  <motion.div
                    animate={{ x: [-6, 6, -6], rotate: [-10, -7, -10] }}
                    transition={{ duration: 4.6, repeat: Infinity, ease: 'easeInOut' }}
                    className="absolute bottom-2 left-1/2 z-20 flex h-14 w-[250px] -translate-x-[58%] rotate-[-10deg] items-center rounded-full border-4 border-brand-dark bg-brand-purple shadow-[8px_8px_0px_0px_#1A1A1A] sm:bottom-3 sm:h-16 sm:w-[320px] lg:bottom-5 lg:h-20 lg:w-[380px]"
                  >
                    <div className="ml-auto flex h-full w-14 items-center justify-start rounded-r-full border-l-4 border-brand-dark bg-white pl-4 sm:w-16 lg:w-[72px]">
                      <div className="h-0 w-0 border-b-[12px] border-l-[24px] border-t-[12px] border-b-transparent border-l-brand-dark border-t-transparent sm:border-b-[14px] sm:border-l-[28px] sm:border-t-[14px]" />
                    </div>
                  </motion.div>
                </div>

                <div className="w-full max-w-[360px] rounded-full border-2 border-brand-dark bg-white/95 px-5 py-3 text-center font-black shadow-[4px_4px_0px_0px_#1A1A1A] backdrop-blur-sm sm:px-6 sm:py-3.5">
                  {t('home.hero.supportBadge')}
                </div>
              </div>
            </div>
          </motion.aside>
        </div>
      </main>
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:hidden">
        <div className="pointer-events-auto rounded-[1.6rem] border-2 border-brand-dark bg-white/95 p-3 shadow-[8px_8px_0px_0px_#1A1A1A] backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                void trackCtaClick({
                  location: 'sticky_mobile',
                  ctaId: 'jump_to_join',
                  label: 'jump_to_join',
                });
                window.scrollTo({ top: 260, behavior: 'smooth' });
              }}
              className="flex-1 rounded-full border-2 border-brand-dark bg-brand-orange px-4 py-3 text-sm font-black text-white"
            >
              הצטרפות מהירה
            </button>
            <button
              type="button"
              onClick={() => handleTrackedNavigate('/contact', 'sticky_contact', 'sticky_contact', 'sticky_mobile')}
              className="flex-1 rounded-full border-2 border-brand-dark bg-white px-4 py-3 text-sm font-black"
            >
              דברו איתנו
            </button>
          </div>
        </div>
      </div>
      {showBackToTop ? (
        <button
          type="button"
          onClick={() => {
            void trackCtaClick({
              location: 'floating_action',
              ctaId: 'back_to_top',
              label: 'back_to_top',
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="fixed bottom-24 right-4 z-40 flex h-12 w-12 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-yellow shadow-[4px_4px_0px_0px_#1A1A1A] md:bottom-6 md:right-6"
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      ) : null}
      <JoinScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleDetectedPin} />
    </div>
  );
}

function JoinStatusChip({ ready, text }: { ready: boolean; text: string }) {
  return (
    <div
      className={`rounded-full border-2 px-4 py-2 text-sm font-black shadow-[3px_3px_0px_0px_#1A1A1A] ${
        ready
          ? 'border-emerald-300 bg-emerald-50 text-brand-dark'
          : 'border-brand-dark/10 bg-white text-brand-dark/70'
      }`}
    >
      {text}
    </div>
  );
}
