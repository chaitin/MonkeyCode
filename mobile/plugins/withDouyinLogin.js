const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  IOSConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withInfoPlist,
  withPodfile,
  withProjectBuildGradle,
  withXcodeProject,
} = require('@expo/config-plugins');

const DOUYIN_PACKAGES = [
  'com.ss.android.ugc.aweme',
  'com.ss.android.ugc.aweme.lite',
  'com.ss.android.ugc.live',
];

const DOUYIN_IOS_SCHEMES = [
  'douyinopensdk',
  'douyinliteopensdk',
  'douyinsharesdk',
  'snssdk1128',
];

function resolveClientKey(config, props = {}) {
  return (
    props.clientKey ||
    process.env.EXPO_PUBLIC_DOUYIN_CLIENT_KEY ||
    process.env.DOUYIN_CLIENT_KEY ||
    config.extra?.douyinClientKey ||
    ''
  ).trim();
}

function addAndroidPackageQuery(manifest, packageName) {
  AndroidConfig.Manifest.ensureToolsAvailable(manifest);
  const [query = {}, ...rest] = manifest.manifest.queries ?? [];
  for (const item of rest) {
    for (const key of Object.keys(item)) {
      query[key] = [...(query[key] ?? []), ...item[key]];
    }
  }
  manifest.manifest.queries = [query];

  const exists = query.package?.some((pkg) => pkg.$?.['android:name'] === packageName);
  if (!exists) {
    query.package = [
      ...(query.package ?? []),
      { $: { 'android:name': packageName } },
    ];
  }
}

function addAndroidActivity(manifest, packageName) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const name = `${packageName}.douyinapi.DouYinEntryActivity`;
  app.activity = app.activity ?? [];
  if (app.activity.some((activity) => activity.$?.['android:name'] === name || activity.$?.['android:name'] === '.douyinapi.DouYinEntryActivity')) {
    return;
  }
  app.activity.push({
    $: {
      'android:name': name,
      'android:launchMode': 'singleTask',
      'android:taskAffinity': packageName,
      'android:exported': 'true',
    },
  });
}

function ensureContains(source, needle, insert) {
  return source.includes(needle) ? source : insert(source);
}

