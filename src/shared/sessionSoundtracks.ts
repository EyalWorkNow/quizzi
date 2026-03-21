export const SESSION_SOUNDTRACK_IDS = [
  'quizzmusic1',
  'quizzmusic2',
  'quizzmusic3',
  'quizzmusic4',
] as const;

export type SessionSoundtrackId = (typeof SESSION_SOUNDTRACK_IDS)[number];
export type SessionSoundtrackChoice = SessionSoundtrackId | 'none';

export type SessionSoundtrack = {
  id: SessionSoundtrackId;
  label: string;
  src: string;
};

export const SESSION_SOUNDTRACKS: readonly SessionSoundtrack[] = [
  {
    id: 'quizzmusic1',
    label: 'Track 1',
    src: '/audio/quizzmusic1.mp3',
  },
  {
    id: 'quizzmusic2',
    label: 'Track 2',
    src: '/audio/quizzmusic2.mp3',
  },
  {
    id: 'quizzmusic3',
    label: 'Track 3',
    src: '/audio/quizzmusic3.mp3',
  },
  {
    id: 'quizzmusic4',
    label: 'Track 4',
    src: '/audio/quizzmusic4.mp3',
  },
] as const;

export const DEFAULT_SESSION_SOUNDTRACKS = {
  lobby_track_id: 'quizzmusic1' as SessionSoundtrackChoice,
  gameplay_track_id: 'quizzmusic2' as SessionSoundtrackChoice,
};

export function isSessionSoundtrackChoice(value: unknown): value is SessionSoundtrackChoice {
  return value === 'none' || SESSION_SOUNDTRACK_IDS.includes(value as SessionSoundtrackId);
}

export function sanitizeSessionSoundtrackChoice(
  value: unknown,
  fallback: SessionSoundtrackChoice = 'none',
): SessionSoundtrackChoice {
  return isSessionSoundtrackChoice(value) ? value : fallback;
}

export function getSessionSoundtrackById(id: SessionSoundtrackChoice | null | undefined) {
  if (!id || id === 'none') return null;
  return SESSION_SOUNDTRACKS.find((track) => track.id === id) || null;
}
