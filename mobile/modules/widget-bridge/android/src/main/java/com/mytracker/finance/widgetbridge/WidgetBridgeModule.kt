package com.mytracker.finance.widgetbridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WidgetBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    AsyncFunction("syncWidgetAuth") { accessToken: String, refreshToken: String ->
      val context = appContext.reactContext ?: return@AsyncFunction Unit
      WidgetAuthPrefs.setTokens(context, accessToken, refreshToken)
    }

    AsyncFunction("syncWidgetAccessToken") { accessToken: String ->
      val context = appContext.reactContext ?: return@AsyncFunction Unit
      WidgetAuthPrefs.setAccessToken(context, accessToken)
    }

    AsyncFunction("clearWidgetAuth") {
      val context = appContext.reactContext ?: return@AsyncFunction Unit
      WidgetAuthPrefs.clear(context)
    }
  }
}
