import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bike,
  Compass,
  ExternalLink,
  Gauge,
  Globe2,
  LayoutGrid,
  Lock,
  LogIn,
  MapPinned,
  Play,
  Radio,
  RefreshCcw,
  Route,
  Smartphone,
  Store,
} from 'lucide-react';
import type { AuthMode } from '../lib/auth';
import {
  clampAppleWattbikeConnections,
  maxAppleWattbikeConnections,
  type MembershipState,
} from '../lib/membership';
import { readPublicBikeShopDirectoryState } from '../lib/publicBikeShopDirectoryState';
import type { TrackRecord } from '../types';
import {
  PublicBikeShopDirectory,
  type PublicBikeShopDirectoryLaunchRequest,
} from './PublicBikeShopDirectory';
import {
  PublicTrackLocator,
  type PublicTrackLocatorResumeState,
  type PublicTrackNearbyBikeShopRequest,
} from './PublicTrackLocator';
import './PublicTrackLocator.css';
import './MembershipLanding.css';

export type AppleBillingStatus = 'idle' | 'loading' | 'error' | 'success';
export type AppleBillingAction = 'products' | 'purchase' | 'restore' | 'manage' | null;
export type AppleSubscriptionOffer = {
  productId: string;
  bikeSeats: number;
  displayName: string;
  displayPrice: string;
};

type MembershipLandingProps = {
  membership: MembershipState;
  bikeSeats: number;
  appleStoreAvailable: boolean | null;
  appleBillingServerReady: boolean | null;
  appleProducts: AppleSubscriptionOffer[];
  billingStatus: AppleBillingStatus;
  billingAction: AppleBillingAction;
  billingMessage: string | null;
  authMode: AuthMode;
  authLoading: boolean;
  profileName: string;
  profileEmail: string;
  profilePassword: string;
  profileComplete: boolean;
  profileError: string | null;
  isAdminProfile: boolean;
  onlineRiderCount: number;
  liveRoomCount: number;
  catalogReady: boolean;
  tracks: TrackRecord[];
  onAuthModeChange: (mode: AuthMode) => void;
  onProfileNameChange: (name: string) => void;
  onProfileEmailChange: (email: string) => void;
  onProfilePasswordChange: (password: string) => void;
  onProfileSubmit: () => boolean | Promise<boolean>;
  onSignOut: () => void;
  onJoinFree: () => void;
  onEnterApp: () => void;
  onOpenRaceIntervals: () => void;
  onOpenStraightSprint: () => void;
  onOpenGetPulled: () => void;
  onOpenExplore: () => void;
  onOpenResults: () => void;
  onStartDemo: () => void;
  onBikeSeatsChange: (count: number) => void;
  onPurchase: () => void;
  onRestorePurchases: () => void;
  onManageSubscription: () => void;
};

