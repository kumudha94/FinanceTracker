package com.mytracker.finance

import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.facebook.react.HeadlessJsTaskService

class NotificationListener : NotificationListenerService() {
  override fun onNotificationPosted(sbn: StatusBarNotification) {
    // Deliberately minimal: this callback runs on the listener's main thread and blocking
    // here (e.g. a PackageManager call) risks delaying notification delivery system-wide,
    // not just for this app. All resolution/parsing work happens in the headless task,
    // off this critical path.
    val serviceIntent = Intent(this, NotificationHeadlessTaskService::class.java)
    serviceIntent.putExtra("appPackage", sbn.packageName)
    serviceIntent.putExtra("key", sbn.key)
    serviceIntent.putExtra("postTime", sbn.postTime)
    serviceIntent.putExtra("extras", sbn.notification.extras)

    startService(serviceIntent)
    HeadlessJsTaskService.acquireWakeLockNow(this)
  }
}
