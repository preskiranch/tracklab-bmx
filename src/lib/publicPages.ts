export type PublicPageKind = 'privacy' | 'support';

const publicPageByPath = new Map<string, PublicPageKind>([
  ['/privacy', 'privacy'],
  ['/privacy-policy', 'privacy'],
  ['/support', 'support'],
]);

export function resolvePublicPage(pathname: string): PublicPageKind | null {
  const normalized = `/${String(pathname || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLocaleLowerCase()}`;

  return publicPageByPath.get(normalized) ?? null;
}
