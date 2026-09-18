package __PACKAGE__.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
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
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import org.json.JSONArray

data class WidgetTransactionRow(val id: Int, val merchant: String, val amount: Double, val type: String)

class RecentTransactionsWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val prefs = currentState<Preferences>()
      val error = prefs[KEY_TRANSACTIONS_ERROR]
      val json = prefs[KEY_TRANSACTIONS_JSON]
      val openAppIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://"))

      Column(modifier = GlanceModifier.fillMaxSize().padding(8.dp)) {
        when {
          // An auth failure must always win, even over cached data: the refresh token is
          // invalid (logged out / password changed elsewhere), so the cached list can
          // never be refreshed and showing it would be misleading. Only a transient
          // "network" error should be allowed to fall behind the cached-data check below.
          error == "auth" -> Text("Open app to sign in", modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent)))
          // Cached data was successfully fetched at some point: always show it if the most
          // recent refresh failed with a transient "network" error, so a transient failure
          // doesn't wipe a list the user can still see.
          json != null -> {
            val rows = runCatching { parseTransactions(json) }.getOrElse { emptyList() }
            if (rows.isEmpty()) {
              Text("No transactions yet", modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent)))
            } else {
              LazyColumn {
                items(rows) { row ->
                  val rowIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://transaction/${row.id}"))
                  Row(
                    modifier = GlanceModifier
                      .fillMaxWidth()
                      .padding(vertical = 4.dp)
                      .clickable(actionStartActivity(rowIntent))
                  ) {
                    Text(row.merchant, modifier = GlanceModifier.padding(end = 8.dp))
                    val amountText = (if (row.type == "credit") "+" else "-") + "₹" + String.format("%,.2f", row.amount)
                    val amountColor = if (row.type == "credit") Color(0xFF16A34A) else Color(0xFFDC2626)
                    Text(amountText, style = TextStyle(color = ColorProvider(amountColor)))
                  }
                }
              }
            }
          }
          else -> Text("Unable to load transactions", modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent)))
        }
      }
    }
  }
}

class RecentTransactionsWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = RecentTransactionsWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    schedulePeriodicWidgetUpdates(context)
    runImmediateWidgetUpdate(context)
  }
}

fun parseTransactions(json: String): List<WidgetTransactionRow> {
  val array = JSONArray(json)
  val rows = mutableListOf<WidgetTransactionRow>()
  for (i in 0 until array.length()) {
    val obj = array.getJSONObject(i)
    rows.add(
      WidgetTransactionRow(
        id = obj.optInt("id", 0),
        merchant = obj.optString("merchant", "Transaction"),
        amount = obj.optDouble("amount", 0.0),
        type = obj.optString("type", "debit")
      )
    )
  }
  return rows
}
