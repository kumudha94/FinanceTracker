package __PACKAGE__.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.layout.Column
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider

private const val STALE_THRESHOLD_MINUTES = 120L

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
          // An auth failure must always win, even over cached data: the refresh token is
          // invalid (logged out / password changed elsewhere), so the cached balance can
          // never be refreshed and showing it would be misleading. Only a transient
          // "network" error should be allowed to fall behind the cached-data check below.
          error == "auth" -> Text("Open app to sign in")
          // A value was successfully fetched at some point: always show it if the most
          // recent refresh failed with a transient "network" error. A transient failure
          // should surface as staleness on a value the user can still see, not wipe it.
          total != null -> {
            val isStale = (ageMinutesSince(updatedAt) ?: 0) >= STALE_THRESHOLD_MINUTES
            if (isStale) {
              // Past the staleness threshold, the "last updated" line becomes the
              // dominant visual signal and the balance is deprioritized.
              Text(
                formatUpdatedAt(updatedAt),
                style = TextStyle(
                  fontSize = 15.sp,
                  fontWeight = FontWeight.Bold,
                  color = ColorProvider(Color(0xFFDC2626))
                )
              )
              Text(formatBalance(total.toDoubleOrNull() ?: 0.0), style = TextStyle(fontSize = 14.sp))
            } else {
              Text(formatBalance(total.toDoubleOrNull() ?: 0.0), style = TextStyle(fontSize = 22.sp))
              Text(formatUpdatedAt(updatedAt), style = TextStyle(fontSize = 11.sp))
            }
          }
          else -> Text("Unable to load balance")
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

private fun ageMinutesSince(updatedAtMillis: Long?): Long? {
  if (updatedAtMillis == null) return null
  return (System.currentTimeMillis() - updatedAtMillis) / 60000
}

fun formatUpdatedAt(updatedAtMillis: Long?): String {
  val ageMinutes = ageMinutesSince(updatedAtMillis) ?: return "Not yet updated"
  return when {
    ageMinutes < 1 -> "Updated just now"
    ageMinutes < STALE_THRESHOLD_MINUTES -> "Updated ${ageMinutes}m ago"
    else -> "Last updated ${ageMinutes / 60}h ago"
  }
}
