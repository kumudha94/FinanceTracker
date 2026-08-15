import { requireOptionalNativeModule } from 'expo-modules-core';

const NotificationListenerBridge = requireOptionalNativeModule('NotificationListenerBridge');

export function isNotificationListenerEnabled(): Promise<boolean> {
  if (!NotificationListenerBridge) return Promise.resolve(false);
  return NotificationListenerBridge.isEnabled();
}
