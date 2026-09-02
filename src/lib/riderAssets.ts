import type { PlayerSlot } from '../types';

// These square rig frames include transparent safety margins around the full
// rider and both wheels. Keep every map renderer on the same sources so a
// fallback path cannot reintroduce one of the legacy edge-cropped sprites.
export const riderRigBaseAssetByColor = {
  lime: '/assets/rider-lime-rig-base.png',
  red: '/assets/rider-red-rig-base.png',
  blue: '/assets/rider-blue-rig-base.png',
  yellow: '/assets/rider-yellow-rig-base.png',
} satisfies Record<PlayerSlot['colorName'], string>;

// Google Maps' synchronous marker fallback cannot apply a CSS/canvas filter.
// Keep a prefiltered Evergreen frame so the initial and load-error paths match
// the rendered Player 1 model instead of briefly reverting to neon lime.
export const riderFallbackRigBaseAssetByColor = {
  ...riderRigBaseAssetByColor,
  lime: '/assets/rider-evergreen-rig-base.png',
} satisfies Record<PlayerSlot['colorName'], string>;
