import { UsersRound } from 'lucide-react';
import './MultiplayerComingSoon.css';

type MultiplayerComingSoonProps = Readonly<{
  title?: string;
  description?: string;
  compact?: boolean;
  onContinueSolo?: () => void | boolean | Promise<void>;
}>;

export function MultiplayerComingSoon({
  title = 'Live multiplayer',
  description = 'Live races and private rooms are coming soon. Solo training and ghost races are available now.',
  compact = false,
  onContinueSolo,
}: MultiplayerComingSoonProps) {
  return (
    <section
      className={`multiplayer-coming-soon${compact ? ' compact' : ''}`}
      aria-label={`${title}: Coming soon`}
    >
      <span className="multiplayer-coming-soon-icon"><UsersRound size={24} aria-hidden="true" /></span>
      <div className="multiplayer-coming-soon-copy">
        <span className="multiplayer-coming-soon-label">Coming soon</span>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {onContinueSolo && (
        <button type="button" onClick={() => void onContinueSolo()}>
          Continue solo
        </button>
      )}
    </section>
  );
}
