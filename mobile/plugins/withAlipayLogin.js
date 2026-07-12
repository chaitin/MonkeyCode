const fs = require('fs');
const path = require('path');
const {
  IOSConfig,
  withAppBuildGradle,
  withDangerousMod,
  withInfoPlist,
  withPodfile,
  withXcodeProject,
} = require('@expo/config-plugins');

const DEFAULT_SCHEME = 'com.chaitin.baizhi.monkeycode.alipay';
const DEFAULT_ANDROID_SDK_VERSION = '15.8.42';
const DEFAULT_IOS_SDK_VERSION = '15.8.30';

function resolveScheme(config, props = {}) {
  return (
    props.scheme ||
    process.env.EXPO_PUBLIC_ALIPAY_SCHEME ||
    config.extra?.alipayScheme ||
    DEFAULT_SCHEME
  ).trim();
}

function addAndroidDependency(source, version) {
  if (source.includes('com.alipay.sdk:alipaysdk-android')) return source;
  const dependency = `\n    implementation "com.alipay.sdk:alipaysdk-android:${version}"\n`;
  return source.replace(/dependencies\s*\{/, (match) => `${match}${dependency}`);
}

function addIOSPod(source, version) {
  if (source.includes("pod 'AlipaySDK-iOS'")) return source;
  return source.replace(/use_expo_modules!\n/, `use_expo_modules!\n  pod 'AlipaySDK-iOS', '${version}'\n`);
}

function addIOSURLScheme(infoPlist, scheme) {
  const types = Array.isArray(infoPlist.CFBundleURLTypes) ? infoPlist.CFBundleURLTypes : [];
  const exists = types.some((item) => (
    Array.isArray(item.CFBundleURLSchemes) && item.CFBundleURLSchemes.includes(scheme)
  ));
  if (!exists) {
    types.push({
      CFBundleURLName: 'com.monkeycode.alipay-auth',
      CFBundleURLSchemes: [scheme],
    });
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
  const file = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packageName.split('.'),
    'MainApplication.kt',
  );
  if (!fs.existsSync(file)) return;
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes('add(AlipayAuthPackage())')) return;
  source = source.replace(
    /PackageList\(this\)\.packages\.apply\s*\{/,
    (match) => `${match}\n          add(AlipayAuthPackage())`,
  );
  fs.writeFileSync(file, source);
}

function androidModuleSource(packageName) {
  return `package ${packageName}

import android.net.Uri
import com.alipay.sdk.app.AuthTask
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

class AlipayAuthModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()

  override fun getName(): String = "AlipayAuth"

  @ReactMethod
  fun authorize(authInfo: String, promise: Promise) {
    val cleanAuthInfo = authInfo.trim()
    if (cleanAuthInfo.isEmpty()) {
      promise.reject("E_ALIPAY_AUTH_INFO", "缺少支付宝授权参数")
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "当前没有可用的 Activity")
      return
    }

    executor.execute {
      try {
        val result = AuthTask(activity).authV2(cleanAuthInfo, true)
        resolveResult(result, promise)
      } catch (e: Exception) {
        promise.reject("E_ALIPAY_AUTH", e.message ?: "支付宝授权失败", e)
      }
    }
  }

  private fun resolveResult(result: Map<String, String>?, promise: Promise) {
    val status = result?.get("resultStatus").orEmpty()
    val memo = result?.get("memo").orEmpty()
    val payload = result?.get("result").orEmpty().trim().trim('"')
    val code = queryValue(payload, "auth_code")
    val resultCode = queryValue(payload, "result_code")

    if (status == "6001") {
      promise.reject("E_ALIPAY_CANCELLED", memo.ifBlank { "已取消支付宝授权" })
      return
    }
    if (status != "9000" || code.isBlank() || (resultCode.isNotBlank() && resultCode != "200")) {
      promise.reject("E_ALIPAY_AUTH", memo.ifBlank { "支付宝授权失败（${'$'}status）" })
      return
    }

    val response = Arguments.createMap()
    response.putString("code", code)
    response.putString("resultStatus", status)
    response.putString("resultCode", resultCode)
    response.putString("userId", queryValue(payload, "user_id"))
    promise.resolve(response)
  }

  private fun queryValue(payload: String, key: String): String {
    if (payload.isBlank()) return ""
    return Uri.parse("https://localhost/?${'$'}payload").getQueryParameter(key).orEmpty()
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

@Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
class AlipayAuthPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(AlipayAuthModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;
}

function writeAndroidNativeFiles(projectRoot, packageName) {
  const base = path.join(
    projectRoot,
    'android',
    'app',
    'src',
    'main',
    'java',
    ...packageName.split('.'),
  );
  writeFileIfChanged(path.join(base, 'AlipayAuthModule.kt'), androidModuleSource(packageName));
  writeFileIfChanged(path.join(base, 'AlipayAuthPackage.kt'), androidPackageSource(packageName));
}

function iosSwiftSource() {
  return `import Foundation
import React
import AlipaySDK

@objc(AlipayAuth)
class AlipayAuth: NSObject {
  private static var pendingResolve: RCTPromiseResolveBlock?
  private static var pendingReject: RCTPromiseRejectBlock?
  private static var pendingResult: [AnyHashable: Any]?

  @objc(authorize:scheme:resolver:rejecter:)
  func authorize(
    authInfo: String,
    scheme: String,
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let cleanAuthInfo = authInfo.trimmingCharacters(in: .whitespacesAndNewlines)
    let cleanScheme = scheme.trimmingCharacters(in: .whitespacesAndNewlines)
    if cleanAuthInfo.isEmpty {
      reject("E_ALIPAY_AUTH_INFO", "缺少支付宝授权参数", nil)
      return
    }
    if cleanScheme.isEmpty {
      reject("E_ALIPAY_SCHEME", "缺少支付宝回调 Scheme", nil)
      return
    }

    DispatchQueue.main.async {
      Self.pendingReject?("E_ALIPAY_CANCELLED", "新的支付宝授权已开始", nil)
      Self.pendingResolve = resolve
      Self.pendingReject = reject
      Self.pendingResult = nil
      AlipaySDK.defaultService().auth_V2(withInfo: cleanAuthInfo, fromScheme: cleanScheme) { result in
        Self.complete(result)
      }
    }
  }

  @objc(consumePendingResult:rejecter:)
  func consumePendingResult(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let result = Self.pendingResult else {
        resolve(nil)
        return
      }
      Self.pendingResult = nil
      Self.resolve(result, resolve: resolve, reject: reject)
    }
  }

  @objc
  static func handleOpenURL(_ url: URL) -> Bool {
    AlipaySDK.defaultService().processAuth_V2Result(url) { result in
      Self.complete(result)
    }
    return true
  }

  private static func complete(_ result: [AnyHashable: Any]?) {
    let value = result ?? [:]
    guard let resolve = pendingResolve, let reject = pendingReject else {
      pendingResult = value
      return
    }
    pendingResolve = nil
    pendingReject = nil
    Self.resolve(value, resolve: resolve, reject: reject)
  }

  private static func resolve(
    _ result: [AnyHashable: Any],
    resolve: RCTPromiseResolveBlock,
    reject: RCTPromiseRejectBlock
  ) {
    let status = String(describing: result["resultStatus"] ?? "")
    let memo = String(describing: result["memo"] ?? "")
    let payload = String(describing: result["result"] ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "\\\""))
    let items = URLComponents(string: "https://localhost/?\\(payload)")?.queryItems ?? []
    let code = items.first(where: { $0.name == "auth_code" })?.value ?? ""
    let resultCode = items.first(where: { $0.name == "result_code" })?.value ?? ""
    let userId = items.first(where: { $0.name == "user_id" })?.value ?? ""

    if status == "6001" {
      reject("E_ALIPAY_CANCELLED", memo.isEmpty ? "已取消支付宝授权" : memo, nil)
      return
    }
    if status != "9000" || code.isEmpty || (!resultCode.isEmpty && resultCode != "200") {
      reject("E_ALIPAY_AUTH", memo.isEmpty ? "支付宝授权失败（\\(status)）" : memo, nil)
      return
    }
    resolve([
      "code": code,
      "resultStatus": status,
      "resultCode": resultCode,
      "userId": userId,
    ])
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

@interface RCT_EXTERN_MODULE(AlipayAuth, NSObject)
RCT_EXTERN_METHOD(authorize:(NSString *)authInfo scheme:(NSString *)scheme resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(consumePendingResult:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
`;
}

function writeIOSNativeFiles(projectRoot) {
  const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
  const base = path.join(projectRoot, 'ios', projectName);
  writeFileIfChanged(path.join(base, 'AlipayAuth.swift'), iosSwiftSource());
  writeFileIfChanged(path.join(base, 'AlipayAuthBridge.m'), iosBridgeSource());
}

function addIOSNativeFilesToProject(projectRoot, project) {
  const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
  let targetUuid;
  try {
    targetUuid = IOSConfig.XcodeUtils.getApplicationNativeTarget({ project, projectName })?.uuid;
  } catch {
    targetUuid = undefined;
  }
  for (const filename of ['AlipayAuth.swift', 'AlipayAuthBridge.m']) {
    const filepath = `${projectName}/${filename}`;
    const refs = project.pbxFileReferenceSection();
    const exists = Object.keys(refs).some((uuid) => {
      if (uuid.endsWith('_comment')) return false;
      const file = refs[uuid];
      return file?.path === filename || file?.path === filepath || file?.name === filename;
    });
    if (exists) continue;
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath,
      groupName: projectName,
      project,
      targetUuid,
    });
  }
}

function patchAppDelegate(projectRoot, scheme) {
  const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
  const file = path.join(projectRoot, 'ios', projectName, 'AppDelegate.swift');
  if (!fs.existsSync(file)) return;
  let source = fs.readFileSync(file, 'utf8');
  if (!source.includes('import AlipaySDK')) {
    source = source.replace('import React\n', 'import React\nimport AlipaySDK\n');
  }

  const start = '    // @generated by withAlipayLogin';
  const end = '    // @end withAlipayLogin';
  const block = `${start}\n    if url.scheme == "${scheme}", AlipayAuth.handleOpenURL(url) {\n      return true\n    }\n${end}\n`;
  const pattern = /    \/\/ @generated by withAlipayLogin[\s\S]*?    \/\/ @end withAlipayLogin\n/g;
  source = source.replace(pattern, '');
  source = source.replace(
    /(  public override func application\(\n    _ app: UIApplication,\n    open url: URL,\n    options: \[UIApplication\.OpenURLOptionsKey: Any\] = \[:\]\n  \) -> Bool \{\n)/,
    (match) => `${match}${block}`,
  );
  fs.writeFileSync(file, source);
}

module.exports = function withAlipayLogin(config, props = {}) {
  const scheme = resolveScheme(config, props);
  const packageName = config.android?.package || 'com.chaitin.baizhi.monkeycode';
  const androidSdkVersion = props.androidSdkVersion || DEFAULT_ANDROID_SDK_VERSION;
  const iosSdkVersion = props.iosSdkVersion || DEFAULT_IOS_SDK_VERSION;

  config = withInfoPlist(config, (mod) => {
    const current = Array.isArray(mod.modResults.LSApplicationQueriesSchemes)
      ? mod.modResults.LSApplicationQueriesSchemes
      : [];
    mod.modResults.LSApplicationQueriesSchemes = Array.from(new Set([...current, 'alipays', 'alipay']));
    addIOSURLScheme(mod.modResults, scheme);
    return mod;
  });

  config = withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = addAndroidDependency(mod.modResults.contents, androidSdkVersion);
    return mod;
  });

  config = withPodfile(config, (mod) => {
    mod.modResults.contents = addIOSPod(mod.modResults.contents, iosSdkVersion);
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
    patchAppDelegate(mod.modRequest.projectRoot, scheme);
    return mod;
  }]);
};