export function MembershipLanding({
  membership,
  bikeSeats,
  appleStoreAvailable,
  appleBillingServerReady,
  appleProducts,
  billingStatus,
  billingAction,
  billingMessage,
  authMode,
  authLoading,
  profileName,
  profileEmail,
  profilePassword,
  profileComplete,
  profileError,
  isAdminProfile,
  onlineRiderCount,
  liveRoomCount,
  catalogReady,
  tracks,
  onAuthModeChange,
  onProfileNameChange,
  onProfileEmailChange,
  onProfilePasswordChange,
  onProfileSubmit,
  onSignOut,
  onJoinFree,
  onEnterApp,
  onOpenRaceIntervals,
  onOpenStraightSprint,
  onOpenGetPulled,
  onOpenExplore,
  onOpenResults,
  onStartDemo,
  onBikeSeatsChange,
  onPurchase,
  onRestorePurchases,
  onManageSubscription,
}: MembershipLandingProps) {
  type LandingTab = 'home' | 'tracks' | 'shops' | 'training' | 'results';
  const initialLandingTab = (): LandingTab => {
    const url = new URL(window.location.href);
    if (url.hash === '#bike-shop-directory') return 'shops';
    if (url.hash === '#track-locator' || url.searchParams.has('locator')) return 'tracks';
    return 'home';
  };
  const isMember = membership.tier !== 'visitor';
  const creatingAccount = authMode === 'register';
  const selectedOffer = appleProducts.find((product) => product.bikeSeats === bikeSeats);
  const productPriceAvailable = Boolean(selectedOffer?.displayPrice.trim());
  const selectedPlanIsCurrent = !isAdminProfile
    && membership.tier === 'racer'
    && membership.bikeSeats === bikeSeats;
  const changingPlan = !isAdminProfile
    && membership.tier === 'racer'
    && membership.bikeSeats !== bikeSeats;
  const billingBusy = billingStatus === 'loading';
  const profileSubmitPendingRef = useRef(false);
  const requestedScrollTargetRef = useRef<string | null>(null);
  const nearbyShopLaunchSequenceRef = useRef(0);
  const [shopClaimPrompt, setShopClaimPrompt] = useState('');
  const [bikeShopLaunchRequest, setBikeShopLaunchRequest] = useState<PublicBikeShopDirectoryLaunchRequest | null>(null);
  const [trackLocatorResumeState, setTrackLocatorResumeState] = useState<PublicTrackLocatorResumeState | null>(null);
  const [activeTab, setActiveTab] = useState<LandingTab>(initialLandingTab);
  useEffect(() => {
    if (!profileComplete && (activeTab === 'training' || activeTab === 'results')) {
      setActiveTab('home');
    }
  }, [activeTab, profileComplete]);
  useEffect(() => {
    const syncTabFromUrl = () => setActiveTab(initialLandingTab());
    window.addEventListener('popstate', syncTabFromUrl);
    window.addEventListener('hashchange', syncTabFromUrl);
    return () => {
      window.removeEventListener('popstate', syncTabFromUrl);
      window.removeEventListener('hashchange', syncTabFromUrl);
    };
  }, []);
  useEffect(() => {
    const requestedTargetId = requestedScrollTargetRef.current;
    requestedScrollTargetRef.current = null;
    const targetId = requestedTargetId ?? (activeTab === 'tracks'
      ? 'track-locator'
      : activeTab === 'shops'
        ? 'bike-shop-directory'
        : activeTab === 'training'
          ? 'membership-training'
          : activeTab === 'results'
            ? 'membership-results'
            : 'membership-hub-content-top');
    const restoredShopScrollY = activeTab === 'shops' && !bikeShopLaunchRequest
      ? readPublicBikeShopDirectoryState()?.pageScrollY ?? 0
      : 0;
    const frame = window.requestAnimationFrame(() => {
      // The directory restores a saved tab position after returning from a
      // full-page nearby-track link. Do not begin a competing smooth scroll
      // that can win after the directory has restored its exact list position.
      if (activeTab === 'shops' && restoredShopScrollY > 0) return;
      document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, bikeShopLaunchRequest]);
  const selectTab = (tab: LandingTab) => {
    if (!profileComplete && (tab === 'training' || tab === 'results')) return;
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === 'tracks') {
      url.hash = 'track-locator';
    } else if (tab === 'shops') {
      url.hash = 'bike-shop-directory';
      url.searchParams.delete('locator');
    } else {
      url.searchParams.delete('locator');
      if (url.hash === '#track-locator' || url.hash === '#bike-shop-directory') url.hash = '';
    }
    if (url.href !== window.location.href) {
      window.history.pushState(window.history.state, '', url);
    }
  };
  const revealSignIn = () => {
    requestedScrollTargetRef.current = 'free-account-gate';
    if (activeTab === 'home') {
      requestedScrollTargetRef.current = null;
      window.requestAnimationFrame(() => {
        document.getElementById('free-account-gate')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    selectTab('home');
  };
  const consumeLocator = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('locator') || url.hash === '#track-locator' || url.hash === '#bike-shop-directory') {
      url.searchParams.delete('locator');
      if (url.hash === '#track-locator' || url.hash === '#bike-shop-directory') url.hash = '';
      window.history.replaceState(window.history.state, '', url);
    }
  };
  const enterFromLocator = (action: () => void) => {
    consumeLocator();
    action();
  };
  const submitProfile = async () => {
    if (profileSubmitPendingRef.current) return;
    profileSubmitPendingRef.current = true;
    try {
      if (await onProfileSubmit()) consumeLocator();
    } finally {
      profileSubmitPendingRef.current = false;
    }
  };
  const requireFreeAccountForShopClaim = (shopName: string) => {
    setShopClaimPrompt(`Create or sign in to a free TrackLab account to request ownership of ${shopName}.`);
    window.requestAnimationFrame(() => {
      const gate = document.getElementById('free-account-gate');
      gate?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => gate?.querySelector<HTMLInputElement>('input')?.focus(), 350);
    });
  };
  const openNearbyBikeShops = (request: PublicTrackNearbyBikeShopRequest) => {
    nearbyShopLaunchSequenceRef.current += 1;
    setTrackLocatorResumeState(request.returnState);
    setBikeShopLaunchRequest({
      requestId: nearbyShopLaunchSequenceRef.current,
      origin: {
        latitude: request.track.latitude,
        longitude: request.track.longitude,
        label: request.track.name,
      },
      radiusMiles: request.radiusMiles,
      ...(request.selectedShop ? { selectedShopId: request.selectedShop.id } : {}),
    });
    selectTab('shops');
  };
  const consumeTrackLocatorResumeState = useCallback(() => {
    setTrackLocatorResumeState(null);
  }, []);
  const consumeBikeShopLaunchRequest = useCallback((requestId: number) => {
    setBikeShopLaunchRequest((current) => current?.requestId === requestId ? null : current);
  }, []);

  const trainingActions = [
    { label: 'Race Intervals', detail: 'Mapped BMX racing', icon: Activity, action: onOpenRaceIntervals },
    { label: 'Straight Sprint', detail: 'Custom sprint locations', icon: Route, action: onOpenStraightSprint },
    { label: 'Get Pulled', detail: 'Power and cadence pulls', icon: Gauge, action: onOpenGetPulled },
    { label: 'Explore the World', detail: 'Ride routes worldwide', icon: Compass, action: onOpenExplore },
  ];

  return (
    <main className="membership-page membership-hub-page">
      <aside className="membership-hub-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radio size={20} strokeWidth={2.6} />
          </div>
          <div>
            <h1>TrackLab BMX</h1>
            <p>Wattbike racing and training network</p>
          </div>
        </div>
        <nav className="membership-hub-nav" aria-label="TrackLab home navigation">
          <button className={activeTab === 'home' ? 'active' : ''} type="button" onClick={() => selectTab('home')}>
            <LayoutGrid size={18} /> Home
          </button>
          <button className={activeTab === 'tracks' ? 'active' : ''} type="button" onClick={() => selectTab('tracks')}>
            <MapPinned size={18} /> BMX Tracks
          </button>
          <button
            className={activeTab === 'shops' ? 'active' : ''}
            title="Global Bike Shop Directory"
            type="button"
            onClick={() => selectTab('shops')}
          >
            <Store size={18} /> Bike Shops
          </button>
          {profileComplete && (
            <>
              <button className={activeTab === 'training' ? 'active' : ''} type="button" onClick={() => selectTab('training')}>
                <Bike size={18} /> Training
              </button>
              <button className={activeTab === 'results' ? 'active' : ''} type="button" onClick={() => selectTab('results')}>
                <BarChart3 size={18} /> Results
              </button>
            </>
          )}
        </nav>
        {profileComplete ? (
          <div className="membership-hub-account">
            <span>{profileName.trim().slice(0, 1).toUpperCase() || 'R'}</span>
            <div><strong>{profileName}</strong><small>{profileEmail}</small></div>
          </div>
        ) : (
          <button className="membership-hub-signin" type="button" onClick={revealSignIn}>
            <LogIn size={17} /> Sign in
          </button>
        )}
      </aside>

      <header className="membership-nav membership-hub-topbar" id="membership-hub-content-top">
        <div>
          <span className="eyebrow">{profileComplete ? `Welcome back, ${profileName}` : 'Explore without an account'}</span>
          <h1>{activeTab === 'home' ? 'Your BMX home base.' : activeTab === 'tracks' ? 'Global BMX tracks' : activeTab === 'shops' ? 'Global bike shops' : activeTab === 'training' ? 'Wattbike training' : 'Your results'}</h1>
        </div>
        <div className="membership-nav-actions">
          <div className="watch-connect-indicator-slot" id="watch-connect-indicator-slot" />
          {profileComplete && (
            <button className="secondary-button" type="button" onClick={onSignOut}>
              Sign Out
            </button>
          )}
          {isAdminProfile && (
            <button className="secondary-button" type="button" onClick={() => enterFromLocator(onStartDemo)}>
              <Play size={16} /> Demo Race
            </button>
          )}
          <button className="secondary-button" type="button" onClick={() => enterFromLocator(onEnterApp)} disabled={!profileComplete}>
            Open App
          </button>
        </div>
      </header>

      {activeTab === 'home' && (
        <>
          <section className="membership-hub-intro">
            <span className="membership-pill"><Globe2 size={15} /> Global BMX community</span>
            <h2>Discover globally. Train when you are ready.</h2>
            <p>Track and bike-shop directories are free to explore. Signed-in riders also get direct access to every Wattbike activity and their saved results.</p>
            <div className="membership-hub-status" aria-label="TrackLab live status">
              <span><strong>{onlineRiderCount}</strong> riders online</span>
              <span><strong>{liveRoomCount}</strong> active rooms</span>
              <span><strong>{membership.tier === 'racer' ? membership.bikeSeats : 'Free'}</strong> {membership.tier === 'racer' ? 'bike seats' : 'directory access'}</span>
            </div>
          </section>
          <section className="membership-hub-cards" aria-label="TrackLab directories">
            <article className="membership-hub-feature">
              <div>
                <span className="eyebrow">Global directory</span>
                <h2>Find BMX tracks anywhere</h2>
                <p>Browse by country, state, and city, or move across the world map.</p>
                <button className="primary-button" type="button" onClick={() => selectTab('tracks')}><MapPinned size={17} /> Open track finder</button>
              </div>
              <Globe2 className="membership-hub-globe" aria-hidden="true" />
            </article>
            <article className="membership-hub-secondary">
              <span className="eyebrow">Nearby support</span>
              <h2>Global bike shops</h2>
              <p>Search near your location or browse any country, state, and city worldwide.</p>
              <button className="secondary-button" type="button" onClick={() => selectTab('shops')}><Store size={17} /> Open shop finder</button>
            </article>
          </section>
          {profileComplete && (
            <section className="membership-training-launch" aria-label="Wattbike training shortcuts">
              <div className="section-heading"><div><span className="eyebrow">Signed-in tools</span><h2>Start Wattbike training</h2></div><Bike size={20} /></div>
              <div className="membership-training-grid">
                {trainingActions.map(({ label, detail, icon: Icon, action }) => (
                  <button key={label} type="button" onClick={() => enterFromLocator(action)}><Icon size={19} /><span><strong>{label}</strong><small>{detail}</small></span></button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {activeTab === 'tracks' && (
        <PublicTrackLocator
          accountId={profileComplete ? profileEmail : null}
          catalogReady={catalogReady}
          tracks={tracks}
          resumeState={trackLocatorResumeState}
          onResumeStateConsumed={consumeTrackLocatorResumeState}
          onOpenNearbyBikeShops={openNearbyBikeShops}
        />
      )}

      {activeTab === 'shops' && (
        <PublicBikeShopDirectory
          accountId={profileComplete ? profileEmail : null}
          isAdmin={isAdminProfile}
          tracks={tracks}
          launchRequest={bikeShopLaunchRequest}
          onLaunchRequestConsumed={consumeBikeShopLaunchRequest}
          onRequireFreeAccount={(shop) => requireFreeAccountForShopClaim(shop.name)}
        />
      )}

      {activeTab === 'training' && profileComplete && (
        <section className="membership-training-launch membership-tab-panel" id="membership-training" aria-label="Choose a Wattbike activity">
          <div className="section-heading"><div><span className="eyebrow">Wattbike training</span><h2>Choose an activity</h2></div><Bike size={20} /></div>
          <p className="panel-helper">Your account, connected bike, club access, and saved activity settings carry into the training workspace.</p>
          <div className="membership-training-grid">
            {trainingActions.map(({ label, detail, icon: Icon, action }) => (
              <button key={label} type="button" onClick={() => enterFromLocator(action)}><Icon size={20} /><span><strong>{label}</strong><small>{detail}</small></span></button>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'results' && profileComplete && (
        <section className="membership-results-launch membership-tab-panel" id="membership-results">
          <BarChart3 size={34} />
          <span className="eyebrow">Training history</span>
          <h2>Review every saved result</h2>
          <p>Open your race, sprint, pull, and Explore the World history with exports and detailed metrics.</p>
          <button className="primary-button" type="button" onClick={() => enterFromLocator(onOpenResults)}><BarChart3 size={17} /> Open results</button>
        </section>
      )}

      <section id="free-account-gate" className={`profile-gate ${profileComplete ? 'complete' : ''}`} aria-label="Required profile">
        <div>
          <span className="eyebrow">Login required</span>
          <h2>{profileComplete ? 'Account ready' : creatingAccount ? 'Create your free TrackLab account' : 'Sign in to TrackLab'}</h2>
          <p>
            Every spectator and racer signs in before entering TrackLab. Free accounts can watch live sessions;
            racer accounts can connect Wattbikes and join private rooms.
          </p>
          {shopClaimPrompt && !profileComplete && <p className="shop-claim-account-prompt" role="status">{shopClaimPrompt}</p>}
        </div>
        <form
          className="profile-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submitProfile();
          }}
        >
          {profileComplete ? (
            <div className="account-ready-panel">
              <strong>{profileName}</strong>
              <span>{profileEmail}</span>
            </div>
          ) : creatingAccount && (
            <label>
              <span>Name</span>
              <input
                autoComplete="name"
                disabled={authLoading}
                onChange={(event) => onProfileNameChange(event.target.value)}
                placeholder="Rider or studio name"
                type="text"
                value={profileName}
              />
            </label>
          )}
          {!profileComplete && (
            <>
              <label>
                <span>Email</span>
                <input
                  autoComplete="email"
                  disabled={authLoading}
                  inputMode="email"
                  onChange={(event) => onProfileEmailChange(event.target.value)}
                  placeholder="you@example.com"
                  type="email"
                  value={profileEmail}
                />
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete={creatingAccount ? 'new-password' : 'current-password'}
                  disabled={authLoading}
                  onChange={(event) => onProfilePasswordChange(event.target.value)}
                  placeholder="8 characters minimum"
                  type="password"
                  value={profilePassword}
                />
              </label>
              <button className="primary-button" type="submit" disabled={authLoading}>
                <LogIn size={17} />
                {authLoading ? 'Working...' : creatingAccount ? 'Create Account' : 'Sign In'}
              </button>
            </>
          )}
          {isAdminProfile && (
            <p className="profile-gate-note">Administrator racer access is active for this account.</p>
          )}
          {profileError && <p className="checkout-message error">{profileError}</p>}
          {!profileComplete && (
            <>
              <button
                className="text-button"
                type="button"
                onClick={() => onAuthModeChange(creatingAccount ? 'login' : 'register')}
                disabled={authLoading}
              >
                {creatingAccount ? 'Already have an account? Sign in' : 'Need an account? Create one free'}
              </button>
              <p className="profile-gate-note">
                {creatingAccount
                  ? 'Use your main email here. The owner account unlocks admin racer access automatically.'
                  : 'First time on this deployment? Create the free account before signing in.'}
              </p>
            </>
          )}
        </form>
      </section>

      {activeTab === 'home' && (
      <section className="membership-grid" aria-label="Membership options">
        <article className="membership-card">
          <div className="card-icon">
            <Activity size={20} />
          </div>
          <span className="eyebrow">Spectator</span>
          <h3>Free membership</h3>
          <p>
            Watch live rooms, follow race activity, and explore the public BMX track and mapped bike shop directories without a paid bike seat.
          </p>
          <ul>
            <li>Live race viewing</li>
            <li>Public track directory</li>
            <li>Mapped bike shop directory</li>
            <li>Community profile</li>
          </ul>
          <button className="secondary-button full-width" type="button" onClick={profileComplete ? () => enterFromLocator(onJoinFree) : () => { void submitProfile(); }} disabled={!profileComplete && authLoading}>
            {isMember ? 'Use Free Access' : 'Create Free Membership'}
          </button>
        </article>

        <article className="membership-card pricing-card">
          <div className="card-icon accent">
            <Smartphone size={20} />
          </div>
          <span className="eyebrow">Racer · Apple subscription</span>
          <h3>{appleStoreAvailable == null
            ? 'Checking App Store...'
            : selectedOffer?.displayName?.trim() || 'App Store plan unavailable'}</h3>
          {productPriceAvailable && (
            <p className="apple-plan-price">{selectedOffer?.displayPrice} / month</p>
          )}
          <p>
            Choose a fixed plan for one to four simultaneous Wattbike connections. Every plan includes live Wattbike
            telemetry, cloud training records, club monitoring, and multiplayer racing.
          </p>
          {membership.tier === 'racer' && (
            <p className="apple-current-access">
              Current account access: up to {membership.bikeSeats} Wattbike {membership.bikeSeats === 1 ? 'connection' : 'connections'}.
              This access is based on the latest subscription entitlement verified with Apple.
            </p>
          )}
          <div className="apple-tier-selector" role="radiogroup" aria-label="Monthly Wattbike connection plan">
            {Array.from({ length: maxAppleWattbikeConnections }, (_, index) => index + 1).map((connectionCount) => {
              const offer = appleProducts.find((product) => product.bikeSeats === connectionCount);
              const selected = bikeSeats === connectionCount;
              return (
                <button
                  aria-checked={selected}
                  className={selected ? 'active' : ''}
                  key={connectionCount}
                  onClick={() => onBikeSeatsChange(clampAppleWattbikeConnections(connectionCount))}
                  role="radio"
                  type="button"
                >
                  <strong>{connectionCount}</strong>
                  <span>{connectionCount === 1 ? 'connection' : 'connections'}</span>
                  <small>{appleStoreAvailable == null
                    ? 'Loading price...'
                    : offer?.displayPrice?.trim() || 'Price unavailable'}</small>
                </button>
              );
            })}
          </div>
          <p className="apple-subscription-disclosure">
            This is an auto-renewing monthly subscription for exactly {bikeSeats} simultaneous Wattbike {bikeSeats === 1 ? 'connection' : 'connections'}.
            Payment is charged to your Apple Account and renews automatically unless canceled at least 24 hours before
            the end of the current period. Manage or cancel it in your App Store subscriptions. See the{' '}
            <a href="/privacy">Privacy Policy</a> and{' '}
            <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/" target="_blank" rel="noreferrer">
              Terms of Use <ExternalLink aria-hidden="true" size={12} />
            </a>.
          </p>
          <button
            className="primary-button full-width"
            type="button"
            onClick={onPurchase}
            disabled={!profileComplete || appleStoreAvailable !== true || appleBillingServerReady !== true || !productPriceAvailable || billingBusy || selectedPlanIsCurrent}
          >
            <Smartphone size={17} />
            {!profileComplete
              ? 'Sign In First'
              : appleStoreAvailable == null
                ? 'Checking App Store...'
                : !appleStoreAvailable
                  ? 'Subscribe in the iPhone or iPad app'
                  : appleBillingServerReady == null
                    ? 'Checking subscription service...'
                    : !appleBillingServerReady
                      ? 'Apple billing is being configured'
                      : billingAction === 'products'
                        ? 'Loading App Store price...'
                        : !productPriceAvailable
                          ? 'App Store price unavailable'
                          : billingAction === 'purchase'
                            ? 'Completing Apple purchase...'
                            : selectedPlanIsCurrent
                              ? 'Current Apple plan'
                              : `${changingPlan ? 'Change plan' : 'Subscribe'} · ${selectedOffer?.displayPrice} / month`}
          </button>
          <div className="apple-subscription-actions">
            <button
              className="secondary-button"
              disabled={!profileComplete || appleStoreAvailable !== true || appleBillingServerReady !== true || billingBusy}
              onClick={onRestorePurchases}
              type="button"
            >
              <RefreshCcw size={15} />
              {billingAction === 'restore' ? 'Restoring...' : 'Restore Purchases'}
            </button>
            <button
              className="secondary-button"
              disabled={appleStoreAvailable !== true || billingBusy}
              onClick={onManageSubscription}
              type="button"
            >
              <ExternalLink size={15} />
              Manage Subscription
            </button>
          </div>
          {appleStoreAvailable === false && (
            <p className="checkout-message">
              Subscriptions are purchased and managed in the TrackLab BMX app on an iPhone or iPad. Sign in with this
              same TrackLab account on any device to use its verified Wattbike connection capacity.
            </p>
          )}
          {appleStoreAvailable === true && appleBillingServerReady === false && (
            <p className="checkout-message error">
              Apple billing is being configured. Purchase and Restore will become available after TrackLab can verify
              transactions. You can still manage or cancel an existing subscription.
            </p>
          )}
          {billingMessage && (
            <p className={`checkout-message ${billingStatus === 'error' ? 'error' : ''}`}>
              {billingMessage}
            </p>
          )}
        </article>

        <article className="membership-card">
          <div className="card-icon">
            <Bike size={20} />
          </div>
          <span className="eyebrow">Racer tools</span>
          <h3>Built for connected training</h3>
          <p>
            Connect up to four Wattbikes in a room, race mapped BMX tracks, send private invites, and compare zone data.
          </p>
          <ul>
            <li>Private race rooms</li>
            <li>Random online challenges</li>
            <li>Post-race analytics</li>
          </ul>
          <button className="secondary-button full-width" type="button" onClick={() => enterFromLocator(onEnterApp)} disabled={!profileComplete}>
            <Lock size={16} />
            Open Dashboard
          </button>
        </article>
      </section>
      )}
      <footer
        aria-label="TrackLab policies and support"
        style={{ display: 'flex', justifyContent: 'center', gap: 18, padding: '10px 20px 42px' }}
      >
        <a href="/support" style={{ color: '#64726a', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>Support</a>
        <a href="/privacy" style={{ color: '#64726a', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>Privacy</a>
      </footer>
    </main>
  );
}
