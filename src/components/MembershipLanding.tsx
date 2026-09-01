import { useRef, useState } from 'react';
import {
  Activity,
  Bike,
  ExternalLink,
  Globe2,
  Lock,
  LogIn,
  MapPinned,
  Play,
  Radio,
  RefreshCcw,
  Smartphone,
  Store,
  Users,
} from 'lucide-react';
import type { AuthMode } from '../lib/auth';
import {
  clampAppleWattbikeConnections,
  maxAppleWattbikeConnections,
  type MembershipState,
} from '../lib/membership';
import type { TrackRecord } from '../types';
import { PublicBikeShopDirectory } from './PublicBikeShopDirectory';
import { PublicTrackLocator } from './PublicTrackLocator';
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
  onStartDemo,
  onBikeSeatsChange,
  onPurchase,
  onRestorePurchases,
  onManageSubscription,
}: MembershipLandingProps) {
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
  const [shopClaimPrompt, setShopClaimPrompt] = useState('');
  const consumeLocator = () => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('locator')) {
      url.searchParams.delete('locator');
      if (url.hash === '#track-locator') url.hash = '';
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

  return (
    <main className="membership-page">
      <header className="membership-nav">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radio size={20} strokeWidth={2.6} />
          </div>
          <div>
            <h1>TrackLab BMX</h1>
            <p>Wattbike racing and training network</p>
          </div>
        </div>
        <div className="membership-nav-actions">
          <div className="watch-connect-indicator-slot" id="watch-connect-indicator-slot" />
          <a className="secondary-button" href="#track-locator">
            <MapPinned size={16} />
            Find a Track
          </a>
          <a className="secondary-button" href="#bike-shop-directory">
            <Store size={16} />
            Global Bike Shop Directory
          </a>
          {profileComplete && (
            <button className="secondary-button" type="button" onClick={onSignOut}>
              Sign Out
            </button>
          )}
          <button className="secondary-button" type="button" onClick={() => enterFromLocator(onEnterApp)} disabled={!profileComplete}>
            Open App
          </button>
        </div>
      </header>

      <section className="membership-hero">
        <div className="membership-hero-copy">
          <span className="membership-pill">
            <Globe2 size={15} />
            Social racing platform
          </span>
          <h2>BMX racers can watch, train, and race on real mapped tracks.</h2>
          <p>
            Free members can view live sessions and explore the track directory. Racer members connect
            Wattbikes, create private rooms, join challenges, and save performance data.
          </p>
          <div className="membership-cta-row">
            <button className="primary-button" type="button" onClick={profileComplete ? () => enterFromLocator(onJoinFree) : () => { void submitProfile(); }} disabled={!profileComplete && authLoading}>
              <Users size={17} />
              {profileComplete ? 'Join Free' : creatingAccount ? 'Create Free Account' : 'Sign In'}
            </button>
            {isAdminProfile && (
              <button className="secondary-button" type="button" onClick={() => enterFromLocator(onStartDemo)} disabled={!profileComplete}>
                <Play size={17} />
                Demo Race
              </button>
            )}
          </div>
        </div>

        <aside className="membership-status-card">
          <div className="status-metric">
            <span>{onlineRiderCount}</span>
            <p>online riders</p>
          </div>
          <div className="status-metric">
            <span>{liveRoomCount}</span>
            <p>active rooms</p>
          </div>
          <div className="status-metric">
            <span>{membership.tier === 'racer' ? `${membership.bikeSeats}` : 'Free'}</span>
            <p>{membership.tier === 'racer' ? 'bike seats' : 'membership'}</p>
          </div>
        </aside>
      </section>

      <PublicTrackLocator accountId={profileComplete ? profileEmail : null} catalogReady={catalogReady} tracks={tracks} />

      <PublicBikeShopDirectory
        accountId={profileComplete ? profileEmail : null}
        isAdmin={isAdminProfile}
        tracks={tracks}
        onRequireFreeAccount={(shop) => requireFreeAccountForShopClaim(shop.name)}
      />

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
