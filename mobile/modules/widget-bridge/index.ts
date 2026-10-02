import { requireOptionalNativeModule } from 'expo-modules-core';

const WidgetBridge = requireOptionalNativeModule('WidgetBridge');

export function syncWidgetAuth(accessToken: string, refreshToken: string): Promise<void> {
  if (!WidgetBridge) return Promise.resolve();
  return WidgetBridge.syncWidgetAuth(accessToken, refreshToken);
}

export function syncWidgetAccessToken(accessToken: string): Promise<void> {
  if (!WidgetBridge) return Promise.resolve();
  return WidgetBridge.syncWidgetAccessToken(accessToken);
}

export function clearWidgetAuth(): Promise<void> {
  if (!WidgetBridge) return Promise.resolve();
  return WidgetBridge.clearWidgetAuth();
}

export function refreshWidgets(): Promise<void> {
  if (!WidgetBridge) return Promise.resolve();
  return WidgetBridge.refreshWidgets();
}
