/**
 * 兼容新版 Xcode / clang（如 Xcode 26+）。
 *
 * Expo SDK 52 / RN 0.76 内置的 fmt 11.0.2 在 base.h 里会“无条件”
 * `#define FMT_USE_CONSTEVAL 1`（只要编译器声明了 __cpp_consteval），
 * 因此用编译宏 -DFMT_USE_CONSTEVAL=0 是无效的（会被头文件覆盖）。
 * 新版 clang 下 fmt 内部对 FMT_STRING 的 consteval 调用会报
 *   "call to consteval function ... is not a constant expression"。
 *
 * 这里通过 Podfile 的 post_install（在 pod 下载完成之后执行）直接给
 * Pods/fmt/include/fmt/base.h 打补丁，强制 FMT_USE_CONSTEVAL 0，
 * 让 fmt 回退到 constexpr 的格式串校验路径（功能不变，仅关闭 consteval）。
 *
 * 在 EAS 云构建里同样生效（EAS 也会跑 pod install -> post_install）；
 * 在匹配 SDK 的旧版 Xcode 上是无害的（本来就能编译，关掉 consteval 只是回退）。
 */
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '__monkeycode_fmt_consteval_off__';

// 注入到 Podfile `post_install do |installer|` 之后的 Ruby 代码
const POST_INSTALL_SNIPPET = `
    # --- ${MARKER}: 修复 fmt 在新版 Xcode/clang 下的 consteval 编译错误 ---
    __fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
    if File.exist?(__fmt_base)
      __src = File.read(__fmt_base)
      unless __src.include?('${MARKER}')
        __anchor = "#if FMT_USE_CONSTEVAL\\n#  define FMT_CONSTEVAL consteval"
        __patch  = "// ${MARKER}\\n#undef FMT_USE_CONSTEVAL\\n#define FMT_USE_CONSTEVAL 0\\n" + __anchor
        if __src.include?(__anchor)
          File.write(__fmt_base, __src.sub(__anchor, __patch))
        end
      end
    end
    # --- end ${MARKER} ---`;

module.exports = function withFmtFix(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (!contents.includes(MARKER)) {
        contents = contents.replace(
          /post_install do \|installer\|/,
          (m) => m + POST_INSTALL_SNIPPET
        );
        fs.writeFileSync(podfile, contents);
      }
      return cfg;
    },
  ]);
};
