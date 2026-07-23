export type CommentaryRiderNameParts = {
  enteredName: string;
  legalName: string;
  nickname: string;
  fullCall: string;
};

function normalizedName(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function commentaryRiderNameParts(value: string): CommentaryRiderNameParts {
  const enteredName = normalizedName(value);
  const nicknameMatch = enteredName.match(/^(.+?)\s*\(([^()]+)\)$/u);
  const legalName = normalizedName(nicknameMatch?.[1] ?? enteredName);
  const nickname = normalizedName(nicknameMatch?.[2] ?? '');

  if (!legalName || !nickname || legalName.toLocaleLowerCase() === nickname.toLocaleLowerCase()) {
    return {
      enteredName,
      legalName: enteredName,
      nickname: '',
      fullCall: enteredName,
    };
  }

  return {
    enteredName,
    legalName,
    nickname,
    fullCall: `${legalName}, ${nickname}`,
  };
}

export function selectCommentaryRiderName(value: string, randomValue: number) {
  const parts = commentaryRiderNameParts(value);
  if (!parts.nickname) {
    return parts.enteredName;
  }

  const selection = Number.isFinite(randomValue)
    ? Math.max(0, Math.min(0.999999, randomValue))
    : 0;
  if (selection < 0.48) {
    return parts.legalName;
  }
  if (selection < 0.78) {
    return parts.nickname;
  }
  return parts.fullCall;
}

export function commentaryRiderNameForms(value: string) {
  const parts = commentaryRiderNameParts(value);
  return [...new Set([
    parts.enteredName,
    parts.legalName,
    parts.nickname,
    parts.fullCall,
  ].filter(Boolean))];
}
