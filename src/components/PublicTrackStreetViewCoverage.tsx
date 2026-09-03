import { ArrowLeft, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  createGoogleStreetViewCoverageSession,
  createGoogleStreetViewSession,
  type GoogleStreetViewCoverageSession,
  type GoogleStreetViewSession,
} from '../lib/googleMaps';

type PublicTrackStreetViewCoverageProps = {
  center: { lat: number; lng: number };
  onBackTo3D: () => void;
};

export function PublicTrackStreetViewCoverage({
  center,
  onBackTo3D,
}: PublicTrackStreetViewCoverageProps) {
  const coverageCanvasRef = useRef<HTMLDivElement | null>(null);
  const panoramaCanvasRef = useRef<HTMLDivElement | null>(null);
  const [coverageAttempt, setCoverageAttempt] = useState(0);
  const [coverageError, setCoverageError] = useState('');
  const [coverageStatus, setCoverageStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [panoramaAttempt, setPanoramaAttempt] = useState(0);
  const [panoramaError, setPanoramaError] = useState('');
  const [panoramaPoint, setPanoramaPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [panoramaSession, setPanoramaSession] = useState<GoogleStreetViewSession | null>(null);
  const [panoramaStatus, setPanoramaStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const element = coverageCanvasRef.current;
    if (!element) return undefined;
    let cancelled = false;
    let session: GoogleStreetViewCoverageSession | null = null;
    setCoverageError('');
    setCoverageStatus('loading');
    createGoogleStreetViewCoverageSession(element, center, (point) => setPanoramaPoint(point))
      .then((nextSession) => {
        if (cancelled) {
          nextSession.destroy();
          return;
        }
        session = nextSession;
        setCoverageStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setCoverageError(error instanceof Error ? error.message : 'Street View coverage could not be loaded.');
        setCoverageStatus('error');
      });
    return () => {
      cancelled = true;
      session?.destroy();
    };
  }, [center.lat, center.lng, coverageAttempt]);

  useEffect(() => {
    const element = panoramaCanvasRef.current;
    if (!element || !panoramaPoint) return undefined;
    let cancelled = false;
    let session: GoogleStreetViewSession | null = null;
    setPanoramaError('');
    setPanoramaSession(null);
    setPanoramaStatus('loading');
    createGoogleStreetViewSession(element, panoramaPoint)
      .then((nextSession) => {
        if (cancelled) {
          nextSession.destroy();
          return;
        }
        session = nextSession;
        setPanoramaSession(nextSession);
        setPanoramaStatus('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPanoramaError(error instanceof Error ? error.message : 'Street View could not be opened here.');
        setPanoramaStatus('error');
      });
    return () => {
      cancelled = true;
      session?.destroy();
    };
  }, [panoramaAttempt, panoramaPoint]);

  return (
    <section className="public-track-street-view" aria-label="Street View coverage in the current map area">
      <div className="public-track-street-view__coverage" ref={coverageCanvasRef} />
      {coverageStatus === 'loading' && (
        <div className="public-track-street-view__status" role="status">
          <strong>Loading Street View coverage…</strong>
          <span>Blue roads will show where Google Street View imagery is available.</span>
        </div>
      )}
      {coverageStatus === 'error' && (
        <div className="public-track-street-view__status error" role="alert">
          <strong>Street View coverage is unavailable</strong>
          <span>{coverageError}</span>
          <div>
            <button type="button" onClick={onBackTo3D}><ArrowLeft size={17} /> Back to 3D</button>
            <button type="button" onClick={() => setCoverageAttempt((value) => value + 1)}><RotateCcw size={17} /> Try again</button>
          </div>
        </div>
      )}

      {panoramaPoint && (
        <section className="public-track-street-view__panorama" aria-label="Street View in the selected map area">
          <div ref={panoramaCanvasRef} />
          <header>
            <button type="button" onClick={() => setPanoramaPoint(null)}>
              <ArrowLeft size={18} /> Back to blue roads
            </button>
            <span><strong>Google Street View</strong><small>{panoramaSession?.description || 'Selected map area'}</small></span>
          </header>
          {panoramaStatus === 'loading' && (
            <div className="public-track-street-view__status" role="status">
              <strong>Opening Street View…</strong>
            </div>
          )}
          {panoramaStatus === 'error' && (
            <div className="public-track-street-view__status error" role="alert">
              <strong>No Street View imagery was found here</strong>
              <span>{panoramaError}</span>
              <div>
                <button type="button" onClick={() => setPanoramaPoint(null)}><ArrowLeft size={17} /> Back to blue roads</button>
                <button type="button" onClick={() => setPanoramaAttempt((value) => value + 1)}><RotateCcw size={17} /> Try again</button>
              </div>
            </div>
          )}
          {panoramaStatus === 'ready' && (
            <footer>
              {[panoramaSession?.imageDate && `Imagery ${panoramaSession.imageDate}`, panoramaSession?.copyright]
                .filter(Boolean)
                .join(' · ') || 'Street View imagery provided by Google'}
            </footer>
          )}
        </section>
      )}
    </section>
  );
}
