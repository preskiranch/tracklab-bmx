import { describe, expect, it } from 'vitest';
import {
  commentaryRiderNameForms,
  commentaryRiderNameParts,
  selectCommentaryRiderName,
} from '../../src/lib/commentaryNames';

describe('browser commentary rider names', () => {
  it('keeps ordinary names unchanged', () => {
    expect(commentaryRiderNameParts('Maya Torres')).toMatchObject({
      legalName: 'Maya Torres',
      nickname: '',
    });
    expect(selectCommentaryRiderName('Maya Torres', 0.7)).toBe('Maya Torres');
  });

  it('offers legal, nickname, and full spoken forms for parenthetical nicknames', () => {
    const enteredName = 'Connor Fields (The Captain)';

    expect(commentaryRiderNameForms(enteredName)).toEqual([
      enteredName,
      'Connor Fields',
      'The Captain',
      'Connor Fields, The Captain',
    ]);
    expect([
      selectCommentaryRiderName(enteredName, 0.1),
      selectCommentaryRiderName(enteredName, 0.6),
      selectCommentaryRiderName(enteredName, 0.9),
    ]).toEqual([
      'Connor Fields',
      'The Captain',
      'Connor Fields, The Captain',
    ]);
  });
});
