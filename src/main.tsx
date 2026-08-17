import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { bootstrapNativeBluetooth } from './lib/nativeBluetoothBootstrap';
import { resolvePublicPage } from './lib/publicPages';
import './styles.css';

async function bootstrap() {
  const publicPage = resolvePublicPage(window.location.pathname);
  let pageContent;

  if (publicPage) {
    const { PublicInfoPage } = await import('./components/PublicInfoPage');
    pageContent = <PublicInfoPage page={publicPage} />;
  } else {
    // The native bridge must exist before App renders and reads
    // navigator.bluetooth for its initial connection state.
    await bootstrapNativeBluetooth();
    pageContent = <App />;
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      {pageContent}
    </StrictMode>,
  );
}

void bootstrap();
