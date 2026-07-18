import { processIncomingSms, RawSmsPayload } from '../lib/smsAutoReader';

export default async function smsAutoParseTask(data: RawSmsPayload): Promise<void> {
  try {
    await processIncomingSms(data);
  } catch (error) {
    console.error('[SmsAutoParseTask] failed to process incoming SMS:', error);
  }
}