function addMavenRepo(source) {
  const repo = "maven { url 'https://artifact.bytedance.com/repository/AwemeOpenSDK' }";
  return ensureContains(source, "artifact.bytedance.com/repository/AwemeOpenSDK", (s) => (
    s.replace(/allprojects\s*\{\s*repositories\s*\{/, (match) => `${match}\n    ${repo}`)
  ));
}

function addAndroidDeps(source) {
  if (source.includes('opensdk-china-external')) return source;
  const deps = `
    def douyin_open_sdk_version = "0.2.0.8"
    implementation "com.bytedance.ies.ugc.aweme:opensdk-china-external:$douyin_open_sdk_version"
    implementation "com.bytedance.ies.ugc.aweme:opensdk-common:$douyin_open_sdk_version"
`;
  return source.replace(/dependencies\s*\{/, (match) => `${match}${deps}`);
}

function addPod(source) {
  let next = source;
  if (!next.includes("pod 'DouyinOpenSDK'")) {
    next = next.replace(/use_expo_modules!\n/, "use_expo_modules!\n  pod 'DouyinOpenSDK'\n");
  }
  return addIOSPodPatches(next);
}

function addIOSPodPatches(source) {
  const helperName = 'patch_douyin_ios_simulator_linkage';
  const helper = `def ${helperName}(installer)
  installer.aggregate_targets.each do |aggregate_target|
    aggregate_target.xcconfigs.each do |_config_name, _xcconfig|
      path = aggregate_target.xcconfig_path(_config_name)
      next unless File.exist?(path)

      contents = File.read(path)
      next unless contents.include?('DouyinOpenSDK')

      contents = contents.lines.reject do |line|
        line.start_with?('EXCLUDED_ARCHS[sdk=iphonesimulator*]') ||
          line.start_with?('OTHER_LDFLAGS[sdk=iphoneos*]') ||
          line.start_with?('OTHER_LDFLAGS[sdk=iphonesimulator*]')
      end.join

      contents = contents.gsub(/^OTHER_LDFLAGS = (.*)\\n/) do
        flags = Regexp.last_match(1)
        next "OTHER_LDFLAGS = #{flags}\\n" unless flags.include?('DouyinOpenSDK')

        base_flags = flags.gsub(/ -framework "DouyinOpenSDK"/, '')
        "OTHER_LDFLAGS = #{base_flags}\\nOTHER_LDFLAGS[sdk=iphoneos*] = $(inherited) -framework \\"DouyinOpenSDK\\"\\n"
      end

      File.write(path, contents)
    end
  end
end

def patch_douyin_resource_bundles(installer)
  sandbox_root = installer.sandbox.root.to_s
  info_plist = File.join(sandbox_root, 'DouyinOpenSDK', 'DouyinOpenSDK.framework', 'Resources', 'DYOpenCore.bundle', 'Info.plist')
  return unless File.exist?(info_plist)

  if system('/usr/libexec/PlistBuddy', '-c', 'Print :CFBundleExecutable', info_plist, out: File::NULL, err: File::NULL)
    system('/usr/libexec/PlistBuddy', '-c', 'Delete :CFBundleExecutable', info_plist)
  end
  system('/usr/libexec/PlistBuddy', '-c', 'Set :CFBundlePackageType BNDL', info_plist) ||
    system('/usr/libexec/PlistBuddy', '-c', 'Add :CFBundlePackageType string BNDL', info_plist)
end
`;
  const helperPattern = new RegExp(`def ${helperName}\\(installer\\)[\\s\\S]*?\\nend\\n\\ntarget ['"]`);
  let next = helperPattern.test(source)
    ? source.replace(helperPattern, `${helper}\ntarget '`)
    : source.replace(/target ['"]/, `${helper}\ntarget '`);
  if (!next.includes(`\n    ${helperName}(installer)`)) {
    next = next.replace(
      /(react_native_post_install\([\s\S]*?:ccache_enabled => ccache_enabled\?\(podfile_properties\),\n    \))/,
      (match) => `${match}\n    ${helperName}(installer)`,
    );
  }
  if (!next.includes('\n    patch_douyin_resource_bundles(installer)')) {
    next = next.replace(
      new RegExp(`(\\n    ${helperName}\\(installer\\))`),
      (match) => `${match}\n    patch_douyin_resource_bundles(installer)`,
    );
  }
  return next;
}

function addIOSURLScheme(infoPlist, scheme) {
  if (!scheme) return;
  const types = Array.isArray(infoPlist.CFBundleURLTypes) ? infoPlist.CFBundleURLTypes : [];
  let target = types.find((item) => Array.isArray(item.CFBundleURLSchemes));
  if (!target) {
    target = { CFBundleURLSchemes: [] };
    types.push(target);
  }
  if (!target.CFBundleURLSchemes.includes(scheme)) {
    target.CFBundleURLSchemes.push(scheme);
  }
  infoPlist.CFBundleURLTypes = types;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFileIfChanged(filePath, contents) {
  ensureDir(filePath);
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === contents) return;
  fs.writeFileSync(filePath, contents);
}

function patchMainApplication(projectRoot, packageName) {
  const rel = path.join('android', 'app', 'src', 'main', 'java', ...packageName.split('.'), 'MainApplication.kt');
  const file = path.join(projectRoot, rel);
  if (!fs.existsSync(file)) return;
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes('add(DouyinAuthPackage())')) return;
  source = source.replace(
    /PackageList\(this\)\.packages\.apply\s*\{/,
    (match) => `${match}\n          add(DouyinAuthPackage())`,
  );
  fs.writeFileSync(file, source);
}

function patchAppDelegate(projectRoot) {
  const file = path.join(projectRoot, 'ios', 'MonkeyCode', 'AppDelegate.swift');
  if (!fs.existsSync(file)) return;
  let source = fs.readFileSync(file, 'utf8');
  const douyinImport = `#if !targetEnvironment(simulator)
import DouyinOpenSDK
#endif
`;
  const douyinOpenURLBlock = `#if !targetEnvironment(simulator)
    if DouyinOpenSDKApplicationDelegate.sharedInstance().application(
      app,
      open: url,
      sourceApplication: options[UIApplication.OpenURLOptionsKey.sourceApplication] as? String,
      annotation: options[UIApplication.OpenURLOptionsKey.annotation]
    ) {
      return true
    }
#endif
`;
  const douyinLaunchBlock = `#if !targetEnvironment(simulator)
    DouyinOpenSDKApplicationDelegate.sharedInstance().application(application, didFinishLaunchingWithOptions: launchOptions)
#endif`;
  const unguardedImportPattern = /^import DouyinOpenSDK\n/m;
  const guardedImportPattern = /#if !targetEnvironment\(simulator\)\nimport DouyinOpenSDK\n#endif\n/g;
  const douyinOpenURLPattern = /(?:#if !targetEnvironment\(simulator\)\n)?    if DouyinOpenSDKApplicationDelegate\.sharedInstance\(\)\.application\(\n      app,\n      open: url,\n      sourceApplication: options\[UIApplication\.OpenURLOptionsKey\.sourceApplication\] as\? String,\n      annotation: options\[UIApplication\.OpenURLOptionsKey\.annotation\]\n    \) \{\n      return true\n    \}\n(?:#endif\n)?/g;
  source = source.replace(guardedImportPattern, '');
  if (unguardedImportPattern.test(source)) {
    source = source.replace(unguardedImportPattern, douyinImport);
  } else {
    source = source.replace('import React\n', `import React\n${douyinImport}`);
  }
  source = source.replace(
    `let douyinLaunched = DouyinOpenSDKApplicationDelegate.sharedInstance().application(application, didFinishLaunchingWithOptions: launchOptions)
    return super.application(application, didFinishLaunchingWithOptions: launchOptions) || douyinLaunched`,
    `${douyinLaunchBlock}
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`,
  );
  source = source.replace(
    /(?:#if !targetEnvironment\(simulator\)\n)?    DouyinOpenSDKApplicationDelegate\.sharedInstance\(\)\.application\(application, didFinishLaunchingWithOptions: launchOptions\)\n(?:#endif\n)?/g,
    '',
  );
  source = source.replace(
    /return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/,
    `${douyinLaunchBlock}
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)`,
  );
  let hasDouyinOpenURLBlock = false;
  source = source.replace(douyinOpenURLPattern, () => {
    if (hasDouyinOpenURLBlock) return '';
    hasDouyinOpenURLBlock = true;
    return douyinOpenURLBlock;
  });
  if (!hasDouyinOpenURLBlock) {
    source = source.replace(
      /return super\.application\(app, open: url, options: options\) \|\| RCTLinkingManager\.application\(app, open: url, options: options\)/,
      `${douyinOpenURLBlock}
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)`,
    );
  }
  fs.writeFileSync(file, source);
}

function androidModuleSource(packageName) {
  return `package ${packageName}

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.bytedance.sdk.open.aweme.authorize.model.Authorization
import com.bytedance.sdk.open.douyin.DouYinOpenApiFactory
import com.bytedance.sdk.open.douyin.DouYinOpenConfig
import java.util.UUID

class DouyinAuthModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "DouyinAuth"

  @ReactMethod
  fun authorize(clientKey: String, promise: Promise) {
    val cleanClientKey = clientKey.trim()
    if (cleanClientKey.isEmpty()) {
      promise.reject("E_DOUYIN_CLIENT_KEY", "缺少抖音 ClientKey")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "当前没有可用的 Activity")
      return
    }

    UiThreadUtil.runOnUiThread {
      try {
        synchronized(DouyinAuthModule::class.java) {
          if (initializedClientKey != cleanClientKey) {
            DouYinOpenApiFactory.init(DouYinOpenConfig(cleanClientKey))
            initializedClientKey = cleanClientKey
          }
          pendingPromise?.reject("E_DOUYIN_CANCELLED", "新的抖音授权已开始")
          pendingPromise = promise
        }
        val request = Authorization.Request()
        request.clientKey = cleanClientKey
        request.scope = "user_info"
        request.state = UUID.randomUUID().toString()
        val api = DouYinOpenApiFactory.create(activity)
        if (api == null) {
          clearPending()?.reject("E_DOUYIN_INIT", "抖音 SDK 初始化失败")
          return@runOnUiThread
        }
        val opened = api.authorize(request)
        if (!opened) {
          clearPending()?.reject("E_DOUYIN_OPEN_FAILED", "无法打开抖音授权页")
        }
      } catch (e: Exception) {
        clearPending()
        promise.reject("E_DOUYIN_AUTH", e.message ?: "抖音授权失败", e)
      }
    }
  }

  companion object {
    private var pendingPromise: Promise? = null
    private var initializedClientKey: String = ""

    fun resolveAuth(code: String, grantedPermissions: String?, state: String?) {
      val promise = clearPending() ?: return
      val result = com.facebook.react.bridge.Arguments.createMap()
      result.putString("code", code)
      result.putString("grantedPermissions", grantedPermissions ?: "")
      result.putString("state", state ?: "")
      promise.resolve(result)
    }

    fun rejectAuth(code: String, message: String) {
      clearPending()?.reject(code, message)
    }

    private fun clearPending(): Promise? {
      synchronized(DouyinAuthModule::class.java) {
        val promise = pendingPromise
        pendingPromise = null
        return promise
      }
    }
  }
}
`;
}

function androidPackageSource(packageName) {
  return `package ${packageName}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DouyinAuthPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(DouyinAuthModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;
}

function androidEntryActivitySource(packageName) {
  return `package ${packageName}.douyinapi

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import com.bytedance.sdk.open.aweme.CommonConstants
import com.bytedance.sdk.open.aweme.authorize.model.Authorization
import com.bytedance.sdk.open.aweme.common.handler.IApiEventHandler
import com.bytedance.sdk.open.aweme.common.model.BaseReq
import com.bytedance.sdk.open.aweme.common.model.BaseResp
import com.bytedance.sdk.open.douyin.DouYinOpenApiFactory
import com.bytedance.sdk.open.douyin.api.DouYinOpenApi
import ${packageName}.DouyinAuthModule

class DouYinEntryActivity : Activity(), IApiEventHandler {
  private var douYinOpenApi: DouYinOpenApi? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    douYinOpenApi = DouYinOpenApiFactory.create(this)
    if (douYinOpenApi?.handleIntent(intent, this) != true) {
      DouyinAuthModule.rejectAuth("E_DOUYIN_INTENT", "抖音授权回调异常")
      finish()
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (douYinOpenApi?.handleIntent(intent, this) != true) {
      DouyinAuthModule.rejectAuth("E_DOUYIN_INTENT", "抖音授权回调异常")
      finish()
    }
  }

  override fun onReq(req: BaseReq) = Unit

  override fun onResp(resp: BaseResp) {
    if (resp.type == CommonConstants.ModeType.SEND_AUTH_RESPONSE && resp is Authorization.Response) {
      if (resp.isSuccess && !resp.authCode.isNullOrBlank()) {
        DouyinAuthModule.resolveAuth(resp.authCode, resp.grantedPermissions, resp.state)
      } else {
        DouyinAuthModule.rejectAuth("E_DOUYIN_AUTH", resp.errorMsg ?: "抖音授权失败")
      }
    } else {
      DouyinAuthModule.rejectAuth("E_DOUYIN_RESPONSE", "抖音授权回调类型异常")
    }
    finish()
  }

  override fun onErrorIntent(intent: Intent?) {
    DouyinAuthModule.rejectAuth("E_DOUYIN_INTENT", "抖音授权回调异常")
    finish()
  }
}
`;
}

function writeAndroidNativeFiles(projectRoot, packageName) {
  const base = path.join(projectRoot, 'android', 'app', 'src', 'main', 'java', ...packageName.split('.'));
  writeFileIfChanged(path.join(base, 'DouyinAuthModule.kt'), androidModuleSource(packageName));
  writeFileIfChanged(path.join(base, 'DouyinAuthPackage.kt'), androidPackageSource(packageName));
  writeFileIfChanged(path.join(base, 'douyinapi', 'DouYinEntryActivity.kt'), androidEntryActivitySource(packageName));
}

function iosSwiftSource() {
  return `import Foundation
import UIKit
import React
#if !targetEnvironment(simulator)
import DouyinOpenSDK
#endif

@objc(DouyinAuth)
class DouyinAuth: NSObject {
  @objc(authorize:resolver:rejecter:)
  func authorize(clientKey: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    let cleanClientKey = clientKey.trimmingCharacters(in: .whitespacesAndNewlines)
    if cleanClientKey.isEmpty {
      reject("E_DOUYIN_CLIENT_KEY", "缺少抖音 ClientKey", nil)
      return
    }
#if targetEnvironment(simulator)
    reject("E_DOUYIN_UNAVAILABLE", "iOS 模拟器不支持抖音授权，请使用真机测试", nil)
    return
#else
    DispatchQueue.main.async {
      guard let root = UIApplication.shared.connectedScenes
        .compactMap({ $0 as? UIWindowScene })
        .flatMap({ $0.windows })
        .first(where: { $0.isKeyWindow })?.rootViewController else {
        reject("E_NO_VIEW_CONTROLLER", "当前没有可用的 ViewController", nil)
        return
      }

      DouyinOpenSDKApplicationDelegate.sharedInstance().registerAppId(cleanClientKey)

      let request = DouyinOpenSDKAuthRequest()
      request.permissions = NSOrderedSet(object: "user_info")
      let opened = request.send(root) { resp in
        guard let resp = resp else {
          reject("E_DOUYIN_AUTH", "抖音授权失败", nil)
          return
        }
        if (resp.errCode.rawValue == 0 || resp.errCode.rawValue == 20000), let code = resp.code, !code.isEmpty {
          resolve([
            "code": code,
            "grantedPermissions": resp.grantedPermissions.map { String(describing: $0) } ?? "",
          ])
        } else {
          reject("E_DOUYIN_AUTH", resp.errString ?? "抖音授权失败", nil)
        }
      }
      if !opened {
        reject("E_DOUYIN_OPEN_FAILED", "无法打开抖音授权页", nil)
      }
    }
#endif
  }

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
`;
}

function iosBridgeSource() {
  return `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(DouyinAuth, NSObject)
RCT_EXTERN_METHOD(authorize:(NSString *)clientKey resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
`;
}

function writeIOSNativeFiles(projectRoot) {
  const base = path.join(projectRoot, 'ios', 'MonkeyCode');
  writeFileIfChanged(path.join(base, 'DouyinAuth.swift'), iosSwiftSource());
  writeFileIfChanged(path.join(base, 'DouyinAuthBridge.m'), iosBridgeSource());
}

function addIOSNativeFilesToProject(projectRoot, project) {
  const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
  let targetUuid;
  try {
    targetUuid = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName })?.uuid;
  } catch {
    targetUuid = undefined;
  }
  for (const filename of ['DouyinAuth.swift', 'DouyinAuthBridge.m']) {
    const filepath = `${projectName}/${filename}`;
    const fileReferences = project.pbxFileReferenceSection();
    let existing = false;
    for (const uuid of Object.keys(fileReferences)) {
      if (uuid.endsWith('_comment')) continue;
      const file = fileReferences[uuid];
      if (file?.path === filename || file?.path === filepath || file?.name === filename) {
        file.name = filename;
        file.path = filepath;
        file.sourceTree = '"<group>"';
        existing = true;
      }
    }
    if (existing) continue;

    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath,
      groupName: projectName,
      project,
      targetUuid,
    });
  }
}

module.exports = function withDouyinLogin(config, props = {}) {
  const clientKey = resolveClientKey(config, props);
  const packageName = config.android?.package || 'com.chaitin.baizhi.monkeycode';

  config = withInfoPlist(config, (mod) => {
    const current = Array.isArray(mod.modResults.LSApplicationQueriesSchemes)
      ? mod.modResults.LSApplicationQueriesSchemes
      : [];
    mod.modResults.LSApplicationQueriesSchemes = Array.from(new Set([...current, ...DOUYIN_IOS_SCHEMES]));
    if (clientKey) {
      mod.modResults.DouyinAppID = clientKey;
      addIOSURLScheme(mod.modResults, clientKey);
    }
    return mod;
  });

  config = withAndroidManifest(config, (mod) => {
    for (const packageName of DOUYIN_PACKAGES) {
      addAndroidPackageQuery(mod.modResults, packageName);
    }
    addAndroidActivity(mod.modResults, packageName);
    return mod;
  });

  config = withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = addMavenRepo(mod.modResults.contents);
    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addAndroidDeps(mod.modResults.contents);
    return mod;
  });

  config = withPodfile(config, (mod) => {
    mod.modResults.contents = addPod(mod.modResults.contents);
    return mod;
  });

  config = withXcodeProject(config, (mod) => {
    addIOSNativeFilesToProject(mod.modRequest.projectRoot, mod.modResults);
    return mod;
  });

  config = withDangerousMod(config, ['android', (mod) => {
    writeAndroidNativeFiles(mod.modRequest.projectRoot, packageName);
    patchMainApplication(mod.modRequest.projectRoot, packageName);
    return mod;
  }]);

  return withDangerousMod(config, ['ios', (mod) => {
    writeIOSNativeFiles(mod.modRequest.projectRoot);
    patchAppDelegate(mod.modRequest.projectRoot);
    return mod;
  }]);
};
