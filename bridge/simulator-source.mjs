import { EventEmitter } from 'node:events';

const players = [
  { deviceId: 18421, name: 'Wattbike A', phase: 0.1, color: 'lime' },
  { deviceId: 18434, name: 'Wattbike B', phase: 1.4, color: 'red' },
  { deviceId: 18452, name: 'Wattbike C', phase: 2.3, color: 'blue' },
  { deviceId: 18477, name: 'Wattbike D', phase: 3.1, color: 'yellow' },
];

export function createSimulatorSource() {
  const emitter = new EventEmitter();
  let timer = null;
  const startedAt = Date.now();

  emitter.start = async () => {
    emitter.emit('status', {
      at: Date.now(),
      message: 'Simulator source active with four virtual Wattbikes.',
      devices: players.map((bike) => ({
        deviceId: bike.deviceId,
        label: bike.name,
        connected: true,
        signal: 0.92,
      })),
    });

    timer = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      for (const bike of players) {
        const sprint = Math.max(0, Math.sin(elapsed * 0.43 + bike.phase) - 0.74) * 420;
        const watts = Math.round(185 + 70 * Math.sin(elapsed * 0.7 + bike.phase) + sprint);
        const cadence = Math.round(84 + 13 * Math.sin(elapsed * 0.54 + bike.phase * 1.7) + sprint / 38);
        const speedKph = Math.max(8, Math.round((watts / 9.4 + cadence / 7) * 10) / 10);

        emitter.emit('bike', {
          at: Date.now(),
          source: 'sim',
          deviceId: bike.deviceId,
          label: bike.name,
          watts,
          cadence,
          speedKph,
          signal: 0.88 + 0.08 * Math.sin(elapsed + bike.phase),
          battery: 1,
        });
      }
    }, 120);
  };

  emitter.stop = async () => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  return emitter;
}
