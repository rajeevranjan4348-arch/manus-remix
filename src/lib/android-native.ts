import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { Geolocation } from '@capacitor/geolocation';
import { Device } from '@capacitor/device';

/**
 * Small, explicit native-capability helpers for features that request access
 * only after a user action. They do not grant permissions silently.
 */
export const isAndroidNative = (): boolean =>
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function requestCameraAccess() {
  if (!Capacitor.isNativePlatform()) {
    return { granted: false, platform: 'web' as const, message: 'Use the browser camera permission prompt.' };
  }
  const status = await Camera.requestPermissions({ permissions: ['camera'] });
  return {
    granted: status.camera === 'granted',
    platform: Capacitor.getPlatform(),
    status,
  };
}

export async function requestLocationAccess() {
  if (!Capacitor.isNativePlatform()) {
    return { granted: false, platform: 'web' as const, message: 'Use the browser location permission prompt.' };
  }
  const current = await Geolocation.checkPermissions();
  const status = current.location === 'granted' || current.coarseLocation === 'granted'
    ? current
    : await Geolocation.requestPermissions();
  return {
    granted: status.location === 'granted' || status.coarseLocation === 'granted',
    platform: Capacitor.getPlatform(),
    status,
  };
}

export async function getNativeDeviceInfo() {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }
  // Return only general device metadata; never collect unique identifiers here.
  const info = await Device.getInfo();
  return {
    platform: info.platform,
    operatingSystem: info.operatingSystem,
    osVersion: info.osVersion,
    model: info.model,
    manufacturer: info.manufacturer,
    isVirtual: info.isVirtual,
  };
}
