import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapNativeBluetooth } from './lib/nativeBluetoothBootstrap';
import { restoreNativeClubTabletCredential } from './lib/nativeClubTabletCredential';
import { loadNativeRuntimeConfig } from './lib/nativeRuntimeConfig';
import { resolvePublicPage } from './lib/publicPages';
import { isTrackLabNativeShell } from './lib/serviceOrigins';
import { installTrackLabServiceTransport } from './lib/serviceTransport';
import './styles.css';

async function bootstrap() {
  installTrackLabServiceTransport();
  if (isTrackLabNativeShell()) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    const online = await fetch('/api/health', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    }).then((response) => response.ok).catch(() => false).finally(() => window.clearTimeout(timeout));
    if (!online) {
      const { NativeOfflinePage } = await import('./components/NativeOfflinePage');
      createRoot(document.getElementById('root')!).render(
        <StrictMode>
          <NativeOfflinePage retry={async () => {
            const response = await fetch('/api/health', { cache: 'no-store' });
            if (!response.ok) throw new Error('TrackLab is still offline.');
            window.location.reload();
          }} />
        </StrictMode>,
      );
      return;
    }
    // The signed native bundle cannot receive Vite environment variables at
    // runtime. Load its public client configuration before App imports any map
    // modules; an unavailable config must not prevent the rest of TrackLab from
    // opening.
    await loadNativeRuntimeConfig({ native: true });
    // Club Tablet authorization is device identity, not account identity.
    // Restore its device-only Keychain record before App synchronously chooses
    // its initial kiosk mode. This also migrates the first bundled-native
    // build's capacitor-origin localStorage credential.
    await restoreNativeClubTabletCredential();
  }
  const publicPage = resolvePublicPage(window.location.pathname);
  let pageContent;

  if (publicPage) {
    const { PublicInfoPage } = await import('./components/PublicInfoPage');
    pageContent = <PublicInfoPage page={publicPage} />;
  } else {
    // The native bridge must exist before App renders and reads
    // navigator.bluetooth for its initial connection state.
    await bootstrapNativeBluetooth();
    const { default: App } = await import('./App');
    pageContent = <App />;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {pageContent}
    </StrictMode>,
  );
}

void bootstrap();
