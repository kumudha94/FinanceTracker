package __PACKAGE__.widgets

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
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
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
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
import androidx.glance.unit.ColorProvider
import org.json.JSONObject

// Matches the Dashboard's Credit Cards block: amber from 80% of the monthly limit, red from 100%.
private val warning = ColorProvider(Color(0xFFF59E0B))

private fun parseSpending(json: String): DashboardSpending {
  val obj = JSONObject(json)
  val categories = obj.getJSONArray("topCategories")
  val cards = obj.getJSONArray("creditCards")
  return DashboardSpending(
    totalSpent = obj.optDouble("totalSpent", 0.0),
    topCategories = (0 until categories.length()).map { i ->
      val c = categories.getJSONObject(i)
      CategorySpend(c.optString("name"), c.optDouble("total", 0.0), c.optString("color", "#9E9E9E"))
    },
    creditCards = (0 until cards.length()).map { i ->
      val c = cards.getJSONObject(i)
      CardSpend(
        name = c.optString("name"),
        bankName = c.optString("bankName", ""),
        spent = c.optDouble("spent", 0.0),
        limit = if (c.isNull("limit")) null else c.optDouble("limit"),
        percentage = c.optInt("percentage", 0)
      )
    }
  )
}

private fun parseHexColor(hex: String): Color =
  runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color(0xFF9E9E9E))

/**
 * Shared frame for both spending widgets: auth failure wins over cached data, cached data is
 * kept through a transient network error, and "Loading…" shows until the first fetch lands.
 */
@Composable
private fun SpendingWidgetContent(title: String, content: @Composable ColumnScope.(DashboardSpending, String) -> Unit) {
  val prefs = currentState<Preferences>()
  val error = prefs[KEY_SPENDING_ERROR]
  val json = prefs[KEY_SPENDING_JSON]
  val updatedAt = prefs[KEY_SPENDING_UPDATED_AT]?.toLongOrNull()
  val openAppIntent = Intent(Intent.ACTION_VIEW, Uri.parse("__DEEP_LINK_SCHEME__://"))

  WidgetCard(modifier = GlanceModifier.clickable(actionStartActivity(openAppIntent))) {
    val data = json?.let { runCatching { parseSpending(it) }.getOrNull() }
    when {
      error == "auth" -> {
        WidgetHeader(title, null)
        WidgetMessage("Open app to sign in")
      }
      data != null -> content(data, formatUpdatedAt(updatedAt))
      else -> {
        WidgetHeader(title, null)
        WidgetMessage(if (error == null) "Loading…" else "Unable to load")
      }
    }
  }
}

class CreditCardsWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      SpendingWidgetContent("Credit cards") { data, updatedText ->
        WidgetHeader("Credit cards", updatedText)
        Spacer(modifier = GlanceModifier.height(4.dp))
        if (data.creditCards.isEmpty()) {
          WidgetMessage("No credit cards")
        } else {
          LazyColumn {
            items(data.creditCards) { card -> CreditCardRow(card) }
          }
        }
      }
    }
  }
}

@Composable
private fun CreditCardRow(card: CardSpend) {
  val hasLimit = card.limit != null && card.limit > 0
  val statusColor = when {
    !hasLimit -> WidgetColors.primary
    card.percentage >= 100 -> WidgetColors.danger
    card.percentage >= 80 -> warning
    else -> WidgetColors.primary
  }
  Column(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 5.dp)) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
      Text(
        card.name,
        modifier = GlanceModifier.defaultWeight().padding(end = 8.dp),
        maxLines = 1,
        style = TextStyle(color = WidgetColors.text, fontSize = 13.sp, fontWeight = FontWeight.Medium)
      )
      Text(
        formatRupees(card.spent),
        maxLines = 1,
        style = TextStyle(
          color = if (hasLimit && card.percentage >= 80) statusColor else WidgetColors.text,
          fontSize = 13.sp,
          fontWeight = FontWeight.Bold
        )
      )
    }
    Spacer(modifier = GlanceModifier.height(4.dp))
    if (hasLimit) {
      LinearProgressIndicator(
        progress = (card.spent / card.limit!!).toFloat().coerceIn(0f, 1f),
        modifier = GlanceModifier.fillMaxWidth().height(6.dp).cornerRadius(3.dp),
        color = statusColor,
        backgroundColor = WidgetColors.divider
      )
      Spacer(modifier = GlanceModifier.height(2.dp))
      Text(
        "${card.percentage}% of ${formatRupees(card.limit!!)} this cycle",
        maxLines = 1,
        style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp)
      )
    } else {
      Text("Spent this cycle · no limit set", maxLines = 1, style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp))
    }
  }
}

