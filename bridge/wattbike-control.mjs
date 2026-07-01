const actionEnvKeys = {
  'race-arm': ['WATTBIKE_RACE_ARM_HEX', 'WATTBIKE_USB_RACE_ARM_HEX'],
  'race-start': ['WATTBIKE_RACE_START_HEX', 'WATTBIKE_USB_RACE_START_HEX'],
  'race-reset': ['WATTBIKE_RACE_RESET_HEX', 'WATTBIKE_USB_RACE_RESET_HEX'],
};

function normalizeHex(value) {
  return value.replace(/[^0-9a-f]/gi, '');
}

function parseReports(value) {
  return value
    .split(';')
    .map((part) => normalizeHex(part))
    .filter(Boolean)
    .map((hex) => {
      if (hex.length % 2 !== 0) {
        throw new Error(`Invalid Wattbike command hex length: ${hex.length}`);
      }

      return Buffer.from(hex, 'hex');
    });
}

function parseList(value) {
  return (value ?? '')
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function commandHexForAction(action) {
  const envKeys = actionEnvKeys[action];
  if (!envKeys) {
    return null;
  }

  for (const envKey of envKeys) {
    const value = process.env[envKey]?.trim();
    if (value) {
      return { envKey, value };
    }
  }

  return { envKey: envKeys[0], value: null };
}

function numberFromEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value.startsWith('0x') ? Number.parseInt(value, 16) : value);
  return Number.isFinite(parsed) ? parsed : null;
}

function booleanFromEnv(name) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (['1', 'true', 'yes', 'on'].includes(value)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(value)) {
    return false;
  }

  return null;
}

function productMatches(device) {
  const vendorId = numberFromEnv('WATTBIKE_HID_VENDOR_ID');
  const productId = numberFromEnv('WATTBIKE_HID_PRODUCT_ID');
  const productMatch = process.env.WATTBIKE_HID_PRODUCT_MATCH?.trim() || 'Wattbike';

  if (vendorId != null && device.vendorId !== vendorId) {
    return false;
  }

  if (productId != null && device.productId !== productId) {
    return false;
  }

  if (vendorId != null || productId != null) {
    return true;
  }

  const haystack = `${device.manufacturer ?? ''} ${device.product ?? ''}`.toLowerCase();
  return haystack.includes(productMatch.toLowerCase());
}

function serialProductMatches(portInfo) {
  const vendorId = process.env.WATTBIKE_SERIAL_VENDOR_ID?.trim().toLowerCase();
  const productId = process.env.WATTBIKE_SERIAL_PRODUCT_ID?.trim().toLowerCase();
  const matchTerms = parseList(process.env.WATTBIKE_SERIAL_PRODUCT_MATCH || 'Wattbike,FTDI,USB Serial');

  if (vendorId && portInfo.vendorId?.toLowerCase() !== vendorId.replace(/^0x/, '')) {
    return false;
  }

  if (productId && portInfo.productId?.toLowerCase() !== productId.replace(/^0x/, '')) {
    return false;
  }

  if (vendorId || productId) {
    return true;
  }

  const haystack = [
    portInfo.manufacturer,
    portInfo.friendlyName,
    portInfo.pnpId,
    portInfo.path,
  ].filter(Boolean).join(' ').toLowerCase();

  return matchTerms.some((term) => haystack.includes(term.toLowerCase()));
}

function reportDeviceLabel(device) {
  return [
    device.manufacturer,
    device.product,
    device.serialNumber ? `serial ${device.serialNumber}` : null,
    device.vendorId != null ? `vid ${device.vendorId}` : null,
    device.productId != null ? `pid ${device.productId}` : null,
  ].filter(Boolean).join(' / ');
}

function reportSerialLabel(portInfo) {
  return [
    portInfo.path,
    portInfo.manufacturer,
    portInfo.friendlyName,
    portInfo.vendorId ? `vid ${portInfo.vendorId}` : null,
    portInfo.productId ? `pid ${portInfo.productId}` : null,
  ].filter(Boolean).join(' / ');
}

