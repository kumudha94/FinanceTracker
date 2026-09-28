package __PACKAGE__.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import org.json.JSONArray

private const val STALE_THRESHOLD_MINUTES = 120L

data class WidgetAccountRow(val name: String, val balance: Double)

class BalanceWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val prefs = currentState<Preferences>()
      val error = prefs[KEY_BALANCE_ERROR]
      val total = prefs[KEY_BALANCE_TOTAL]?.toDoubleOrNull()
      val accountsJson = prefs[KEY_BALANCE_ACCOUNTS_JSON]
      val updatedAt = prefs[KEY_BALANCE_UPDATED_AT]?.toLongOrNull()
      val openAppIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://"))

      WidgetCard(modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent))) {
        when {
          // An auth failure must always win, even over cached data: the refresh token is
          // invalid (logged out / password changed elsewhere), so the cached balances can
          // never be refreshed and showing them would be misleading. Only a transient
          // "network" error should be allowed to fall behind the cached-data check below.
          error == "auth" -> {
            WidgetHeader("Bank balance", null)
            WidgetMessage("Open app to sign in")
          }
          // Balances were successfully fetched at some point: always show them if the most
          // recent refresh failed with a transient "network" error. A transient failure
          // should surface as staleness on values the user can still see, not wipe them.
          total != null -> {
            val isStale = (ageMinutesSince(updatedAt) ?: 0) >= STALE_THRESHOLD_MINUTES
            val rows = accountsJson?.let { runCatching { parseAccounts(it) }.getOrNull() } ?: emptyList()
            // Past the staleness threshold the header's "last updated" turns red and bold,
            // so old numbers never pass as current.
            WidgetHeader("Bank balance", formatUpdatedAt(updatedAt), isStale)
            Spacer(modifier = GlanceModifier.height(6.dp))
            if (rows.isEmpty()) {
              WidgetMessage("Add a bank account in the app")
            } else {
              LazyColumn(modifier = GlanceModifier.defaultWeight()) {
                items(rows) { row -> AccountRow(row) }
              }
              WidgetDivider()
              Row(
                modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp),
                verticalAlignment = Alignment.CenterVertically
              ) {
                Text(
                  "Total",
                  modifier = GlanceModifier.defaultWeight(),
                  style = TextStyle(color = WidgetColors.textMuted, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                )
                Text(
                  formatRupees(total),
                  maxLines = 1,
                  style = TextStyle(
                    color = if (total < 0) WidgetColors.danger else WidgetColors.text,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                  )
                )
              }
            }
          }
          else -> {
            // No data yet: the first fetch is still running unless it already failed.
            WidgetHeader("Bank balance", null)
            WidgetMessage(if (error == null) "Loading…" else "Unable to load balance")
          }
        }
      }
    }
  }
}

@androidx.compose.runtime.Composable
private fun AccountRow(row: WidgetAccountRow) {
  Row(
    modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Text(
      row.name,
      modifier = GlanceModifier.defaultWeight().padding(end = 8.dp),
      maxLines = 1,
      style = TextStyle(color = WidgetColors.text, fontSize = 13.sp)
    )
    Text(
      formatRupees(row.balance),
      maxLines = 1,
      style = TextStyle(
        color = if (row.balance < 0) WidgetColors.danger else WidgetColors.text,
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium
      )
    )
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

fun parseAccounts(json: String): List<WidgetAccountRow> {
  val array = JSONArray(json)
  return (0 until array.length()).map { i ->
    val obj = array.getJSONObject(i)
    WidgetAccountRow(name = obj.optString("name", "Account"), balance = obj.optDouble("balance", 0.0))
  }
}

private fun ageMinutesSince(updatedAtMillis: Long?): Long? {
  if (updatedAtMillis == null) return null
  return (System.currentTimeMillis() - updatedAtMillis) / 60000
}

fun formatUpdatedAt(updatedAtMillis: Long?): String {
  val ageMinutes = ageMinutesSince(updatedAtMillis) ?: return "Not yet updated"
  return when {
    ageMinutes < 1 -> "Updated just now"
    ageMinutes < 60 -> "Updated ${ageMinutes}m ago"
    ageMinutes < STALE_THRESHOLD_MINUTES -> "Updated ${ageMinutes / 60}h ago"
    else -> "Last updated ${ageMinutes / 60}h ago"
  }
}
