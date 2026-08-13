import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { API_BASE_URL, TASKER_API_KEY } from './api';

const STORAGE_KEYS = {
  AUTO_READ_ENABLED: '@finance_tracker_notification_auto_read_enabled',
  PROCESSED_IDS: '@finance_tracker_notification_processed_ids',
  FAILED_QUEUE: '@finance_tracker_notification_failed_queue',
};

const MAX_PROCESSED_IDS = 200;
const MAX_QUEUE_SIZE = 50;

export interface RawNotificationPayload {
  appPackage: string;
  key: string;
  postTime: number;
  extras?: {
    'android.title'?: string;
    'android.text'?: string;
    'android.bigText'?: string;
    [k: string]: unknown;
  };
}

interface QueuedNotification {
  sender: string;
  message: string;
  receivedAt: string;
  processedKey: string;
}

interface ParseNotificationResult {
  success: boolean;
  transaction?: { id: number; amount: string; type: string; merchant?: string } | null;
  parsed?: { amount: number; type: 'debit' | 'credit'; merchant?: string };
  message?: string;
}

export async function isNotificationAutoReadEnabled(): Promise<boolean> {
  const value = await AsyncStorage.getItem(STORAGE_KEYS.AUTO_READ_ENABLED);
  return value === 'true';
}

export async function setNotificationAutoReadEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.AUTO_READ_ENABLED, enabled ? 'true' : 'false');
}

// Cheap on-device pre-filter so most notifications never reach the server. Must stay a
// superset of what server/smsParser.ts's DUE_KEYWORDS actually acts on — deliberately
// excludes bare "payment" (matches confirmation/success notifications, not just reminders;
// see docs/superpowers/specs/2026-08-09-notification-bill-capture-design.md).
function looksLikeBillReminder(text: string): boolean {
  return /due|bill|recharge|expires|expiring|outstanding|overdue|renew|premium/i.test(text);
}

// FNV-1a, good enough for a cheap local content fingerprint (not cryptographic use).
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function extractText(payload: RawNotificationPayload): { title: string; body: string } {
  const extras = payload.extras || {};
  const title = typeof extras['android.title'] === 'string' ? extras['android.title'] : '';
  // Prefer bigText (BigTextStyle notifications truncate the plain text field) — see Global
  // Constraints in the plan this file was built from.
  const body =
    typeof extras['android.bigText'] === 'string' ? extras['android.bigText'] :
    typeof extras['android.text'] === 'string' ? extras['android.text'] : '';
  return { title, body };
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

async function getQueue(): Promise<QueuedNotification[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEYS.FAILED_QUEUE);
  return raw ? JSON.parse(raw) : [];
}

async function enqueue(item: QueuedNotification): Promise<void> {
  const queue = await getQueue();
  const updated = [...queue, item].slice(-MAX_QUEUE_SIZE);
  await AsyncStorage.setItem(STORAGE_KEYS.FAILED_QUEUE, JSON.stringify(updated));
}

async function setQueue(queue: QueuedNotification[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEYS.FAILED_QUEUE, JSON.stringify(queue));
}

async function postNotificationToBackend(sender: string, message: string, receivedAt: string): Promise<ParseNotificationResult> {
  const response = await fetch(`${API_BASE_URL}/api/parse-sms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TASKER_API_KEY,
    },
    body: JSON.stringify({ sender, message, receivedAt, source: 'notification' }),
  });

  if (!response.ok) {
    throw new Error(`Notification parse request failed with status ${response.status}`);
  }

  return response.json();
}

export async function drainFailedNotificationQueue(): Promise<void> {
  const queue = await getQueue();
  if (queue.length === 0) return;

  const netState = await NetInfo.fetch();
  if (!netState.isConnected) return;

  const remaining: QueuedNotification[] = [];
  for (const item of queue) {
    try {
      await postNotificationToBackend(item.sender, item.message, item.receivedAt);
      await markProcessed(item.processedKey);
    } catch {
      remaining.push(item);
    }
  }
  await setQueue(remaining);
}

export async function processIncomingNotification(payload: RawNotificationPayload): Promise<void> {
  const enabled = await isNotificationAutoReadEnabled();
  if (!enabled) return;

  const { title, body } = extractText(payload);
  const fullText = `${title}\n${body}`.trim();
  if (!fullText) return;

  if (!looksLikeBillReminder(fullText)) return;

  // sbn.key alone would miss content changes to the same logical notification (a reminder
  // updating from "expires tomorrow" to "expires today" reuses the same key) — combine with
  // a content hash so a materially changed repost is treated as new, not silently dropped.
  const processedKey = `${payload.key}:${hashText(fullText)}`;
  if (await wasAlreadyProcessed(processedKey)) return;

  await drainFailedNotificationQueue();

  const receivedAt = new Date(payload.postTime).toISOString();
  const sender = payload.appPackage;

  try {
    await postNotificationToBackend(sender, fullText, receivedAt);
    await markProcessed(processedKey);
  } catch {
    await enqueue({
      sender,
      message: fullText,
      receivedAt,
      processedKey,
    });
  }
}