class TopSpendingWidget : GlanceAppWidget() {
  override val stateDefinition = PreferencesGlanceStateDefinition

  override suspend fun provideGlance(context: Context, id: GlanceId) {
    provideContent {
      SpendingWidgetContent("Top spending") { data, updatedText ->
        WidgetHeader("Top spending", updatedText)
        Spacer(modifier = GlanceModifier.height(2.dp))
        if (data.topCategories.isEmpty()) {
          WidgetMessage("No spending this cycle yet")
        } else {
          LazyColumn(modifier = GlanceModifier.defaultWeight()) {
            items(data.topCategories) { category -> CategoryRow(category, data.totalSpent) }
          }
          WidgetDivider()
          Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 3.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
              "Spent this cycle",
              modifier = GlanceModifier.defaultWeight(),
              style = TextStyle(color = WidgetColors.textMuted, fontSize = 12.sp, fontWeight = FontWeight.Medium)
            )
            Text(
              formatRupees(data.totalSpent),
              maxLines = 1,
              style = TextStyle(color = WidgetColors.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            )
          }
        }
      }
    }
  }
}

@Composable
private fun CategoryRow(category: CategorySpend, totalSpent: Double) {
  val color = ColorProvider(parseHexColor(category.color))
  val fraction = if (totalSpent > 0) (category.total / totalSpent).toFloat().coerceIn(0f, 1f) else 0f
  Row(modifier = GlanceModifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
    Box(modifier = GlanceModifier.size(8.dp).cornerRadius(4.dp).background(color)) {}
    Spacer(modifier = GlanceModifier.width(8.dp))
    Column(modifier = GlanceModifier.defaultWeight()) {
      Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(
          category.name,
          modifier = GlanceModifier.defaultWeight().padding(end = 8.dp),
          maxLines = 1,
          style = TextStyle(color = WidgetColors.text, fontSize = 12.sp)
        )
        Text(
          formatRupees(category.total),
          maxLines = 1,
          style = TextStyle(color = WidgetColors.text, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        )
        Text(
          "${Math.round(fraction * 100)}%",
          modifier = GlanceModifier.width(36.dp),
          maxLines = 1,
          style = TextStyle(color = WidgetColors.textMuted, fontSize = 11.sp, textAlign = androidx.glance.text.TextAlign.End)
        )
      }
      Spacer(modifier = GlanceModifier.height(2.dp))
      LinearProgressIndicator(
        progress = fraction,
        modifier = GlanceModifier.fillMaxWidth().height(3.dp).cornerRadius(2.dp),
        color = color,
        backgroundColor = WidgetColors.divider
      )
    }
  }
}

class CreditCardsWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = CreditCardsWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    schedulePeriodicWidgetUpdates(context)
    runImmediateWidgetUpdate(context)
  }
}

class TopSpendingWidgetReceiver : GlanceAppWidgetReceiver() {
  override val glanceAppWidget: GlanceAppWidget = TopSpendingWidget()

  override fun onEnabled(context: Context) {
    super.onEnabled(context)
    schedulePeriodicWidgetUpdates(context)
    runImmediateWidgetUpdate(context)
  }
}
