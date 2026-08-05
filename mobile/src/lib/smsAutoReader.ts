import {Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import NetInfo from '@react-native-community/netinfo';
import { API_BASE_URL, TASKER_API_KEY } from './api';

const STORAGE_KEYS = {
  AUTO_READ_ENABLED: '@finance_tracker_sms_auto_read_enabled',
  PROCESSED_IDS: '@finance_tracker_sms_processed_ids',
  FAILED_QUEUE: '@finance_tracker_sms_failed_queue',
};

const MAX_PROCESSED_IDS = 200;
const MAX_QUEUE_SIZE = 50;

export interface RawSmsPayload {
  sender: string;
  body: string;
  timestamp: number;
}

interface QueuedSms {
  sender: string;
  message: string;
  receivedAt: string;
  processedKey: string;
}

interface ParseSmsResult {
  success: boolean;
  transaction?: { id: number; amount: string; type: string; merchant?: string } | null;
  parsed?: { amount: number; type: 'debit' | 'credit'; merchant?: string };
  message?: string;
}

export async function isAutoReadEnabled(): Promise<boolean> {
  const value = await AsyncStorage.getItem(STORAGE_KEYS.AUTO_READ_ENABLED);
  return value === 'true';
}

export async function setAutoReadEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.AUTO_READ_ENABLED, enabled ? 'true' : 'false');
}

export async function requestSmsAndNotificationPermissions(): Promise<{
  smsGranted: boolean;
  notificationsGranted: boolean;
}> {
  let smsGranted = false;

  // TODO: uncomment after local web testing
  // if (Platform.OS === 'android') {
  //   const results = await PermissionsAndroid.requestMultiple([
  //     PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
  //     PermissionsAndroid.PERMISSIONS.READ_SMS,
  //   ]);
  //   smsGranted =
  //     results[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === PermissionsAndroid.RESULTS.GRANTED &&
  //     results[PermissionsAndroid.PERMISSIONS.READ_SMS] === PermissionsAndroid.RESULTS.GRANTED;
  // }

  const notificationPermission = await Notifications.requestPermissionsAsync();
  const notificationsGranted = notificationPermission.granted;

  return { smsGranted, notificationsGranted };
}

export async function hasSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  // TODO: uncomment after local web testing
  // const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.READ_SMS);
  // return granted;
  return false;
}

// Cheap on-device pre-filter so we don't ship every OTP/promo SMS to the server for parsing.
// Must stay a superset of the debit/credit keywords server/smsParser.ts actually parses on
// (currently: debited, deducted, withdrawn, spent, used for, paid, purchase, charged, sent,
// credited, received, deposited, refunded, added, reversed) — anything missing here is silently
// dropped before the server ever sees it, which is worse than one extra discarded network call.
function looksFinancial(body: string): boolean {
  return /debited|deducted|withdrawn|spent|used for|paid|purchase|charged|sent|credited|received|deposited|refunded|added|reversed/i.test(body);
}

async function getProcessedIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.PROCESSED_IDS);
  return raw ? JSON.parse(raw) : [];
}

async function markProcessed(key: string): Promise<void> {
  const ids = await getProcessedIds();
  if (ids.includes(key)) return;
  const updated = [...ids, key].slice(-MAX_PROCESSED_IDS);
  await AsyncStorage.setItem(STORAGE_KEYS.PROCESSED_IDS, JSON.stringify(updated));
}

async function wasAlreadyProcessed(key: string): Promise<boolean> {
  const ids = await getProcessedIds();
  return ids.includes(key);
}

async function getQueue(): Promise<QueuedSms[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.FAILED_QUEUE);
  return raw ? JSON.parse(raw) : [];
}

async function enqueue(item: QueuedSms): Promise<void> {
  const queue = await getQueue();
  const updated = [...queue, item].slice(-MAX_QUEUE_SIZE);
  await AsyncStorage.setItem(STORAGE_KEYS.FAILED_QUEUE, JSON.stringify(updated));
}

async function setQueue(queue: QueuedSms[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.FAILED_QUEUE, JSON.stringify(queue));
}

async function postSmsToBackend(sender: string, message: string, receivedAt: string): Promise<ParseSmsResult> {
  const response = await fetch(`${API_BASE_URL}/api/parse-sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TASKER_API_KEY,
    },
    body: JSON.stringify({ sender, message, receivedAt }),
  });

  if (!response.ok) {
    throw new Error(`SMS parse request failed with status ${response.status}`);
  }

  return response.json();
}

async function notifyTransactionAdded(result: ParseSmsResult): Promise<void> {
  if (!result.transaction || !result.parsed) return;

  const { amount, type, merchant } = result.parsed;
  const verb = type === 'credit' ? 'Credited' : 'Debited';
  const merchantText = merchant ? ` at ${merchant}` : '';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `${verb} ₹${amount}${merchantText}`,
      body: 'Transaction added automatically from SMS.',
    },
    trigger: null,
  });
}

export async function drainFailedQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;

  const netState = await NetInfo.fetch();
  if (!netState.isConnected) return;

  const remaining: QueuedSms[] = [];
  for (const item of queue) {
    try {
      const result = await postSmsToBackend(item.sender, item.message, item.receivedAt);
      await markProcessed(item.processedKey);
      await notifyTransactionAdded(result);
    } catch {
      remaining.push(item);
    }
  }
  await setQueue(remaining);
}

export async function processIncomingSms(payload: RawSmsPayload): Promise<void> {
  const enabled = await isAutoReadEnabled();
  if (!enabled) return;

  if (!looksFinancial(payload.body)) return;

  const processedKey = `${payload.sender}:${payload.timestamp}:${payload.body.length}`;
  if (await wasAlreadyProcessed(processedKey)) return;

  await drainFailedQueue();

  const receivedAt = new Date(payload.timestamp).toISOString();

  try {
    const result = await postSmsToBackend(payload.sender, payload.body, receivedAt);
    await markProcessed(processedKey);
    await notifyTransactionAdded(result);
  } catch {
    await enqueue({
      sender: payload.sender,
      message: payload.body,
      receivedAt,
      processedKey,
    });
  }
}
