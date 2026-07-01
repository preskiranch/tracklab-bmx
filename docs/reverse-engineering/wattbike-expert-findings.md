# Wattbike Expert Interop Notes

This document records static-analysis findings from the installer files supplied by the project owner. The goal is interoperability with owned Wattbike hardware. Do not use these notes to bypass licensing, activation, or access controls.

## Supplied Installers

- `WattbikeExpert26020Setup (2).exe`
  - SHA-256: `3c0ff46d6d1b95402f7b6c04b2bd7ba153e33a82d60bf62a0d736f7648d1508c`
  - InstallShield wrapper containing `WATTBIKE Expert 2.60.20.msi`
- `WattbikePowerCyclingSE400Setup (1).zip`
  - SHA-256: `f6eb253af14b32ae0c9d08b553280bd0d28476cf0f19506ef363fc09a1ddf1c4`
  - Contains `WattbikePowerCyclingSE400Setup.exe`, an InstallShield wrapper containing `WATTBIKE Power Cycling Studio Edition 4.0.0.0.msi`

The installers were extracted without executing the Windows programs. The working extraction was:

1. Extract the InstallShield payload with `ISx`.
2. Extract the MSI OLE cabinet stream.
3. Extract the cabinet with 7-Zip.

## Recovered Application Files

Wattbike Expert 2.60.20:

- `wattbike_expert.exe`
- `atrs232.dll`
- `atisp.dll`
- `cdm_setup.exe`
- Access databases: `expertparameters.edb`, `expertpersonals.edb`, `racefiletemplate.rdb`

Wattbike Power Cycling Studio Edition 4.0.0.0:

- `wattbike_power_cycling_se.ex` (PE executable despite the short extension)
- `ant_dll.dll`
- `mchid.dll`
- `atrs232.dll`
- `atisp.dll`
- `cdm_setup.exe`
- Access databases: `expertparameters.edb`, `expertpersonals.edb`, `activityfiletemplate.adb`

## Connection Findings

Wattbike Expert Model B control is strongly indicated to use a local Windows USB serial/FTDI path:

- `atrs232.dll` exports `OpenRS232`, `ReadRS232`, `WriteRS232`, `ReadSerial`, `SetDtr`, `ClearDtr`, `SetRts`, `ClearRts`, `UpdateBaudrate`, and `Close`.
- `wattbike_expert.exe` references `Ftd2xx.dll`, `FT_W32_ReadFile`, `FT_W32_WriteFile`, `FT_SetBaudRate`, `FT_SetDataCharacteristics`, `FT_SetDtr`, `FT_ClrDtr`, and `FT_ListDevices`.
- The executable references `System\CurrentControlSet\Enum\FTDIBUS\VID_%04X+PID_%04X+%sA\0000\Device Parameters\PortName`, which is how FTDI virtual COM ports are discovered on Windows.
- The app includes default COM port labels `COM1` through `COM20`, plus database strings for `BaudRate`, `DataBits`, `StopBits`, `Parity`, and `Port`.
- The FTDI driver installer `cdm_setup.exe` is bundled.

The newer Power Cycling app adds HID and ANT paths:

- `mchid.dll` exports `Connect`, `Disconnect`, `Read`, `Write`, `ReadEx`, `WriteEx`, `GetVendorID`, `GetProductID`, `GetSerialNumber`, `GetInputReportLength`, and `GetOutputReportLength`.
- The executable references HID device IDs including `0xBAC0`, `0xBABF`, `0xBABD`, and `0xC1CA`.
- `ant_dll.dll` exports standard Dynastream ANT functions such as `ANT_Init`, `ANT_AssignChannel`, `ANT_SetNetworkKey`, `ANT_OpenChannel`, `ANT_SendBroadcastData`, and `ANT_RequestMessage`.
- The ANT stack references `USB\VID_0FCF&PID_10*`, matching Dynastream/Garmin ANT USB sticks.

## Current App Impact

The web app already sends these race-control actions to the local bridge:

- `race-arm` when countdown/cadence starts.
- `race-start` at the exact green light/gate-drop moment.
- `race-reset` when reset is pressed.

The bridge now supports three control modes:

- `log`: safe default; records commands but sends nothing.
- `usb-hid`: writes captured command frames to matching HID monitors.
- `serial`: writes captured command frames to configured serial/FTDI ports.

Serial mode was added because Wattbike Expert Model B appears to use FTDI/COM-port control. Example:

```sh
WATTBIKE_CONTROL=serial \
WATTBIKE_SERIAL_PORTS=COM3,COM4,COM5,COM6 \
WATTBIKE_SERIAL_BAUD=... \
WATTBIKE_RACE_ARM_HEX=... \
WATTBIKE_RACE_START_HEX=... \
WATTBIKE_RACE_RESET_HEX=... \
npm run bridge
```

The app still needs the actual command bytes from a live capture before monitor-start control should be enabled. Static strings show the transport and code path, but not enough to safely invent the race-start/reset protocol.

## Next Capture

Use the Windows PC that can already control the bikes with Wattbike Expert:

1. Connect one Wattbike by USB.
2. Run Wattbike Expert and confirm it can start/reset a short race.
3. Capture the session with USBPcap/Wireshark.
4. For Model B, inspect the FTDI virtual COM traffic first. If the monitor exposes HID, inspect HID output reports too.
5. Capture these exact moments:
   - software arms/opens the session
   - gate-drop/start
   - finish/reset/stop
6. Repeat with two bikes so we can confirm whether the command is identical per monitor or includes a device/session address.

After that capture, add the frames to `WATTBIKE_RACE_ARM_HEX`, `WATTBIKE_RACE_START_HEX`, and `WATTBIKE_RACE_RESET_HEX`, then test with one bike before enabling all four.
