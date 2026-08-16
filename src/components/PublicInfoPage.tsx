import { useEffect, type ReactNode } from 'react';
import {
  Bike,
  Bluetooth,
  Database,
  Download,
  ExternalLink,
  Globe2,
  LifeBuoy,
  LockKeyhole,
  Mail,
  MapPinned,
  Mic2,
  Radio,
  ShieldCheck,
  Smartphone,
  UserRound,
  Wifi,
} from 'lucide-react';
import type { PublicPageKind } from '../lib/publicPages';
import './PublicInfoPage.css';

type PublicInfoPageProps = {
  page: PublicPageKind;
};

const supportEmail = 'preskiranch@gmail.com';

const pageMetadata: Record<PublicPageKind, { description: string; title: string }> = {
  privacy: {
    title: 'Privacy | TrackLab BMX',
    description: 'How TrackLab BMX handles account, Wattbike, training, map, multiplayer, and app data.',
  },
  support: {
    title: 'Support | TrackLab BMX',
    description: 'Setup and troubleshooting help for the TrackLab BMX web, iPhone, and iPad experience.',
  },
};

function BrandHeader({ page }: { page: PublicPageKind }) {
  return (
    <header className="public-info-header">
      <a className="public-info-brand" href="/" aria-label="TrackLab BMX home">
        <span className="public-info-brand-mark"><Radio aria-hidden="true" size={22} /></span>
        <span>
          <strong>TrackLab BMX</strong>
          <small>Wattbike training and racing</small>
        </span>
      </a>
      <nav aria-label="Public pages">
        <a className={page === 'support' ? 'active' : ''} href="/support">Support</a>
        <a className={page === 'privacy' ? 'active' : ''} href="/privacy">Privacy</a>
        <a className="public-info-open-app" href="/">Open TrackLab</a>
      </nav>
    </header>
  );
}

function PageFooter() {
  return (
    <footer className="public-info-footer">
      <div>
        <strong>TrackLab BMX</strong>
        <span>Connected BMX training with up to four Wattbikes.</span>
      </div>
      <nav aria-label="Footer links">
        <a href="/support">Support</a>
        <a href="/privacy">Privacy</a>
        <a href="https://github.com/preskiranch/tracklab-bmx" rel="noreferrer" target="_blank">
          GitHub <ExternalLink aria-hidden="true" size={13} />
        </a>
      </nav>
    </footer>
  );
}

function SummaryCard({
  children,
  icon,
  title,
}: {
  children: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <article>
      {icon}
      <strong>{title}</strong>
      <span>{children}</span>
    </article>
  );
}

