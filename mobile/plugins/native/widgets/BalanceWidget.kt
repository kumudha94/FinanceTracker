package __PACKAGE__.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.Text
import androidx.glance.text.TextStyle

class BalanceWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val prefs = currentState<Preferences>()
      val error = prefs[KEY_BALANCE_ERROR]
      val total = prefs[KEY_BALANCE_TOTAL]
      val updatedAt = prefs[KEY_BALANCE_UPDATED_AT]?.toLongOrNull()
      val openAppIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://"))

      Column(
        modifier = GlanceModifier
          .fillMaxSize()
          .padding(12.dp)
          .clickable(actionStartActivity(openAppIntent))
      ) {
        when {
          error == "auth" -> Text("Open app to sign in")
          error == "network" || total == null -> Text("Unable to load balance")
          else -> {
            Text(formatBalance(total.toDoubleOrNull() ?: 0.0), style = TextStyle(fontSize = 22.sp))
            Text(formatUpdatedAt(updatedAt), style = TextStyle(fontSize = 11.sp))
          }
        }
      }
    }
  }
}

class BalanceWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = BalanceWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    schedulePeriodicWidgetUpdates(context)
    runImmediateWidgetUpdate(context)
  }
}

fun formatBalance(amount: Double): String = "₹" + String.format("%,.2f", amount)

fun formatUpdatedAt(updatedAtMillis: Long?): String {
  if (updatedAtMillis == null) return "Not yet updated"
  val ageMinutes = (System.currentTimeMillis() - updatedAtMillis) / 60000
  return when {
    ageMinutes < 1 -> "Updated just now"
    ageMinutes < 120 -> "Updated ${ageMinutes}m ago"
    else -> "Last updated ${ageMinutes / 60}h ago"
  }
}
