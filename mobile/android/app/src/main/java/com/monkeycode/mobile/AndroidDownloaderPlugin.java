package com.monkeycode.mobile;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.URLUtil;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(
    name = "AndroidDownloader",
    permissions = {
        @Permission(
            alias = "storage",
            strings = {
                Manifest.permission.READ_EXTERNAL_STORAGE,
                Manifest.permission.WRITE_EXTERNAL_STORAGE
            }
        )
    }
)
public class AndroidDownloaderPlugin extends Plugin {
    @PluginMethod
    public void downloadFile(PluginCall call) {
        if (requiresLegacyStoragePermission() && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storagePermissionCallback");
            return;
        }

        startDownload(call);
    }

    @PermissionCallback
    private void storagePermissionCallback(PluginCall call) {
        if (!requiresLegacyStoragePermission() || getPermissionState("storage") == PermissionState.GRANTED) {
            startDownload(call);
            return;
        }

        call.reject("Storage permission is required to download files");
    }

    private void startDownload(PluginCall call) {
        String url = call.getString("url");
        String filename = call.getString("filename");

        if (url == null || url.trim().isEmpty()) {
            call.reject("url is required");
            return;
        }

        Uri downloadUri = Uri.parse(url);
        String resolvedFilename = filename;
        if (resolvedFilename == null || resolvedFilename.trim().isEmpty()) {
            resolvedFilename = URLUtil.guessFileName(url, null, null);
        }

        DownloadManager.Request request = new DownloadManager.Request(downloadUri)
            .setTitle(resolvedFilename)
            .setDescription("Downloading file")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, resolvedFilename);

        String mimeType = resolveMimeType(url, resolvedFilename);
        if (mimeType != null && !mimeType.isEmpty()) {
            request.setMimeType(mimeType);
        }

        String cookies = CookieManager.getInstance().getCookie(url);
        if (cookies != null && !cookies.isEmpty()) {
            request.addRequestHeader("Cookie", cookies);
        }

        String userAgent = System.getProperty("http.agent");
        if (userAgent != null && !userAgent.isEmpty()) {
            request.addRequestHeader("User-Agent", userAgent);
        }

        Context context = getContext();
        DownloadManager downloadManager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (downloadManager == null) {
            call.reject("DownloadManager unavailable");
            return;
        }

        long downloadId;
        try {
            downloadId = downloadManager.enqueue(request);
        } catch (SecurityException exception) {
            call.reject("Storage permission is required to download files", exception);
            return;
        } catch (RuntimeException exception) {
            call.reject("Failed to enqueue Android download", exception);
            return;
        }

        JSObject result = new JSObject();
        result.put("downloadId", downloadId);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            result.put("filename", resolvedFilename);
        }
        call.resolve(result);
    }

    private String resolveMimeType(String url, String filename) {
        String extension = MimeTypeMap.getFileExtensionFromUrl(url);
        if (extension == null || extension.isEmpty()) {
            int dotIndex = filename.lastIndexOf('.');
            if (dotIndex >= 0 && dotIndex < filename.length() - 1) {
                extension = filename.substring(dotIndex + 1);
            }
        }

        if (extension == null || extension.isEmpty()) {
            return null;
        }

        return MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension.toLowerCase());
    }

    private boolean requiresLegacyStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P;
    }
}
