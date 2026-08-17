const privatePowerKeyPattern = /(?:watts?|power)/i;

export function redactPrivatePower<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => redactPrivatePower(entry)) as T;
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !privatePowerKeyPattern.test(key))
        .map(([key, entry]) => [key, redactPrivatePower(entry)]),
    ) as T;
  }

  return value;
}
