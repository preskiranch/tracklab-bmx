function normalizedName(value) {
  return typeof value === 'string'
    ? value.trim().replace(/\s+/g, ' ')
    : '';
}

export function commentaryRiderNameParts(value) {
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

export function commentaryRiderNameForms(value) {
  const parts = commentaryRiderNameParts(value);
  return [...new Set([
    parts.enteredName,
    parts.legalName,
    parts.nickname,
    parts.fullCall,
  ].filter(Boolean))];
}

export function commentaryRiderNameAliases(value) {
  const parts = commentaryRiderNameParts(value);
  const forms = commentaryRiderNameForms(value);
  return [...new Set([
    ...forms,
    ...parts.legalName.split(/[\s,]+/u),
  ].filter((name) => name.length >= 2))]
    .sort((left, right) => right.length - left.length);
}

export function selectCommentaryRiderName(value, randomValue = Math.random()) {
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

export function commentaryRiderNameFact(value) {
  const parts = commentaryRiderNameParts(value);
  return parts.nickname
    ? {
      enteredName: parts.enteredName,
      legalName: parts.legalName,
      nickname: parts.nickname,
      fullCall: parts.fullCall,
    }
    : {
      enteredName: parts.enteredName,
      legalName: parts.legalName,
    };
}
