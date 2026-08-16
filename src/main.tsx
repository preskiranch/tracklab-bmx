import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { resolvePublicPage } from './lib/publicPages';
import './styles.css';

const NATIVE_BLUETOOTH_ERROR_KEY = 'tracklab.native.bluetooth.error';

function isNativeTrackLabShell() {
  const capacitor = (window as Window & {
    Capacitor?: { isNativePlatform?: () => boolean };
  }).Capacitor;

  return navigator.userAgent.includes('TrackLabBMX-iOS')
    || capacitor?.isNativePlatform?.() === true;
}

function reportNativeBluetoothFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('TrackLab native Bluetooth failed to initialize.', error);

  try {
    window.sessionStorage.setItem(NATIVE_BLUETOOTH_ERROR_KEY, message);
  } catch {
    // Diagnostics must never prevent the dashboard from loading.
  }

  window.dispatchEvent(new CustomEvent('tracklab:native-bluetooth-error', {
    detail: { message },
  }));
}

function clearNativeBluetoothFailure() {
  try {
    window.sessionStorage.removeItem(NATIVE_BLUETOOTH_ERROR_KEY);
  } catch {
    // Storage diagnostics are optional in restricted WebViews.
  }
}

async function bootstrap() {
  const publicPage = resolvePublicPage(window.location.pathname);
  let pageContent = <App />;

  if (publicPage) {
    const { PublicInfoPage } = await import('./components/PublicInfoPage');
    pageContent = <PublicInfoPage page={publicPage} />;
  }

  if (!publicPage && isNativeTrackLabShell()) {
    try {
      const { installCapacitorBluetoothBridge } = await import('./lib/capacitorBluetoothBridge');
      const installed = await installCapacitorBluetoothBridge();
      if (!installed) {
        throw new Error('The native Bluetooth bridge is not available in this app shell.');
      }
      clearNativeBluetoothFailure();
    } catch (error) {
      reportNativeBluetoothFailure(error);
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {pageContent}
    </StrictMode>,
  );
}

void bootstrap();
