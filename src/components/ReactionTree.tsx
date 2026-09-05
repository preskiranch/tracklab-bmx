import type { CSSProperties } from 'react';
import type { ReactionTestStage, ReactionTestResult } from '../lib/reactionTest';
import { reactionTreeLampState, type ReactionTreeLamp } from '../lib/reactionTree';
import './ReactionTree.css';

const scene = '/assets/reaction-test-bmx-scene.jpg';
const photoWidth = 1671;
// Lens bounds in the approved 1671 × 941 photograph. Each lens samples the same
// photograph, preserving its LEDs and metal housing instead of drawing a new lamp.
const lamps: { stage: ReactionTreeLamp; label: string; x: number; y: number; width: number; height: number; glow: string }[] = [
  { stage: 'red', label: 'red', x: 450, y: 96, width: 68, height: 67, glow: '#ff293c' },
  { stage: 'yellow-1', label: 'first yellow', x: 451, y: 194, width: 67, height: 70, glow: '#ffc52b' },
  { stage: 'yellow-2', label: 'second yellow', x: 451, y: 292, width: 68, height: 68, glow: '#ffc52b' },
  { stage: 'green', label: 'green', x: 451, y: 389, width: 67, height: 67, glow: '#25ed6b' },
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
