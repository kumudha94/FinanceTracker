import SmsAndroid from 'react-native-get-sms-android';
import { API_BASE_URL, TASKER_API_KEY } from './api';

const MAX_RANGE_DAYS = 30;

export interface RawSms {
  sender: string;
  message: string;
  receivedAt: string;
}

export interface PreviewSmsResult {
  message: string;
  sender?: string;
  receivedAt?: string;
  status: 'new' | 'duplicate' | 'unmatched' | 'unparseable';
  amount?: number;
  type?: 'debit' | 'credit';
  merchant?: string;
  date?: string;
  matchedAccountName?: string;
}

// Cheap on-device pre-filter so we don't ship every OTP/promo SMS to the server for parsing.
// Must stay a superset of the debit/credit keywords server/smsParser.ts actually parses on
// (currently: debited, deducted, withdrawn, spent, used for, paid, purchase, charged, sent,
// credited, received, deposited, refunded, added, reversed) — anything missing here is silently
// dropped before the server ever sees it, which is worse than one extra discarded network call.
function looksFinancial(body: string): boolean {
  return /debited|deducted|withdrawn|spent|used for|paid|purchase|charged|sent|credited|received|deposited|refunded|added|reversed/i.test(body);
}

export function validateRescanRange(fromDate: Date, toDate: Date): string | null {
  if (fromDate > toDate) return 'Start date must be before end date';
  const days = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
  if (days > MAX_RANGE_DAYS) return `Range is limited to ${MAX_RANGE_DAYS} days — please pick a shorter range`;
  return null;
}

// Reads the on-device SMS inbox for the given date range and returns only messages that look
// like bank transaction alerts — the same cheap pre-filter the live auto-read path uses, so we
// don't waste a network round-trip sending OTPs/promos to the server for parsing.
export function scanInboxForRange(fromDate: Date, toDate: Date): Promise<RawSms[]> {
  const filter = {
    box: 'inbox',
    minDate: fromDate.getTime(),
    maxDate: toDate.getTime(),
  };

  return new Promise((resolve, reject) => {
    SmsAndroid.list(
      JSON.stringify(filter),
      (fail: string) => reject(new Error(fail)),
      (_count: number, smsList: string) => {
        const parsed: any[] = JSON.parse(smsList);
        const matches = parsed
          .filter((sms) => looksFinancial(sms.body || ''))
          .map((sms) => ({
            sender: sms.address || '',
            message: sms.body || '',
            receivedAt: new Date(Number(sms.date)).toISOString(),
          }));
        resolve(matches);
      }
    );
  });
}

export async function previewRescan(messages: RawSms[]): Promise<PreviewSmsResult[]> {
  const response = await fetch(`${API_BASE_URL}/api/parse-sms-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TASKER_API_KEY,
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Preview request failed with status ${response.status}`);
  }

  const data = await response.json();
  return data.results;
}

export async function commitRescan(messages: RawSms[]): Promise<{ successful: number; failed: number }> {
  const response = await fetch(`${API_BASE_URL}/api/parse-sms-batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TASKER_API_KEY,
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Commit request failed with status ${response.status}`);
  }

  const data = await response.json();
  return { successful: data.successful, failed: data.failed };
}
