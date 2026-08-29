import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const exists = (path: string) => existsSync(fileURLToPath(new URL(path, import.meta.url)));

const exploreViewSource = read('../../src/components/ExploreView.tsx');
const exploreMapSource = read('../../src/components/ExploreMapPanel.tsx');
const explore3dMapSource = read('../../src/components/ExploreGoogle3DMapPanel.tsx');
const appSource = read('../../src/App.tsx');

describe('Explore the World iOS map viewport regressions', () => {
  it('migrates every legacy renderer preference, including Apple Satellite, to Google Satellite', () => {
    expect(exploreViewSource).toContain(
      "type ExploreMapRenderer = 'google-satellite' | 'google-3d';",
    );
    expect(exploreViewSource).toContain(
      "const exploreMapRendererStorageKey = 'tracklab-explore-map-renderer-v1';",
    );
    expect(exploreViewSource).toContain("if (saved === 'google-3d') return saved;");
    expect(exploreViewSource).toContain("if (saved && saved !== 'google-satellite') {");
    expect(exploreViewSource).toContain(
      "window.localStorage.setItem(exploreMapRendererStorageKey, 'google-satellite');",
    );
    expect(exploreViewSource).not.toContain("'apple-satellite'");
    expect(exploreViewSource).not.toContain('Apple Satellite');
  });

  it('removes the Apple MapKit renderer, server API, and deployment configuration', () => {
    expect(exists('../../src/components/ExploreAppleMapPanel.tsx')).toBe(false);
    expect(exists('../../src/lib/appleMaps.ts')).toBe(false);
    expect(exploreViewSource).not.toContain('ExploreAppleMapPanel');

    const serverSource = read('../../cloud/server.mjs');
    const renderSource = read('../../render.yaml');
    const envExampleSource = read('../../.env.example');
    for (const source of [serverSource, renderSource, envExampleSource]) {
      expect(source).not.toContain('APPLE_MAPKIT_JS_TOKEN');
      expect(source).not.toContain('/api/admin/apple-map-config');
    }
  });

  it('refreshes Google maps after container, orientation, viewport, and fullscreen changes', () => {
    expect(exploreMapSource).toContain('export function useExploreMapViewportRefresh(');
    expect(exploreMapSource).toContain('new ResizeObserver(scheduleRefresh)');
    expect(exploreMapSource).toContain("window.addEventListener('resize', scheduleRefresh)");
    expect(exploreMapSource).toContain("window.addEventListener('orientationchange', scheduleRefresh)");
    expect(exploreMapSource).toContain(
      "window.visualViewport?.addEventListener('resize', scheduleRefresh)",
    );
    expect(exploreMapSource).toContain(
      "document.addEventListener('fullscreenchange', scheduleRefresh)",
    );
    expect(exploreMapSource).toContain("google.maps.event?.trigger(map, 'resize')");
    expect(explore3dMapSource).toContain('useExploreMapViewportRefresh(containerRef, () => {');

    expect(exploreViewSource).toContain('currentExploreViewportOrientation()');
    expect(exploreViewSource).toContain("window.addEventListener('orientationchange', updateOrientation)");
    expect(exploreViewSource).toContain(
      "window.visualViewport?.addEventListener('resize', updateOrientation)",
    );
    expect(exploreViewSource).toContain("${viewportOrientation}");
  });

  it('keeps the standard Google satellite renderer instead of forcing a WebGL vector canvas', () => {
    expect(exploreMapSource).not.toMatch(/RenderingType\??\.VECTOR/u);
    expect(exploreMapSource).not.toContain('renderingType:');
  });

  it('lets native UIKit own Explore fullscreen while keeping browser fullscreen on the web', () => {
    const exploreFullscreenHandler = appSource.match(
      /const handleExploreFullscreenChange = useCallback\(\(enabled: boolean\) => \{[\s\S]*?\n  \}, \[\]\);/u,
    )?.[0];

    expect(exploreFullscreenHandler).toBeTruthy();
    expect(exploreFullscreenHandler).toContain(
      'if (!isNativeTrackLabShell()) requestBrowserFullscreen(raceShellRef.current);',
    );
    expect(exploreFullscreenHandler).toContain('releaseBrowserFullscreen();');
    expect(exploreFullscreenHandler).not.toMatch(
      /if \(enabled\) \{\s*requestBrowserFullscreen\(raceShellRef\.current\);/u,
    );
  });
});
