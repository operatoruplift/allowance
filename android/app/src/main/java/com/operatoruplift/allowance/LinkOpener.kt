package com.operatoruplift.allowance

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.annotation.StringRes
import androidx.core.net.toUri

/**
 * Hands the links the web app cannot show itself to the system, and never lets a missing
 * handler or a crafted intent: URL take the shell down. Every launch is caught: a phone
 * without a wallet or a mail app gets a short message instead of a crash.
 */
class LinkOpener(private val context: Context) {
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Only https leaves the shell for the system browser. */
    fun openInBrowser(uri: Uri): Boolean {
        if (!uri.scheme.equals("https", ignoreCase = true)) return false
        return start(Intent(Intent.ACTION_VIEW, uri), R.string.webshell_no_browser)
    }

    fun openWallet(uri: Uri): Boolean = start(Intent(Intent.ACTION_VIEW, uri), R.string.webshell_no_wallet_app)

    fun openEmail(uri: Uri): Boolean = start(Intent(Intent.ACTION_SENDTO, uri), R.string.webshell_no_email_app)

    /**
     * intent: URLs are reduced to what a browser honours: no explicit component or selector
     * (so a page cannot pick another app's exported activity), no extras, no URI permission
     * grants, and only activities that declare themselves BROWSABLE. When nothing can open
     * the result, the https browser_fallback_url is tried, and nothing else.
     */
    fun openIntentUrl(url: String): Boolean {
        val parsed = runCatching { Intent.parseUri(url, Intent.URI_INTENT_SCHEME) }.getOrNull() ?: return false
        val fallback =
            parsed.getStringExtra("browser_fallback_url")?.toUri()?.takeIf { it.scheme.equals("https", ignoreCase = true) }
        val safe =
            Intent(parsed).apply {
                component = null
                selector = null
                replaceExtras(null as Bundle?)
                addCategory(Intent.CATEGORY_BROWSABLE)
                flags = flags and GRANT_FLAGS.inv()
            }
        if (start(safe, null)) return true
        return fallback != null && openInBrowser(fallback)
    }

    fun toast(
        @StringRes message: Int,
    ) {
        mainHandler.post { Toast.makeText(context.applicationContext, message, Toast.LENGTH_SHORT).show() }
    }

    private fun start(
        intent: Intent,
        @StringRes message: Int?,
    ): Boolean {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return try {
            context.startActivity(intent)
            true
        } catch (e: ActivityNotFoundException) {
            Log.w(TAG, "No activity for ${intent.data?.scheme ?: intent.action}")
            if (message != null) toast(message)
            false
        } catch (e: SecurityException) {
            Log.w(TAG, "Launch refused for ${intent.data?.scheme ?: intent.action}: ${e.message}")
            if (message != null) toast(message)
            false
        }
    }

    private companion object {
        const val TAG = "WebShell"
        const val GRANT_FLAGS =
            Intent.FLAG_GRANT_READ_URI_PERMISSION or
                Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or
                Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
    }
}
