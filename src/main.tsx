import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bootstrapNativeBluetooth } from './lib/nativeBluetoothBootstrap';
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
