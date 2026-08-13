import { processIncomingNotification, RawNotificationPayload } from '../lib/notificationAutoReader';

export default async function notificationAutoParseTask(data: RawNotificationPayload): Promise<void> {
  try {
    await processIncomingNotification(data);
  } catch (error) {
    console.error('[NotificationAutoParseTask] failed to process incoming notification:', error);
  }
}
