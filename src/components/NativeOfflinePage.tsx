import { useState } from 'react';
import './NativeOfflinePage.css';

export function NativeOfflinePage({ retry }: { retry: () => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  return (
    <main className="native-offline-page">
      <div aria-hidden="true" className="native-offline-mark">TL</div>
      <h1>TrackLab is temporarily offline</h1>
      <p>
        This app is installed on your device, and your saved training data is safe.
        Check this tablet’s internet connection, then try again.
      </p>
      {message && <p role="alert">{message}</p>}
      <button
        disabled={checking}
        onClick={() => {
          setChecking(true);
          setMessage('');
          void retry()
            .catch(() => setMessage('TrackLab is still offline. Check Wi-Fi and try again.'))
            .finally(() => setChecking(false));
        }}
        type="button"
      >
        {checking ? 'Checking…' : 'Try Again'}
      </button>
    </main>
  );
}
