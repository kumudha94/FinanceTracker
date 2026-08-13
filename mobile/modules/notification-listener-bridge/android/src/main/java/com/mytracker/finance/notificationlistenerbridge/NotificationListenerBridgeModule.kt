package com.mytracker.finance.notificationlistenerbridge

import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NotificationListenerBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NotificationListenerBridge")

    AsyncFunction("isEnabled") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)
    }
  }
}
