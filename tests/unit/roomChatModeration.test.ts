import { describe, expect, it } from 'vitest';
import { moderateRoomChatText } from '../../cloud/roomChatModeration.mjs';

describe('room chat moderation', () => {
  it('allows ordinary race and training conversation', () => {
    expect(moderateRoomChatText('Great lap — see you at the gate!')).toEqual({
      allowed: true,
      code: 'allowed',
      message: '',
      text: 'Great lap — see you at the gate!',
    });
    expect(moderateRoomChatText('That last straight is killing me today.').allowed).toBe(true);
    expect(moderateRoomChatText('Can you send me the track address?').allowed).toBe(true);
  });

  it('rejects profanity and common obfuscation', () => {
    expect(moderateRoomChatText('you are an asshole')).toMatchObject({
      allowed: false,
      code: 'objectionable-content',
      text: '',
    });
    expect(moderateRoomChatText('f.u.c.k you').allowed).toBe(false);
    expect(moderateRoomChatText('you are a f4gg0t').allowed).toBe(false);
    expect(moderateRoomChatText('you n\u200bi\u200bg\u200bg\u200be\u200br').allowed).toBe(false);
  });

  it('rejects threats, self-harm encouragement, and sexual solicitation', () => {
    expect(moderateRoomChatText('go kill yourself').allowed).toBe(false);
    expect(moderateRoomChatText('you should die').allowed).toBe(false);
    expect(moderateRoomChatText('I will hurt you').allowed).toBe(false);
    expect(moderateRoomChatText('send me nudes').allowed).toBe(false);
    expect(moderateRoomChatText('meet me alone').allowed).toBe(false);
  });

  it('returns a clear validation response for empty content', () => {
    expect(moderateRoomChatText('   ')).toEqual({
      allowed: false,
      code: 'empty-message',
      message: 'Enter a message before sending.',
      text: '',
    });
  });
});
