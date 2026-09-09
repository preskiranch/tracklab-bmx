// Compare gameplay and saved geometry, not each tablet's camera or panel layout.
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
export function clubStudentChoiceKey(setup) {
  if (!setup?.configuration) return '';
  const { raceView, ...gameplay } = setup.configuration;
  return JSON.stringify(stable(gameplay));
}
export function clubStudentAgreement(racerIds, choices) {
  const ids = [...racerIds];
  if (ids.length < 2 || ids.length > 4) return null;
  const first = choices[ids[0]];
  const key = clubStudentChoiceKey(first);
  return key && ids.every(id => clubStudentChoiceKey(choices[id]) === key) ? first : null;
}
