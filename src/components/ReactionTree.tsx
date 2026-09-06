import type { CSSProperties } from 'react';
import type { ReactionTestStage, ReactionTestResult } from '../lib/reactionTest';
import { reactionTreeLampState, type ReactionTreeLamp } from '../lib/reactionTree';
import './ReactionTree.css';

const scene = '/assets/reaction-test-bmx-approved-4k.jpg';
const photoWidth = 1672;
// Lens bounds in the logical 1672 × 941 coordinate space of the approved 4K photograph. Each lens samples the same
// photograph, preserving its LEDs and metal housing instead of drawing a new lamp.
const lamps: { stage: ReactionTreeLamp; label: string; x: number; y: number; width: number; height: number; glow: string }[] = [
  { stage: 'red', label: 'red', x: 452, y: 90, width: 75, height: 71, glow: '#ff293c' },
  { stage: 'yellow-1', label: 'first yellow', x: 454, y: 191, width: 72, height: 73, glow: '#ffc52b' },
  { stage: 'yellow-2', label: 'second yellow', x: 454, y: 289, width: 73, height: 72, glow: '#ffc52b' },
  { stage: 'green', label: 'green', x: 455, y: 384, width: 71, height: 70, glow: '#25ed6b' },
];

export function ReactionTree({ activeStage, stoppedStage }: { activeStage: ReactionTestStage; stoppedStage: ReactionTestResult['stage'] | null }) {
  return (
    <div className="reaction-tree" style={{ left: `${360 / photoWidth * 100}%`, width: `${215 / photoWidth * 100}%` }} role="group" aria-label={stoppedStage === 'too-early'
      ? 'Starting tree: false start, no light recorded'
      : `Starting tree: ${stoppedStage ? `reaction recorded at ${stoppedStage}` : activeStage}`}>
      {lamps.map((lamp) => {
        const state = reactionTreeLampState(lamp.stage, activeStage, stoppedStage);
        return <span key={lamp.stage} className={`reaction-light is-${state}`}
          data-reaction-stage={lamp.stage} data-lamp-state={state} role="img"
          aria-label={`${lamp.label} light${state === 'stopped' ? ', reaction recorded here' : state === 'lit' ? ', illuminated' : ', dim'}`}
          style={{ left: `${(lamp.x - 360) / 215 * 100}%`, top: `${(lamp.y - 40) / 670 * 100}%`,
            width: `${lamp.width / 215 * 100}%`, height: `${lamp.height / 670 * 100}%`,
            '--lamp-glow': lamp.glow } as CSSProperties}>
          <span className="reaction-light-bulb" style={{ backgroundImage: `url(${scene})`,
            backgroundSize: `${photoWidth / lamp.width * 100}% ${941 / lamp.height * 100}%`,
            backgroundPosition: `${lamp.x / (photoWidth - lamp.width) * 100}% ${lamp.y / (941 - lamp.height) * 100}%` }} />
        </span>;
      })}
    </div>
  );
}
