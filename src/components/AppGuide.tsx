import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BookOpen, FlaskConical, Search } from 'lucide-react';
import { accountGuideSections, betaGuideSection } from '../lib/appGuideAccount';
import { discoveryGuideSections } from '../lib/appGuideDiscovery';
import { ridingGuideSections } from '../lib/appGuideRiding';
import { familyGuideSection } from '../lib/appGuideFamily';
import type { AppGuideSection } from '../lib/appGuideTypes';
import './AppGuide.css';

type AppGuideProps = {
  beta: boolean;
  billingReady: boolean | null;
  onOpenTracks: () => void;
  onOpenShops: () => void;
  onChangeGuide: () => void;
};

const sectionOrder = ['membership', 'wattbike', 'training', 'explore-world', 'tracks-shops', 'ghosts-results', 'profile-sync', 'family', 'watch-recovery', 'community'];
const featureSections = [...accountGuideSections, ...ridingGuideSections, ...discoveryGuideSections, familyGuideSection]
  .sort((a, b) => sectionOrder.indexOf(a.id) - sectionOrder.indexOf(b.id));
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function AppGuide({ beta, billingReady, onOpenTracks, onOpenShops, onChangeGuide }: AppGuideProps) {
  const [query, setQuery] = useState('');
  const [requestedTopic, setRequestedTopic] = useState<string | null>(null);
  const sections = useMemo(() => beta ? [betaGuideSection, ...featureSections] : [...featureSections, betaGuideSection], [beta]);
  const filtered = useMemo(() => {
    const terms = searchable(query).trim().split(/\s+/).filter(Boolean);
    if (!terms.length) return sections;
    return sections.map((section): AppGuideSection => ({
      ...section,
      articles: section.articles.filter((article) => {
        const haystack = searchable([section.title, section.summary, article.title, ...article.paragraphs, ...article.steps ?? [], ...article.bullets ?? []].join(' '));
        return terms.every((term) => haystack.includes(term));
      }),
    })).filter((section) => section.articles.length);
  }, [query, sections]);

  useEffect(() => {
    if (!requestedTopic) return;
    const heading = document.getElementById(`guide-${requestedTopic}`);
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    setRequestedTopic(null);
  }, [requestedTopic, filtered]);

  function jumpTo(id: string) {
    // Hero shortcuts also work when the requested topic is filtered out.
    if (!filtered.some((section) => section.id === id)) setQuery('');
    setRequestedTopic(id);
  }

  return (
    <section className="app-guide" aria-label={beta ? 'Beta Testing Info guide' : 'App Guide'}>
      <div className="app-guide-intro">
        <span className="app-guide-kicker">{beta ? <FlaskConical size={19} /> : <BookOpen size={19} />}{beta ? 'Your beta field guide' : 'Discover what you can do'}</span>
        <h2>{beta ? 'Test the possibilities.' : 'A world of riding. One place to begin.'}</h2>
        <p>{beta
          ? 'Sign in for beta access, connect your Wattbike, and put TrackLab through its paces. This guide includes the full feature tour, what to test, and how access works after beta.'
          : 'Find a BMX track, discover a nearby bike shop, practice your start, or turn a connected Wattbike session into a ride across the world. Get to know the tools and the account that brings your progress together.'}</p>
        <div className="app-guide-actions">
          <button className="primary-button" type="button" onClick={() => jumpTo(beta ? 'beta-start' : 'wattbike')}>{beta ? 'Start beta testing' : 'Connect and ride'} <ArrowUpRight size={16} /></button>
          <button className="secondary-button" type="button" onClick={onChangeGuide}>{beta ? 'View App Guide' : 'View Beta Testing Info'}</button>
        </div>
      </div>

      <div className="app-guide-access" aria-label="Access at a glance">
        <article><span>01 / Free</span><h3>Discover. Practice. Connect.</h3><p>Browse tracks and bike shops without signing in. A free account adds the Reaction Test, track favorites, a community profile, and Friends.</p></article>
        <article><span>02 / Public beta</span><h3>Bring your Wattbike.</h3><p>While public beta enrollment is open, signed-in testers automatically receive four simultaneous Wattbike connections for a limited period. No purchase or separate beta invitation is required.</p></article>
        <article><span>03 / Outside beta</span><h3>Choose your connections.</h3><p>Racer plans support one to four simultaneous Wattbike connections. When purchasing is available, Apple shows the monthly price and terms before you confirm.</p></article>
      </div>
      <p className="app-guide-availability">Public live multiplayer: <strong>Coming soon.</strong> Eligible solo ride records still upload, and recorded ghost racing remains available with bike access. Authorized club sessions have separate controls.</p>
      {billingReady === false && <p className="app-guide-availability"><strong>Purchase availability:</strong> Apple billing is being configured. Purchase and Restore are currently unavailable; active beta access works without checkout.</p>}

      <div className="app-guide-layout">
        <aside className="app-guide-tools">
          <label className="app-guide-search" htmlFor="guide-search"><span><Search size={16} /> Search this guide</span><input id="guide-search" type="search" placeholder="Try Smart Route, sync, shops…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          {query && <button className="app-guide-clear" type="button" onClick={() => setQuery('')}>Clear search</button>}
          <p className="app-guide-count" role="status">{query ? `${filtered.length} matching ${filtered.length === 1 ? 'topic' : 'topics'}` : `${sections.length} topics to explore`}</p>
          <nav className="app-guide-topics" aria-label="Guide topics">
            {filtered.map((section) => <button type="button" key={section.id} onClick={() => jumpTo(section.id)}>{section.title}</button>)}
          </nav>
          <label className="app-guide-mobile-topics">Jump to a topic<select value="" onChange={(event) => jumpTo(event.target.value)}><option value="" disabled>Choose a topic</option>{filtered.map((section) => <option value={section.id} key={section.id}>{section.title}</option>)}</select></label>
        </aside>
        <div className="app-guide-content">
          {filtered.length === 0 && <div className="app-guide-empty"><h2>No topics match “{query}”</h2><p>Try a shorter phrase, such as “Wattbike,” “destination,” or “profile.”</p><button className="secondary-button" type="button" onClick={() => setQuery('')}>Show all topics</button></div>}
          {filtered.map((section) => <section className="app-guide-section" key={section.id} aria-labelledby={`guide-${section.id}`}>
            <h2 id={`guide-${section.id}`} tabIndex={-1}>{section.title}</h2>
            <p className="app-guide-summary">{section.summary}</p>
            <div className="app-guide-articles">{section.articles.map((article) => <article key={article.title}>
              <h3>{article.title}</h3>
              {article.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {article.steps && <ol>{article.steps.map((step) => <li key={step}>{step}</li>)}</ol>}
              {article.bullets && <ul>{article.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
            </article>)}</div>
            {section.id === 'tracks-shops' && <div className="app-guide-actions"><button className="secondary-button" type="button" onClick={onOpenTracks}>Find BMX tracks <ArrowUpRight size={16} /></button><button className="secondary-button" type="button" onClick={onOpenShops}>Find bike shops <ArrowUpRight size={16} /></button></div>}
          </section>)}
        </div>
      </div>
      <div className="app-guide-help"><h2>A good ride starts with a little help.</h2><p>Open More → Beta Testing in the app to see your invitation access and prepare feedback, or visit Support for account and connection help.</p><a href="/support">TrackLab Support <ArrowUpRight size={16} /></a></div>
    </section>
  );
}
