package com.mytracker.finance

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

class NotificationHeadlessTaskService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent): HeadlessJsTaskConfig? {
    val extras = intent.extras ?: return null
    return HeadlessJsTaskConfig(
      "NotificationAutoParseTask",
      Arguments.fromBundle(extras),
      30000,
      true
    )
  }
}