function PrivacyPage() {
  return (
    <>
      <section className="public-info-hero privacy">
        <span className="public-info-kicker"><ShieldCheck aria-hidden="true" size={17} /> Privacy</span>
        <h1>How TrackLab handles your data</h1>
        <p>
          This notice describes the current TrackLab BMX web and iPhone/iPad app behavior. TrackLab combines
          Wattbike telemetry, mapped tracks, training history, multiplayer rooms, and optional AI commentary.
        </p>
        <span className="public-info-updated">Last updated August 15, 2026</span>
      </section>

      <section className="public-info-summary" aria-label="Privacy summary">
        <SummaryCard icon={<LockKeyhole aria-hidden="true" />} title="Your controls">
          Photos, location, microphone, commentary, and ghost analytics have feature-level choices.
        </SummaryCard>
        <SummaryCard icon={<Database aria-hidden="true" />} title="Account sync">
          Signed-in profiles and training records are stored so they remain available across devices.
        </SummaryCard>
        <SummaryCard icon={<Download aria-hidden="true" />} title="Portable sessions">
          Saved training sessions can be downloaded from TrackLab in JSON or CSV format.
        </SummaryCard>
      </section>

      <div className="public-info-content">
        <aside className="public-info-toc" aria-label="On this page">
          <strong>On this page</strong>
          <a href="#privacy-data">Data TrackLab handles</a>
          <a href="#privacy-use">How data is used</a>
          <a href="#privacy-sharing">When data is shared</a>
          <a href="#privacy-controls">Your controls</a>
          <a href="#privacy-storage">Storage and security</a>
          <a href="#privacy-age">Club and youth use</a>
          <a href="#privacy-contact">Contact</a>
        </aside>

        <div className="public-info-article">
          <section id="privacy-data">
            <span className="public-info-section-icon"><UserRound aria-hidden="true" /></span>
            <div>
              <h2>Data TrackLab handles</h2>
              <h3>Account and profile information</h3>
              <p>
                Account records include your name, email address, password credential, membership level, and sign-in
                session. Passwords are stored by the TrackLab server as salted password hashes, not as readable
                passwords. You may add a rider photo. Studio and Club Connect features can also store rider names,
                nicknames, photos, club relationships, and invite status.
              </p>

              <h3>Wattbike and training information</h3>
              <p>
                TrackLab processes nearby Wattbike identifiers and names, saved bike assignments, connection state,
                and available measurements such as cadence, power, speed, and battery information. During a session,
                it can derive rollout distance, timing, reaction, splits, race position, pedal-zone results, finish
                order, personal records, ghost replays, and training history. Straight Sprint settings and Explore
                distance, duration, grade, and elevation can also be included in saved sessions.
              </p>

              <h3>Maps, routes, and location</h3>
              <p>
                TrackLab stores selected tracks, custom routes, mapped ride lines, split routes, pedal zones, camera
                preferences, and recent Explore routes. If you tap <em>Use my current location</em>, the app requests
                a one-time device location to choose the route origin. Explore progress is driven by bike input rather
                than continuous device GPS. Developer-published track mappings and custom mapped tracks are designed
                to be visible to other TrackLab users.
              </p>

              <h3>Rooms, messages, and optional microphone audio</h3>
              <p>
                Multiplayer features handle display names, room membership, invites, challenges, race state, and room
                messages. Voice chat is off by default. If a room racer enables it, TrackLab requests microphone access
                and sends live audio to the other room racers through real-time connections. The current implementation
                processes connection-signaling messages but does not create stored voice recordings.
              </p>

              <h3>Technical information</h3>
              <p>
                TrackLab servers process network information such as IP address, request timing, browser or app
                capabilities, and error or service-health information to deliver the service, enforce rate limits,
                diagnose failures, and protect accounts. Local device or browser storage keeps settings, remembered
                bike identifiers, camera layouts, and short-lived working data.
              </p>
            </div>
          </section>

          <section id="privacy-use">
            <span className="public-info-section-icon"><Bike aria-hidden="true" /></span>
            <div>
              <h2>How data is used</h2>
              <ul>
                <li>Authenticate accounts and synchronize account, club, rider, route, and training data.</li>
                <li>Connect up to four Wattbikes and run BMX races, straight sprints, and Explore rides.</li>
                <li>Create results, leaderboards, records, ghosts, calendar history, and downloadable reports.</li>
                <li>Operate private rooms, room chat, optional voice chat, challenges, and live race state.</li>
                <li>Load maps, resolve route locations, calculate routes and elevation, and show track information.</li>
                <li>Generate optional pre-race and live commentary from current race context.</li>
                <li>Process memberships, prevent misuse, monitor reliability, and troubleshoot the service.</li>
              </ul>
            </div>
          </section>

          <section id="privacy-sharing">
            <span className="public-info-section-icon"><Globe2 aria-hidden="true" /></span>
            <div>
              <h2>When data is shared</h2>
              <ul>
                <li>
                  <strong>Other TrackLab users:</strong> room participants can see rider display names, photos, live
                  positions, and results. Public leaderboards and ghost replays can display rider identity and race
                  performance. Detailed ghost zone analytics are shared only when that option is enabled.
                </li>
                <li>
                  <strong>Clubs:</strong> a claimed Club Connect athlete can choose “Training at” a club to associate
                  the saved session with that club. While its owner has Club Live Monitor open, TrackLab also shares
                  the athlete&apos;s selected program, live status, course progress, track or destination, power,
                  cadence, and speed with that owner. This read-only live feed expires automatically after the owner
                  closes the monitor or the athlete leaves club training.
                </li>
                <li>
                  <strong>Google mapping services:</strong> map tiles, places, route endpoints, route geometry,
                  Street View, and elevation requests are handled by the Google mapping services used by the feature.
                </li>
                <li>
                  <strong>OpenAI:</strong> when AI commentary is enabled, limited race context—including supplied
                  rider display names and live race facts—can be sent to generate commentary and speech.
                </li>
                <li>
                  <strong>Square:</strong> paid membership checkout opens Square. Payment details are entered with
                  Square; TrackLab&apos;s current backend stores checkout or order identifiers and membership status,
                  rather than raw payment-card numbers.
                </li>
                <li>
                  <strong>Hosting and database providers:</strong> TrackLab uses hosted application and database
                  infrastructure to deliver and store cloud-backed features.
                </li>
              </ul>
              <p>
                External services process data under their own terms and privacy notices. Opening a landmark website,
                Apple Maps, Google Maps, or another external link takes you to that provider.
              </p>
            </div>
          </section>

          <section id="privacy-controls">
            <span className="public-info-section-icon"><Mic2 aria-hidden="true" /></span>
            <div>
              <h2>Your controls</h2>
              <ul>
                <li>Profile photos are optional and can be replaced from profile or rider controls.</li>
                <li>Current location is requested only after you choose the current-location action.</li>
                <li>Room microphone access starts only after a racer turns voice chat on.</li>
                <li>Race commentary and ambient track sound each have an on/off control.</li>
                <li>Ghost replay analytics have a separate sharing choice.</li>
                <li>Training sessions can be exported as JSON or CSV from the account calendar.</li>
                <li>You can sign out to end the current browser or app session.</li>
              </ul>
              <p>
                The current product does not provide a self-service account-deletion button. Contact support to
                request access, correction, or deletion. TrackLab may need enough information to verify the account
                before acting on a request.
              </p>
            </div>
          </section>

          <section id="privacy-storage">
            <span className="public-info-section-icon"><LockKeyhole aria-hidden="true" /></span>
            <div>
              <h2>Storage, retention, and security</h2>
              <p>
                Signed-in cloud data is stored in TrackLab&apos;s application database. Some preferences and remembered
                device information remain in local browser or app storage. A same-site, HTTP-only session cookie is
                used for web authentication. Production connections use HTTPS, and passwords are processed with a
                salted password-hashing function.
              </p>
              <p>
                TrackLab currently keeps account and training records so they remain available across devices and
                sessions. Temporary records, expired authentication sessions, and local data can have different
                lifetimes. The current product does not expose one automatic retention schedule for every record type;
                contact support for an account-specific deletion request. No internet service or storage method can
                guarantee absolute security.
              </p>
            </div>
          </section>

          <section id="privacy-age">
            <span className="public-info-section-icon"><UserRound aria-hidden="true" /></span>
            <div>
              <h2>Club and youth use</h2>
              <p>
                TrackLab includes studio riders and Club Connect, but the current build does not independently verify
                a rider&apos;s age. When a rider is a minor, the club, studio, parent, or guardian is responsible for using
                the service only with the authorization and supervision required in their location. Do not upload a
                minor&apos;s photo or create a claimed account for a minor without appropriate permission.
              </p>
            </div>
          </section>

          <section id="privacy-contact">
            <span className="public-info-section-icon"><Mail aria-hidden="true" /></span>
            <div>
              <h2>Questions or data requests</h2>
              <p>
                Email <a href={`mailto:${supportEmail}?subject=TrackLab%20BMX%20Privacy`}>{supportEmail}</a> with
                “TrackLab BMX Privacy” in the subject. Include the account email involved, but do not send your
                password, payment-card details, API keys, or Bluetooth credentials.
              </p>
              <p>
                This notice may be updated as TrackLab changes. The date at the top identifies the version currently
                published with the service.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function SupportCard({ children, icon, title }: { children: ReactNode; icon: ReactNode; title: string }) {
  return (
    <section className="public-info-support-card">
      <span className="public-info-card-icon">{icon}</span>
      <div><h2>{title}</h2>{children}</div>
    </section>
  );
}

function SupportPage() {
  return (
    <>
      <section className="public-info-hero support">
        <span className="public-info-kicker"><LifeBuoy aria-hidden="true" size={17} /> Support</span>
        <h1>Get TrackLab ready to ride</h1>
        <p>
          Setup and troubleshooting help for TrackLab BMX on the web, iPhone, and iPad—including Wattbike pairing,
          account sync, maps, race audio, and Club Connect.
        </p>
        <div className="public-info-hero-actions">
          <a className="primary" href={`mailto:${supportEmail}?subject=TrackLab%20BMX%20Support`}>
            <Mail aria-hidden="true" size={16} /> Email support
          </a>
          <a href="/api/health" rel="noreferrer" target="_blank">
            <Wifi aria-hidden="true" size={16} /> Service status
          </a>
        </div>
      </section>

      <section className="public-info-summary support" aria-label="Support overview">
        <SummaryCard icon={<Smartphone aria-hidden="true" />} title="iPhone and iPad">
          The native app adds direct Bluetooth support that iOS web browsers do not provide.
        </SummaryCard>
        <SummaryCard icon={<Bluetooth aria-hidden="true" />} title="Up to four bikes">
          Only connected bikes enter the rider list, and each Wattbike can be assigned to a rider profile.
        </SummaryCard>
        <SummaryCard icon={<Database aria-hidden="true" />} title="One signed-in history">
          Account, club, route, race, sprint, and Explore data sync through the TrackLab service.
        </SummaryCard>
      </section>

      <div className="public-info-support-grid">
        <SupportCard icon={<Bluetooth aria-hidden="true" />} title="Pair a Wattbike">
          <ol>
            <li>Wake the Wattbike monitor and open its normal riding screen.</li>
            <li>In TrackLab, choose Bluetooth and open the pairing list.</li>
            <li>Select the Wattbike PM/device identifier shown by the monitor.</li>
            <li>Allow Bluetooth access when iOS asks, then wait for live cadence or power.</li>
            <li>Repeat inside the same pairing flow for up to four bikes, then assign riders.</li>
          </ol>
          <p>A bike can normally have only one active Bluetooth connection. Close other connected training apps.</p>
        </SupportCard>

        <SupportCard icon={<Smartphone aria-hidden="true" />} title="iPhone and iPad notes">
          <ul>
            <li>Direct pairing is available in the native TrackLab app.</li>
            <li>Chrome and Safari on iOS do not expose Web Bluetooth to websites.</li>
            <li>The current app loads the live TrackLab service, so internet access is required.</li>
            <li>Bluetooth cannot be validated in the iOS Simulator; use a physical device.</li>
            <li>Landscape mode gives the most room for race and Explore overlays.</li>
          </ul>
        </SupportCard>

        <SupportCard icon={<MapPinned aria-hidden="true" />} title="Maps or routes are not loading">
          <ul>
            <li>Confirm the device has internet access, then reopen the affected mode.</li>
            <li>Try Satellite if a photorealistic 3D view is unavailable.</li>
            <li>For Explore, rebuild the route if its provider can no longer resolve it.</li>
            <li>Current location is optional; type a starting place if permission is unavailable.</li>
            <li>If all maps show a provider warning, report the time and track or route name.</li>
          </ul>
        </SupportCard>

        <SupportCard icon={<Mic2 aria-hidden="true" />} title="Commentary, cadence, or room voice">
          <ul>
            <li>Race commentary and ambient track sound have separate toggles.</li>
            <li>TrackLab stays silent if its natural commentary voice is unavailable.</li>
            <li>Room voice is microphone-off by default and is available only to room racers.</li>
            <li>Allow microphone access only when you want live voice chat.</li>
            <li>Check device volume and silent mode when cadence or gate tones cannot be heard.</li>
          </ul>
        </SupportCard>

        <SupportCard icon={<UserRound aria-hidden="true" />} title="Account, profile, and Club Connect">
          <ul>
            <li>Use the same account on each device to load its profile and training calendar.</li>
            <li>Claim a Club Connect invite while signed into the athlete&apos;s own account.</li>
            <li>A claim can add the athlete&apos;s full name, nickname, and profile photo.</li>
            <li>Club-linked sessions can appear for the athlete and connected club owner.</li>
            <li>Session cards provide JSON and CSV downloads.</li>
          </ul>
        </SupportCard>

        <section className="public-info-support-card contact">
          <span className="public-info-card-icon"><Mail aria-hidden="true" /></span>
          <div>
            <h2>Contact support</h2>
            <p>Send a concise description to <a href={`mailto:${supportEmail}`}>{supportEmail}</a>. Include:</p>
            <ul>
              <li>Device model, operating-system version, and browser or TrackLab app.</li>
              <li>The affected TrackLab mode, track or route, and approximate time.</li>
              <li>For pairing only, the last three characters of the Wattbike PM identifier.</li>
            </ul>
            <p className="public-info-warning">
              Never email your password, Apple verification code, payment-card details, API keys, or authentication cookie.
            </p>
          </div>
        </section>
      </div>

      <section className="public-info-faq">
        <span className="public-info-kicker">Quick answers</span>
        <h2>Common questions</h2>
        <details>
          <summary>Why does a saved bike still need permission after reinstalling?</summary>
          <p>iOS controls Bluetooth permissions. A new installation, reset, or permission change can require a fresh selection.</p>
        </details>
        <details>
          <summary>Why is a bike missing from the race?</summary>
          <p>
            Bikes appear only after a live connection. Wake the monitor, close other connected apps, pair again, and
            verify live cadence or power before entering the race.
          </p>
        </details>
        <details>
          <summary>Where are my sessions?</summary>
          <p>
            Open My Profile and choose a day in the training calendar. Verify you are using the same account if a
            second device shows different history.
          </p>
        </details>
        <details>
          <summary>Can the iOS app work offline?</summary>
          <p>
            Not in its current architecture. The native shell loads the live service so account, maps, club, training,
            and multiplayer data stay synchronized.
          </p>
        </details>
      </section>
    </>
  );
}

// LEGAL REVIEW REQUIRED: this documents current product behavior, but
// operator/counsel review is required before App Store production submission.
export function PublicInfoPage({ page }: PublicInfoPageProps) {
  useEffect(() => {
    const metadata = pageMetadata[page];
    document.title = metadata.title;
    document.querySelector<HTMLMetaElement>('meta[name="description"]')
      ?.setAttribute('content', metadata.description);
  }, [page]);

  return (
    <div className="public-info-page">
      <BrandHeader page={page} />
      <main>{page === 'privacy' ? <PrivacyPage /> : <SupportPage />}</main>
      <PageFooter />
    </div>
  );
}
