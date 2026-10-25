package com.operatoruplift.allowance

import android.app.DownloadManager
import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.WebView
import org.json.JSONObject

/**
 * Saves the files the web app offers for download. A WebView drops downloads unless the app
 * handles them: https URLs go to the system DownloadManager, data: URLs are decoded here, and
 * blob: URLs (what the JSON and CSV exports use) are read by a small script inside the page
 * and handed back through [saveBase64]. That method and [reportFailure] are the whole bridge;
 * they only ever create a new file in the device's Downloads collection.
 */
class WebShellDownloads(
    private val context: Context,
    private val opener: LinkOpener,
) {
    fun onDownloadStart(
        webView: WebView,
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?,
    ) {
        val name = safeFileName(URLUtil.guessFileName(url, contentDisposition, mimeType))
        when {
            url.startsWith("blob:", ignoreCase = true) -> {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                    opener.toast(R.string.webshell_download_needs_android_10)
                    return
                }
                webView.evaluateJavascript(blobReaderScript(url, name), null)
            }

            url.startsWith("data:", ignoreCase = true) -> {
                val comma = url.indexOf(',')
                if (comma < 5) {
                    opener.toast(R.string.webshell_download_failed)
                    return
                }
                val header = url.substring(5, comma)
                val payload = url.substring(comma + 1)
                val mime = header.substringBefore(';').ifBlank { mimeType ?: "application/octet-stream" }
                val bytes = if (header.contains(";base64")) decode(payload) else Uri.decode(payload).toByteArray()
                if (bytes == null) {
                    opener.toast(R.string.webshell_download_failed)
                    return
                }
                write(name, mime, bytes)
            }

            url.startsWith("https://", ignoreCase = true) -> enqueue(url, userAgent, mimeType, name)

            else -> opener.toast(R.string.webshell_download_failed)
        }
    }

    /** Called from the page with a blob's contents. Writes one new file under Downloads. */
    @JavascriptInterface
    fun saveBase64(
        name: String?,
        mimeType: String?,
        base64: String?,
    ): Boolean {
        val bytes = decode(base64 ?: return false) ?: return false
        val mime = mimeType?.takeIf { it.isNotBlank() } ?: "application/octet-stream"
        return write(safeFileName(name ?: "download"), mime, bytes)
    }

    @JavascriptInterface
    fun reportFailure(reason: String?) {
        Log.w(TAG, "Blob download failed: ${reason?.take(200)}")
        opener.toast(R.string.webshell_download_failed)
    }

    private fun enqueue(
        url: String,
        userAgent: String?,
        mimeType: String?,
        name: String,
    ) {
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        if (manager == null) {
            opener.toast(R.string.webshell_download_failed)
            return
        }
        val request =
            DownloadManager.Request(Uri.parse(url)).apply {
                setTitle(name)
                if (!mimeType.isNullOrBlank()) setMimeType(mimeType)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
                userAgent?.let { addRequestHeader("User-Agent", it) }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
                } else {
                    setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, name)
                }
            }
        runCatching { manager.enqueue(request) }
            .onSuccess { opener.toast(R.string.webshell_download_started) }
            .onFailure {
                Log.w(TAG, "DownloadManager refused $name: ${it.message}")
                opener.toast(R.string.webshell_download_failed)
            }
    }

    private fun write(
        name: String,
        mimeType: String,
        bytes: ByteArray,
    ): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            opener.toast(R.string.webshell_download_needs_android_10)
            return false
        }
        if (bytes.size > MAX_BYTES) {
            opener.toast(R.string.webshell_download_failed)
            return false
        }
        val resolver = context.contentResolver
        val values =
            ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.MIME_TYPE, mimeType)
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
        val uri = runCatching { resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) }.getOrNull()
        if (uri == null) {
            opener.toast(R.string.webshell_download_failed)
            return false
        }
        val ok =
            runCatching {
                resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("no output stream")
                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(uri, values, null, null)
            }.isSuccess
        if (!ok) runCatching { resolver.delete(uri, null, null) }
        opener.toast(if (ok) R.string.webshell_download_saved else R.string.webshell_download_failed)
        return ok
    }

    private fun decode(base64: String): ByteArray? = runCatching { Base64.decode(base64, Base64.DEFAULT) }.getOrNull()

    private fun blobReaderScript(
        url: String,
        name: String,
    ): String {
        val quotedUrl = JSONObject.quote(url)
        val quotedName = JSONObject.quote(name)
        return """
            (function () {
              fetch($quotedUrl).then(function (response) { return response.blob(); }).then(function (blob) {
                return new Promise(function (resolve, reject) {
                  var reader = new FileReader();
                  reader.onload = function () { resolve(reader.result); };
                  reader.onerror = function () { reject(reader.error); };
                  reader.readAsDataURL(blob);
                });
              }).then(function (dataUrl) {
                var comma = dataUrl.indexOf(',');
                var mime = dataUrl.slice(5, comma).split(';')[0];
                $BRIDGE.saveBase64($quotedName, mime, dataUrl.slice(comma + 1));
              }).catch(function (error) { $BRIDGE.reportFailure(String(error)); });
            })();
            """.trimIndent()
    }

    companion object {
        /** The name the page sees; keep in step with [blobReaderScript]. */
        const val BRIDGE = "WebShellDownloads"
        private const val TAG = "WebShell"
        private const val MAX_BYTES = 64 * 1024 * 1024

        fun safeFileName(raw: String): String {
            val cleaned =
                raw
                    .substringAfterLast('/')
                    .substringAfterLast('\\')
                    .replace(Regex("[\\u0000-\\u001f\"*:<>?|]"), "_")
                    .trim()
                    .trimStart('.')
            return (if (cleaned.isBlank()) "download" else cleaned).take(120)
        }
    }
}
