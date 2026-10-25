package com.operatoruplift.allowance

import android.content.Context
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient

open class WebShellViewClient(
    context: Context,
    private val scopeHostProvider: () -> String,
    private val opener: LinkOpener = LinkOpener(context),
) : WebViewClient() {
    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        val url = request.url
        val scheme = url.scheme?.lowercase() ?: return false

        // Subframe navigation stays inside the WebView; which origins may be framed is the
        // site's content security policy's job.
        if (!request.isForMainFrame) return false

        return when (scheme) {
            "http", "https" -> {
                if (url.host.equals(scopeHostProvider.invoke(), ignoreCase = true)) {
                    false
                } else {
                    // Off-site links open in the system browser, always over https.
                    opener.openInBrowser(if (scheme == "http") url.buildUpon().scheme("https").build() else url)
                    true
                }
            }

            "solana-wallet" -> {
                if (opener.openWallet(url)) {
                    // The wallet protocol library uses window.blur to detect that the wallet
                    // app opened. A WebView never fires it, so dispatch one to unblock the
                    // detection promise (3-second timeout in startSession.ts).
                    view.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null)
                }
                true
            }

            "mailto" -> {
                opener.openEmail(url)
                true
            }

            "intent" -> {
                opener.openIntentUrl(url.toString())
                true
            }

            "blob", "data", "about" -> false

            // javascript:, file:, content:, tel:, sms: and anything else never leave the shell.
            else -> true
        }
    }
}