function serialConfig() {
  const baudRate = numberFromEnv('WATTBIKE_SERIAL_BAUD');
  const dataBits = numberFromEnv('WATTBIKE_SERIAL_DATA_BITS') ?? 8;
  const stopBits = numberFromEnv('WATTBIKE_SERIAL_STOP_BITS') ?? 1;
  const parity = process.env.WATTBIKE_SERIAL_PARITY?.trim() || 'none';
  const delayMs = numberFromEnv('WATTBIKE_SERIAL_WRITE_DELAY_MS') ?? 20;
  const dtr = booleanFromEnv('WATTBIKE_SERIAL_DTR');
  const rts = booleanFromEnv('WATTBIKE_SERIAL_RTS');

  return {
    baudRate,
    dataBits,
    stopBits,
    parity,
    delayMs,
    dtr,
    rts,
  };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createWattbikeControl() {
  const mode = process.env.WATTBIKE_CONTROL?.trim() || 'log';
  let HID = null;
  let SerialPortClass = null;

  async function loadHid() {
    if (HID) {
      return HID;
    }

    try {
      HID = await import('node-hid');
      return HID;
    } catch {
      throw new Error('USB HID control needs node-hid installed locally: npm install node-hid');
    }
  }

  async function loadSerialPort() {
    if (SerialPortClass) {
      return SerialPortClass;
    }

    try {
      const serial = await import('serialport');
      SerialPortClass = serial.SerialPort;
      return SerialPortClass;
    } catch {
      throw new Error('Serial/FTDI control needs serialport installed locally: npm install serialport');
    }
  }

  async function listDevices() {
    const hid = await loadHid();
    const devices = hid.default?.devices?.() ?? hid.devices?.() ?? [];
    return devices.filter((device) => device.path && productMatches(device));
  }

  async function listSerialPorts() {
    const explicitPorts = parseList(process.env.WATTBIKE_SERIAL_PORTS);
    if (explicitPorts.length > 0) {
      return explicitPorts.map((path) => ({ path }));
    }

    const SerialPort = await loadSerialPort();
    const ports = await SerialPort.list();
    return ports.filter((portInfo) => portInfo.path && serialProductMatches(portInfo));
  }

  async function writeSerialCommand(portInfo, reports) {
    const SerialPort = await loadSerialPort();
    const config = serialConfig();

    if (!config.baudRate) {
      throw new Error('WATTBIKE_SERIAL_BAUD is required for serial/FTDI monitor control.');
    }

    await new Promise((resolve, reject) => {
      const port = new SerialPort({
        path: portInfo.path,
        baudRate: config.baudRate,
        dataBits: config.dataBits,
        stopBits: config.stopBits,
        parity: config.parity,
        autoOpen: false,
      });

      const closePort = (callback) => {
        if (!port.isOpen) {
          callback();
          return;
        }

        port.close((closeError) => callback(closeError));
      };

      port.open(async (openError) => {
        if (openError) {
          reject(openError);
          return;
        }

        try {
          const controlSignals = {};
          if (config.dtr != null) {
            controlSignals.dtr = config.dtr;
          }
          if (config.rts != null) {
            controlSignals.rts = config.rts;
          }
          if (Object.keys(controlSignals).length > 0) {
            await new Promise((setResolve, setReject) => {
              port.set(controlSignals, (setError) => (setError ? setReject(setError) : setResolve()));
            });
          }

          for (const report of reports) {
            await new Promise((writeResolve, writeReject) => {
              port.write(report, (writeError) => (writeError ? writeReject(writeError) : writeResolve()));
            });
            await new Promise((drainResolve, drainReject) => {
              port.drain((drainError) => (drainError ? drainReject(drainError) : drainResolve()));
            });
            if (config.delayMs > 0) {
              await wait(config.delayMs);
            }
          }

          closePort((closeError) => (closeError ? reject(closeError) : resolve()));
        } catch (error) {
          closePort(() => reject(error));
        }
      });
    });
  }

  return {
    mode,

    async status() {
      if (mode === 'serial') {
        const ports = await listSerialPorts();
        const config = serialConfig();
        return {
          configured: Boolean(config.baudRate),
          devices: ports.map(reportSerialLabel),
          message: ports.length > 0
            ? `Wattbike serial/FTDI control found ${ports.length} candidate port${ports.length === 1 ? '' : 's'}${config.baudRate ? ` at ${config.baudRate} baud` : '; set WATTBIKE_SERIAL_BAUD before sending commands'}.`
            : 'Wattbike serial/FTDI control is enabled, but no matching serial ports were found. Set WATTBIKE_SERIAL_PORTS=COM3,COM4,... if auto-detection misses them.',
        };
      }

      if (mode !== 'usb-hid') {
        return {
          configured: false,
          message: 'Wattbike monitor control is in log mode. Race commands are recorded by the bridge but not sent to monitors.',
        };
      }

      const devices = await listDevices();
      return {
        configured: true,
        devices: devices.map(reportDeviceLabel),
        message: devices.length > 0
          ? `Wattbike USB control ready for ${devices.length} HID device${devices.length === 1 ? '' : 's'}.`
          : 'Wattbike USB control is enabled, but no matching HID Wattbike monitors were found.',
      };
    },

    async send(command) {
      const action = command?.action;
      const commandHex = commandHexForAction(action);
      if (!commandHex) {
        return {
          ok: false,
          action,
          controlledCount: 0,
          message: `Unsupported Wattbike control action: ${action}`,
        };
      }

      if (mode !== 'usb-hid' && mode !== 'serial') {
        return {
          ok: true,
          action,
          controlledCount: 0,
          message: `Wattbike control ${action} received. Control is in log mode; no monitor command was sent.`,
        };
      }

      if (!commandHex.value) {
        return {
          ok: false,
          action,
          controlledCount: 0,
          message: `${commandHex.envKey} is not set. Capture the Wattbike Expert command bytes for ${action} before enabling monitor control.`,
        };
      }

      const reports = parseReports(commandHex.value);

      if (mode === 'serial') {
        const ports = await listSerialPorts();

        if (ports.length === 0) {
          return {
            ok: false,
            action,
            controlledCount: 0,
            message: 'No matching Wattbike serial/FTDI ports found for monitor control command.',
          };
        }

        let controlledCount = 0;
        for (const portInfo of ports) {
          await writeSerialCommand(portInfo, reports);
          controlledCount += 1;
        }

        return {
          ok: true,
          action,
          controlledCount,
          message: `Sent ${action} command to ${controlledCount} Wattbike serial/FTDI port${controlledCount === 1 ? '' : 's'}.`,
        };
      }

      const hid = await loadHid();
      const HidDevice = hid.default?.HID ?? hid.HID;
      const devices = await listDevices();

      if (devices.length === 0) {
        return {
          ok: false,
          action,
          controlledCount: 0,
          message: 'No matching Wattbike HID monitors found for USB control command.',
        };
      }

      let controlledCount = 0;
      for (const device of devices) {
        const handle = new HidDevice(device.path);
        try {
          reports.forEach((report) => handle.write([...report]));
          controlledCount += 1;
        } finally {
          handle.close?.();
        }
      }

      return {
        ok: true,
        action,
        controlledCount,
        message: `Sent ${action} command to ${controlledCount} Wattbike HID monitor${controlledCount === 1 ? '' : 's'}.`,
      };
    },
  };
}
