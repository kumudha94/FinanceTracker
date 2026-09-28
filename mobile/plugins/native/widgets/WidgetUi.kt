package __PACKAGE__.widgets

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ColumnScope
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale
import java.util.TimeZone

// Mirrors the app palette in mobile/src/lib/utils.ts (COLORS) so the widgets follow the
// device's light/dark mode the same way the app does.
object WidgetColors {
  val card = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF1C1C1E))
  val text = ColorProvider(day = Color(0xFF0A0A0A), night = Color(0xFFFAFAFA))
  val textMuted = ColorProvider(day = Color(0xFF71717A), night = Color(0xFFA1A1AA))
  val divider = ColorProvider(day = Color(0xFFE4E4E7), night = Color(0xFF27272A))
  val primary = ColorProvider(Color(0xFF16A34A))
  val danger = ColorProvider(Color(0xFFDC2626))
  val creditBadge = ColorProvider(day = Color(0xFFDCFCE7), night = Color(0xFF14532D))
  val debitBadge = ColorProvider(day = Color(0xFFFEE2E2), night = Color(0xFF7F1D1D))
}

/** Rounded themed card that every widget draws its content inside. */
@Composable
fun WidgetCard(modifier: GlanceModifier = GlanceModifier, content: @Composable ColumnScope.() -> Unit) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .cornerRadius(20.dp)
      .background(WidgetColors.card)
      .padding(horizontal = 16.dp, vertical = 12.dp),
    content = content
  )
}

/** Green title on the left, muted "Updated …" on the right (red once the data is stale). */
@Composable
fun WidgetHeader(title: String, updatedText: String?, isStale: Boolean = false) {
  Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Box(modifier = GlanceModifier.width(4.dp).height(14.dp).cornerRadius(2.dp).background(WidgetColors.primary)) {}
    Spacer(modifier = GlanceModifier.width(6.dp))
    Text(
      title,
      modifier = GlanceModifier.defaultWeight(),
      maxLines = 1,
      style = TextStyle(color = WidgetColors.primary, fontSize = 13.sp, fontWeight = FontWeight.Bold)
    )
    if (updatedText != null) {
      Text(
        updatedText,
        maxLines = 1,
        style = TextStyle(
          color = if (isStale) WidgetColors.danger else WidgetColors.textMuted,
          fontSize = 11.sp,
          fontWeight = if (isStale) FontWeight.Bold else FontWeight.Normal
        )
      )
    }
  }
}

@Composable
fun WidgetDivider() {
  Spacer(modifier = GlanceModifier.fillMaxWidth().height(1.dp).background(WidgetColors.divider))
}

/** Centered muted message for empty / error / signed-out states. */
@Composable
fun WidgetMessage(message: String) {
  Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Text(message, style = TextStyle(color = WidgetColors.textMuted, fontSize = 13.sp))
  }
}

/** Indian digit grouping (₹1,29,135.75) to match the app's Intl 'en-IN' formatCurrency. */
fun formatRupees(amount: Double): String {
  val plain = String.format(Locale.US, "%.2f", Math.abs(amount))
  val whole = plain.substringBefore('.')
  val grouped = if (whole.length <= 3) whole else {
    val head = whole.dropLast(3)
    head.reversed().chunked(2).joinToString(",").reversed() + "," + whole.takeLast(3)
  }
  val formatted = "₹" + grouped + "." + plain.substringAfter('.')
  return if (amount < 0) "-$formatted" else formatted
}

private val isoParsers = listOf("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", "yyyy-MM-dd'T'HH:mm:ss'Z'").map {
  SimpleDateFormat(it, Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
}

/** "Today · 2:15 PM", "Yesterday", or "12 Sep" from the API's ISO timestamp; "" if unparseable. */
fun formatRelativeDate(iso: String): String {
  val date = isoParsers.firstNotNullOfOrNull { runCatching { it.parse(iso) }.getOrNull() } ?: return ""
  val then = Calendar.getInstance().apply { time = date }
  val today = Calendar.getInstance()
  val yesterday = Calendar.getInstance().apply { add(Calendar.DAY_OF_YEAR, -1) }
  fun Calendar.sameDay(other: Calendar) =
    get(Calendar.YEAR) == other.get(Calendar.YEAR) && get(Calendar.DAY_OF_YEAR) == other.get(Calendar.DAY_OF_YEAR)
  return when {
    then.sameDay(today) -> "Today · " + SimpleDateFormat("h:mm a", Locale.US).format(date)
    then.sameDay(yesterday) -> "Yesterday"
    else -> SimpleDateFormat("d MMM", Locale.US).format(date)
  }
}
