import { Activity, Bike, CreditCard, Globe2, Lock, Play, Radio, Users } from 'lucide-react';
import {
  additionalBikeMonthlyCents,
  formatUsd,
  includedBikeMonthlyCents,
  maxBillingBikeSeats,
  racerMonthlyCents,
  type MembershipState,
} from '../lib/membership';

type CheckoutStatus = 'idle' | 'loading' | 'error';

type MembershipLandingProps = {
  membership: MembershipState;
  bikeSeats: number;
  checkoutStatus: CheckoutStatus;
  checkoutMessage: string | null;
  onlineRiderCount: number;
  liveRoomCount: number;
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
  onlineRiderCount,
  liveRoomCount,
  onJoinFree,
  onEnterApp,
  onStartDemo,
  onBikeSeatsChange,
  onCheckout,
}: MembershipLandingProps) {
  const monthlyCents = racerMonthlyCents(bikeSeats);
  const isMember = membership.tier !== 'visitor';

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
        <button className="secondary-button" type="button" onClick={onEnterApp}>
          Open App
        </button>
      </header>

      <section className="membership-hero">
        <div className="membership-hero-copy">
          <span className="membership-pill">
            <Globe2 size={15} />
            Social racing platform
          </span>
          <h2>BMX racers can watch, train, and race on real mapped tracks.</h2>
          <p>
            Free members can view live sessions and run demo races. Racer members connect Wattbikes,
            create private rooms, join challenges, and save performance data.
          </p>
          <div className="membership-cta-row">
            <button className="primary-button" type="button" onClick={onJoinFree}>
              <Users size={17} />
              Join Free
            </button>
            <button className="secondary-button" type="button" onClick={onStartDemo}>
              <Play size={17} />
              Demo Race
            </button>
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

      <section className="membership-grid" aria-label="Membership options">
        <article className="membership-card">
          <div className="card-icon">
            <Activity size={20} />
          </div>
          <span className="eyebrow">Spectator</span>
          <h3>Free membership</h3>
          <p>
            Watch live rooms, follow race activity, and use demo mode on the benchmark track without a paid bike seat.
          </p>
          <ul>
            <li>Live race viewing</li>
            <li>Benchmark demo races</li>
            <li>Community profile</li>
          </ul>
          <button className="secondary-button full-width" type="button" onClick={onJoinFree}>
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
            Includes one Wattbike at {formatUsd(includedBikeMonthlyCents)} per month.
            Each additional Wattbike is {formatUsd(additionalBikeMonthlyCents)} per month.
          </p>
          <div className="seat-selector" aria-label="Wattbike seats">
            {Array.from({ length: maxBillingBikeSeats }, (_, index) => index + 1).map((count) => (
              <button
                className={bikeSeats === count ? 'selected' : ''}
                key={count}
                type="button"
                onClick={() => onBikeSeatsChange(count)}
              >
                {count}
              </button>
            ))}
          </div>
          <button className="primary-button full-width" type="button" onClick={onCheckout} disabled={checkoutStatus === 'loading'}>
            <CreditCard size={17} />
            {checkoutStatus === 'loading' ? 'Opening Square...' : 'Upgrade with Square'}
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
          <button className="secondary-button full-width" type="button" onClick={onEnterApp}>
            <Lock size={16} />
            Open Dashboard
          </button>
        </article>
      </section>
    </main>
  );
}
