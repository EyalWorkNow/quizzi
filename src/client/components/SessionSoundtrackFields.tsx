import React from 'react';
import { Music2 } from 'lucide-react';
import { SESSION_SOUNDTRACKS, type SessionSoundtrackChoice } from '../../shared/sessionSoundtracks.ts';

type Props = {
  lobbyTrackId: SessionSoundtrackChoice;
  gameplayTrackId: SessionSoundtrackChoice;
  onLobbyTrackChange: (value: SessionSoundtrackChoice) => void;
  onGameplayTrackChange: (value: SessionSoundtrackChoice) => void;
  compact?: boolean;
};

function SoundtrackSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: SessionSoundtrackChoice;
  onChange: (value: SessionSoundtrackChoice) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] font-black uppercase tracking-[0.2em] text-brand-dark/45 mb-2">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SessionSoundtrackChoice)}
        className="w-full rounded-2xl border-2 border-brand-dark bg-white px-4 py-3 font-black text-brand-dark shadow-[2px_2px_0px_0px_#1A1A1A] focus:outline-none focus:ring-4 focus:ring-brand-orange/20"
      >
        <option value="none">No music</option>
        {SESSION_SOUNDTRACKS.map((track) => (
          <option key={track.id} value={track.id}>
            {track.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default function SessionSoundtrackFields({
  lobbyTrackId,
  gameplayTrackId,
  onLobbyTrackChange,
  onGameplayTrackChange,
  compact = false,
}: Props) {
  return (
    <div className={`rounded-[2rem] border-4 border-brand-dark bg-white ${compact ? 'p-5' : 'p-6'}`}>
      <div className="flex items-start gap-3 mb-5">
        <div className="w-12 h-12 rounded-2xl border-2 border-brand-dark bg-brand-yellow flex items-center justify-center shadow-[3px_3px_0px_0px_#1A1A1A] shrink-0">
          <Music2 className="w-5 h-5 text-brand-dark" />
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-purple mb-1">Session soundtrack</p>
          <p className="font-black text-lg leading-tight">Choose one track for the lobby and one track for gameplay.</p>
        </div>
      </div>

      <div className={`grid gap-4 ${compact ? 'grid-cols-1' : 'grid-cols-1 xl:grid-cols-2'}`}>
        <SoundtrackSelect label="Lobby Music" value={lobbyTrackId} onChange={onLobbyTrackChange} />
        <SoundtrackSelect label="Game Music" value={gameplayTrackId} onChange={onGameplayTrackChange} />
      </div>
    </div>
  );
}
