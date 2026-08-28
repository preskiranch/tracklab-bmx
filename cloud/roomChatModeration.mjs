const moderationErrorMessage = 'That message was not sent because it may contain unsafe or objectionable content.';

const leetspeakCharacters = new Map([
  ['0', 'o'],
  ['1', 'i'],
  ['3', 'e'],
  ['4', 'a'],
  ['5', 's'],
  ['7', 't'],
  ['8', 'b'],
  ['@', 'a'],
  ['$', 's'],
]);

// Keep this list deliberately narrow. The filter runs before a room message is
// persisted or broadcast, and reports remain the fallback for context-dependent
// harassment that cannot be identified reliably by a word list.
const blockedWholeWords = new Set([
  'asshole',
  'bitch',
  'cunt',
  'dickhead',
  'faggot',
  'fuck',
  'fucker',
  'fucking',
  'motherfucker',
  'nigger',
  'retard',
  'retarded',
  'whore',
]);

const blockedCompactTerms = [
  'asshole',
  'bitch',
  'cunt',
  'dickhead',
  'faggot',
  'fuck',
  'motherfucker',
  'nigger',
  'retard',
  'whore',
];

const blockedPhrasePatterns = [
  // Threats and encouragement of self-harm.
  /\b(?:go\s+)?kill\s+yourself\b/u,
  /\bkys\b/u,
  /\bi(?:\s+am|'m|\s+will|'ll)?\s*(?:going\s+to\s+)?(?:kill|shoot|stab|rape|hurt)\s+you\b/u,
  /\b(?:kill|shoot|stab|rape|hurt)\s+you\b/u,
  /\b(?:go|you\s+should|i\s+hope\s+you)\s+die\b/u,
  /\b(?:i\s+)?(?:will|'ll)\s+(?:find|doxx?)\s+(?:you|your\s+(?:home|address))\b/u,
  // Sexual solicitation and exploitation, especially important for an app
  // that can be used by youth athletes.
  /\bsend\s+(?:me\s+)?(?:a\s+)?nudes?\b/u,
  /\bsend\s+(?:me\s+)?nude\s+(?:pics?|photos?)\b/u,
  /\bshow\s+(?:me\s+)?(?:yourself\s+)?naked\b/u,
  /\b(?:child|minor|underage)\s+(?:porn|sex|nudes?)\b/u,
  // Requests to move a child or athlete into unsafe private contact.
  /\bsend\s+(?:me\s+)?your\s+(?:home\s+)?address\b/u,
  /\bmeet\s+me\s+alone\b/u,
];

const blockedCompactPhrases = [
  'killyourself',
  'sendmenudes',
  'showmenaked',
  'childporn',
  'underageporn',
  'meetmealone',
];

function moderationText(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/\p{Mark}+/gu, '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\ufeff]/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[0134578@$]/g, (character) => leetspeakCharacters.get(character) ?? character)
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactModerationText(value) {
  return moderationText(value).replace(/[^\p{L}\p{N}]+/gu, '');
}

function blockedByWordOrPhrase(normalized, compact) {
  if (normalized.split(' ').some((word) => blockedWholeWords.has(word.replace(/^'+|'+$/g, '')))) {
    return true;
  }
  if (blockedPhrasePatterns.some((pattern) => pattern.test(normalized))) {
    return true;
  }
  if (blockedCompactTerms.some((term) => compact.includes(term))) {
    return true;
  }
  return blockedCompactPhrases.some((phrase) => compact.includes(phrase));
}

export function moderateRoomChatText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) {
    return {
      allowed: false,
      code: 'empty-message',
      message: 'Enter a message before sending.',
      text: '',
    };
  }

  const normalized = moderationText(text);
  const compact = compactModerationText(text);
  if (!normalized || blockedByWordOrPhrase(normalized, compact)) {
    return {
      allowed: false,
      code: 'objectionable-content',
      message: moderationErrorMessage,
      text: '',
    };
  }

  return {
    allowed: true,
    code: 'allowed',
    message: '',
    text,
  };
}

export { moderationErrorMessage };
