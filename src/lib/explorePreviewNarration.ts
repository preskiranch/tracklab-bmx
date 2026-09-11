import type { ExploreRoute } from '../types';

const openings = [
  'Let’s take a look at', 'Here is your introduction to', 'Let’s explore the shape of',
  'Your next route is', 'Take a moment to discover', 'Here is a fresh look at',
  'Let’s get familiar with', 'Today’s preview takes us along', 'The tour ahead follows',
  'Our route preview features', 'Before you ride, explore', 'Let’s trace the journey along',
  'This flyover introduces', 'See what lies ahead on', 'Your planned journey follows',
  'Let’s discover the route called',
];
const closings = [
  'The destination is coming into view.', 'That brings our tour toward its destination.',
  'We are approaching the end of this preview.', 'That is the journey from start to finish.',
  'You have now seen the shape of the route.', 'The overview is nearly complete.',
  'This is the final part of our route tour.', 'Our flyover is drawing to a close.',
  'The last stretch completes the route.', 'That rounds out this look at your journey.',
  'Our preview has reached the final stretch.', 'We are wrapping up this route overview.',
  'This completes our introduction to the route.', 'The route tour is nearing its finish.',
  'We have traced the journey to its endpoint.', 'That is your route at a glance.',
];
export const previewNarrationVariationCount = openings.length * closings.length;

export function previewNarrationLines(route: ExploreRoute, variant: number, metric: boolean): string[] {
  const index = ((variant % previewNarrationVariationCount) + previewNarrationVariationCount) % previewNarrationVariationCount;
  const distance = metric ? route.distanceMeters / 1000 : route.distanceMeters / 1609.344;
  const shortLabel = (label: string) => label.split(',').slice(0, 2).join(',').slice(0, 100);
  const origin = shortLabel(route.originLabel);
  const destination = shortLabel(route.destinationLabel);
  const name = route.name?.trim().slice(0, 100) || `${origin} to ${destination}`;
  const waypoint = route.waypoints?.filter(point => point.label.trim())[index % Math.max(1, route.waypoints?.length ?? 0)];
  const landmark = waypoint ? ` A planned stop is ${shortLabel(waypoint.label)}.` : '';
  const elevation = Number.isFinite(route.elevationGainMeters)
    ? ` The recorded elevation profile includes ${Math.round((route.elevationGainMeters ?? 0) * (metric ? 1 : 3.28084))} ${metric ? 'meters' : 'feet'} of climbing.` : '';
  return [
    `${openings[index % openings.length]} ${name}. This route covers ${distance.toFixed(1)} ${metric ? 'kilometers' : 'miles'}.`,
    `The route starts at ${origin} and ends at ${destination}.${landmark}${elevation}`,
    `${closings[Math.floor(index / openings.length)]} You can replay the preview, adjust your zoom, or start your ride when you are ready.`,
  ];
}

// A shuffled cycle avoids repeating any complete tour for 256 previews on this device.
export function nextPreviewNarrationVariant(routeId: string): number {
  const key = `tracklab-preview-narration-v1:${routeId}`;
  let step = Math.floor(Math.random() * previewNarrationVariationCount);
  try {
    const previous = localStorage.getItem(key);
    if (previous !== null && Number.isFinite(Number(previous))) step = (Number(previous) + 1) % previewNarrationVariationCount;
    localStorage.setItem(key, String(step));
  } catch { /* Narration still works when storage is unavailable. */ }
  return (step * 73) % previewNarrationVariationCount;
}
