package com.mytracker.finance

import android.app.Notification
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.HeadlessJsTaskService

class NotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    // Deliberately minimal: this callback runs on the listener's main thread and blocking
    // here (e.g. a PackageManager call) risks delaying notification delivery system-wide,
    // not just for this app. All resolution/parsing work happens in the headless task,
    // off this critical path. The skips below are cheap bitwise/string checks only — no
    // PackageManager calls, no regex.

    // Persistent/foreground-service notifications (music players, downloads, etc.) — not
    // user-facing bill/due content, and re-fire repeatedly while ongoing.
    if (sbn.notification.flags and Notification.FLAG_ONGOING_EVENT != 0) return
    // Group-summary placeholders, not real notification content.
    if (sbn.notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
    // This app's own notifications (e.g. confirmation toasts).
    if (sbn.packageName == packageName) return

    val extras = sbn.notification.extras
    val serviceIntent = Intent(this, NotificationHeadlessTaskService::class.java)
    serviceIntent.putExtra("appPackage", sbn.packageName)
    serviceIntent.putExtra("key", sbn.key)
    serviceIntent.putExtra("postTime", sbn.postTime)
    serviceIntent.putExtra("title", extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: "")
    serviceIntent.putExtra("bigText", extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString() ?: "")
    serviceIntent.putExtra("text", extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: "")

    startService(serviceIntent)
    HeadlessJsTaskService.acquireWakeLockNow(this)
  }
}
