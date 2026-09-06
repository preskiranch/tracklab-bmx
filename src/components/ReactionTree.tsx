import type { ReactionTestStage, ReactionTestResult } from '../lib/reactionTest';
import { reactionTreeLampState, type ReactionTreeLamp } from '../lib/reactionTree';
import { REACTION_SCENE_IMAGE, REACTION_SCENE_SOURCE_HEIGHT, REACTION_SCENE_SOURCE_WIDTH } from '../lib/reactionScene';
import './ReactionTree.css';

const tree = { x: 275, y: 30, width: 166, height: 515 };
// Bounds measured in the exact 1280 × 720 original photograph. Lens masks
// sample that same photograph, so its LED texture and housings stay intact.
const lamps: { stage: ReactionTreeLamp; label: string; x: number; y: number; width: number; height: number }[] = [
  { stage: 'red', label: 'red', x: 344, y: 75, width: 55, height: 58 },
  { stage: 'yellow-1', label: 'first yellow', x: 345, y: 151, width: 54, height: 58 },
  { stage: 'yellow-2', label: 'second yellow', x: 345, y: 226, width: 54, height: 57 },
  { stage: 'green', label: 'green', x: 345, y: 297, width: 54, height: 57 },
];

export function ReactionTree({ activeStage, stoppedStage, ready = false }: { activeStage: ReactionTestStage; stoppedStage: ReactionTestResult['stage'] | null; ready?: boolean }) {
  return (
    <div className={`reaction-tree${ready ? ' is-ready' : ''}`} style={{ left: `${tree.x / REACTION_SCENE_SOURCE_WIDTH * 100}%`, top: `${tree.y / REACTION_SCENE_SOURCE_HEIGHT * 100}%`, width: `${tree.width / REACTION_SCENE_SOURCE_WIDTH * 100}%`, height: `${tree.height / REACTION_SCENE_SOURCE_HEIGHT * 100}%` }} role="group" aria-label={ready
      ? 'Starting tree: ready, four illuminated lights'
      : stoppedStage === 'too-early'
      ? 'Starting tree: false start, no light recorded'
      : `Starting tree: ${stoppedStage ? `reaction recorded at ${stoppedStage}` : activeStage}`}>
      {lamps.map((lamp) => {
        const state = ready ? 'lit' : reactionTreeLampState(lamp.stage, activeStage, stoppedStage);
        return <span key={lamp.stage} className={`reaction-light is-${state}`}
          data-reaction-stage={lamp.stage} data-lamp-state={state} role="img"
          aria-label={`${lamp.label} light${state === 'stopped' ? ', reaction recorded here' : state === 'lit' ? ', illuminated' : ', dim'}`}
          style={{ left: `${(lamp.x - tree.x) / tree.width * 100}%`, top: `${(lamp.y - tree.y) / tree.height * 100}%`,
            width: `${lamp.width / tree.width * 100}%`, height: `${lamp.height / tree.height * 100}%` }}>
          <span className="reaction-light-bulb" style={{ backgroundImage: `url(${REACTION_SCENE_IMAGE})`,
            backgroundSize: `${REACTION_SCENE_SOURCE_WIDTH / lamp.width * 100}% ${REACTION_SCENE_SOURCE_HEIGHT / lamp.height * 100}%`,
            backgroundPosition: `${lamp.x / (REACTION_SCENE_SOURCE_WIDTH - lamp.width) * 100}% ${lamp.y / (REACTION_SCENE_SOURCE_HEIGHT - lamp.height) * 100}%` }} />
        </span>;
      })}
    </div>
  );
}
