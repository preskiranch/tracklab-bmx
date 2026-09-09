import './AdminAnalyticsPanel.css';
import { useEffect, useState } from 'react';
import { readAdminAnalytics, type AdminAnalytics } from '../lib/adminAnalytics';

const n = (value: number) => value.toLocaleString();
const labels: Record<string, string> = { privacy: 'Privacy information', support: 'Support information', home: 'Home', app: 'Application', tracks: 'Track directory', shops: 'Bike shop directory', guide: 'App guide', beta: 'Beta information' };

export function AdminAnalyticsPanel() {
  const [days, setDays] = useState(7);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setData(null);
    readAdminAnalytics(days, controller.signal).then(setData).catch((e: Error) => {
      if (!controller.signal.aborted) setError(e.message);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [days, refresh]);
  const web = data?.traffic.find(row => row.platform === 'web');
  const ios = data?.traffic.find(row => row.platform === 'ios');
  return <section className="admin-overview" aria-labelledby="admin-overview-title">
    <header className="admin-overview-header">
      <div><h1 id="admin-overview-title">Your app at a glance</h1><p>Private administrator dashboard · TrackLab BMX</p></div>
      <div className="admin-overview-actions"><label>Period <select value={days} onChange={e => setDays(Number(e.target.value))}>
        <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
      </select></label><button onClick={() => setRefresh(v => v + 1)} disabled={loading}>Refresh</button></div>
    </header>
    {loading && <p role="status">Loading your dashboard…</p>}
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p className="admin-overview-note">Updated {new Date(data.generatedAt).toLocaleString()}. Date boundaries use UTC. Account and family totals are all-time; new accounts and usage follow the selected period.</p>
      <div className="admin-stat-grid">
        <Stat title="Total accounts" value={data.accounts.total} detail={`${n(data.accounts.verified)} email verified`} />
        <Stat title="New accounts" value={data.accounts.new} detail="Created in this period" />
        <Stat title="Website sessions" value={web?.visits ?? 0} detail={`${n(web?.views ?? 0)} screen views`} />
        <Stat title="iOS app sessions" value={ios?.visits ?? 0} detail={`${n(ios?.views ?? 0)} screen views`} />
        <Stat title="Recently online" value={(web?.online ?? 0) + (ios?.online ?? 0)} detail="Sessions seen within 5 minutes" />
        <Stat title="Parent / family accounts" value={data.family.parents} detail={`${n(data.family.children)} managed child profiles · ${n(data.family.linked)} linked profiles`} />
      </div>
      <div className="admin-detail-grid">
        <section className="admin-detail-card"><h2>Wattbike connections</h2>
          {data.wattbikes?.length ? <div className="admin-active-counts">{data.wattbikes.map(row => <Stat key={row.platform} title={row.platform === 'ios' ? 'iOS connections' : 'Website connections'} value={row.connections} detail={`${n(row.connectedSessions)} connected sessions / ${n(row.reporting)} reporting sessions`} />)}</div> : <p>No recent connection reports available.</p>}
          <p>Latest reported connected bikes from sessions seen within 5 minutes. Counts update on Refresh; this is not an instantaneous live count. Demo bikes and administrator sessions are excluded. Older app builds do not report connections. No bike identifiers or power measurements are collected here.</p>
        </section>
        <section className="admin-detail-card"><h2>Active signed-in accounts</h2>
          <div className="admin-active-counts"><Stat title="Today" value={data.active.daily}/><Stat title="7 days" value={data.active.weekly}/><Stat title="30 days" value={data.active.monthly}/></div>
          <p>Distinct account logins seen using the app. Child-only devices and anonymous visitors are not counted as separate account logins.</p>
        </section>
        <section className="admin-detail-card"><h2>Traffic by day</h2>
          {data.daily.length ? <div className="admin-traffic-days">{data.daily.map(row => <div key={row.day} className="admin-traffic-row"><span>{row.day.slice(5)}</span><meter min={0} max={Math.max(1, ...data.daily.map(r => r.visits))} value={row.visits} aria-label={`${row.day}: ${row.visits} sessions`} /><strong>{n(row.visits)}</strong></div>)}</div> : <p>No traffic recorded for this period yet.</p>}
          <p>Sessions across web and iOS. Daily counts can include the same session on multiple days.</p>
        </section>
        <section className="admin-detail-card"><h2>Popular screens</h2><SimpleRows rows={data.pages.map(row => [labels[row.page] ?? row.page, row.views])} empty="No screen views recorded yet." unit="Views" /></section>
        <section className="admin-detail-card"><h2>Saved activity</h2><SimpleRows rows={data.activity.map(row => [row.activity.replaceAll('-', ' ').replaceAll('_', ' '), row.sessions])} empty="No saved training sessions in this period." unit="Sessions" />
          <p><strong>{n(data.reactions)} reaction attempts</strong> submitted in this period.</p>
          <p>Saved training sessions exclude demo data. Reaction attempts are counted separately; unsaved activity is not included.</p>
        </section>
        <section className="admin-detail-card"><h2>Requested tracks</h2><SimpleRows rows={data.requests.map(row => [row.track_id.replaceAll('-', ' '), row.requests])} empty="No new mapping requests in this period." unit="Requests" /><p>Top 10 requests for future track mapping.</p></section>
        <section className="admin-detail-card"><h2>Feedback & operations</h2><p>Review tester feedback in TestFlight and your support email inbox. Those external messages are not included in these counts.</p><a href="https://appstoreconnect.apple.com/" target="_blank" rel="noreferrer">Open App Store Connect ↗</a><p>Use the 3D usage tab to review map loads and your remaining allowance.</p></section>
      </div>
      <p className="admin-overview-note">Traffic tracking started {data.trackingSince ? new Date(data.trackingSince).toLocaleDateString() : 'with this update'}. Earlier visits cannot be reconstructed. Sessions are browser tabs or app sessions, not unique people. Privacy settings, older app builds and blocked requests can reduce counts. Signed-in administrator traffic is excluded. This dashboard covers TrackLab BMX; Preski Labs marketing traffic is not included.</p>
    </>}
  </section>;
}
function Stat({ title, value, detail }: { title: string; value: number; detail?: string }) {
  return <div className="admin-stat"><span>{title}</span><strong>{n(value)}</strong>{detail && <small>{detail}</small>}</div>;
}
function SimpleRows({ rows, empty, unit }: { rows: [string, number][]; empty: string; unit: string }) {
  return rows.length ? <table className="admin-simple-table"><thead><tr><th scope="col">Name</th><th scope="col">{unit}</th></tr></thead><tbody>{rows.map(([label, value]) => <tr key={label}><th scope="row">{label}</th><td>{n(value)}</td></tr>)}</tbody></table> : <p>{empty}</p>;
}
