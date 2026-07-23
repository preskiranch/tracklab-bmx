import { describe, expect, it } from 'vitest';
import {
  commentaryLineSimilarity,
  commentaryLineWordCount,
  selectNovelCommentaryLine,
} from '../../cloud/commentaryVariation.mjs';

describe('adaptive commentary variation', () => {
  it('recognizes repeated lines and repeated openings', () => {
    expect(commentaryLineWordCount('Avery flies—Blake gives chase!')).toBe(5);
    expect(commentaryLineSimilarity(
      'Avery makes the move and takes over.',
      'Avery makes the move and takes over!',
    )).toBe(1);
    expect(commentaryLineSimilarity(
      'Avery makes the move through turn one.',
      'Avery makes the move down the last straight.',
    )).toBeGreaterThan(commentaryLineSimilarity(
      'Avery makes the move through turn one.',
      'Here comes Blake, charging into the lead.',
    ));
  });

  it('selects the candidate least like recent race calls', () => {
    const selected = selectNovelCommentaryLine([
      'Avery makes the move and takes over!',
      'Avery makes the move into the lead!',
      'Here comes Avery, sweeping around Blake!',
    ], [
      'Avery makes the move and takes over.',
      'Avery makes the move through the rhythm section.',
    ], () => 0);

    expect(selected).toBe('Here comes Avery, sweeping around Blake!');
  });

  it('varies among equally fresh candidates instead of always taking the first', () => {
    const candidates = [
      'Avery leads the charge.',
      'Blake stays right there.',
      'Jordan flies into turn one.',
    ];

    expect(selectNovelCommentaryLine(candidates, [], () => 0)).toBe(candidates[0]);
    expect(selectNovelCommentaryLine(candidates, [], () => 0.999)).toBe(candidates[2]);
  });
});
