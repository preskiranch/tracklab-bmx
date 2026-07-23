function normalizedTokens(line) {
  return String(line || '')
    .normalize('NFKD')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function commentaryLineWordCount(line) {
  return normalizedTokens(line).length;
}

function ngrams(tokens, size) {
  if (tokens.length < size) {
    return [];
  }
  return Array.from(
    { length: tokens.length - size + 1 },
    (_, index) => tokens.slice(index, index + size).join(' '),
  );
}

function jaccardSimilarity(leftValues, rightValues) {
  const left = new Set(leftValues);
  const right = new Set(rightValues);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) {
      intersection += 1;
    }
  }
  return intersection / (left.size + right.size - intersection);
}

export function commentaryLineSimilarity(leftLine, rightLine) {
  const left = normalizedTokens(leftLine);
  const right = normalizedTokens(rightLine);
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  if (left.join(' ') === right.join(' ')) {
    return 1;
  }

  let openingSimilarity = left[0] === right[0] ? 0.42 : 0;
  if (left.slice(0, 2).join(' ') === right.slice(0, 2).join(' ')) {
    openingSimilarity = 0.72;
  }
  if (left.slice(0, 3).join(' ') === right.slice(0, 3).join(' ')) {
    openingSimilarity = 0.9;
  }

  return Math.max(
    openingSimilarity,
    jaccardSimilarity(left, right) * 0.82,
    jaccardSimilarity(ngrams(left, 2), ngrams(right, 2)),
  );
}

export function selectNovelCommentaryLine(candidates, recentLines = [], random = Math.random) {
  const uniqueCandidates = [...new Map(
    candidates
      .filter((line) => typeof line === 'string' && line.trim())
      .map((line) => [normalizedTokens(line).join(' '), line.trim()]),
  ).values()];
  if (uniqueCandidates.length === 0) {
    return '';
  }

  const ranked = uniqueCandidates
    .map((line) => ({
      line,
      similarity: recentLines.reduce(
        (highest, recentLine) => Math.max(
          highest,
          commentaryLineSimilarity(line, recentLine),
        ),
        0,
      ),
    }))
    .sort((left, right) => left.similarity - right.similarity);
  const bestSimilarity = ranked[0].similarity;
  const nearBest = ranked.filter((candidate) => (
    candidate.similarity <= bestSimilarity + 0.08
  ));
  const randomIndex = Math.min(
    nearBest.length - 1,
    Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * nearBest.length),
  );
  return nearBest[randomIndex].line;
}
