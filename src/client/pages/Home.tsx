import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  MessageSquareText,
  Play,
  RotateCcw,
  ScanLine,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import { motion } from 'motion/react';
import { extractNickname } from '../components/Avatar.tsx';
import BrandLogo from '../components/BrandLogo.tsx';
import HomeJoinIllustration from '../components/HomeJoinIllustration.tsx';
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
  const homeSurfaceCopy = {
    he: {
      navContact: 'צור קשר',
      navTeacherLogin: 'כניסת מורה',
      navStudentLogin: 'כניסת תלמיד',
      heroTitle: 'פרטי הצטרפות',
      heroBody: 'הזן את קוד החדר ואת השם ששאר השחקנים יראו.',
      pinLabel: 'קוד משחק',
      nicknameLabel: 'כינוי',
      identityLabel: 'הזהות שלך',
      previewLabel: 'הזדהה כ:',
      joinLabel: 'הצטרפות',
      scannerLabel: 'סריקת קוד במקום הקלדה',
      visualEyebrow: 'LIVE SESSION',
      visualTitle: 'Quizzi Classroom',
      visualBody: 'מצטרפים מהר, בוחרים זהות, ונכנסים לשיעור בלי עמודי ביניים מיותרים.',
      supportBadge: 'שיעור חי. כניסה מהירה. בלי בלגן.',
      lowerTitle: 'עוד דברים שאפשר לעשות אחרי שנכנסים',
      lowerBody: 'סביבת תלמיד, שאלות נפוצות ויצירת קשר נשארים זמינים בהמשך העמוד, בלי להעמיס על אזור ההצטרפות.',
      teacherCta: 'יצירת חשבון',
      quickJoinCta: 'התחברות',
      studentSpaceCta: 'סביבת תלמיד',
      feedbackTitle: 'מה חסר כאן?',
      feedbackBody: 'אם משהו עדיין לא מספיק ברור, כתבו לנו מה יקל על ההצטרפות.',
    },
    ar: {
      navContact: 'اتصل بنا',
      navTeacherLogin: 'دخول المعلّم',
      navStudentLogin: 'دخول الطالب',
      heroTitle: 'تفاصيل الانضمام',
      heroBody: 'أدخل رمز الغرفة والاسم الذي سيظهر لباقي اللاعبين.',
      pinLabel: 'رمز اللعبة',
      nicknameLabel: 'الاسم',
      identityLabel: 'هويتك',
      previewLabel: 'الدخول باسم:',
      joinLabel: 'انضمام',
      scannerLabel: 'امسح الرمز بدل الكتابة',
      visualEyebrow: 'LIVE SESSION',
      visualTitle: 'Quizzi Classroom',
      visualBody: 'انضم بسرعة، اختر هويتك، وادخل إلى الحصة من دون خطوات مربكة.',
      supportBadge: 'حصة مباشرة. دخول سريع. بدون فوضى.',
      lowerTitle: 'أشياء إضافية بعد الدخول',
      lowerBody: 'مساحة الطالب، الأسئلة الشائعة، والتواصل موجودة أسفل الصفحة بدون تشويش على منطقة الانضمام.',
      teacherCta: 'إنشاء حساب',
      quickJoinCta: 'دخول',
      studentSpaceCta: 'مساحة الطالب',
      feedbackTitle: 'ما الذي ينقص هنا؟',
      feedbackBody: 'إذا كان هناك شيء ما يزال غير واضح، أخبرنا ما الذي سيجعل الانضمام أسهل.',
    },
    en: {
      navContact: 'Contact',
      navTeacherLogin: 'Teacher Login',
      navStudentLogin: 'Student Login',
      heroTitle: 'Join Details',
      heroBody: 'Enter the room code and the name other players will see.',
      pinLabel: 'Game Code',
      nicknameLabel: 'Nickname',
      identityLabel: 'Your Identity',
      previewLabel: 'Joining as:',
      joinLabel: 'Join',
      scannerLabel: 'Scan a code instead of typing',
      visualEyebrow: 'LIVE SESSION',
      visualTitle: 'Quizzi Classroom',
      visualBody: 'Join fast, choose an identity, and enter the class without extra friction.',
      supportBadge: 'Live class. Fast entry. No friction.',
      lowerTitle: 'More things after the join',
      lowerBody: 'Student Space, FAQs, and contact options stay lower on the page so the join area stays focused.',
      teacherCta: 'Create Account',
      quickJoinCta: 'Join',
      studentSpaceCta: 'Student Space',
      feedbackTitle: 'What is missing here?',
      feedbackBody: 'If something is still unclear, tell us what would make joining easier.',
    },
  }[language] || {
    navContact: 'Contact',
    navTeacherLogin: 'Teacher Login',
    navStudentLogin: 'Student Login',
    heroTitle: 'Join Details',
    heroBody: 'Enter the room code and the name other players will see.',
    pinLabel: 'Game Code',
    nicknameLabel: 'Nickname',
    identityLabel: 'Your Identity',
    previewLabel: 'Joining as:',
    joinLabel: 'Join',
    scannerLabel: 'Scan a code instead of typing',
    visualEyebrow: 'LIVE SESSION',
    visualTitle: 'Quizzi Classroom',
    visualBody: 'Join fast and enter the class without extra friction.',
    supportBadge: 'Live class. Fast entry. No friction.',
    lowerTitle: 'More things after the join',
    lowerBody: 'Student Space, FAQs, and contact options stay lower on the page.',
    teacherCta: 'Create Account',
    quickJoinCta: 'Join',
    studentSpaceCta: 'Student Space',
    feedbackTitle: 'What is missing here?',
    feedbackBody: 'Tell us what would make joining easier.',
  };

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
      <nav className="page-shell relative z-20 py-4">
        <div className="mx-auto grid max-w-[1220px] gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-center">
          <div className="flex items-center justify-start">
            <BrandLogo onClick={() => navigate('/')} imageClassName="h-10 w-auto sm:h-12" />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              onClick={() => navigate('/contact')}
              className="rounded-full border-[3px] border-brand-dark bg-white px-5 py-2.5 text-sm font-black shadow-[0_4px_0_0_#1A1A1A]"
            >
              {homeSurfaceCopy.navContact}
            </button>
            <button
              onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')}
              className="rounded-full border-[3px] border-brand-orange bg-brand-orange px-5 py-2.5 text-sm font-black text-white shadow-[0_4px_0_0_#1A1A1A]"
            >
              {homeSurfaceCopy.navTeacherLogin}
            </button>
            <button
              onClick={() => navigate('/student/auth')}
              className="rounded-full border-[3px] border-brand-dark bg-white px-5 py-2.5 text-sm font-black shadow-[0_4px_0_0_#1A1A1A]"
            >
              {homeSurfaceCopy.navStudentLogin}
            </button>
          </div>
          <div className="hidden lg:block" />
        </div>
      </nav>

      <main className="page-shell relative z-10 flex-1 overflow-y-auto thin-scrollbar py-2 pb-8 sm:py-4 sm:pb-10">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto grid max-w-[1220px] gap-8 lg:grid-cols-[minmax(0,1.04fr)_minmax(380px,0.86fr)]"
        >
          <div className="order-2 hidden lg:block lg:order-1">
            <HomeJoinIllustration
              pin={pin}
              nickname={trimmedNickname}
              avatar={selectedAvatar}
            />
          </div>

          <div className="order-1 lg:order-2 lg:max-w-[560px] lg:justify-self-end">
            <div className="px-1 sm:px-2">
              <h1 className="text-right text-[clamp(1.95rem,2.8vw,3.55rem)] font-black leading-[0.98] tracking-tight">
                {homeSurfaceCopy.heroTitle}
              </h1>
              <p className="mt-3 text-right text-[clamp(0.95rem,1.05vw,1.25rem)] font-black leading-tight text-brand-dark">
                {homeSurfaceCopy.heroBody}
              </p>

              {joinAssistMessage ? (
                <div className="mt-5 rounded-[1.45rem] border-[3px] border-brand-dark bg-brand-yellow px-4 py-3.5 shadow-[0_5px_0_0_#1A1A1A]">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-[3px] border-brand-dark bg-white">
                      <CheckCircle2 className="h-4 w-4 text-brand-orange" />
                    </div>
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-dark/50">{t('home.assist.detected')}</p>
                      <p className="mt-1 text-sm font-black sm:text-[0.95rem]">{joinAssistMessage}</p>
                    </div>
                  </div>
                </div>
              ) : null}

              {error ? (
                <div role="alert" aria-live="single" className="mt-5 rounded-[1.45rem] border-[3px] border-red-300 bg-red-50 px-4 py-3.5 text-sm font-black text-red-500 sm:text-base">
                  {error}
                </div>
              ) : null}

              <motion.form
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                onSubmit={handleJoin}
                className="mt-6 space-y-5"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label htmlFor="game-pin" className="flex flex-col gap-3">
                    <span className="text-right text-[1rem] font-black sm:text-[1.15rem]">{homeSurfaceCopy.pinLabel}</span>
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
                      className="h-[70px] rounded-[1.65rem] border-[3px] border-brand-dark bg-white px-5 text-center text-[1.55rem] font-black tracking-[0.08em] shadow-[0_6px_0_0_#1A1A1A] placeholder:text-brand-dark/35 focus:outline-none sm:h-[74px] sm:text-[1.75rem]"
                    />
                  </label>

                  <label htmlFor="nickname" className="flex flex-col gap-3">
                    <span className="text-right text-[1rem] font-black sm:text-[1.15rem]">{homeSurfaceCopy.nicknameLabel}</span>
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
                      className="h-[70px] rounded-[1.65rem] border-[3px] border-brand-dark bg-white px-5 text-center text-[1.45rem] font-black shadow-[0_6px_0_0_#1A1A1A] placeholder:text-brand-dark/35 focus:outline-none sm:h-[74px] sm:text-[1.65rem]"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <JoinStatusChip
                    ready={sessionPinReady}
                    text={sessionPinReady ? t('home.status.pinReady', { pin }) : t('home.status.pinWait')}
                  />
                  <JoinStatusChip
                    ready={nicknameReady}
                    text={nicknameReady ? t('home.status.nicknameReady', { nickname: trimmedNickname }) : t('home.status.nicknameWait')}
                  />
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[1.2rem] font-black sm:text-[1.4rem]">{homeSurfaceCopy.identityLabel}</span>
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
                      className="inline-flex items-center gap-2 rounded-full border-[3px] border-brand-dark bg-white px-4 py-2 text-xs font-black shadow-[0_4px_0_0_#1A1A1A] sm:text-sm"
                    >
                      <ScanLine className="h-4 w-4 text-brand-orange" />
                      {homeSurfaceCopy.scannerLabel}
                    </button>
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-[1rem] font-black sm:text-[1.1rem]">{homeSurfaceCopy.previewLabel}</span>
                    <div className="flex min-h-[64px] flex-1 items-center justify-between gap-3 rounded-full border-[3px] border-brand-dark bg-white px-5 py-2.5 shadow-[0_6px_0_0_#1A1A1A] sm:min-h-[68px]">
                      <span className="text-[1.35rem] font-black leading-none sm:text-[1.55rem]">{trimmedNickname || t('home.form.nickname')}</span>
                      <span className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-full border-[3px] border-brand-dark bg-brand-bg sm:h-12 sm:w-12">
                        <img src={`/avatars/${selectedAvatar}`} alt="" className="h-full w-full object-cover" />
                      </span>
                    </div>
                  </div>

                  <div className="rounded-[1.7rem] bg-white/90 p-2.5 shadow-[0_8px_20px_rgba(0,0,0,0.05)]">
                    <div className="grid grid-cols-5 gap-2.5">
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
                          className={`overflow-hidden rounded-[1.25rem] border-[3px] bg-white transition-all ${
                            selectedAvatar === avatar
                              ? 'border-brand-dark shadow-[0_5px_0_0_#1A1A1A]'
                              : 'border-brand-dark/10 hover:border-brand-dark/50'
                          }`}
                        >
                          <div className="aspect-square w-full">
                            <img src={`/avatars/${avatar}`} alt="" className="h-full w-full object-cover" />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={!canJoin}
                  className="w-full rounded-[1.7rem] border-[4px] border-brand-dark bg-brand-orange px-8 py-3.5 text-lg font-black text-white shadow-[0_7px_0_0_#1A1A1A] transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-60 sm:text-[1.45rem]"
                >
                  {joining ? t('home.form.joining') : homeSurfaceCopy.joinLabel}
                </button>

                {savedSeat ? (
                  <div className="rounded-[2rem] border-[3px] border-brand-dark bg-brand-bg p-4 shadow-[0_6px_0_0_#1A1A1A]">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple">{t('home.saved.title')}</p>
                    <p className="mt-2 text-2xl font-black">{savedSeat.nickname}</p>
                    <p className="mt-1 text-sm font-bold text-brand-dark/65">
                      {t('home.saved.sessionLine', { pin: savedSeat.sessionPin })}
                      {savedSeat.teamName ? ` • ${savedSeat.teamName}` : ''}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={handleResumeSavedSession}
                        className="rounded-full border-[3px] border-brand-dark bg-brand-dark px-5 py-3 text-sm font-black text-white shadow-[0_5px_0_0_#FF5A36]"
                      >
                        {t('home.saved.continue')}
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSavedSession}
                        className="rounded-full border-[3px] border-brand-dark bg-white px-5 py-3 text-sm font-black shadow-[0_5px_0_0_#1A1A1A]"
                      >
                        {t('home.saved.clear')}
                      </button>
                    </div>
                  </div>
                ) : null}
              </motion.form>
            </div>
          </div>
        </motion.section>

        <section className="mx-auto mt-10 grid max-w-[1320px] gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <div className="rounded-[2.2rem] border-[3px] border-brand-dark bg-white p-6 shadow-[0_8px_0_0_#1A1A1A]">
            <div className="inline-flex items-start gap-3 rounded-[1.5rem] border-[3px] border-brand-dark bg-brand-bg px-4 py-4 shadow-[0_5px_0_0_#1A1A1A]">
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-brand-orange" />
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple">{studentSpaceLabel}</p>
                <p className="mt-2 text-sm font-bold leading-7 text-brand-dark/72">{studentSpaceBody}</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {studentAuth ? (
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-black text-brand-dark">שלום, {studentAuth.displayName}</span>
                      <button onClick={handleStudentLogout} className="text-[11px] font-black uppercase tracking-wider text-brand-orange hover:underline">
                        {language === 'he' ? 'התנתק' : 'Logout'}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => handleTrackedNavigate('/student/auth', 'student_sign_in', studentEmailSignInLabel, 'student_space')}
                        className="rounded-full border-[3px] border-brand-dark bg-white px-4 py-2 text-xs font-black shadow-[0_4px_0_0_#1A1A1A]"
                      >
                        {studentEmailSignInLabel}
                      </button>
                      <button
                        onClick={() => handleTrackedNavigate('/student/auth?mode=register', 'student_register', studentCreateAccountLabel, 'student_space')}
                        className="rounded-full border-[3px] border-brand-dark bg-brand-yellow px-4 py-2 text-xs font-black shadow-[0_4px_0_0_#1A1A1A]"
                      >
                        {studentCreateAccountLabel}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-orange">{homeSurfaceCopy.lowerTitle}</p>
              <p className="mt-3 text-base font-medium leading-7 text-brand-dark/72">{homeSurfaceCopy.lowerBody}</p>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {QUICK_VALUE_ITEMS.map((item) => (
                <div key={item.label} className="rounded-[1.5rem] border-[3px] border-brand-dark bg-brand-bg px-4 py-4 shadow-[0_5px_0_0_#1A1A1A]">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45">{item.label}</p>
                  <p className="mt-2 text-lg font-black">{item.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2.2rem] border-[3px] border-brand-dark bg-brand-yellow/45 p-6 shadow-[0_8px_0_0_#1A1A1A]">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-[3px] border-brand-dark bg-white">
                <MessageSquareText className="h-5 w-5 text-brand-orange" />
              </div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45">Feedback</p>
                <h2 className="text-2xl font-black">{homeSurfaceCopy.feedbackTitle}</h2>
                <p className="mt-2 text-sm font-medium leading-7 text-brand-dark/70">{homeSurfaceCopy.feedbackBody}</p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setFeedbackScore('positive')}
                className={`rounded-[1.3rem] border-[3px] px-3 py-3 font-black ${feedbackScore === 'positive' ? 'border-brand-dark bg-white shadow-[0_4px_0_0_#1A1A1A]' : 'border-brand-dark/20 bg-white/70'}`}
              >
                <ThumbsUp className="mx-auto mb-2 h-5 w-5" />
                ברור
              </button>
              <button
                type="button"
                onClick={() => setFeedbackScore('neutral')}
                className={`rounded-[1.3rem] border-[3px] px-3 py-3 font-black ${feedbackScore === 'neutral' ? 'border-brand-dark bg-white shadow-[0_4px_0_0_#1A1A1A]' : 'border-brand-dark/20 bg-white/70'}`}
              >
                <MessageSquareText className="mx-auto mb-2 h-5 w-5" />
                כמעט
              </button>
              <button
                type="button"
                onClick={() => setFeedbackScore('negative')}
                className={`rounded-[1.3rem] border-[3px] px-3 py-3 font-black ${feedbackScore === 'negative' ? 'border-brand-dark bg-white shadow-[0_4px_0_0_#1A1A1A]' : 'border-brand-dark/20 bg-white/70'}`}
              >
                <ThumbsDown className="mx-auto mb-2 h-5 w-5" />
                חסר
              </button>
            </div>

            <textarea
              value={feedbackMessage}
              onChange={(event) => setFeedbackMessage(event.target.value)}
              placeholder="למשל: חסר וידאו קצר, דוגמה לכיתה, או הסבר ברור יותר למורים."
              className="mt-4 min-h-28 w-full rounded-[1.6rem] border-[3px] border-brand-dark bg-white px-4 py-4 text-sm font-medium outline-none"
            />

            <button
              type="button"
              disabled={!feedbackScore || feedbackSubmitted}
              onClick={submitFeedback}
              className="mt-4 w-full rounded-[1.6rem] border-[3px] border-brand-dark bg-brand-dark px-5 py-3 text-base font-black text-white shadow-[0_6px_0_0_#FF5A36] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {feedbackSubmitted ? feedbackThanks : 'שלחו משוב קצר'}
            </button>

            <button
              type="button"
              onClick={() => handleTrackedNavigate('/contact', 'contact_sales', 'contact_sales', 'feedback_panel')}
              className="mt-3 w-full rounded-[1.6rem] border-[3px] border-brand-dark bg-white px-5 py-3 text-base font-black shadow-[0_6px_0_0_#1A1A1A]"
            >
              רוצים שנחזור אליכם?
            </button>
          </div>
        </section>

        <section className="mx-auto mt-10 grid max-w-[1320px] gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div className="rounded-[2.2rem] border-[3px] border-brand-dark bg-white p-6 shadow-[0_8px_0_0_#1A1A1A]">
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
                  <div key={item.id} className="rounded-[1.5rem] border-[3px] border-brand-dark bg-brand-bg/60 px-4 py-3">
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

          <div className="rounded-[2.2rem] border-[3px] border-brand-dark bg-white p-6 shadow-[0_8px_0_0_#1A1A1A]">
            <BrandLogo onClick={() => navigate('/')} imageClassName="h-12 w-auto" />
            <p className="mt-4 text-sm font-medium leading-7 text-brand-dark/72">{homeSurfaceCopy.lowerBody}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')}
                className="rounded-full border-[3px] border-brand-dark bg-brand-yellow px-5 py-3 text-sm font-black shadow-[0_5px_0_0_#1A1A1A]"
              >
                {teacherSignedIn ? t('nav.dashboard') : homeSurfaceCopy.teacherCta}
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className={`rounded-full border-[3px] border-brand-dark px-5 py-3 text-sm font-black shadow-[0_5px_0_0_#1A1A1A] ${teacherSignedIn ? 'bg-white' : 'hidden'}`}
              >
                {t('nav.logout')}
              </button>
            </div>
          </div>
        </section>
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
      className={`rounded-full border-2 px-3.5 py-1.5 text-xs font-black shadow-[3px_3px_0px_0px_#1A1A1A] sm:px-4 sm:py-2 sm:text-sm ${
        ready
          ? 'border-emerald-300 bg-emerald-50 text-brand-dark'
          : 'border-brand-dark/10 bg-white text-brand-dark/70'
      }`}
    >
      {text}
    </div>
  );
}
