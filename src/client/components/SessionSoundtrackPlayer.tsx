import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Music2, Volume2, VolumeX } from 'lucide-react';
import {
  DEFAULT_SESSION_SOUNDTRACKS,
  getSessionSoundtrackById,
  sanitizeSessionSoundtrackChoice,
} from '../../shared/sessionSoundtracks.ts';

type Props = {
  status: string;
  modeConfig?: Record<string, unknown> | null;
  className?: string;
};

const DEFAULT_VOLUME = 0.34;

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

export default function SessionSoundtrackPlayer({ status, modeConfig, className = '' }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(false);
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

  const buttonLabel = needsInteraction
    ? `Enable ${status === 'LOBBY' ? 'lobby' : 'game'} music`
    : muted
      ? 'Music muted'
      : activeTrack.label;

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
      className={`fixed bottom-5 right-5 z-40 hidden items-center gap-3 rounded-full border-4 border-brand-dark bg-white px-5 py-3 text-left shadow-[6px_6px_0px_0px_#1A1A1A] transition-colors hover:bg-brand-yellow md:flex ${className}`.trim()}
      title={activeTrack.label}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-brand-dark bg-brand-bg">
        {muted ? <VolumeX className="w-5 h-5 text-brand-dark" /> : isPlaying ? <Volume2 className="w-5 h-5 text-brand-orange" /> : <Music2 className="w-5 h-5 text-brand-dark" />}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-purple">
          {status === 'LOBBY' ? 'Lobby soundtrack' : 'Game soundtrack'}
        </p>
        <p className="truncate font-black text-brand-dark">{buttonLabel}</p>
      </div>
    </button>
  );
}
