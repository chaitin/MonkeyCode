package com.monkeycode.mobile

import android.app.DownloadManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Base64
import android.webkit.CookieManager
import android.webkit.DownloadListener
import android.webkit.JavascriptInterface
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import com.monkeycode.mobile.databinding.ActivityMainBinding
import java.io.File
import java.io.FileOutputStream

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null
    private val mainHandler = Handler(Looper.getMainLooper())
    private val activeDownloads = mutableMapOf<Long, Runnable>()
    private var hasRequestedStartupPermissions = false

    private val downloadCompleteReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            if (intent?.action != DownloadManager.ACTION_DOWNLOAD_COMPLETE) {
                return
            }

            val downloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L)
            if (downloadId == -1L) {
                return
            }

            stopTrackingDownload(downloadId)
            handleDownloadCompletion(downloadId)
        }
    }

    private val singleFilePicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            val results = uri?.let { arrayOf(it) }
            fileChooserCallback?.onReceiveValue(results)
            fileChooserCallback = null
        }

    private val filePicker =
        registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            val results = uris.toTypedArray()
            fileChooserCallback?.onReceiveValue(results)
            fileChooserCallback = null
        }

    private val notificationPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            applyWebsiteTheme()
        }

    private val allFilesAccessLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
            applyWebsiteTheme()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        createDownloadNotificationChannel()
        registerDownloadReceiver()
        applyWindowInsets()
        configureWebView()
        configureRefresh()
        handleBackPress()
        requestStartupPermissions()

        if (savedInstanceState == null) {
            binding.webView.loadUrl(HOME_URL)
        } else {
            binding.webView.restoreState(savedInstanceState)
            applyWebsiteTheme()
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        binding.webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
        applyWebsiteTheme()
        if (hasRequestedStartupPermissions) {
            maybeRequestAllFilesAccess()
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyWebsiteTheme()
    }

    override fun onDestroy() {
        unregisterReceiver(downloadCompleteReceiver)
        activeDownloads.values.forEach(mainHandler::removeCallbacks)
        activeDownloads.clear()
        fileChooserCallback?.onReceiveValue(null)
        fileChooserCallback = null
        binding.webView.destroy()
        super.onDestroy()
    }

    private fun applyWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { view, insets ->
            val systemBars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val imeInsets = insets.getInsets(WindowInsetsCompat.Type.ime())
            val bottomInset = maxOf(systemBars.bottom, imeInsets.bottom)

            view.updatePadding(top = systemBars.top)
            binding.swipeRefresh.updatePadding(bottom = bottomInset)

            insets
        }
    }

    private fun configureRefresh() {
        binding.swipeRefresh.setOnRefreshListener {
            binding.webView.reload()
        }
    }

    private fun configureWebView() {
        val cookieManager = CookieManager.getInstance()
        cookieManager.setAcceptCookie(true)
        cookieManager.setAcceptThirdPartyCookies(binding.webView, true)

        binding.webView.apply {
            overScrollMode = WebView.OVER_SCROLL_NEVER
            isVerticalScrollBarEnabled = false
            isHorizontalScrollBarEnabled = false

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mediaPlaybackRequiresUserGesture = false
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                cacheMode = WebSettings.LOAD_DEFAULT
                loadWithOverviewMode = true
                useWideViewPort = true
                builtInZoomControls = false
                displayZoomControls = false
                userAgentString = buildDesktopUserAgent()
            }

            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, true)
            }

            addJavascriptInterface(MonkeyCodeNativeBridge(), JS_BRIDGE_NAME)
            webViewClient = ShellWebViewClient()
            webChromeClient = ShellWebChromeClient()
            setDownloadListener(createDownloadListener())
        }

        applyWebsiteTheme()
    }

    private fun requestStartupPermissions() {
        if (hasRequestedStartupPermissions) {
            return
        }

        hasRequestedStartupPermissions = true
        requestNotificationPermission()
        maybeRequestAllFilesAccess()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return
        }

        if (ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return
        }

        notificationPermissionLauncher.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    private fun maybeRequestAllFilesAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()) {
            return
        }

        Toast.makeText(this, getString(R.string.all_files_permission_prompt), Toast.LENGTH_LONG).show()
        val packageUri = Uri.parse("package:$packageName")
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, packageUri)
        val fallbackIntent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)

        try {
            allFilesAccessLauncher.launch(intent)
        } catch (_: Exception) {
            allFilesAccessLauncher.launch(fallbackIntent)
        }
    }

    private fun createDownloadListener(): DownloadListener {
        return DownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(url.toUri())
                .setMimeType(mimeType)
                .setTitle(fileName)
                .setDescription(getString(R.string.download_description))
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(true)
                .addRequestHeader("User-Agent", userAgent)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "$DOWNLOAD_SUBDIRECTORY/$fileName")

            CookieManager.getInstance().getCookie(url)?.let {
                request.addRequestHeader("Cookie", it)
            }

            try {
                val downloadManager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val downloadId = downloadManager.enqueue(request)
                trackDownload(downloadId, fileName)
                Toast.makeText(this, getString(R.string.download_started), Toast.LENGTH_SHORT).show()
            } catch (error: Exception) {
                Toast.makeText(this, error.message ?: getString(R.string.download_failed), Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun createDownloadNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }

        val channel = NotificationChannel(
            DOWNLOAD_CHANNEL_ID,
            getString(R.string.download_channel_name),
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = getString(R.string.download_channel_description)
        }

        val notificationManager = getSystemService(NotificationManager::class.java)
        notificationManager.createNotificationChannel(channel)
    }

    private fun registerDownloadReceiver() {
        val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(downloadCompleteReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(downloadCompleteReceiver, filter)
        }
    }

    private fun trackDownload(downloadId: Long, fileName: String) {
        val runnable = object : Runnable {
            override fun run() {
                val downloadManager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                val query = DownloadManager.Query().setFilterById(downloadId)
                downloadManager.query(query).use { cursor ->
                    if (!cursor.moveToFirst()) {
                        stopTrackingDownload(downloadId)
                        return
                    }

                    val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                    val downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                    val total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))

                    if (status == DownloadManager.STATUS_RUNNING || status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                        showDownloadProgress(downloadId, fileName, downloaded, total)
                        mainHandler.postDelayed(this, DOWNLOAD_POLL_INTERVAL_MS)
                    }
                }
            }
        }

        activeDownloads[downloadId] = runnable
        mainHandler.post(runnable)
    }

    private fun stopTrackingDownload(downloadId: Long) {
        activeDownloads.remove(downloadId)?.let(mainHandler::removeCallbacks)
    }

    private fun showDownloadProgress(downloadId: Long, fileName: String, downloaded: Long, total: Long) {
        val builder = NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(fileName)
            .setContentText(getString(R.string.download_in_progress))
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)

        if (total > 0) {
            val progress = ((downloaded * 100) / total).toInt()
            builder.setProgress(100, progress, false)
                .setContentText(getString(R.string.download_progress_percent, progress))
        } else {
            builder.setProgress(0, 0, true)
        }

        NotificationManagerCompat.from(this).notify(downloadId.toInt(), builder.build())
    }

    private fun handleDownloadCompletion(downloadId: Long) {
        val downloadManager = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val query = DownloadManager.Query().setFilterById(downloadId)
        downloadManager.query(query).use { cursor ->
            if (!cursor.moveToFirst()) {
                return
            }

            val status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
            val title = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE)) ?: getString(R.string.download_complete)

            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                NotificationManagerCompat.from(this).notify(
                    downloadId.toInt(),
                    NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.stat_sys_download_done)
                        .setContentTitle(title)
                        .setContentText(getString(R.string.download_saved_path))
                        .setAutoCancel(true)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                        .build()
                )
                Toast.makeText(this, getString(R.string.download_completed_toast), Toast.LENGTH_LONG).show()
            } else {
                NotificationManagerCompat.from(this).notify(
                    downloadId.toInt(),
                    NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.stat_notify_error)
                        .setContentTitle(title)
                        .setContentText(getString(R.string.download_failed))
                        .setAutoCancel(true)
                        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                        .build()
                )
            }
        }
    }

    private fun handleBackPress() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (binding.webView.canGoBack()) {
                        binding.webView.goBack()
                    } else {
                        finish()
                    }
                }
            }
        )
    }

    private fun applyWebsiteTheme() {
        val isDarkMode =
            (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                Configuration.UI_MODE_NIGHT_YES
        val themeValue = if (isDarkMode) "dark" else "light"
        val script = """
            (function() {
              const theme = '$themeValue';
              const capabilities = {
                supportsFolderAccess: true,
                supportsDirectoryUpload: true,
                supportsFileUpload: true,
                supportsMultiFileUpload: true,
                hasAllFilesAccess: ${hasAllFilesAccess()},
                hasNotificationPermission: ${hasNotificationPermission()}
              };
              document.documentElement.setAttribute('data-theme', theme);
              document.documentElement.style.colorScheme = theme;
              document.body && document.body.setAttribute('data-theme', theme);
              window.localStorage.setItem('theme', theme);
              window.localStorage.setItem('color-theme', theme);
              window.MonkeyCodeAppCapabilities = capabilities;
              window.dispatchEvent(new CustomEvent('monkeycode-capabilities', { detail: capabilities }));
            })();
        """.trimIndent()

        if (WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) {
            @Suppress("DEPRECATION")
            WebSettingsCompat.setForceDark(
                binding.webView.settings,
                if (isDarkMode) WebSettingsCompat.FORCE_DARK_ON else WebSettingsCompat.FORCE_DARK_OFF
            )
        }

        binding.webView.evaluateJavascript(script, null)
        injectDownloadBridge()
    }

    private fun injectDownloadBridge() {
        val script = """
            (function() {
              if (window.__monkeycodeDownloadBridgeInstalled) return;
              window.__monkeycodeDownloadBridgeInstalled = true;

              async function saveBlob(blob, fileName) {
                const reader = new FileReader();
                reader.onloadend = function() {
                  const result = typeof reader.result === 'string' ? reader.result : '';
                  if (!result) return;
                  window.MonkeyCodeNative.saveBase64File(fileName || 'download', blob.type || 'application/octet-stream', result);
                };
                reader.readAsDataURL(blob);
              }

              function createWritableHandle(nameHint) {
                let collected = [];
                let mimeType = 'application/octet-stream';
                let currentPosition = 0;
                let writable;
                const writer = {
                  async write(data) {
                    return writable.write(data);
                  },
                  async close() {
                    return writable.close();
                  },
                  async abort() {
                    collected = [];
                  },
                  releaseLock() {
                  }
                };
                writable = {
                  getWriter() {
                    return writer;
                  },
                  async write(data) {
                    if (data && typeof data === 'object' && data.type === 'write' && 'data' in data) {
                      return this.write(data.data);
                    }
                    if (data && typeof data === 'object' && data.type === 'truncate') {
                      return;
                    }
                    if (data && typeof data === 'object' && data.type === 'seek') {
                      currentPosition = Number(data.position || 0);
                      return;
                    }
                    if (data instanceof Blob) {
                      mimeType = data.type || mimeType;
                      const arrayBuffer = await data.arrayBuffer();
                      collected.push(new Uint8Array(arrayBuffer));
                      currentPosition += arrayBuffer.byteLength;
                      return;
                    }
                    if (data instanceof Uint8Array) {
                      collected.push(data);
                      currentPosition += data.byteLength;
                      return;
                    }
                    if (data instanceof ArrayBuffer) {
                      const typed = new Uint8Array(data);
                      collected.push(typed);
                      currentPosition += typed.byteLength;
                      return;
                    }
                    if (typeof data === 'string') {
                      const typed = new TextEncoder().encode(data);
                      collected.push(typed);
                      currentPosition += typed.byteLength;
                    }
                  },
                  async seek(position) {
                    currentPosition = Number(position || 0);
                  },
                  async truncate() {
                    return;
                  },
                  async close() {
                    let total = 0;
                    for (const part of collected) total += part.length;
                    const merged = new Uint8Array(total);
                    let offset = 0;
                    for (const part of collected) {
                      merged.set(part, offset);
                      offset += part.length;
                    }
                    const blob = new Blob([merged], { type: mimeType });
                    await saveBlob(blob, nameHint || 'download');
                  },
                  async abort() {
                    collected = [];
                  }
                };
                return writable;
              }

              function createFileHandle(suggestedName) {
                return {
                  kind: 'file',
                  name: suggestedName || 'download',
                  async queryPermission() { return 'granted'; },
                  async requestPermission() { return 'granted'; },
                  async createWritable() {
                    return createWritableHandle(suggestedName || 'download');
                  },
                  async getFile() {
                    return new File([], suggestedName || 'download');
                  }
                };
              }

              function createDirectoryHandle() {
                return {
                  kind: 'directory',
                  name: 'monkeycode',
                  async queryPermission() { return 'granted'; },
                  async requestPermission() { return 'granted'; },
                  async getFileHandle(name) {
                    return createFileHandle(name || 'download');
                  },
                  async getDirectoryHandle() {
                    return createDirectoryHandle();
                  },
                  async removeEntry() {
                    return;
                  },
                  async resolve() {
                    return ['monkeycode'];
                  },
                  async *entries() {
                  },
                  async *values() {
                  },
                  async *keys() {
                  }
                };
              }

              async function handleLink(link) {
                const href = link.href || '';
                const fileName = link.getAttribute('download') || link.dataset.download || 'download';
                if (href.startsWith('blob:')) {
                  const response = await fetch(href);
                  const blob = await response.blob();
                  await saveBlob(blob, fileName);
                  return true;
                }
                if (href.startsWith('data:')) {
                  window.MonkeyCodeNative.saveBase64File(fileName, '', href);
                  return true;
                }
                return false;
              }

              document.addEventListener('click', async function(event) {
                const link = event.target && event.target.closest ? event.target.closest('a[download],a[href^="blob:"],a[href^="data:"]') : null;
                if (!link) return;
                try {
                  const handled = await handleLink(link);
                  if (handled) {
                    event.preventDefault();
                    event.stopPropagation();
                  }
                } catch (error) {
                  console.error('MonkeyCode download bridge failed', error);
                }
              }, true);

              window.showSaveFilePicker = async function(options) {
                const suggestedName = options && options.suggestedName ? options.suggestedName : 'download';
                return createFileHandle(suggestedName);
              };

              window.showDirectoryPicker = async function() {
                return createDirectoryHandle();
              };

              if (navigator.storage && typeof navigator.storage.getDirectory !== 'function') {
                navigator.storage.getDirectory = async function() {
                  return createDirectoryHandle();
                };
              }

              window.MonkeyCodeAppCapabilities = Object.assign({}, window.MonkeyCodeAppCapabilities || {}, {
                supportsBlobDownloadBridge: true,
                supportsDataUrlDownloadBridge: true,
                supportsFileSystemAccessApi: true
              });
            })();
        """.trimIndent()
        binding.webView.evaluateJavascript(script, null)
    }

    private fun hasNotificationPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(this, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    }

    private fun hasAllFilesAccess(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.R || Environment.isExternalStorageManager()
    }

    private fun buildDesktopUserAgent(): String {
        return "$DESKTOP_CHROME_UA $APP_UA_SUFFIX"
    }

    private fun openFilePicker(acceptTypes: Array<String>, allowMultiple: Boolean) {
        val normalizedTypes = acceptTypes
            .flatMap { entry ->
                entry.split(',').map { it.trim() }.filter { it.isNotEmpty() }
            }
            .ifEmpty { listOf("*/*") }
            .toTypedArray()

        try {
            if (allowMultiple) {
                filePicker.launch(normalizedTypes)
            } else {
                singleFilePicker.launch(arrayOf(normalizedTypes.first()))
            }
        } catch (_: ActivityNotFoundException) {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = null
            Toast.makeText(this, getString(R.string.file_picker_unavailable), Toast.LENGTH_SHORT).show()
        }
    }

    private fun saveBase64FileInternal(fileName: String, mimeType: String, dataUrl: String) {
        try {
            val base64Payload = dataUrl.substringAfter("base64,", dataUrl)
            val bytes = Base64.decode(base64Payload, Base64.DEFAULT)
            val targetDir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), DOWNLOAD_SUBDIRECTORY)
            if (!targetDir.exists()) {
                targetDir.mkdirs()
            }

            val safeName = normalizeFileName(fileName, mimeType)
            val targetFile = File(targetDir, safeName)
            FileOutputStream(targetFile).use { it.write(bytes) }
            MediaScannerConnection.scanFile(this, arrayOf(targetFile.absolutePath), arrayOf(mimeType.ifBlank { "application/octet-stream" }), null)

            NotificationManagerCompat.from(this).notify(
                targetFile.absolutePath.hashCode(),
                NotificationCompat.Builder(this, DOWNLOAD_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.stat_sys_download_done)
                    .setContentTitle(safeName)
                    .setContentText(getString(R.string.download_saved_path))
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build()
            )
            Toast.makeText(this, getString(R.string.download_completed_toast), Toast.LENGTH_LONG).show()
        } catch (error: Exception) {
            Toast.makeText(this, error.message ?: getString(R.string.download_failed), Toast.LENGTH_LONG).show()
        }
    }

    private fun normalizeFileName(fileName: String, mimeType: String): String {
        val sanitized = fileName.ifBlank { "download" }
            .replace(Regex("[\\\\/:*?\"<>|]"), "_")
        if (sanitized.contains('.')) {
            return sanitized
        }

        val suffix = when (mimeType.lowercase()) {
            "application/pdf" -> ".pdf"
            "application/zip" -> ".zip"
            "application/json" -> ".json"
            "text/plain" -> ".txt"
            "image/png" -> ".png"
            "image/jpeg" -> ".jpg"
            "application/vnd.android.package-archive" -> ".apk"
            else -> ""
        }
        return sanitized + suffix
    }

    private inner class ShellWebViewClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
            val uri = request?.url ?: return false
            val scheme = uri.scheme.orEmpty()
            if (scheme == "http" || scheme == "https") {
                return false
            }

            return try {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
                true
            } catch (_: Exception) {
                false
            }
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            binding.swipeRefresh.isRefreshing = true
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            CookieManager.getInstance().flush()
            applyWebsiteTheme()
            binding.swipeRefresh.isRefreshing = false
        }
    }

    private inner class ShellWebChromeClient : WebChromeClient() {
        override fun onShowFileChooser(
            webView: WebView?,
            filePathCallback: ValueCallback<Array<Uri>>?,
            fileChooserParams: FileChooserParams?
        ): Boolean {
            fileChooserCallback?.onReceiveValue(null)
            fileChooserCallback = filePathCallback

            val allowMultiple = fileChooserParams?.mode == FileChooserParams.MODE_OPEN_MULTIPLE
            val acceptTypes = fileChooserParams?.acceptTypes ?: emptyArray()

            openFilePicker(acceptTypes, allowMultiple)
            return true
        }
    }

    private inner class MonkeyCodeNativeBridge {
        @JavascriptInterface
        fun requestNotificationPermission() {
            runOnUiThread { requestNotificationPermission() }
        }

        @JavascriptInterface
        fun requestAllFilesAccessPermission() {
            runOnUiThread { maybeRequestAllFilesAccess() }
        }

        @JavascriptInterface
        fun hasNotificationPermission(): Boolean {
            return this@MainActivity.hasNotificationPermission()
        }

        @JavascriptInterface
        fun hasAllFilesAccess(): Boolean {
            return this@MainActivity.hasAllFilesAccess()
        }

        @JavascriptInterface
        fun supportsFolderAccess(): Boolean {
            return true
        }

        @JavascriptInterface
        fun saveBase64File(fileName: String, mimeType: String, dataUrl: String) {
            runOnUiThread {
                this@MainActivity.saveBase64FileInternal(fileName, mimeType, dataUrl)
            }
        }
    }

    companion object {
        private const val HOME_URL = "https://monkeycode-ai.com/"
        private const val APP_UA_SUFFIX = "MonkeyCodeMobile/1.0"
        private const val DESKTOP_CHROME_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
        private const val DOWNLOAD_CHANNEL_ID = "monkeycode_downloads"
        private const val DOWNLOAD_SUBDIRECTORY = "monkeycode"
        private const val DOWNLOAD_POLL_INTERVAL_MS = 1000L
        private const val JS_BRIDGE_NAME = "MonkeyCodeNative"
    }
}
