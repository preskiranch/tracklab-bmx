import type { PlayerColorName } from '../types';

export const EVERGREEN_RIDER_ACCENT = '#178f4d';
export const EVERGREEN_RIDER_FILTER = 'saturate(1.35) brightness(0.64) contrast(1.08)';

const defaultAccentByColor: Record<PlayerColorName, string> = {
  lime: EVERGREEN_RIDER_ACCENT,
  blue: '#39a8ff',
  red: '#ff4d42',
  yellow: '#ffd83d',
};

export function canonicalPlayerAccent(colorName: PlayerColorName, accent?: string | null) {
  if (colorName === 'lime') return EVERGREEN_RIDER_ACCENT;
  const normalized = typeof accent === 'string' ? accent.trim() : '';
  return /^#[0-9a-f]{3,8}$/i.test(normalized) ? normalized : defaultAccentByColor[colorName];
}
