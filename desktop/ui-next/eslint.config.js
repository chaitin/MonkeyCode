// 本工程此前没有任何 linter,却散落着十几处
// `// eslint-disable-next-line react-hooks/exhaustive-deps` —— 那条规则从来
// 没跑过,注释是"作者以为它在跑"的化石。而 hooks 依赖/清理正是这份代码
// 最集中的缺陷来源(陈旧闭包、守卫与依赖不匹配、effect 漏清理),它是这里
// 最该开的一条规则。
//
// 口径:typecheck 已经把类型面守住了(strict + noUncheckedIndexedAccess +
// verbatimModuleSyntax),lint 只补 tsc 照不到的两类——
//   ① React hooks 规则(rules-of-hooks 硬错、exhaustive-deps 告警);
//   ② 会静默吃掉失败的写法(floating promise 由 no-floating-promises 覆盖需
//      类型信息,成本高,暂以 hooks + 明显错误为主)。
// 不引入格式化类规则:本仓库没有 prettier,风格靠 review 与既有惯例。
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "public", "../uidist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 依赖数组不全在这份代码里有大量**刻意**的例外(见各处 disable 注释里
      // 写明的理由:纪元 ref、稳定 setState 包装、只按 html 变化重跑等),
      // 一次性改成 error 会逼出一批"为过 lint 而加依赖"的假修复——那比现状
      // 更危险。先按 warn 跑,新增的一律要求写明理由再 disable。
      "react-hooks/exhaustive-deps": "warn",

      // 以下三条是 plugin v7 面向 **React Compiler** 的新规则,不是缺陷检测:
      // - refs:禁止渲染期读写 ref。本工程大量使用"镜像 ref"(渲染期
      //   `ref.current = 最新值`,供只挂一次的事件回调读最新快照,见
      //   App.tsx 的 sessionsRef/currentIdRef 注释)。这是当前代码的既定
      //   架构,27 处;
      // - set-state-in-effect:禁止 effect 内 setState。异步 IPC 落地后
      //   setState 是本工程数据面的基本形态,30 处;
      // - immutability:禁止就地改可变值。
      // 三条都指向"为 React Compiler 做准备"这件独立的事,不该混在这次
      // 修 bug 的批次里——一次性硬改会把 60 处稳定代码全部翻一遍,风险
      // 远大于收益。留在 warn 档保持可见,升 error 是另一次有计划的迁移。
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",

      // tsc 的 noUnusedLocals 已覆盖,交给它报(带类型的信息更准)
      "@typescript-eslint/no-unused-vars": "off",
      // 本仓库非测试源码里 any 为 0,规则留着挡新增
      "@typescript-eslint/no-explicit-any": "error",
    },
    // 写了 disable 却没有对应报错 = 规则改过/代码改过之后忘了撤,
    // 留着会让下一个人以为"这里有个已知例外"
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    // 测试里允许非空断言与更松的写法(构造边界数据本就要绕过类型)
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
);
