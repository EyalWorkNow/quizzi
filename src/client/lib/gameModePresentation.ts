import type { GameModeId } from '../../shared/gameModes.ts';

export function getGameModeTone(gameModeId: GameModeId | string | null | undefined) {
  switch (gameModeId) {
    case 'speed_sprint':
      return {
        pill: 'bg-brand-orange text-white',
        panel: 'bg-brand-orange text-white',
        accent: 'text-brand-orange',
      };
    case 'confidence_climb':
      return {
        pill: 'bg-brand-purple text-white',
        panel: 'bg-brand-purple text-white',
        accent: 'text-brand-purple',
      };
    case 'peer_pods':
      return {
        pill: 'bg-brand-yellow text-brand-dark',
        panel: 'bg-brand-yellow text-brand-dark',
        accent: 'text-brand-orange',
      };
    case 'team_relay':
      return {
        pill: 'bg-brand-dark text-brand-yellow',
        panel: 'bg-brand-dark text-white',
        accent: 'text-brand-yellow',
      };
    case 'mastery_matrix':
      return {
        pill: 'bg-emerald-200 text-brand-dark',
        panel: 'bg-emerald-200 text-brand-dark',
        accent: 'text-emerald-700',
      };
    default:
      return {
        pill: 'bg-white text-brand-dark',
        panel: 'bg-white text-brand-dark',
        accent: 'text-brand-purple',
      };
  }
}
