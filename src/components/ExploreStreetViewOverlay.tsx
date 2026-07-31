import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  createGoogleStreetViewSession,
  type GoogleLandmarkDetails,
  type GoogleStreetViewSession,
} from '../lib/googleMaps';

type ExploreStreetViewOverlayProps = {
  landmark: GoogleLandmarkDetails;
  onClose: () => void;
};

export function ExploreStreetViewOverlay({
  landmark,
  onClose,
}: ExploreStreetViewOverlayProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const [session, setSession] = useState<GoogleStreetViewSession | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const element = canvasRef.current;
    if (!element || !landmark.point) {
      setError('Google did not provide a location for this landmark.');
      setStatus('error');
      return undefined;
    }

    let cancelled = false;
    let activeSession: GoogleStreetViewSession | null = null;
    setError('');
    setSession(null);
    setStatus('loading');
    createGoogleStreetViewSession(element, landmark.point)
      .then((nextSession) => {
        if (cancelled) {
          nextSession.destroy();
          return;
        }
        activeSession = nextSession;
        setSession(nextSession);
        setStatus('ready');
      })
      .catch((nextError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(nextError instanceof Error
          ? nextError.message
          : 'Street View could not be opened for this landmark.');
        setStatus('error');
      });

    return () => {
      cancelled = true;
      activeSession?.destroy();
    };
  }, [attempt, landmark.placeId, landmark.point]);

  return (
    <section
      className="explore-street-view-overlay"
      role="dialog"
      aria-label={`Street View: ${landmark.name}`}
      aria-modal="true"
    >
      <div className="explore-street-view-canvas" ref={canvasRef} />
      <header>
        <button type="button" onClick={onClose}>
          <ArrowLeft size={19} /> Back to map
        </button>
        <div>
          <span>Google Street View</span>
          <strong>{landmark.name}</strong>
          <small>Your Explore the World ride continues in the background.</small>
        </div>
      </header>
      {status === 'loading' && (
        <div className="explore-street-view-status" aria-live="polite">
          <span className="explore-landmark-spinner" aria-hidden="true" />
          <strong>Finding the best nearby Street View…</strong>
        </div>
      )}
      {status === 'error' && (
        <div className="explore-street-view-status error" role="alert">
          <strong>Street View is not available here</strong>
          <p>{error}</p>
          <div>
            <button type="button" onClick={onClose}>
              <ArrowLeft size={17} /> Back to map
            </button>
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              <RotateCcw size={17} /> Try again
            </button>
          </div>
        </div>
      )}
      {status === 'ready' && (
        <footer>
          <strong>{session?.description || landmark.name}</strong>
          <span>
            {[session?.imageDate && `Imagery ${session.imageDate}`, session?.copyright]
              .filter(Boolean)
              .join(' · ') || 'Street View imagery provided by Google'}
          </span>
        </footer>
      )}
    </section>
  );
}
