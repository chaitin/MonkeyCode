// 字体栈常量:等宽栈被工具卡/审批卡/diff/代码预览共用,单独收口避免各模块重复声明。

// 等宽栈:JetBrains Mono 经 webfont 随应用加载(latin 子集),中文回退 HarmonyOS Sans SC;
// 其后仍显式列出各平台字体,Windows 上不能只留 monospace 泛型——
// Win7 WebView2 对泛型的解析不可靠(显示乱码),中文回退也会掉进宋体位图
export const MONO = '"JetBrains Mono","HarmonyOS Sans SC",ui-monospace,Menlo,Consolas,"Courier New","Microsoft YaHei",monospace';
