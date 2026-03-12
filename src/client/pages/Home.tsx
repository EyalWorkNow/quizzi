import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, QrCode, ScanLine, Sparkles, Star } from 'lucide-react';
import { motion } from 'motion/react';
import JoinScannerModal from '../components/JoinScannerModal.tsx';
import { trackStudentJoinEvent, trackTeacherAuthEvent, toAnalyticsErrorCode } from '../lib/appAnalytics.ts';
import { announceParticipantJoin } from '../lib/firebaseRealtime.ts';
import { isValidSessionPin, sanitizeSessionPin } from '../lib/joinCodes.ts';
import {
  loadTeacherAuth,
  isTeacherAuthenticated,
  refreshTeacherSession,
  signOutTeacher,
} from '../lib/teacherAuth.ts';

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🦖', '🦉'];
const HOME_PIN_KEY = 'quizzi.home.pin';
const HOME_NICKNAME_KEY = 'quizzi.home.nickname';
const HOME_AVATAR_KEY = 'quizzi.home.avatar';

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
  const nicknameInputRef = useRef<HTMLInputElement | null>(null);
  const autoResolvedPinRef = useRef('');
  const navigate = useNavigate();

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
      setError('Enter a 6-digit game PIN before joining.');
      return;
    }
    if (trimmedNickname.length < 2) {
      setError('Nickname must be at least 2 characters.');
      return;
    }

    setJoining(true);
    void trackStudentJoinEvent({
      result: 'attempt',
      pinLength: sessionPin.length,
    });

    try {
      const fullNickname = `${selectedAvatar} ${trimmedNickname}`;
      const res = await fetch(`/api/sessions/${sessionPin}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: fullNickname })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to join');

      localStorage.setItem('participant_id', data.participant_id.toString());
      localStorage.setItem('session_id', data.session_id.toString());
      localStorage.setItem('session_pin', sessionPin);
      localStorage.setItem('nickname', fullNickname);
      if (data.team_name) localStorage.setItem('team_name', data.team_name);
      else localStorage.removeItem('team_name');
      if (data.game_type) localStorage.setItem('game_type', data.game_type);

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

  useEffect(() => {
    const routePin = sanitizeSessionPin(routePinParam || '');
    if (!isValidSessionPin(routePin) || autoResolvedPinRef.current === routePin) {
      return;
    }

    autoResolvedPinRef.current = routePin;
    setPin(routePin);
    setError('');

    if (nickname.trim().length >= 2) {
      setJoinAssistMessage(`Session ${routePin} detected from scan. Joining now...`);
      void joinSession(routePin);
      return;
    }

    setJoinAssistMessage(`Session ${routePin} detected from scan. Add your nickname and join.`);
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
      setJoinAssistMessage(`Session ${sessionPin} scanned. Joining now...`);
      void joinSession(sessionPin);
      return;
    }

    setJoinAssistMessage(`Session ${sessionPin} scanned. Add your nickname to jump in.`);
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

  return (
    <div className="min-h-screen bg-brand-bg font-sans text-brand-dark overflow-x-clip flex flex-col selection:bg-brand-orange selection:text-white">
      {/* Navbar */}
      <nav className="page-shell relative z-20 flex flex-wrap items-center justify-between gap-4 py-5">
        <div className="text-3xl font-black tracking-tight flex items-center gap-1">
          <span className="text-brand-orange">Quiz</span>zi
        </div>
        <div className="hidden md:flex items-center gap-10 font-bold text-lg">
          <button onClick={() => navigate('/explore')} className="hover:text-brand-orange transition-colors flex items-center gap-1">Explore</button>
          <button onClick={() => navigate(teacherSignedIn ? '/teacher/dashboard' : '/auth')} className="hover:text-brand-orange transition-colors">{teacherSignedIn ? 'Teacher Studio' : 'For Teachers'}</button>
          <button onClick={() => navigate('/contact')} className="hover:text-brand-orange transition-colors">Contact Us</button>
        </div>
        <div className="action-row w-full md:w-auto md:justify-end">
          {teacherSignedIn ? (
            <>
              <button onClick={() => navigate('/teacher/dashboard')} className="action-pill font-bold px-6 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">Dashboard</button>
              <button onClick={handleLogout} className="action-pill font-bold px-6 py-3 rounded-full bg-brand-orange text-white border-2 border-brand-orange hover:bg-orange-600 transition-colors">Log out</button>
            </>
          ) : (
            <>
              <button onClick={() => navigate('/auth')} className="action-pill font-bold px-6 py-3 rounded-full border-2 border-brand-dark hover:bg-brand-dark hover:text-white transition-colors">Log in</button>
              <button onClick={() => navigate('/auth')} className="action-pill font-bold px-6 py-3 rounded-full bg-brand-orange text-white border-2 border-brand-orange hover:bg-orange-600 transition-colors">Create account</button>
            </>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <main className="page-shell relative z-10 flex flex-1 flex-col items-center justify-center gap-10 py-4 pb-12 lg:flex-row lg:gap-12 lg:py-8">

        {/* Left Content */}
        <div className="z-10 w-full flex-1 min-w-0">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-5 text-[2.9rem] font-black leading-[1.02] tracking-tight xs:text-[3.4rem] sm:text-[4.8rem] lg:text-[6.5rem]"
          >
            Find the right <br />
            <span className="text-brand-orange">quiz</span> for you
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-8 max-w-xl text-lg font-medium leading-relaxed text-brand-dark/80 sm:text-2xl"
          >
            See your personalised recommendations based on your interests and goals
          </motion.p>

          {/* Join Form */}
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            onSubmit={handleJoin}
            className="relative flex max-w-3xl flex-col gap-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-4">
              <input
                id="game-pin"
                type="text"
                placeholder="Game PIN"
                aria-label="Enter Game PIN"
                value={pin}
                onChange={(e) => setPin(sanitizeSessionPin(e.target.value))}
                maxLength={6}
                required
                inputMode="numeric"
                className="w-full min-w-0 rounded-full border-2 border-brand-dark bg-white px-6 py-4 text-lg font-bold tracking-[0.16em] placeholder:text-brand-dark/40 focus:outline-none focus:ring-4 focus:ring-brand-orange/20 sm:px-8 sm:py-5 sm:text-xl"
              />
              <input
                id="nickname"
                ref={nicknameInputRef}
                type="text"
                placeholder="Nickname"
                aria-label="Enter your nickname"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={12}
                required
                className="w-full min-w-0 rounded-full border-2 border-brand-dark bg-white px-6 py-4 text-lg font-bold placeholder:text-brand-dark/40 focus:outline-none focus:ring-4 focus:ring-brand-orange/20 sm:px-8 sm:py-5 sm:text-xl"
              />
              <button
                type="submit"
                disabled={joining}
                className="w-full rounded-full border-2 border-brand-dark bg-brand-orange px-8 py-4 text-lg font-bold text-white shadow-[4px_4px_0px_0px_#1A1A1A] transition-all hover:translate-x-[2px] hover:translate-y-[2px] hover:bg-[#e84d2a] hover:shadow-[2px_2px_0px_0px_#1A1A1A] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none md:w-auto md:px-10 md:py-5 md:text-xl"
              >
                {joining ? 'Joining...' : 'Join'}
              </button>
            </div>

            <div className="action-row">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setScannerOpen(true);
                }}
                className="action-pill rounded-[1.4rem] border-2 border-brand-dark bg-white px-5 py-4 text-base font-black shadow-[4px_4px_0px_0px_#1A1A1A] sm:text-lg flex items-center justify-center gap-3"
              >
                <ScanLine className="w-5 h-5 text-brand-orange" />
                Scan QR / barcode
              </button>

              <div className={`min-w-0 flex-1 rounded-[1.4rem] border-2 border-brand-dark p-4 ${joinAssistMessage ? 'bg-brand-yellow' : 'bg-white/75'}`}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full border-2 border-brand-dark bg-white flex items-center justify-center shrink-0">
                    {joinAssistMessage ? <CheckCircle2 className="w-5 h-5 text-brand-orange" /> : <QrCode className="w-5 h-5 text-brand-purple" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-1">
                      {joinAssistMessage ? 'Session detected' : 'Fast lane'}
                    </p>
                    <p className="font-black leading-snug">
                      {joinAssistMessage || 'Skip typing the PIN. Scan the host code and we will pull the session automatically.'}
                    </p>
                    <p className="text-sm text-brand-dark/65 font-medium mt-1">
                      {scannerSupported
                        ? 'If a nickname is already saved on this device, the join can complete immediately after the scan.'
                        : 'If in-app scanning is not available on this browser, use your device camera on the host QR and the session link will open automatically.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Avatar Selection */}
            <div className="premium-card mt-4 bg-white/50 p-5 backdrop-blur-md sm:p-6">
              <p className="text-[10px] font-black text-brand-dark/40 mb-4 px-2 uppercase tracking-[0.2em]">Identify as</p>
              <div className="flex flex-wrap gap-3 px-2">
                {AVATARS.map((avatar) => (
                  <button
                    key={avatar}
                    type="button"
                    aria-label={`Select avatar ${avatar}`}
                    aria-pressed={selectedAvatar === avatar}
                    onClick={() => setSelectedAvatar(avatar)}
                    className={`rounded-2xl p-3 text-3xl transition-all hover:scale-125 focus:outline-none focus-visible:ring-8 focus-visible:ring-brand-purple/10 sm:text-4xl ${selectedAvatar === avatar
                      ? 'bg-brand-purple/20 border-2 border-brand-dark scale-110 shadow-[4px_4px_0px_0px_#1A1A1A]'
                      : 'border-2 border-transparent hover:bg-white/80'
                      }`}
                  >
                    {avatar}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div role="alert" aria-live="single" className="text-red-500 font-bold bg-red-50 px-4 py-3 rounded-2xl border border-red-200 shadow-sm">
                {error}
              </div>
            )}
          </motion.form>

          {/* Stats row */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="safe-grid-4 mt-12 sm:mt-16"
          >
            <div className="premium-card group flex flex-col justify-between p-6 sm:p-8">
              <span className="inline-block px-4 py-1.5 rounded-full bg-brand-purple/10 text-brand-purple font-black text-[10px] mb-8 border border-brand-purple/20 uppercase tracking-widest w-fit">Knowledge</span>
              <div>
                <p className="text-xs font-black text-brand-dark/30 uppercase tracking-widest mb-1">Subjects</p>
                <p className="text-5xl font-black transition-colors group-hover:text-brand-purple sm:text-6xl">+40</p>
              </div>
            </div>
            <div className="premium-card group flex flex-col justify-between bg-brand-orange p-6 text-white sm:p-8">
              <span className="inline-block px-4 py-1.5 rounded-full bg-white text-brand-orange font-black text-[10px] mb-8 border border-white/20 uppercase tracking-widest w-fit">Impact</span>
              <div>
                <p className="text-xs font-black text-white/50 uppercase tracking-widest mb-1">Live Sessions</p>
                <p className="text-5xl font-black sm:text-6xl">+120</p>
              </div>
            </div>
            <div className="premium-card group flex flex-col justify-between bg-brand-yellow p-6 sm:p-8">
              <div className="flex gap-1 text-brand-orange mb-8">
                {[1, 2, 3, 4, 5].map(i => <Star key={i} className="w-5 h-5 fill-current" />)}
              </div>
              <div>
                <p className="text-xs font-black text-brand-dark/30 uppercase tracking-widest mb-1">Happy Learners</p>
                <p className="text-5xl font-black sm:text-6xl">+180k</p>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Right Illustration Area */}
        <div className="flex-1 relative hidden lg:flex items-center justify-center h-full min-h-[600px]">
          {/* Decorative rings */}
          <div className="absolute w-[600px] h-[600px] border-[3px] border-brand-dark/5 rounded-full"></div>
          <div className="absolute w-[400px] h-[400px] border-[3px] border-brand-dark/5 rounded-full"></div>

          {/* Floating stars */}
          <motion.div
            animate={{ y: [-10, 10, -10], rotate: [0, 10, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
            className="absolute top-20 left-20 text-brand-yellow"
          >
            <svg width="60" height="60" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
          </motion.div>

          <motion.div
            animate={{ y: [10, -10, 10], rotate: [0, -10, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="absolute bottom-40 right-10 text-brand-yellow"
          >
            <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" /></svg>
          </motion.div>

          {/* Main Illustration Shape */}
          <motion.div
            initial={{ scale: 0.8, rotate: -10 }}
            animate={{ scale: 1, rotate: 12 }}
            transition={{ type: 'spring', bounce: 0.5, duration: 1 }}
            className="relative w-[350px] h-[350px] bg-brand-purple rounded-[4rem] border-4 border-brand-dark shadow-[24px_24px_0px_0px_#1A1A1A] flex items-center justify-center z-10"
          >
            <Sparkles className="w-40 h-40 text-white" />

            {/* Decorative pencil/rocket shape overlapping */}
            <div className="absolute -bottom-20 -left-32 w-[400px] h-20 bg-brand-purple border-4 border-brand-dark rounded-full -rotate-[20deg] shadow-[8px_8px_0px_0px_#1A1A1A] flex items-center">
              <div className="w-16 h-full border-r-4 border-brand-dark bg-white rounded-l-full flex items-center justify-start pl-2">
                <div className="w-0 h-0 border-t-[12px] border-t-transparent border-r-[24px] border-r-brand-dark border-b-[12px] border-b-transparent"></div>
              </div>
            </div>
          </motion.div>
        </div>
      </main>
      <JoinScannerModal open={scannerOpen} onClose={() => setScannerOpen(false)} onDetected={handleDetectedPin} />
    </div>
  );
}
