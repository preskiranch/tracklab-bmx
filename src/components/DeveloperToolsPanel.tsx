import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Box,
  ExternalLink,
  Flag,
  MapPinned,
  Pencil,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { readMap3DUsage, type Map3DLoadContext, type Map3DUsage } from '../lib/map3dUsage';

const contextDetails: Record<Map3DLoadContext, { label: string; icon: typeof MapPinned }> = {
  view: { label: 'Track viewing', icon: MapPinned },
  edit: { label: 'Track editing', icon: Pencil },
  race: { label: '3D racing', icon: Flag },
};

function number(value: number) {
  return new Intl.NumberFormat().format(value);
}

function dateTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Unavailable';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function monthLabel(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Current month';
  }

  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(parsed);
}

export function DeveloperToolsPanel() {
  const [usage, setUsage] = useState<Map3DUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsage(await readMap3DUsage());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '3D usage could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const contextCounts = useMemo(() => {
    const counts = new Map<Map3DLoadContext, number>();
    usage?.byContext.forEach((item) => counts.set(item.context, item.count));
    return (Object.keys(contextDetails) as Map3DLoadContext[]).map((context) => ({
      context,
      count: counts.get(context) ?? 0,
      ...contextDetails[context],
    }));
  }, [usage]);

  const maxDailyCount = Math.max(1, ...((usage?.daily ?? []).map((item) => item.count)));
  const usageLevel = (usage?.thisMonth.percentUsed ?? 0) >= 90
    ? 'critical'
    : (usage?.thisMonth.percentUsed ?? 0) >= 75
      ? 'warning'
      : 'normal';

  return (
    <main className="developer-tools" aria-labelledby="developer-tools-title">
      <header className="developer-tools-header">
        <div>
          <span className="eyebrow">Platform operations</span>
          <h1 id="developer-tools-title">Developer Tools</h1>
          <p>Private operational visibility for TrackLab BMX.</p>
        </div>
        <div className="developer-tools-actions">
          <span className="developer-admin-badge"><ShieldCheck size={15} /> Administrator only</span>
          <button type="button" onClick={() => void loadUsage()} disabled={loading}>
            <RefreshCw className={loading ? 'spinning' : ''} size={16} />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
      </header>

      {error ? (
        <section className="developer-error" role="alert">
          <strong>Usage data unavailable</strong>
          <span>{error}</span>
          <button type="button" onClick={() => void loadUsage()}>Try again</button>
        </section>
      ) : null}

      <section className="developer-usage-band" aria-busy={loading}>
        <div className="developer-usage-summary">
          <span className="eyebrow">Photorealistic 3D scenes</span>
          <strong>{usage ? number(usage.thisMonth.count) : '--'}</strong>
          <span>loads in {usage ? monthLabel(usage.thisMonth.startsAt) : 'the current month'}</span>
        </div>
        <div className="developer-usage-meter">
          <div className="developer-usage-meter-label">
            <span>{usage ? `${number(usage.thisMonth.remaining)} remaining` : 'Loading allowance'}</span>
            <strong>{usage ? `${usage.thisMonth.percentUsed.toFixed(1)}%` : '--'}</strong>
          </div>
          <div className={`developer-usage-progress ${usageLevel}`}>
            <span style={{ width: `${usage?.thisMonth.percentUsed ?? 0}%` }} />
          </div>
          <small>
            Monthly monitoring allowance: {usage ? number(usage.monthlyAllowance) : '--'} scene loads
          </small>
        </div>
        <div className="developer-usage-stat">
          <span>Today</span>
          <strong>{usage ? number(usage.today) : '--'}</strong>
        </div>
        <div className="developer-usage-stat">
          <span>Lifetime</span>
          <strong>{usage ? number(usage.lifetime) : '--'}</strong>
        </div>
      </section>

      <div className="developer-tools-grid">
        <section className="developer-section">
          <div className="developer-section-heading">
            <div>
              <span className="eyebrow">Load context</span>
              <h2>Where 3D is opened</h2>
            </div>
            <Box size={19} />
          </div>
          <div className="developer-context-grid">
            {contextCounts.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.context}>
                  <span><Icon size={16} /> {item.label}</span>
                  <strong>{number(item.count)}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="developer-section">
          <div className="developer-section-heading">
            <div>
              <span className="eyebrow">Last 14 days</span>
              <h2>Daily 3D activity</h2>
            </div>
            <Activity size={19} />
          </div>
          {usage?.daily.length ? (
            <div className="developer-daily-chart" aria-label="Daily 3D scene loads">
              {usage.daily.map((item) => (
                <div key={item.date} className="developer-daily-column" title={`${item.date}: ${item.count} loads`}>
                  <strong>{item.count}</strong>
                  <span style={{ height: `${Math.max(6, (item.count / maxDailyCount) * 100)}%` }} />
                  <small>{new Date(`${item.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</small>
                </div>
              ))}
            </div>
          ) : (
            <p className="developer-empty-state">No 3D loads have been recorded in the last 14 days.</p>
          )}
        </section>

        <section className="developer-section developer-top-tracks">
          <div className="developer-section-heading">
            <div>
              <span className="eyebrow">Current month</span>
              <h2>Most opened tracks</h2>
            </div>
            <MapPinned size={19} />
          </div>
          {usage?.topTracks.length ? (
            <div className="developer-track-table">
              <div className="developer-track-table-head"><span>Track</span><span>Loads</span></div>
              {usage.topTracks.map((track, index) => (
                <div key={track.trackId}>
                  <span className="developer-track-rank">{index + 1}</span>
                  <strong>{track.trackName}</strong>
                  <span>{number(track.count)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="developer-empty-state">Track-level activity will appear after the first 3D load.</p>
          )}
        </section>

        <aside className="developer-tools-note">
          <ShieldCheck size={20} />
          <div>
            <strong>How loads are counted</strong>
            <p>
              One event is recorded when a new photorealistic 3D track scene becomes ready. Camera movement,
              route editing, and rider animation inside that scene do not add another event.
            </p>
            <a href="https://developers.google.com/maps/billing-and-pricing/pricing" target="_blank" rel="noreferrer">
              Google Maps pricing and usage <ExternalLink size={14} />
            </a>
            <small>Last updated {usage ? dateTime(usage.generatedAt) : '--'}</small>
          </div>
        </aside>
      </div>
    </main>
  );
}
