import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Play, QrCode, RotateCcw, ScanLine, Sparkles, Star } from 'lucide-react';
import { motion } from 'motion/react';
import { extractNickname } from '../components/Avatar.tsx';
import JoinScannerModal from '../components/JoinScannerModal.tsx';
import { trackStudentJoinEvent, trackTeacherAuthEvent, toAnalyticsErrorCode } from '../lib/appAnalytics.ts';
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
  const [savedSeat, setSavedSeat] = useState(() => readSavedSeat());
  const { t, language, direction } = useAppLanguage();
  const nicknameInputRef = useRef<HTMLInputElement | null>(null);
  const autoResolvedPinRef = useRef('');
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

  const joinSession = async (nextPin = pin) => {
    const sessionPin = sanitizeSessionPin(nextPin);
    const trimmedNickname = nickname.trim();

    setError('');
    if (!isValidSessionPin(sessionPin)) {
      setError(t('home.error.pinSixDigits'));
      return;
    }
    if (trimmedNickname.length < 2) {
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
      });

      void trackStudentJoinEvent({
        result: 'success',
        pinLength: sessionPin.length,
      });
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
    navigate(`/student/session/${savedSeat.sessionPin}/play`);
  };

  const handleClearSavedSession = () => {
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

  const heroTitle = `${t('home.hero.title1')} ${t('home.hero.title2')}`;
  const trimmedNickname = nickname.trim();

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
                        onChange={(e) => setPin(sanitizeSessionPin(e.target.value))}
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
                        onChange={(e) => setNickname(e.target.value)}
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
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="relative min-w-0"
          >
            <div className="relative flex min-h-[240px] items-center justify-center overflow-hidden rounded-[2.8rem] border-2 border-brand-dark/5 bg-brand-bg/60 px-6 py-8 sm:min-h-[300px] lg:min-h-[640px] lg:px-8 lg:py-10">
              <div className="absolute h-[520px] w-[520px] rounded-full border-[3px] border-brand-dark/5 lg:h-[620px] lg:w-[620px]" />
              <div className="absolute h-[360px] w-[360px] rounded-full border-[3px] border-brand-dark/5 lg:h-[420px] lg:w-[420px]" />

              <motion.div
                animate={{ y: [-10, 10, -10], rotate: [0, 10, 0] }}
                transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute left-6 top-8 text-brand-yellow lg:left-10 lg:top-20"
              >
                <svg width="54" height="54" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
              </motion.div>

              <motion.div
                animate={{ y: [10, -10, 10], rotate: [0, -10, 0] }}
                transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                className="absolute bottom-10 right-4 text-brand-yellow lg:bottom-32 lg:right-8"
              >
                <svg width="38" height="38" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
              </motion.div>

              <motion.div
                initial={{ scale: 0.84, rotate: -8 }}
                animate={{ scale: 1, rotate: 12 }}
                transition={{ type: 'spring', bounce: 0.42, duration: 1 }}
                className="relative z-10 flex h-[240px] w-[240px] items-center justify-center rounded-[3rem] border-4 border-brand-dark bg-brand-purple shadow-[18px_18px_0px_0px_#1A1A1A] sm:h-[280px] sm:w-[280px] lg:h-[360px] lg:w-[360px] lg:rounded-[4rem]"
              >
                <Sparkles className="h-24 w-24 text-white sm:h-28 sm:w-28 lg:h-40 lg:w-40" />

                <div className="absolute -bottom-12 -left-20 flex h-14 w-[240px] rotate-[-18deg] items-center rounded-full border-4 border-brand-dark bg-brand-purple shadow-[8px_8px_0px_0px_#1A1A1A] sm:-left-24 sm:w-[280px] lg:-bottom-20 lg:-left-32 lg:h-20 lg:w-[400px]">
                  <div className="flex h-full w-14 items-center justify-start rounded-l-full border-r-4 border-brand-dark bg-white pl-2 lg:w-16">
                    <div className="h-0 w-0 border-b-[12px] border-r-[24px] border-t-[12px] border-b-transparent border-r-brand-dark border-t-transparent" />
                  </div>
                </div>
              </motion.div>

              <div className="absolute bottom-5 left-1/2 w-[min(88%,360px)] -translate-x-1/2 rounded-full border-2 border-brand-dark bg-white/90 px-5 py-3 text-center font-black shadow-[4px_4px_0px_0px_#1A1A1A] backdrop-blur-sm lg:bottom-8">
                {t('home.hero.supportBadge')}
              </div>
            </div>
          </motion.aside>
        </div>
      </main>
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
