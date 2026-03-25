import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Volume2, VolumeX } from 'lucide-react';
import { useAppLanguage } from '../lib/appLanguage.tsx';
import {
  DEFAULT_SESSION_SOUNDTRACKS,
  getSessionSoundtrackById,
  sanitizeSessionSoundtrackChoice,
} from '../../shared/sessionSoundtracks.ts';

type Props = {
  status: string;
  modeConfig?: Record<string, unknown> | null;
  className?: string;
  placement?: 'fixed' | 'inline';
};

const DEFAULT_VOLUME = 0.34;
const SOUNDTRACK_PREFERENCE_KEY = 'quizzi.session-soundtrack';

function readStoredMutedPreference() {
  if (typeof window === 'undefined') return false;
  try {
    const raw =
      window.sessionStorage.getItem(SOUNDTRACK_PREFERENCE_KEY)
      || window.localStorage.getItem(SOUNDTRACK_PREFERENCE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.muted);
  } catch {
    return false;
  }
}

function persistMutedPreference(muted: boolean) {
  if (typeof window === 'undefined') return;
  const payload = JSON.stringify({ muted });
  try {
    window.sessionStorage.setItem(SOUNDTRACK_PREFERENCE_KEY, payload);
  } catch {
    // Ignore storage failures and keep the in-memory preference.
  }
  try {
    window.localStorage.setItem(SOUNDTRACK_PREFERENCE_KEY, payload);
  } catch {
    // Ignore storage failures and keep the in-memory preference.
  }
}

function resolveActiveTrackId(status: string, modeConfig?: Record<string, unknown> | null) {
  const lobbyTrackId = sanitizeSessionSoundtrackChoice(
    modeConfig?.lobby_track_id,
    DEFAULT_SESSION_SOUNDTRACKS.lobby_track_id,
  );
  const gameplayTrackId = sanitizeSessionSoundtrackChoice(
    modeConfig?.gameplay_track_id,
    DEFAULT_SESSION_SOUNDTRACKS.gameplay_track_id,
  );

  if (status === 'ENDED') return 'none';
  return status === 'LOBBY' ? lobbyTrackId : gameplayTrackId;
}

export default function SessionSoundtrackPlayer({
  status,
  modeConfig,
  className = '',
  placement = 'fixed',
}: Props) {
  const { language } = useAppLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(() => readStoredMutedPreference());
  const [needsInteraction, setNeedsInteraction] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const activeTrack = useMemo(() => {
    const activeTrackId = resolveActiveTrackId(status, modeConfig || undefined);
    return getSessionSoundtrackById(activeTrackId);
  }, [modeConfig, status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!audioRef.current) {
      const audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      audioRef.current = audio;
    }

    return () => {
      if (!audioRef.current) return;
      audioRef.current.pause();
      audioRef.current.src = '';
    };
  }, []);

  useEffect(() => {
    persistMutedPreference(muted);
  }, [muted]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.volume = muted ? 0 : DEFAULT_VOLUME;

    if (!activeTrack || muted) {
      audio.pause();
      setIsPlaying(false);
      if (!activeTrack) {
        setNeedsInteraction(false);
      }
      return;
    }

    if (!audio.src.endsWith(activeTrack.src)) {
      audio.src = activeTrack.src;
      audio.load();
    }

    let cancelled = false;

    const startPlayback = async () => {
      try {
        await audio.play();
        if (cancelled) return;
        setIsPlaying(true);
        setNeedsInteraction(false);
      } catch (error: any) {
        if (cancelled) return;
        const code = String(error?.name || error?.code || '');
        if (code === 'NotAllowedError' || code === 'AbortError') {
          setNeedsInteraction(true);
          setIsPlaying(false);
          return;
        }
        console.warn('[session-audio] Failed to start soundtrack:', error);
        setIsPlaying(false);
      }
    };

    void startPlayback();

    return () => {
      cancelled = true;
    };
  }, [activeTrack, muted]);

  useEffect(() => {
    if (!needsInteraction || muted || !activeTrack) return;

    const resumePlayback = () => {
      const audio = audioRef.current;
      if (!audio) return;
      void audio.play()
        .then(() => {
          setIsPlaying(true);
          setNeedsInteraction(false);
        })
        .catch(() => {
          setIsPlaying(false);
        });
    };

    const eventOptions = { once: true, passive: true } as AddEventListenerOptions;
    window.addEventListener('pointerdown', resumePlayback, eventOptions);
    window.addEventListener('keydown', resumePlayback, eventOptions);
    return () => {
      window.removeEventListener('pointerdown', resumePlayback);
      window.removeEventListener('keydown', resumePlayback);
    };
  }, [activeTrack, muted, needsInteraction]);

  if (!activeTrack) return null;

  const copy = {
    he: {
      enableLobby: 'הפעל את מוזיקת הלובי',
      enableGame: 'הפעל את מוזיקת המשחק',
      muted: 'המוזיקה מושתקת',
      lobbyLabel: 'פסקול הלובי',
      gameLabel: 'פסקול המשחק',
    },
    ar: {
      enableLobby: 'فعّل موسيقى الردهة',
      enableGame: 'فعّل موسيقى اللعبة',
      muted: 'الموسيقى مكتومة',
      lobbyLabel: 'موسيقى الردهة',
      gameLabel: 'موسيقى اللعبة',
    },
    en: {
      enableLobby: 'Enable lobby music',
      enableGame: 'Enable game music',
      muted: 'Music muted',
      lobbyLabel: 'Lobby soundtrack',
      gameLabel: 'Game soundtrack',
    },
  }[language];

  const buttonLabel = needsInteraction
    ? (status === 'LOBBY' ? copy.enableLobby : copy.enableGame)
    : muted
      ? copy.muted
      : activeTrack.label;
  const placementClassName =
    placement === 'inline'
      ? 'game-action-button game-action-button--secondary group w-full justify-start px-5 py-3 text-left'
      : 'game-action-button game-action-button--secondary group fixed bottom-5 right-5 z-40 hidden justify-start px-5 py-3 text-left md:flex';

  return (
    <button
      type="button"
      onClick={() => {
        if (needsInteraction || muted) {
          setMuted(false);
          setNeedsInteraction(false);
          const audio = audioRef.current;
          if (audio) {
            void audio.play()
              .then(() => {
                setIsPlaying(true);
              })
              .catch(() => {
                setNeedsInteraction(true);
                setIsPlaying(false);
              });
          }
          return;
        }

        setMuted(true);
        setIsPlaying(false);
      }}
      className={`${placementClassName} ${className}`.trim()}
      title={activeTrack.label}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-bg transition-colors group-hover:bg-brand-yellow">
        {muted ? <VolumeX className="w-5 h-5 text-brand-dark" /> : isPlaying ? <Volume2 className="w-5 h-5 text-brand-orange" /> : <Music2 className="w-5 h-5 text-brand-dark" />}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple">
          {status === 'LOBBY' ? copy.lobbyLabel : copy.gameLabel}
        </p>
        <p className="truncate font-black text-brand-dark">{buttonLabel}</p>
      </div>
    </button>
  );
}
