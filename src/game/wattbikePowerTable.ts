// Source: Wattbike Pro & Air-Pro High power/resistance/cadence table.
// Wattbike publishes rows through 130 rpm, rounded to the nearest 5 W; BMX demo sprints extrapolate above that range.
const proAirHighPowerRows = [
  { cadence: 40, watts: [25, 30, 30, 40, 45, 45, 50, 50, 55, 55] },
  { cadence: 45, watts: [35, 40, 40, 45, 50, 55, 55, 60, 60, 65] },
  { cadence: 50, watts: [40, 40, 50, 55, 60, 65, 70, 70, 75, 80] },
  { cadence: 55, watts: [50, 50, 60, 70, 75, 80, 90, 95, 100, 105] },
  { cadence: 60, watts: [60, 60, 70, 80, 90, 100, 110, 115, 120, 125] },
  { cadence: 65, watts: [70, 80, 90, 100, 115, 125, 135, 150, 155, 160] },
  { cadence: 70, watts: [85, 90, 105, 120, 135, 150, 165, 175, 185, 190] },
  { cadence: 75, watts: [100, 105, 130, 150, 175, 185, 200, 210, 225, 240] },
  { cadence: 80, watts: [115, 125, 150, 170, 195, 215, 235, 250, 270, 280] },
  { cadence: 85, watts: [130, 145, 170, 195, 225, 260, 275, 295, 320, 340] },
  { cadence: 90, watts: [150, 165, 200, 235, 265, 300, 325, 350, 375, 390] },
  { cadence: 95, watts: [175, 185, 225, 265, 310, 350, 375, 400, 425, 450] },
  { cadence: 100, watts: [195, 215, 260, 310, 355, 395, 430, 465, 500, 520] },
  { cadence: 105, watts: [210, 230, 295, 350, 400, 445, 490, 525, 565, 600] },
  { cadence: 110, watts: [245, 270, 330, 395, 455, 510, 555, 600, 645, 675] },
  { cadence: 115, watts: [270, 310, 380, 445, 515, 575, 625, 675, 725, 760] },
  { cadence: 120, watts: [300, 335, 410, 490, 570, 640, 695, 750, 810, 850] },
  { cadence: 125, watts: [330, 370, 450, 545, 635, 710, 775, 835, 900, 945] },
  { cadence: 130, watts: [360, 405, 495, 600, 705, 785, 855, 925, 995, 1045] },
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function wattsAtResistance(row: typeof proAirHighPowerRows[number], resistanceLevel: number) {
  const level = clamp(resistanceLevel, 1, 10);
  const lowerLevel = Math.floor(level);
  const upperLevel = Math.ceil(level);
  const lowerWatts = row.watts[lowerLevel - 1] ?? row.watts[0];
  const upperWatts = row.watts[upperLevel - 1] ?? row.watts[row.watts.length - 1];

  return lerp(lowerWatts, upperWatts, level - lowerLevel);
}

export function wattbikeProAirHighWattsFromCadence(cadenceRpm: number | null | undefined, resistanceLevel: number) {
  const cadence = Math.max(0, cadenceRpm ?? 0);
  if (cadence === 0) {
    return 0;
  }

  const firstRow = proAirHighPowerRows[0];
  const lastRow = proAirHighPowerRows[proAirHighPowerRows.length - 1];

  if (cadence <= firstRow.cadence) {
    const firstWatts = wattsAtResistance(firstRow, resistanceLevel);
    return firstWatts * Math.pow(cadence / firstRow.cadence, 2.35);
  }

  for (let index = 1; index < proAirHighPowerRows.length; index += 1) {
    const lowerRow = proAirHighPowerRows[index - 1];
    const upperRow = proAirHighPowerRows[index];

    if (cadence <= upperRow.cadence) {
      const progress = (cadence - lowerRow.cadence) / (upperRow.cadence - lowerRow.cadence);
      return lerp(
        wattsAtResistance(lowerRow, resistanceLevel),
        wattsAtResistance(upperRow, resistanceLevel),
        progress,
      );
    }
  }

  const previousRow = proAirHighPowerRows[proAirHighPowerRows.length - 2];
  const previousWatts = wattsAtResistance(previousRow, resistanceLevel);
  const lastWatts = wattsAtResistance(lastRow, resistanceLevel);
  const curveExponent = clamp(
    Math.log(lastWatts / previousWatts) / Math.log(lastRow.cadence / previousRow.cadence),
    2.15,
    3.05,
  );

  return lastWatts * Math.pow(cadence / lastRow.cadence, curveExponent);
}
