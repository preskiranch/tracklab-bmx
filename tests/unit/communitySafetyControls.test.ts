import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(path, 'utf8');

describe('community safety controls', () => {
  it('keeps report and block actions visible from rider safety menus', () => {
    const friends = source('src/components/FriendsView.tsx');
    const multiplayer = source('src/components/MultiplayerPanel.tsx');
    const multiplayerHook = source('src/hooks/useMultiplayer.ts');

    expect(friends).toContain('Safety actions for');
    expect(friends).toContain('> Block</button>');
    expect(friends).toContain('> Report</button>');
    expect(friends).toContain('Submit report');
    expect(friends).toContain('Blocked riders cannot find you');

    expect(multiplayer).toContain('Room rider controls');
    expect(multiplayer).toContain('onReportRoomMember(member.id)');
    expect(multiplayer).toContain('onBlockRoomMember(member.id)');
    expect(multiplayer).toContain('<Flag size={14} /> Report');
    expect(multiplayer).toContain('<ShieldOff size={14} /> Block');

    expect(multiplayerHook).toContain("type: 'room-report'");
    expect(multiplayerHook).toContain("type: 'room-block'");
    expect(multiplayerHook).toContain("message.type === 'room-safety-result'");
  });

  it('keeps microphone mute and direct-chat end controls visible', () => {
    const multiplayer = source('src/components/MultiplayerPanel.tsx');
    const explore = source('src/components/ExploreView.tsx');
    const race = source('src/components/EarthTrackView.tsx');
    const directAudio = source('src/components/LiveFriendAudioCoordinator.tsx');

    expect(multiplayer).toContain("voiceEnabled ? 'Mute voice' : 'Enable voice'");
    expect(multiplayer).toContain('Off by default. TrackLab does not record room audio.');
    expect(explore).toContain("voiceEnabled ? 'Mute microphone' : 'Enable microphone'");
    expect(race).toContain("voiceEnabled ? 'Mute room microphone' : 'Enable room microphone'");
    expect(directAudio).toContain("voiceEnabled ? 'Mute'");
    expect(directAudio).toContain("ending ? 'Ending…' : 'End'");
    expect(directAudio).toContain('await onVoiceStop();');
    expect(directAudio).toContain('await onLeaveRoom();');
  });
});
