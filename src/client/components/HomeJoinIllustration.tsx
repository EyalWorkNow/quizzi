import { motion } from 'motion/react';
import { ScanLine, Sparkles, Stars } from 'lucide-react';

const FLOATING_AVATARS = [
  'avatar_1.png',
  'avatar_3.png',
  'avatar_5.png',
  'avatar_8.png',
] as const;

type HomeJoinIllustrationProps = {
  pin?: string;
  nickname?: string;
  avatar?: string;
};

function formatPreviewPin(value?: string) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 6);
  if (!digits) return 'Game PIN';
  if (digits.length <= 3) return digits;
  return `${digits.slice(0, 3)} ${digits.slice(3)}`.trim();
}

export default function HomeJoinIllustration({
  pin = '',
  nickname = '',
  avatar = 'avatar_1.png',
}: HomeJoinIllustrationProps) {
  const displayPin = formatPreviewPin(pin);
  const displayNickname = nickname.trim() || 'Nickname';

  return (
    <>
      <style>{`
        .quizzi-join-illustration-grid {
          background-image:
            linear-gradient(rgba(0,0,0,0.04) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,0.04) 1px, transparent 1px);
          background-size: 34px 34px;
          background-position: center center;
        }

        .quizzi-join-illustration-beam {
          background: linear-gradient(180deg, transparent 0%, rgba(255,255,255,0.88) 48%, transparent 100%);
          filter: blur(1px);
          animation: quizzi-join-illustration-scan 4.2s ease-in-out infinite;
        }

        .quizzi-join-illustration-orbit {
          animation: quizzi-join-illustration-orbit 12s linear infinite;
          transform-origin: center;
        }

        @keyframes quizzi-join-illustration-scan {
          0%, 100% {
            transform: translateY(-38%);
            opacity: 0.35;
          }
          50% {
            transform: translateY(118%);
            opacity: 0.85;
          }
        }

        @keyframes quizzi-join-illustration-orbit {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>

      <div className="relative h-full min-h-[280px] overflow-hidden rounded-[2.6rem] border-[3px] border-brand-dark bg-[#fffaf1] shadow-[0_10px_0_0_#1A1A1A] sm:min-h-[380px] lg:min-h-[560px]">
        <div className="quizzi-join-illustration-grid absolute inset-0 opacity-60" />
        <div className="absolute left-[-12%] top-[-16%] h-48 w-48 rounded-full bg-brand-yellow/60 blur-3xl sm:h-64 sm:w-64" />
        <div className="absolute bottom-[-12%] right-[-10%] h-52 w-52 rounded-full bg-brand-purple/30 blur-3xl sm:h-72 sm:w-72" />
        <div className="absolute inset-[10%] rounded-full border border-brand-dark/8" />
        <div className="absolute inset-[22%] rounded-full border border-brand-dark/8" />

        <motion.div
          animate={{ y: [0, -12, 0], rotate: [-5, -2, -5] }}
          transition={{ duration: 5.8, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute left-[8%] top-[14%] flex items-center gap-2 rounded-full border-[3px] border-brand-dark bg-white px-4 py-2 shadow-[0_5px_0_0_#1A1A1A]"
        >
          <ScanLine className="h-4 w-4 text-brand-orange" />
          <span className="text-xs font-black uppercase tracking-[0.18em] text-brand-dark/80">Live Join</span>
        </motion.div>

        <motion.div
          animate={{ y: [0, -10, 0], x: [0, 6, 0] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute bottom-[10%] left-[10%] rounded-[1.4rem] border-[3px] border-brand-dark bg-white px-4 py-3 shadow-[0_5px_0_0_#1A1A1A]"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-brand-dark bg-brand-orange text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">Fast Entry</p>
              <p className="text-sm font-black">Code. Name. Play.</p>
            </div>
          </div>
        </motion.div>

        <div className="absolute inset-0 flex items-center justify-center p-8 sm:p-10">
          <div className="quizzi-join-illustration-orbit pointer-events-none absolute inset-[11%] rounded-full">
            {FLOATING_AVATARS.map((avatar, index) => {
              const orbitStyle = [
                'left-[8%] top-[18%]',
                'right-[10%] top-[14%]',
                'right-[6%] bottom-[18%]',
                'left-[12%] bottom-[14%]',
              ][index];

              return (
                <motion.div
                  key={avatar}
                  animate={{ y: [0, -8, 0], scale: [1, 1.05, 1] }}
                  transition={{ duration: 3.4 + index, repeat: Infinity, ease: 'easeInOut' }}
                  className={`absolute ${orbitStyle} rounded-[1.4rem] border-[3px] border-brand-dark bg-white p-2 shadow-[0_5px_0_0_#1A1A1A]`}
                >
                  <img src={`/avatars/${avatar}`} alt="" className="h-14 w-14 rounded-[0.9rem] object-cover sm:h-16 sm:w-16" />
                </motion.div>
              );
            })}
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.92, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: -6 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
            className="relative z-10 w-full max-w-[420px] rounded-[2.8rem] border-[4px] border-brand-dark bg-white p-5 shadow-[0_16px_0_0_#1A1A1A] sm:p-6"
          >
            <motion.div
              animate={{ rotate: [-6, -3, -6], y: [0, -10, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: 'easeInOut' }}
              className="relative overflow-hidden rounded-[2.2rem] border-[4px] border-brand-dark bg-[linear-gradient(135deg,#B488FF_0%,#9F74F0_42%,#FF5A36_100%)] px-5 py-6 text-white shadow-[0_10px_0_0_#1A1A1A]"
            >
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.28),transparent_42%)]" />
              <div className="quizzi-join-illustration-beam absolute inset-x-0 top-0 h-20" />
              <div className="relative flex items-center justify-between">
                <div className="rounded-full border-[3px] border-white/70 bg-white/15 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em]">
                  Quizzi Live
                </div>
                <img src="/Quizzi%20LOGO.svg" alt="" className="h-7 w-auto drop-shadow-[0_2px_0_rgba(0,0,0,0.28)]" />
              </div>

              <div className="relative mt-8 space-y-3">
                <div className="rounded-[1.5rem] border-[3px] border-white/85 bg-white/12 px-4 py-3 backdrop-blur-sm">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/75">Room Code</p>
                  <motion.p
                    key={displayPin}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, ease: 'easeOut' }}
                    className="mt-1 text-2xl font-black tracking-[0.16em]"
                  >
                    {displayPin}
                  </motion.p>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-[1.5rem] border-[3px] border-white/85 bg-white px-4 py-3 text-brand-dark shadow-[0_5px_0_0_#1A1A1A]">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.18em] text-brand-dark/45">Identity</p>
                    <motion.p
                      key={displayNickname}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.24, ease: 'easeOut' }}
                      className="mt-1 text-lg font-black"
                    >
                      {displayNickname}
                    </motion.p>
                  </div>
                  <motion.div
                    key={avatar}
                    initial={{ opacity: 0, scale: 0.88 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.24, ease: 'easeOut' }}
                    className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-[3px] border-brand-dark bg-brand-bg"
                  >
                    <img src={`/avatars/${avatar}`} alt="" className="h-full w-full object-cover" />
                  </motion.div>
                </div>
              </div>

              <div className="relative mt-5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-white" />
                  <div className="h-2.5 w-2.5 rounded-full bg-white/60" />
                  <div className="h-2.5 w-2.5 rounded-full bg-white/40" />
                </div>
                <Stars className="h-6 w-6 text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.55)]" />
              </div>
            </motion.div>

            <motion.div
              animate={{ y: [0, 6, 0], rotate: [3, 1, 3] }}
              transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute -bottom-7 right-6 rounded-full border-[4px] border-brand-dark bg-brand-orange px-6 py-3 text-sm font-black text-white shadow-[0_8px_0_0_#1A1A1A]"
            >
              Ready to Join
            </motion.div>
          </motion.div>
        </div>
      </div>
    </>
  );
}
