import { EventEmitter } from 'node:events';

const POWER_EVENT_NAMES = [
  'powerData',
  'bikePowerData',
  'bicyclePowerData',
  'cyclingPowerData',
];

function normalizePowerSample(raw) {
  const deviceId = raw.DeviceId ?? raw.DeviceID ?? raw.deviceId ?? raw.id;
  const watts = raw.Power
    ?? raw.InstantaneousPower
    ?? raw.CalculatedPower
    ?? raw.computedPower
    ?? raw.watts;
  const cadence = raw.Cadence
    ?? raw.InstantaneousCadence
    ?? raw.CalculatedCadence
    ?? raw.cadence;
  const speedKph = raw.SpeedKph ?? raw.Speed ?? raw.speedKph;

  if (!deviceId || watts == null) {
    return null;
  }

  return {
    at: Date.now(),
    source: 'ant',
    deviceId: Number(deviceId),
    label: `ANT+ ${deviceId}`,
    watts: Math.max(0, Math.round(Number(watts))),
    cadence: cadence == null ? null : Math.max(0, Math.round(Number(cadence))),
    speedKph: speedKph == null ? null : Math.max(0, Math.round(Number(speedKph) * 10) / 10),
    signal: 1,
  };
}

function getBikePowerScannerClass(Ant) {
  return Ant.BicyclePowerScanner
    ?? Ant.BikePowerScanner
    ?? Ant.PowerScanner
    ?? Ant.CyclingPowerScanner
    ?? null;
}

export function createAntSource() {
  const emitter = new EventEmitter();
  let stick = null;
  let powerScanner = null;

  emitter.start = async () => {
    const Ant = await import('ant-plus-next');
    const StickClass = Ant.GarminStick3 ?? Ant.GarminStick2;
    const PowerScannerClass = getBikePowerScannerClass(Ant);

    if (!StickClass) {
      throw new Error('ant-plus-next did not expose GarminStick2/GarminStick3.');
    }

    if (!PowerScannerClass) {
      const exports = Object.keys(Ant).sort().join(', ');
      throw new Error(`ant-plus-next bicycle power scanner export not found. Exports: ${exports}`);
    }

    stick = new StickClass();
    powerScanner = new PowerScannerClass(stick);

    for (const eventName of POWER_EVENT_NAMES) {
      powerScanner.on(eventName, (raw) => {
        const sample = normalizePowerSample(raw);
        if (sample) {
          emitter.emit('bike', sample);
        }
      });
    }

    powerScanner.on('attached', () => {
      emitter.emit('status', {
        at: Date.now(),
        message: 'ANT+ bicycle power scan attached. Pedal each Wattbike to wake it.',
      });
    });

    powerScanner.on('detached', () => {
      emitter.emit('status', {
        at: Date.now(),
        message: 'ANT+ bicycle power scanner detached.',
      });
    });

    stick.on('startup', () => {
      emitter.emit('status', {
        at: Date.now(),
        message: 'ANT+ USB stick started. Scanning for all bicycle power devices.',
      });
      powerScanner.scan();
    });

    const opened = await stick.open();
    if (!opened) {
      throw new Error('ANT+ USB stick was not found or could not be opened.');
    }
  };

  emitter.stop = async () => {
    try {
      await powerScanner?.detach?.();
    } finally {
      await stick?.close?.();
    }
  };

  return emitter;
}
