package __PACKAGE__.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.itemsIndexed
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import org.json.JSONArray

data class WidgetTransactionRow(
  val id: Int,
  val merchant: String,
  val amount: Double,
  val type: String,
  val transactionDate: String
)

class RecentTransactionsWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val prefs = currentState<Preferences>()
      val error = prefs[KEY_TRANSACTIONS_ERROR]
      val json = prefs[KEY_TRANSACTIONS_JSON]
      val updatedAt = prefs[KEY_TRANSACTIONS_UPDATED_AT]?.toLongOrNull()
      val openAppIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://"))

      WidgetCard {
        when {
          // An auth failure must always win, even over cached data: the refresh token is
          // invalid (logged out / password changed elsewhere), so the cached list can
          // never be refreshed and showing it would be misleading. Only a transient
          // "network" error should be allowed to fall behind the cached-data check below.
          error == "auth" -> {
            WidgetHeader("Recent transactions", null)
            Box(modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent))) {
              WidgetMessage("Open app to sign in")
            }
          }
          // Cached data was successfully fetched at some point: always show it if the most
          // recent refresh failed with a transient "network" error, so a transient failure
          // doesn't wipe a list the user can still see.
          json != null -> {
            val rows = runCatching { parseTransactions(json) }.getOrElse { emptyList() }
            WidgetHeader("Recent transactions", updatedAt?.let { formatUpdatedAt(it) })
            Spacer(modifier = GlanceModifier.height(4.dp))
            if (rows.isEmpty()) {
              Box(modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent))) {
                WidgetMessage("No transactions yet")
              }
            } else {
              LazyColumn {
                itemsIndexed(rows) { index, row ->
                  Column {
                    if (index > 0) WidgetDivider()
                    TransactionRow(row)
                  }
                }
              }
            }
          }
          else -> {
            WidgetHeader("Recent transactions", null)
            Box(modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent))) {
              WidgetMessage("Unable to load transactions")
            }
          }
        }
      }
    }
  }
}

@Composable
private fun TransactionRow(row: WidgetTransactionRow) {
  val isCredit = row.type == "credit"
  val rowIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://transaction/${row.id}"))
  Row(
    modifier = GlanceModifier
      .fillMaxWidth()
      .padding(vertical = 6.dp)
      .clickable(actionStartActivity(rowIntent)),
    verticalAlignment = Alignment.CenterVertically
  ) {
    Box(
      modifier = GlanceModifier
        .size(28.dp)
        .cornerRadius(14.dp)
        .background(if (isCredit) WidgetColors.creditBadge else WidgetColors.debitBadge),
      contentAlignment = Alignment.Center
    ) {
      Text(
        if (isCredit) "↓" else "↑",
        style = TextStyle(
          color = if (isCredit) WidgetColors.primary else WidgetColors.danger,
          fontSize = 14.sp,
          fontWeight = FontWeight.Bold
        )
      )
    }
    Spacer(modifier = GlanceModifier.width(10.dp))
    Column(modifier = GlanceModifier.defaultWeight().padding(end = 8.dp)) {
      Text(
        row.merchant,
        maxLines = 1,
        style = TextStyle(color = WidgetColors.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
      )
      val dateText = formatRelativeDate(row.transactionDate)
      if (dateText.isNotEmpty()) {
        Text(dateText, maxLines = 1, style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
      }
    }
    Text(
      (if (isCredit) "+" else "-") + formatRupees(row.amount),
      maxLines = 1,
      style = TextStyle(
        color = if (isCredit) WidgetColors.primary else WidgetColors.danger,
        fontSize = 13.sp,
        fontWeight = FontWeight.Bold
      )
    )
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
  return (0 until array.length()).map { i ->
    val obj = array.getJSONObject(i)
    WidgetTransactionRow(
      id = obj.optInt("id", 0),
      merchant = obj.optString("merchant", "Transaction"),
      amount = obj.optDouble("amount", 0.0),
      type = obj.optString("type", "debit"),
      transactionDate = obj.optString("transactionDate", "")
    )
  }
}
