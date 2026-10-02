package __PACKAGE__.widgets

import __PACKAGE__.widgetbridge.WidgetAuthPrefs
import android.content.Context
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.IOException

private const val API_BASE_URL = "__API_BASE_URL__"

sealed class WidgetDataResult<out T> {
  data class Success<T>(val data: T) : WidgetDataResult<T>()
  object AuthFailure : WidgetDataResult<Nothing>()
  object NetworkError : WidgetDataResult<Nothing>()
}

data class TransactionSummary(
  val id: Int,
  val merchant: String,
  val amount: Double,
  val type: String,
  val transactionDate: String
)

data class AccountBalance(val name: String, val balance: Double)

data class BankBalanceSummary(val total: Double, val accounts: List<AccountBalance>)

data class CategorySpend(val name: String, val total: Double, val color: String)

data class CardSpend(val name: String, val bankName: String, val spent: Double, val limit: Double?, val percentage: Int)

/** The Top Spending and Credit Cards blocks of the Dashboard, from /api/dashboard-summary. */
data class DashboardSpending(val totalSpent: Double, val topCategories: List<CategorySpend>, val creditCards: List<CardSpend>)

/** /api/spending-allowance, reduced to what the widget shows. configured = false: salary not set up, other fields are 0. */
data class AllowanceSummary(
  val configured: Boolean,
  val todayLimit: Double,
  val todaySpent: Double,
  val todayLeft: Double,
  val weekLeft: Double,
  val cycleLeft: Double,
  val daysLeft: Int
)

fun parseAllowance(obj: JSONObject): AllowanceSummary {
  if (!obj.optBoolean("configured", false)) return AllowanceSummary(false, 0.0, 0.0, 0.0, 0.0, 0.0, 0)
  val today = obj.getJSONObject("today")
  return AllowanceSummary(
    configured = true,
    todayLimit = today.optDouble("limit", 0.0),
    todaySpent = today.optDouble("spent", 0.0),
    todayLeft = today.optDouble("left", 0.0),
    weekLeft = obj.getJSONObject("week").optDouble("left", 0.0),
    cycleLeft = obj.optDouble("cycleLeft", 0.0),
    daysLeft = obj.getJSONObject("cycle").optInt("daysLeft", 0)
  )
}

object WidgetRepository {
  private val client = OkHttpClient()

  /**
   * Bank accounts only: debit cards are cards on those same banks and credit card balances
   * aren't money held, so neither belongs in the total. Zero-balance accounts are left out
   * of the list (they add nothing to the total either).
   */
  suspend fun fetchBankBalances(context: Context): WidgetDataResult<BankBalanceSummary> {
    return when (val result = authenticatedGet(context, "$API_BASE_URL/api/accounts")) {
      is WidgetDataResult.Success -> {
        try {
          val accounts = JSONArray(result.data)
          var total = 0.0
          val rows = mutableListOf<AccountBalance>()
          for (i in 0 until accounts.length()) {
            val account = accounts.getJSONObject(i)
            if (account.optString("type") != "bank" || !account.optBoolean("isActive", true)) continue
            val balance = account.optString("balance", "0").toDoubleOrNull() ?: 0.0
            total += balance
            if (balance != 0.0) rows.add(AccountBalance(optText(account, "name") ?: "Account", balance))
          }
          WidgetDataResult.Success(BankBalanceSummary(total, rows))
        } catch (e: JSONException) {
          WidgetDataResult.NetworkError
        }
      }
      is WidgetDataResult.AuthFailure -> WidgetDataResult.AuthFailure
      is WidgetDataResult.NetworkError -> WidgetDataResult.NetworkError
    }
  }

  suspend fun fetchDashboardSpending(context: Context): WidgetDataResult<DashboardSpending> {
    return when (val result = authenticatedGet(context, "$API_BASE_URL/api/dashboard-summary")) {
      is WidgetDataResult.Success -> {
        try {
          val summary = JSONObject(result.data)
          val categories = summary.optJSONArray("topCategories") ?: JSONArray()
          val cards = summary.optJSONArray("creditCardSpending") ?: JSONArray()
          WidgetDataResult.Success(
            DashboardSpending(
              totalSpent = summary.optDouble("totalSpent", 0.0),
              topCategories = (0 until categories.length()).map { i ->
                val c = categories.getJSONObject(i)
                CategorySpend(optText(c, "name") ?: "Other", c.optDouble("total", 0.0), optText(c, "color") ?: "#9E9E9E")
              },
              creditCards = (0 until cards.length()).map { i ->
                val c = cards.getJSONObject(i)
                CardSpend(
                  name = optText(c, "accountName") ?: "Card",
                  bankName = optText(c, "bankName") ?: "",
                  spent = c.optDouble("spent", 0.0),
                  limit = if (c.isNull("limit")) null else c.optDouble("limit"),
                  percentage = c.optInt("percentage", 0)
                )
              }
            )
          )
        } catch (e: JSONException) {
          WidgetDataResult.NetworkError
        }
      }
      is WidgetDataResult.AuthFailure -> WidgetDataResult.AuthFailure
      is WidgetDataResult.NetworkError -> WidgetDataResult.NetworkError
    }
  }

