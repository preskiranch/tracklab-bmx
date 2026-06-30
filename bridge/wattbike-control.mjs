const actionEnvKeys = {
  'race-arm': 'WATTBIKE_USB_RACE_ARM_HEX',
  'race-start': 'WATTBIKE_USB_RACE_START_HEX',
  'race-reset': 'WATTBIKE_USB_RACE_RESET_HEX',
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
        throw new Error(`Invalid HID report hex length: ${hex.length}`);
      }

      return Buffer.from(hex, 'hex');
    });
}

function numberFromEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value.startsWith('0x') ? Number.parseInt(value, 16) : value);
  return Number.isFinite(parsed) ? parsed : null;
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

function reportDeviceLabel(device) {
  return [
    device.manufacturer,
    device.product,
    device.serialNumber ? `serial ${device.serialNumber}` : null,
    device.vendorId != null ? `vid ${device.vendorId}` : null,
    device.productId != null ? `pid ${device.productId}` : null,
  ].filter(Boolean).join(' / ');
}

export function createWattbikeControl() {
  const mode = process.env.WATTBIKE_CONTROL?.trim() || 'log';
  let HID = null;

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

  async function listDevices() {
    const hid = await loadHid();
    const devices = hid.default?.devices?.() ?? hid.devices?.() ?? [];
    return devices.filter((device) => device.path && productMatches(device));
  }

  return {
    mode,

    async status() {
      if (mode !== 'usb-hid') {
        return {
          configured: false,
          message: 'Wattbike USB control is in log mode. Race commands are recorded by the bridge but not sent to monitors.',
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
      const envKey = actionEnvKeys[action];
      if (!envKey) {
        return {
          ok: false,
          action,
          controlledCount: 0,
          message: `Unsupported Wattbike control action: ${action}`,
        };
      }

      if (mode !== 'usb-hid') {
        return {
          ok: true,
          action,
          controlledCount: 0,
          message: `Wattbike control ${action} received. USB control is in log mode; no monitor command was sent.`,
        };
      }

      const reportsValue = process.env[envKey]?.trim();
      if (!reportsValue) {
        return {
          ok: false,
          action,
          controlledCount: 0,
          message: `${envKey} is not set. Capture the Wattbike Expert USB/HID report for ${action} before enabling monitor control.`,
        };
      }

      const reports = parseReports(reportsValue);
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
