package __PACKAGE__.widgets

import android.content.BroadcastReceiver
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
import androidx.glance.appwidget.LinearProgressIndicator
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import org.json.JSONObject

class SpendingAllowanceWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      val prefs = currentState<Preferences>()
      val error = prefs[KEY_ALLOWANCE_ERROR]
      val data = prefs[KEY_ALLOWANCE_JSON]?.let { runCatching { parseAllowance(JSONObject(it)) }.getOrNull() }
      val updatedText = formatUpdatedAt(prefs[KEY_ALLOWANCE_UPDATED_AT]?.toLongOrNull())
      val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://spending-allowance"))
      val title = "Safe to spend today"

      WidgetCard(modifier = GlanceModifier.clickable(actionStartActivity(openIntent))) {
        when {
          error == "auth" -> { WidgetHeader(title, null); WidgetMessage("Open app to sign in") }
          data == null -> { WidgetHeader(title, null); WidgetMessage(if (error == null) "Loading…" else "Unable to load") }
          !data.configured -> { WidgetHeader(title, null); WidgetMessage("Set up salary to see your daily limit") }
          else -> AllowanceContent(data, title, updatedText)
        }
      }
    }
  }
}

@androidx.compose.runtime.Composable
private fun AllowanceContent(a: AllowanceSummary, title: String, updatedText: String) {
  val overToday = a.todayLeft < 0
  val overCycle = a.todayLimit < 0
  val mainColor = if (overToday) WidgetColors.danger else WidgetColors.primary

  WidgetHeader(title, updatedText)
  Spacer(modifier = GlanceModifier.height(4.dp))
  if (overCycle) {
    Text(
      "Over budget for this cycle by ${formatRupees(-a.cycleLeft)}",
      maxLines = 2,
      style = TextStyle(color = WidgetColors.danger, fontSize = 16.sp, fontWeight = FontWeight.Bold)
    )
  } else {
    Row(verticalAlignment = Alignment.Bottom) {
      Text(
        if (overToday) "${formatRupees(-a.todayLeft)} over today" else formatRupees(a.todayLeft),
        maxLines = 1,
        style = TextStyle(color = mainColor, fontSize = 24.sp, fontWeight = FontWeight.Bold)
      )
      if (!overToday) {
        Text(
          "  left of ${formatRupees(a.todayLimit)}",
          maxLines = 1,
          style = TextStyle(color = WidgetColors.textMuted, fontSize = 12.sp)
        )
      }
    }
    Spacer(modifier = GlanceModifier.height(4.dp))
    LinearProgressIndicator(
      progress = if (a.todayLimit > 0) (a.todaySpent / a.todayLimit).toFloat().coerceIn(0f, 1f) else 1f,
      modifier = GlanceModifier.fillMaxWidth().height(6.dp).cornerRadius(3.dp),
      color = mainColor,
      backgroundColor = WidgetColors.divider
    )
    Text("${formatRupees(a.todaySpent)} spent today", maxLines = 1, style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
  }
  Spacer(modifier = GlanceModifier.height(6.dp))
  WidgetDivider()
  Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 4.dp)) {
    Column(modifier = GlanceModifier.defaultWeight()) {
      Text("This week", style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
      Text(formatRupees(a.weekLeft), maxLines = 1, style = TextStyle(color = if (a.weekLeft < 0) WidgetColors.danger else WidgetColors.text, fontSize = 14.sp, fontWeight = FontWeight.Bold))
    }
    Column(modifier = GlanceModifier.defaultWeight()) {
      Text("Until payday · ${a.daysLeft}d", style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
      Text(formatRupees(a.cycleLeft), maxLines = 1, style = TextStyle(color = if (a.cycleLeft < 0) WidgetColors.danger else WidgetColors.text, fontSize = 14.sp, fontWeight = FontWeight.Bold))
    }
  }
}

class SpendingAllowanceWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = SpendingAllowanceWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    schedulePeriodicWidgetUpdates(context)
    runImmediateWidgetUpdate(context)
  }
}

/**
 * Lets the widget-bridge module (a separate Gradle module that can't see this package) ask for
 * an immediate refresh of every widget, e.g. right after an SMS adds a transaction.
 */
class WidgetRefreshReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    runImmediateWidgetUpdate(context)
  }
}