  suspend fun fetchSpendingAllowance(context: Context): WidgetDataResult<AllowanceSummary> {
    return when (val result = authenticatedGet(context, "$API_BASE_URL/api/spending-allowance")) {
      is WidgetDataResult.Success -> {
        try {
          WidgetDataResult.Success(parseAllowance(JSONObject(result.data)))
        } catch (e: JSONException) {
          WidgetDataResult.NetworkError
        }
      }
      is WidgetDataResult.AuthFailure -> WidgetDataResult.AuthFailure
      is WidgetDataResult.NetworkError -> WidgetDataResult.NetworkError
    }
  }

  suspend fun fetchRecentTransactions(context: Context, limit: Int = 4): WidgetDataResult<List<TransactionSummary>> {
    return when (val result = authenticatedGet(context, "$API_BASE_URL/api/transactions?limit=$limit")) {
      is WidgetDataResult.Success -> {
        try {
          val raw = JSONArray(result.data)
          val transactions = mutableListOf<TransactionSummary>()
          for (i in 0 until raw.length()) {
            val tx = raw.getJSONObject(i)
            transactions.add(
              TransactionSummary(
                id = tx.optInt("id", 0),
                merchant = optText(tx, "merchant") ?: optText(tx, "description") ?: "Transaction",
                amount = tx.optString("amount", "0").toDoubleOrNull() ?: 0.0,
                type = tx.optString("type", "debit"),
                transactionDate = tx.optString("transactionDate", "")
              )
            )
          }
          WidgetDataResult.Success(transactions)
        } catch (e: JSONException) {
          WidgetDataResult.NetworkError
        }
      }
      is WidgetDataResult.AuthFailure -> WidgetDataResult.AuthFailure
      is WidgetDataResult.NetworkError -> WidgetDataResult.NetworkError
    }
  }

  /** org.json's optString turns a JSON null into the literal "null"; treat that as missing. */
  private fun optText(obj: JSONObject, key: String): String? =
    if (obj.isNull(key)) null else obj.optString(key).trim().ifEmpty { null }

  private fun authenticatedGet(context: Context, url: String): WidgetDataResult<String> {
    val accessToken = WidgetAuthPrefs.getAccessToken(context) ?: return WidgetDataResult.AuthFailure

    val first = executeGet(url, accessToken) ?: return WidgetDataResult.NetworkError
    if (first.first in 200..299) return WidgetDataResult.Success(first.second)
    // The backend returns 403 for an expired/invalid token, and reserves 401 for a
    // missing Authorization header entirely. Treat both as "needs a token refresh".
    if (first.first == 401 || first.first == 403) {
      val refreshed = refreshAccessToken(context) ?: return WidgetDataResult.AuthFailure
      val second = executeGet(url, refreshed) ?: return WidgetDataResult.NetworkError
      return if (second.first in 200..299) WidgetDataResult.Success(second.second) else WidgetDataResult.AuthFailure
    }
    return WidgetDataResult.NetworkError
  }

  private fun executeGet(url: String, accessToken: String): Pair<Int, String>? {
    return try {
      val request = Request.Builder()
        .url(url)
        .header("Authorization", "Bearer $accessToken")
        .get()
        .build()
      client.newCall(request).execute().use { response ->
        Pair(response.code, response.body?.string() ?: "")
      }
    } catch (e: Exception) {
      null
    }
  }

  private fun refreshAccessToken(context: Context): String? {
    val refreshToken = WidgetAuthPrefs.getRefreshToken(context) ?: return null
    return try {
      val body = JSONObject().put("refreshToken", refreshToken).toString()
        .toRequestBody("application/json".toMediaTypeOrNull())
      val request = Request.Builder()
        .url("$API_BASE_URL/api/auth/refresh-token")
        .post(body)
        .build()
      client.newCall(request).execute().use { response ->
        if (!response.isSuccessful) return null
        val responseBody = response.body?.string() ?: return null
        val newAccessToken = JSONObject(responseBody).optString("accessToken", "")
        if (newAccessToken.isBlank()) return null
        WidgetAuthPrefs.setAccessToken(context, newAccessToken)
        newAccessToken
      }
    } catch (e: Exception) {
      null
    }
  }
}
