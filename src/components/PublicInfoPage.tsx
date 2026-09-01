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
import { trackLabPublicUrl } from '../lib/serviceOrigins';
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
        <span className="public-info-updated">Last updated September 1, 2026</span>
      </section>

      <section className="public-info-summary" aria-label="Privacy summary">
        <SummaryCard icon={<LockKeyhole aria-hidden="true" />} title="Your controls">
          Photos, location, microphone, commentary, and ghost analytics have feature-level choices.
        </SummaryCard>
        <SummaryCard icon={<Database aria-hidden="true" />} title="Account sync">
          Signed-in profiles and training records are stored so they remain available across devices.
        </SummaryCard>
        <SummaryCard icon={<Download aria-hidden="true" />} title="Portable sessions">
          Download individual sessions as JSON or CSV, or a selected day as a Numbers/Excel workbook.
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
              <p>
                A signed-in user who asks to claim a bike-shop listing supplies the shop identity, their relationship
                to the business, a business email or phone number or documentation note, and the request&apos;s review
                status. Claim evidence and claimant/reviewer identities remain private to the requester and authorized
                TrackLab reviewers even after a decision. An approved listing publicly shows only a claimed-and-verified badge.
              </p>

              <h3>Friends, handles, and safety information</h3>
              <p>
                TrackLab assigns an account handle for the Friends feature. If you choose to appear in rider discovery,
                signed-in users can find your public handle and display name and may send you a friend request. TrackLab
                stores friend connections, pending and answered requests, invite-link status, blocks, removals of default
                connections, and safety reports so the service can operate the network and enforce your choices.
              </p>

              <h3>Wattbike and training information</h3>
              <p>
                TrackLab processes nearby Wattbike identifiers and names, saved bike assignments, connection state,
                and available measurements such as cadence, power, speed, and battery information. During a session,
                it can derive rollout distance, timing, reaction, splits, race position, pedal-zone results, finish
                order, personal records, ghost replays, and training history. Straight Sprint settings and Explore
                distance, duration, grade, and elevation can also be included in saved sessions.
              </p>
              <p>
                Watt and power measurements are private rider records. They remain available in the individual
                rider&apos;s own training history and downloads. When a rider has claimed their Club Connect profile,
                power from training explicitly attributed to that claimed profile is also available to that club&apos;s
                authenticated owner in the private Results view. Power is never published to public leaderboards,
                ghosts, demo views, multiplayer participants, or public/shared exports. During club training, current
                live watts may also appear on the authenticated club owner’s optional Club Live Monitor and on a local
                monitor directly connected to the bikes.
              </p>

              <h3>Optional Apple Watch heart rate</h3>
              <p>
                If you choose to connect Apple Watch heart rate, the TrackLab Watch app asks through Apple Health for
                permission to read heart-rate samples and to save the indoor-cycling workout that you start. TrackLab
                receives the beats-per-minute value, the time Apple Watch measured it, and technical sequence and
                delivery times needed to prevent duplicate or stale readings. Heart rate is used only as a private
                fitness and training metric; TrackLab does not use it to diagnose, treat, or provide medical advice.
              </p>
              <p>
                Choosing to save heart rate to TrackLab sends those samples to the signed-in rider&apos;s TrackLab account
                so they can be aligned with active riding time, pauses, pedal zones, and session results. Heart rate is
                excluded from public leaderboards, ghosts, Friends, multiplayer, AI commentary, advertising, and
                marketing. TrackLab does not sell heart-rate data or disclose it to advertisers or data brokers. A rider
                can continue using every training mode without granting Apple Health access.
              </p>
              <p>
                Watch Connect can remember a rider&apos;s approved TrackLab app installation so later training days do not
                require another invite or setup code. TrackLab stores a random, revocable installation identifier for
                this purpose, not the Apple Watch serial number or a hardware advertising identifier. The rider still
                presses <em>Watch Connect</em> on the paired iPhone to start each visible four-hour connection. That
                connection can cover multiple TrackLab programs and bike reconnects, and it ends automatically after
                four hours unless the rider ends it sooner.
              </p>

              <h3>Maps, routes, and location</h3>
              <p>
                TrackLab stores selected tracks, custom routes, mapped ride lines, split routes, pedal zones, camera
                preferences, and recent Explore routes. If you tap <em>Use my current location</em>, the app requests
                a one-time device location to choose the route origin. Explore progress is driven by bike input rather
                than continuous device GPS. Developer-published track mappings and custom mapped tracks are designed
                to be visible to other TrackLab users.
              </p>
              <p>
                The public Global Bike Shop Directory displays a browsable world map and loads public bike-shop listings
                for the visible area after you pan or zoom to a useful city or regional view. You can also enter a city,
                ZIP code, or address, or request a one-time device location, to move the map there. TrackLab sends the
                visible map bounds and zoom level—or the selected nearby-search point and radius—to the OpenStreetMap
                directory service. Those map bounds and search points are not saved to your TrackLab account; directory
                results may be held briefly in an in-memory service cache to improve reliability.
              </p>

              <h3>Rooms, messages, and optional microphone audio</h3>
              <p>
                Multiplayer features handle display names, room membership, invites, challenges, race state, and room
                messages. Voice chat is off by default. If a room racer enables it, TrackLab requests microphone access
                and sends live audio to the other room racers through real-time connections. The current implementation
                processes connection-signaling messages but does not create stored voice recordings.
              </p>
              <p>
                An explicitly accepted friend who is currently online can send a short-lived request to talk live.
                The request contains no custom message, expires automatically, and reveals the private audio room only
                after the invited friend chooses Join. Friend live audio is microphone-off by default, is limited to the
                two connected friends, is not recorded, and does not create a message history or inbox.
              </p>

              <h3>Optional app notifications</h3>
              <p>
                In the iPhone or iPad app, you can choose notifications for live-audio invitations, friend requests,
                new friend connections, and shared tracks. TrackLab sends Apple Push Notification service an opaque
                device token and stores a random app-installation identifier and credential so Apple can deliver the
                choices enabled for your signed-in personal account. Notification payloads contain a notification type
                and opaque identifier, not workout, heart-rate, microphone, message, or payment data.
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
                <li>Create results, non-power leaderboards, records, ghosts, calendar history, and downloadable reports.</li>
                <li>Provide rider discovery, friend requests, secure friend invitations, suggestions, blocks, and safety reporting.</li>
                <li>Operate private rooms, room chat, short-lived friend live-audio alerts, optional voice, challenges, and live race state.</li>
                <li>Deliver optional account-chosen app alerts through Apple Push Notification service.</li>
                <li>Load maps, resolve route locations, calculate routes and elevation, and show track information.</li>
                <li>Find nearby bike shops and connect a selected shop to nearby BMX tracks in the public directory.</li>
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
                  <strong>Friends and rider discovery:</strong> if you opt in to discovery, other signed-in users can see
                  your public handle and display name in search or relevant suggestions. An accepted friend connection is
                  visible to both accounts, and ordinary connected friends can see an optional account profile photo. TrackLab
                  adds the verified Preski Ranch club account and TrackLab founder as default connections; a rider may see
                  those verified accounts&apos; photos, but the default connection does not share the rider&apos;s photo back. You can
                  remove or block either connection. Explicitly accepted friends can see whether the other account is
                  currently online. Verified club and founder accounts may also show their own public online status through
                  an auto-added connection. An auto-added official connection cannot see an ordinary rider&apos;s online
                  presence unless that rider explicitly accepts the connection. Friendship by itself does not share
                  private workout history, private pedal-zone analytics, live device location, or current training activity.
                  An explicitly accepted online friend can send a short-lived live-audio alert containing their public
                  display identity; you can decline it without opening the room. Information can still be shared through
                  a separate action or feature you choose, such as joining a room, publishing an eligible ghost, or
                  training through Club Connect.
                </li>
                <li>
                  <strong>Friend invitation links:</strong> you can create an expiring, single-use link or QR code and send
                  it through a service of your choice. The link contains a random invitation token rather than your email
                  address. A signed-in rider who opens a valid link becomes connected to the inviter, so invitation links
                  should be sent only to the intended rider.
                </li>
                <li>
                  <strong>Other TrackLab users:</strong> room participants can see rider display names, photos, live
                  positions, and results. Public leaderboards and ghost replays can display rider identity and race
                  performance, excluding watts and power. Detailed non-power ghost zone analytics are shared only
                  when that option is enabled.
                </li>
                <li>
                  <strong>Clubs:</strong> a claimed Club Connect athlete can choose “Training at” a club to associate
                  the saved session with that club. The club owner may optionally open Club Live Monitor; when open,
                  TrackLab also shares the athlete&apos;s selected program, live status, course progress, track or
                  destination, cadence, speed, and current live watts with that owner. While the athlete is actively
                  sharing a Club Live session, the owner can also view a temporary, read-only image of the visible
                  TrackLab activity screen. Screen sharing does not capture the device camera, microphone, taps,
                  notifications, other apps, or content outside TrackLab. Frames expire and are deleted when Club Live
                  sharing ends. Saved power history remains private to the athlete and, for training attributed to a
                  claimed Club Connect profile, that club&apos;s authenticated owner. Live or saved watts are not published
                  to public leaderboards, shared ghosts, multiplayer participants, or public/shared exports. The rest of the
                  read-only live feed expires automatically after the athlete leaves club training or stops transmitting.
                </li>
                <li>
                  <strong>Apple Watch heart rate and clubs:</strong> saving private heart rate to a rider account does
                  not give a club access to it. A rider can separately approve a trusted Watch Connect enrollment for one
                  specific club and claimed rider account. The rider then starts each four-hour studio connection with one
                  explicit press on the paired iPhone. Sharing current heart rate is a separate optional choice; sharing
                  saved session summaries also requires the rider&apos;s explicit approval. Friendship, verified default
                  connections, Club Connect membership, name selection, and bike assignment alone never grant heart-rate
                  access. The rider can forget the trusted enrollment, and the rider or club owner can disconnect studio
                  sharing without deleting the athlete&apos;s club membership. Raw and between-effort samples remain private.
                </li>
                <li>
                  <strong>Apple Push Notification service:</strong> if you enable app notifications, TrackLab provides
                  Apple an opaque device token and a minimal alert for delivery to this app installation. Opening an
                  alert causes TrackLab to securely refetch current Friends information for the active account; the
                  alert itself cannot accept an invitation, join live audio, or enable the microphone.
                </li>
                <li>
                  <strong>Google mapping services:</strong> map tiles, places, route endpoints, route geometry,
                  Street View, and elevation requests are handled by the Google mapping services used by the feature.
                </li>
                <li>
                  <strong>OpenStreetMap:</strong> the Global Bike Shop Directory sends the visible map bounds and zoom
                  level, or chosen nearby-search coordinates and radius, to OpenStreetMap&apos;s Overpass service and
                  displays public shop listing data under the ODbL. Choosing a shop&apos;s map, directions, or Street View
                  action opens Google Maps.
                </li>
                <li>
                  <strong>OpenAI:</strong> when AI commentary is enabled, limited race context—including supplied
                  rider display names and live race facts—can be sent to generate commentary and speech.
                </li>
                <li>
                  <strong>Apple App Store:</strong> Wattbike connection subscriptions in the iPhone and iPad app are
                  purchased through Apple. Apple processes payment details; TrackLab receives signed transaction and
                  entitlement information needed to verify the subscription and unlock its connection capacity across
                  devices. TrackLab does not receive raw payment-card numbers from Apple.
                </li>
                <li>
                  <strong>Hosting and database providers:</strong> TrackLab uses hosted application and database
                  infrastructure to deliver and store cloud-backed features.
                </li>
                <li>
                  <strong>Safety and moderation:</strong> blocking removes the friend connection and pending requests and
                  prevents the blocked pair from reconnecting while the block remains. A safety report stores the reported
                  account, category, available details, and review status for TrackLab safety review and moderation. The
                  reported rider is not told who submitted the report.
                </li>
              </ul>
              <p>
                External services process data under their own terms and privacy notices. Opening a landmark website,
                Google Maps or another external link takes you to that provider.
              </p>
            </div>
          </section>

          <section id="privacy-controls">
            <span className="public-info-section-icon"><Mic2 aria-hidden="true" /></span>
            <div>
              <h2>Your controls</h2>
              <ul>
                <li>Profile photos are optional and can be replaced from profile or rider controls.</li>
                <li>You can choose whether your account appears in rider search and friend suggestions.</li>
                <li>You can approve or decline ordinary friend requests, remove friends, and block or report an account.</li>
                <li>Verified club and founder connections are added by default, but each can be removed or blocked.</li>
                <li>
                  Current location is requested only after you choose the current-location action. Explore and bike-shop
                  search both offer a typed-location alternative when you do not want to grant device location.
                </li>
                <li>Room and friend-live microphone access starts only after you explicitly turn voice on.</li>
                <li>
                  App notification permission is requested only after you choose Enable notifications. You can select
                  alert types in TrackLab Settings and can turn notification access off later in iOS Settings.
                </li>
                <li>Race commentary and ambient track sound each have an on/off control.</li>
                <li>Ghost replay analytics have a separate sharing choice.</li>
                <li>
                  Individual training sessions can be exported as JSON or CSV, and the selected day&apos;s non-health
                  spreadsheet can be downloaded as a Numbers/Excel workbook (.xlsx) from the account calendar.
                </li>
                <li>
                  Apple Watch heart rate is optional. After one-time setup, you press <em>Watch Connect</em> on the paired
                  iPhone to start a visible four-hour connection, can end it early from TrackLab, and can use TrackLab
                  without it. You can change Apple Health permission later in the system Health or Settings app.
                </li>
                <li>
                  Revoking Apple Health access stops future collection but does not automatically erase heart-rate
                  samples already saved to TrackLab. Heart rate remains visible in the rider&apos;s private session history
                  and is deliberately excluded from generic session JSON/CSV, the standard selected-day workbook, and
                  public or club exports. A signed-in rider can deliberately download a separate private Numbers/Excel
                  workbook containing heart-rate summaries alongside their session and zone metrics; that workbook does
                  not include raw heart-rate samples. Deleting the TrackLab account also deletes its saved heart-rate
                  records. Contact support for a separate verified raw health-data export or a heart-rate-only deletion.
                </li>
                <li>You can sign out to end the current browser or app session.</li>
              </ul>
              <p>
                A signed-in user can open My Profile, choose Delete Account, reenter the current password, and confirm
                permanent deletion in the app. Deleting a TrackLab account does not cancel an Apple subscription; manage
                or cancel that subscription with Apple first if you do not want it to renew. TrackLab retains only a
                one-way pseudonymous Apple transaction-lineage proof after deletion, without the deleted profile ID,
                email, or name. A user with the same active Apple subscription may deliberately use Restore Purchases
                after creating a new TrackLab account. Contact support to request access, correction, a partial deletion,
                or help with an account-specific request.
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
                TrackLab keeps account and training records so they remain available across devices and sessions until
                the account is deleted. Temporary records, expired authentication sessions, and local data can have
                different lifetimes. TrackLab may retain limited records when required for safety, security, fraud
                prevention, dispute resolution, or legal obligations. No internet service or storage method can guarantee
                absolute security.
              </p>
              <p>
                Saved heart-rate samples are stored in the authenticated rider&apos;s private heart-rate stream. TrackLab
                links only the exact active-time portions of that stream to a completed training session; samples measured
                between short studio efforts remain private to the rider and are not included in the club&apos;s saved-session
                view. Heart-rate records currently follow the general account-retention policy above rather than a separate
                automatic deletion schedule. They are transmitted over encrypted connections, and TrackLab does not store
                personal health information in iCloud. Deleting the TrackLab account also deletes its saved heart-rate
                records. A rider may contact support for an export or a heart-rate-only deletion request. Ending an Apple
                Watch workout or revoking Apple Health permission does not by itself delete a previously synchronized
                TrackLab record.
              </p>
              <p>
                The app keeps its random notification installation identifier and credential in the iOS Keychain using
                device-only storage. TrackLab removes the server registration during normal sign-out and does not register
                personal push alerts in Club Tablet kiosk mode. Apple may retain delivery information under its own terms.
              </p>
              <p>
                Friend connections are deleted when either account removes the connection. TrackLab retains a suppression
                record after a verified default connection is removed or blocked so that connection is not silently added
                again. Blocks remain until the blocking account removes them. Answered requests, claimed or expired invite
                records, and safety reports may be retained for network integrity, abuse prevention, moderation, and legal
                obligations. An account-deletion request also covers the account&apos;s social graph, subject to records that
                TrackLab must retain for safety, security, dispute, or legal reasons.
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
              <p>
                Friend discovery, invitations, and connection controls do not independently verify a rider&apos;s age. A
                parent or guardian should supervise a minor&apos;s discovery setting, friend requests, shared invitations,
                live-audio invitations and microphone use, blocks, and reports.
              </p>
              <p>
                Apple Watch heart rate and any live studio sharing must not be enabled for a minor without the permission
                and supervision required from their parent or guardian. A coach, club owner, friendship, or bike assignment
                cannot substitute for that authorization.
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
          <a href={trackLabPublicUrl('/api/health')} rel="noreferrer" target="_blank">
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
          <p>
            For friend alerts, open TrackLab Settings → Notifications and choose Enable notifications. If access was
            denied, use Open iOS Settings. Notification taps only open and refresh Friends; joining live audio and
            turning on the microphone remain separate actions.
          </p>
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
            <li>Talk live alerts reach explicitly accepted friends while TrackLab shows them online and expire after 90 seconds.</li>
            <li>Room and two-friend live audio are microphone-off by default; no voice recording or friend inbox is created.</li>
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
            <li>
              The selected-day spreadsheet downloads as a Numbers/Excel workbook (.xlsx); expanded session details also
              provide individual JSON and CSV downloads. A separate private workbook can include the signed-in rider&apos;s
              heart-rate summary and zone results; raw samples and other riders&apos; health data stay excluded.
            </li>
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
