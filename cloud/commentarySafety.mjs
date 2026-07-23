import { commentaryRiderNameAliases } from './commentaryNames.mjs';

const forbiddenTelemetryPattern = /\b(?:watts?|wattage|rpm|cadence|speed|mph|kph|km\/?h|kilomet(?:er|re)s?\s+per\s+hour|miles?\s+per\s+hour|power\s+output|reaction\s+time|milliseconds?|meters?|metres?|feet|foot|percent(?:age)?)\b|%/i;
const forbiddenPreRaceTelemetryPattern = /\b(?:watts?|wattage|rpm|cadence|bike\s+speed|rider\s+speed|mph|kph|km\/?h|kilomet(?:er|re)s?\s+per\s+hour|miles?\s+per\s+hour|power\s+output|reaction\s+time|milliseconds?)\b/i;
const demeaningSarcasmPattern = /\b(?:idiot(?:ic)?|stupid|useless|pathetic|loser|embarrassing|terrible rider|awful rider|cannot ride|can't ride|doesn't belong|does not belong|crash(?:ed|ing)?|injur(?:y|ed))\b/i;

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function riderNameAliases(riderNames) {
  if (!Array.isArray(riderNames)) {
    return [];
  }

  return [...new Set(
    riderNames
      .filter((name) => typeof name === 'string')
      .flatMap(commentaryRiderNameAliases)
      .filter((name) => name.length >= 2),
  )].sort((left, right) => right.length - left.length);
}

function lineWithoutRiderNames(line, riderNames) {
  return riderNameAliases(riderNames).reduce(
    (remaining, name) => remaining.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegularExpression(name)}(?=$|[^\\p{L}\\p{N}])`, 'giu'),
      '$1',
    ),
    line,
  );
}

export function commentaryLineUsesForbiddenTelemetry(line, riderNames = []) {
  return forbiddenTelemetryPattern.test(lineWithoutRiderNames(line, riderNames));
}

export function commentaryLineUsesForbiddenPreRaceTelemetry(line, riderNames = []) {
  return forbiddenPreRaceTelemetryPattern.test(lineWithoutRiderNames(line, riderNames));
}

export function commentaryLineMentionsRider(line, riderNames) {
  return riderNameAliases(riderNames).some((name) => (
    new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegularExpression(name)}(?=$|[^\\p{L}\\p{N}])`,
      'iu',
    ).test(line)
  ));
}

export function commentaryLineUsesDemeaningSarcasm(line) {
  return demeaningSarcasmPattern.test(String(line || ''));
}
