package __PACKAGE__.widgets

import android.content.Context
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.appwidget.updateAll
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
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
val KEY_BALANCE_ACCOUNTS_JSON = stringPreferencesKey("balance_accounts_json")

val KEY_TRANSACTIONS_JSON = stringPreferencesKey("transactions_json")
val KEY_TRANSACTIONS_ERROR = stringPreferencesKey("transactions_error")
val KEY_TRANSACTIONS_UPDATED_AT = stringPreferencesKey("transactions_updated_at")

class WidgetUpdateWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
  override suspend fun doWork(): Result {
    val balanceHadNetworkError = updateBalanceWidget(applicationContext)
    val transactionsHadNetworkError = updateRecentTransactionsWidget(applicationContext)
    // Retry with WorkManager's backoff on a transient network failure instead of waiting
    // for the next 30-minute cycle. AuthFailure isn't retried here - the user needs to
    // open the app to sign in again, retrying won't help.
    return if (balanceHadNetworkError || transactionsHadNetworkError) Result.retry() else Result.success()
  }

  /** Returns true if this fetch failed with a [WidgetDataResult.NetworkError]. */
  private suspend fun updateBalanceWidget(context: Context): Boolean {
    val glanceIds = GlanceAppWidgetManager(context).getGlanceIds(BalanceWidget::class.java)
    if (glanceIds.isEmpty()) return false

    val result = WidgetRepository.fetchBankBalances(context)
    for (glanceId in glanceIds) {
      updateAppWidgetState(context, glanceId) { prefs ->
        when (result) {
          is WidgetDataResult.Success -> {
            val accountsJson = JSONArray()
            result.data.accounts.forEach { account ->
              accountsJson.put(JSONObject().put("name", account.name).put("balance", account.balance))
            }
            prefs[KEY_BALANCE_TOTAL] = result.data.total.toString()
            prefs[KEY_BALANCE_ACCOUNTS_JSON] = accountsJson.toString()
            prefs[KEY_BALANCE_UPDATED_AT] = System.currentTimeMillis().toString()
            prefs.remove(KEY_BALANCE_ERROR)
          }
          is WidgetDataResult.AuthFailure -> prefs[KEY_BALANCE_ERROR] = "auth"
          is WidgetDataResult.NetworkError -> prefs[KEY_BALANCE_ERROR] = "network"
        }
      }
    }
    BalanceWidget().updateAll(context)
    return result is WidgetDataResult.NetworkError
  }

  /** Returns true if this fetch failed with a [WidgetDataResult.NetworkError]. */
  private suspend fun updateRecentTransactionsWidget(context: Context): Boolean {
    val glanceIds = GlanceAppWidgetManager(context).getGlanceIds(RecentTransactionsWidget::class.java)
    if (glanceIds.isEmpty()) return false

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
            prefs[KEY_TRANSACTIONS_UPDATED_AT] = System.currentTimeMillis().toString()
            prefs.remove(KEY_TRANSACTIONS_ERROR)
          }
          is WidgetDataResult.AuthFailure -> prefs[KEY_TRANSACTIONS_ERROR] = "auth"
          is WidgetDataResult.NetworkError -> prefs[KEY_TRANSACTIONS_ERROR] = "network"
        }
      }
    }
    RecentTransactionsWidget().updateAll(context)
    return result is WidgetDataResult.NetworkError
  }
}

fun schedulePeriodicWidgetUpdates(context: Context) {
  val constraints = Constraints.Builder()
    .setRequiredNetworkType(NetworkType.CONNECTED)
    .build()
  val request = PeriodicWorkRequestBuilder<WidgetUpdateWorker>(30, TimeUnit.MINUTES)
    .setConstraints(constraints)
    .build()
  WorkManager.getInstance(context).enqueueUniquePeriodicWork(
    "widget_update_worker",
    ExistingPeriodicWorkPolicy.KEEP,
    request
  )
}

fun runImmediateWidgetUpdate(context: Context) {
  WorkManager.getInstance(context).enqueue(OneTimeWorkRequestBuilder<WidgetUpdateWorker>().build())
}
