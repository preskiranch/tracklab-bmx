import { existsSync, readFileSync } from 'node:fs';

export function parseEnvText(text) {
  const parsed = {};

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

export function loadEnvFiles(paths = ['.env.local', '.env']) {
  const loaded = {};

  for (const path of paths) {
    if (!existsSync(path)) {
      continue;
    }

    Object.assign(loaded, parseEnvText(readFileSync(path, 'utf8')));
  }

  return loaded;
}

export function envValue(key, loadedEnv = {}) {
  return process.env[key]?.trim() || loadedEnv[key]?.trim() || '';
}

export function redacted(value) {
  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return '*'.repeat(value.length);
  }

  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
