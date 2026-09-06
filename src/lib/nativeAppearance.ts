import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';

/** Match browser chrome and native status icons to the visible app surface. */
export function setAppSurfaceAppearance(darkExperience: boolean) {
  if (typeof document !== 'undefined') {
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', darkExperience ? '#000000' : '#ffffff');
  }

  if (!Capacitor.isNativePlatform()) return;

  // SystemBars names the surface style: Dark uses light icons, and vice versa.
  void SystemBars.setStyle({
    style: darkExperience ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  }).catch(() => {
    // Older native shells can lack SystemBars; that must not block the app.
  });
}
