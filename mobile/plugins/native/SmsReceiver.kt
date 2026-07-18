package com.mytracker.finance

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Telephony
import com.facebook.react.HeadlessJsTaskService

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isNullOrEmpty()) return

    val sender = messages[0].originatingAddress ?: ""
    val body = messages.joinToString(separator = "") { it.messageBody ?: "" }

    val serviceIntent = Intent(context, SmsHeadlessTaskService::class.java)
    val bundle = Bundle()
    bundle.putString("sender", sender)
    bundle.putString("body", body)
    bundle.putLong("timestamp", System.currentTimeMillis())
    serviceIntent.putExtras(bundle)

    context.startService(serviceIntent)
    HeadlessJsTaskService.acquireWakeLockNow(context)
  }
}
