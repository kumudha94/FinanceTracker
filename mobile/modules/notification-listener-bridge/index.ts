import { requireNativeModule } from 'expo-modules-core';

const NotificationListenerBridge = requireNativeModule('NotificationListenerBridge');

export function isNotificationListenerEnabled(): Promise<boolean> {
  return NotificationListenerBridge.isEnabled();
}
