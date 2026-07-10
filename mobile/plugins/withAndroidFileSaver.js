const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

function writeFileIfChanged(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) return;
  fs.writeFileSync(filePath, contents);
}

function moduleSource(packageName) {
  return `package ${packageName}

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.DocumentsContract
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import java.io.File
import java.io.FileInputStream

class FileSaverModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private var pendingPromise: Promise? = null
  private var pendingSourceUri: Uri? = null

  private val activityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != SAVE_FILE_REQUEST_CODE) return
      val promise = pendingPromise ?: return
      pendingPromise = null
      val sourceUri = pendingSourceUri
      pendingSourceUri = null

      val destinationUri = data?.data
      if (resultCode != Activity.RESULT_OK || destinationUri == null) {
        promise.resolve(null)
        return
      }

      Thread {
        try {
          val input = when (sourceUri?.scheme) {
            "file" -> FileInputStream(File(sourceUri.path ?: throw IllegalArgumentException("源文件路径无效")))
            else -> sourceUri?.let { reactContext.contentResolver.openInputStream(it) }
          } ?: throw IllegalStateException("无法读取下载文件")
          val output = reactContext.contentResolver.openOutputStream(destinationUri, "w")
            ?: throw IllegalStateException("无法写入所选位置")
          input.use { source -> output.use { target -> source.copyTo(target) } }
          promise.resolve(destinationUri.toString())
        } catch (error: Exception) {
          promise.reject("E_SAVE_FILE", error.message ?: "保存文件失败", error)
        }
      }.start()
    }
  }

  init {
    reactContext.addActivityEventListener(activityEventListener)
  }

  override fun getName(): String = "FileSaver"

  @ReactMethod
  fun saveFile(sourceUri: String, suggestedName: String, mimeType: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "当前没有可用的 Activity")
      return
    }
    if (pendingPromise != null) {
      promise.reject("E_SAVE_IN_PROGRESS", "已有文件正在保存")
      return
    }

    pendingPromise = promise
    pendingSourceUri = Uri.parse(sourceUri)
    val intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      type = mimeType.ifBlank { "application/octet-stream" }
      putExtra(Intent.EXTRA_TITLE, suggestedName)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        putExtra(
          DocumentsContract.EXTRA_INITIAL_URI,
          Uri.parse("content://com.android.externalstorage.documents/document/primary%3ADownload"),
        )
      }
    }

    UiThreadUtil.runOnUiThread {
      try {
        activity.startActivityForResult(intent, SAVE_FILE_REQUEST_CODE)
      } catch (error: Exception) {
        pendingPromise = null
        pendingSourceUri = null
        promise.reject("E_OPEN_FILE_PICKER", error.message ?: "无法打开系统文件选择器", error)
      }
    }
  }

  override fun invalidate() {
    reactContext.removeActivityEventListener(activityEventListener)
    pendingPromise?.reject("E_MODULE_DESTROYED", "保存操作已取消")
    pendingPromise = null
    pendingSourceUri = null
    super.invalidate()
  }

  companion object {
    private const val SAVE_FILE_REQUEST_CODE = 7643
  }
}
`;
}

function packageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class FileSaverPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(FileSaverModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;
}

function patchMainApplication(projectRoot, packageName) {
  const file = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
  if (!fs.existsSync(file)) return;
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes('add(FileSaverPackage())')) {
    source = source.replace(
      /PackageList\(this\)\.packages\.apply\s*\{/,
      (match) => `${match}\n          add(FileSaverPackage())`,
    );
    fs.writeFileSync(file, source);
  }
}

module.exports = function withAndroidFileSaver(config) {
  const packageName = config.android?.package || 'com.chaitin.baizhi.monkeycode';
  return withDangerousMod(config, ['android', (mod) => {
    const base = path.join(mod.modRequest.projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'));
    writeFileIfChanged(path.join(base, 'FileSaverModule.kt'), moduleSource(packageName));
    writeFileIfChanged(path.join(base, 'FileSaverPackage.kt'), packageSource(packageName));
    patchMainApplication(mod.modRequest.projectRoot, packageName);
    return mod;
  }]);
};
