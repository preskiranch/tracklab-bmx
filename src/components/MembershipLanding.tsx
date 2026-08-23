import { Activity, Bike, CreditCard, Globe2, Lock, LogIn, MapPinned, Play, Radio, Users } from 'lucide-react';
import type { AuthMode } from '../lib/auth';
import {
  bikeSeatMonthlyCents,
  clampBillingBikeSeats,
  formatUsd,
  maxBillingBikeSeats,
  racerMonthlyCents,
  type MembershipState,
} from '../lib/membership';
import type { TrackRecord } from '../types';
import { PublicTrackLocator } from './PublicTrackLocator';
import './PublicTrackLocator.css';

type CheckoutStatus = 'idle' | 'loading' | 'error';

type MembershipLandingProps = {
  membership: MembershipState;
  bikeSeats: number;
  checkoutStatus: CheckoutStatus;
  checkoutMessage: string | null;
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
  onProfileSubmit: () => void;
  onSignOut: () => void;
  onJoinFree: () => void;
  onEnterApp: () => void;
  onStartDemo: () => void;
  onBikeSeatsChange: (count: number) => void;
  onCheckout: () => void;
};

export function MembershipLanding({
  membership,
  bikeSeats,
  checkoutStatus,
  checkoutMessage,
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
  onCheckout,
}: MembershipLandingProps) {
  const monthlyCents = racerMonthlyCents(bikeSeats);
  const isMember = membership.tier !== 'visitor';
  const creatingAccount = authMode === 'register';

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
          {profileComplete && (
            <button className="secondary-button" type="button" onClick={onSignOut}>
              Sign Out
            </button>
          )}
          <button className="secondary-button" type="button" onClick={onEnterApp} disabled={!profileComplete}>
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
            <button className="primary-button" type="button" onClick={profileComplete ? onJoinFree : onProfileSubmit}>
              <Users size={17} />
              {profileComplete ? 'Join Free' : creatingAccount ? 'Create Free Account' : 'Sign In'}
            </button>
            {isAdminProfile && (
              <button className="secondary-button" type="button" onClick={onStartDemo} disabled={!profileComplete}>
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

      <PublicTrackLocator catalogReady={catalogReady} tracks={tracks} />

      <section className={`profile-gate ${profileComplete ? 'complete' : ''}`} aria-label="Required profile">
        <div>
          <span className="eyebrow">Login required</span>
          <h2>{profileComplete ? 'Account ready' : creatingAccount ? 'Create your free TrackLab account' : 'Sign in to TrackLab'}</h2>
          <p>
            Every spectator and racer signs in before entering TrackLab. Free accounts can watch live sessions;
            racer accounts can connect Wattbikes and join private rooms.
          </p>
        </div>
        <form
          className="profile-gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            onProfileSubmit();
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
            Watch live rooms, follow race activity, and explore the public BMX track directory without a paid bike seat.
          </p>
          <ul>
            <li>Live race viewing</li>
            <li>Public track directory</li>
            <li>Community profile</li>
          </ul>
          <button className="secondary-button full-width" type="button" onClick={profileComplete ? onJoinFree : onProfileSubmit}>
            {isMember ? 'Use Free Access' : 'Create Free Membership'}
          </button>
        </article>

        <article className="membership-card pricing-card">
          <div className="card-icon accent">
            <CreditCard size={20} />
          </div>
          <span className="eyebrow">Racer</span>
          <h3>{formatUsd(monthlyCents)} / month</h3>
          <p>
            Every connected Wattbike seat is {formatUsd(bikeSeatMonthlyCents)} per month.
            Clubs can purchase 20 or more seats, while each race remains limited to four riders.
          </p>
          <div className="seat-selector" aria-label="Wattbike seats">
            <button type="button" aria-label="Remove one Wattbike seat" disabled={bikeSeats <= 1} onClick={() => onBikeSeatsChange(bikeSeats - 1)}>−</button>
            <input
              aria-label="Wattbike seats"
              title="Wattbike seats"
              type="number"
              min="1"
              max={maxBillingBikeSeats}
              inputMode="numeric"
              value={bikeSeats}
              onChange={(event) => onBikeSeatsChange(clampBillingBikeSeats(Number(event.target.value) || 1))}
            />
            <button type="button" aria-label="Add one Wattbike seat" disabled={bikeSeats >= maxBillingBikeSeats} onClick={() => onBikeSeatsChange(bikeSeats + 1)}>+</button>
          </div>
          <button className="primary-button full-width" type="button" onClick={onCheckout} disabled={!profileComplete || checkoutStatus === 'loading'}>
            <CreditCard size={17} />
            {!profileComplete ? 'Sign In First' : checkoutStatus === 'loading' ? 'Opening Square...' : 'Upgrade with Square'}
          </button>
          {checkoutMessage && (
            <p className={`checkout-message ${checkoutStatus === 'error' ? 'error' : ''}`}>
              {checkoutMessage}
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
          <button className="secondary-button full-width" type="button" onClick={onEnterApp} disabled={!profileComplete}>
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
