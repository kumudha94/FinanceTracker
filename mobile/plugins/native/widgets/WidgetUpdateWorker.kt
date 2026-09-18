package __PACKAGE__.widgets

import android.content.Context
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

val KEY_BALANCE_TOTAL = stringPreferencesKey("balance_total")
val KEY_BALANCE_UPDATED_AT = stringPreferencesKey("balance_updated_at")
val KEY_BALANCE_ERROR = stringPreferencesKey("balance_error")

val KEY_TRANSACTIONS_JSON = stringPreferencesKey("transactions_json")
val KEY_TRANSACTIONS_ERROR = stringPreferencesKey("transactions_error")

class WidgetUpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    updateBalanceWidget(applicationContext)
    updateRecentTransactionsWidget(applicationContext)
    return Result.success()
  }

  private suspend fun updateBalanceWidget(context: Context) {
    val glanceIds = GlanceAppWidgetManager(context).getGlanceIds(BalanceWidget::class.java)
    if (glanceIds.isEmpty()) return

    val result = WidgetRepository.fetchTotalBalance(context)
    for (glanceId in glanceIds) {
      updateAppWidgetState(context, glanceId) { prefs ->
        when (result) {
          is WidgetDataResult.Success -> {
            prefs[KEY_BALANCE_TOTAL] = result.data.toString()
            prefs[KEY_BALANCE_UPDATED_AT] = System.currentTimeMillis().toString()
            prefs.remove(KEY_BALANCE_ERROR)
          }
          is WidgetDataResult.AuthFailure -> prefs[KEY_BALANCE_ERROR] = "auth"
          is WidgetDataResult.NetworkError -> prefs[KEY_BALANCE_ERROR] = "network"
        }
      }
    }
    BalanceWidget().updateAll(context)
  }

  private suspend fun updateRecentTransactionsWidget(context: Context) {
    val glanceIds = GlanceAppWidgetManager(context).getGlanceIds(RecentTransactionsWidget::class.java)
    if (glanceIds.isEmpty()) return

    val result = WidgetRepository.fetchRecentTransactions(context)
    for (glanceId in glanceIds) {
      updateAppWidgetState(context, glanceId) { prefs ->
        when (result) {
          is WidgetDataResult.Success -> {
            val json = JSONArray()
            result.data.forEach { tx ->
              json.put(
                JSONObject()
                  .put("id", tx.id)
                  .put("merchant", tx.merchant)
                  .put("amount", tx.amount)
                  .put("type", tx.type)
                  .put("transactionDate", tx.transactionDate)
              )
            }
            prefs[KEY_TRANSACTIONS_JSON] = json.toString()
            prefs.remove(KEY_TRANSACTIONS_ERROR)
          }
          is WidgetDataResult.AuthFailure -> prefs[KEY_TRANSACTIONS_ERROR] = "auth"
          is WidgetDataResult.NetworkError -> prefs[KEY_TRANSACTIONS_ERROR] = "network"
        }
      }
    }
    RecentTransactionsWidget().updateAll(context)
  }
}

fun schedulePeriodicWidgetUpdates(context: Context) {
  val request = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(30, TimeUnit.MINUTES).build()
  WorkManager.getInstance(context).enqueueUniquePeriodicWork(
    "widget_update_worker",
    ExistingPeriodicWorkPolicy.KEEP,
    request
  )
}

fun runImmediateWidgetUpdate(context: Context) {
  WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<WidgetUpdateWorker>().build())
}
