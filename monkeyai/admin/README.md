# React + TypeScript + Vite + shadcn/ui

MonkeyAI 管理端使用 React、TypeScript、Vite 和 Tailwind CSS 3.4。降级前的完整回退基线为提交 `5789bb73`。

## Chrome 86 兼容

- `tailwind.config.cjs` 维护主题、状态变体及工具类，`postcss.config.cjs` 将 CSS 生成到 Chrome 86 可识别的选择器与逻辑属性。生产 JS/CSS 构建目标均为 Chrome 86。
- 主题使用 RGB 通道，支持透明度修饰和深浅色切换；不再依赖原生 CSS 级联层、OKLCH、颜色混合或 CSS 属性注册。旧版视口高度使用 `vh`。
- `src/lib/browser-compat.ts` 在应用启动前安装数组 `.at()`、`Object.hasOwn()` 和 `:has()` 兼容支持，`platform-compat.ts` 补齐 AbortSignal 超时/取消原因以及安全随机 UUID。已有原生实现保持不变。
- 图表与表单仅有的容器宽度断点使用 `ResizeObserver`，按内容宽度判断，表单通过上下文跟随最近分组；不改写样式表。图表和示意图保留传统比例占位回退，避免不支持 `aspect-ratio` 时区域高度塌陷；日期按钮显式设置单元格高度。滚动条同时提供物理定位，兼容旧版不支持的行内逻辑定位。
- Base UI 1.7.0 的构造点击事件带有版本限定的 pnpm 补丁：Chrome 86 虽有 PointerEvent 构造器，但构造的 click 不会激活复选框。补丁按窗口检测实际行为，必要时使用 MouseEvent，现代浏览器保留 PointerEvent，同时保留修饰键和原组件的确认、校验及禁用逻辑。该共享路径也用于 Checkbox；更新 Base UI 时需复核补丁与浏览器测试。
- 不支持磁盘暂存的浏览器，大目录导入仍应使用现成 ZIP；复制等安全上下文功能继续遵循浏览器的 HTTPS/权限限制。

安装后重启 Vite 开发服务器，使新的 PostCSS 配置生效：

```sh
pnpm install --frozen-lockfile
pnpm dev --force
```

验证命令：

```sh
pnpm test
pnpm lint
pnpm build
CHROME_BIN=/path/to/chrome86 pnpm test:browser
# 使用另一个已安装的 Chromium 验证现代浏览器
CHROME_BIN=/path/to/current-chrome pnpm test:browser
# 可选：验证正在运行的开发服务器，API 使用隔离测试数据
CHROME_BIN=/path/to/chrome86 ADMIN_DEV_URL=http://localhost:5173 pnpm test:browser
```

依赖补丁变更后需停止旧开发服务器，执行 `pnpm install --frozen-lockfile` 再运行 `pnpm dev --force`，避免 Vite 的旧预构建仍使用未修复代码。

浏览器检查使用真实可执行文件，不通过修改 User-Agent 模拟旧浏览器。覆盖首页、普通 HTTP 下 UUID、深浅主题、48px 表格行、下拉菜单、日期面板、动态 `:has()`、饼图有效高度、内容宽度断点、移动布局，以及 Switch 的鼠标、空格键、确认/取消和保存期间禁用。回归中使用 Chromium 86.0.4240.0 与 141.0.7390.37；不据此声明其他浏览器已完成全量验证。浏览器测试不会访问真实业务接口。

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `src/components` directory. 当前 shadcn 新模板可能包含 Tailwind 4 专用样式，生成后需检查并迁移到现有 Tailwind 3 配置，不能直接覆盖公共组件。新增状态、动态选择器或工具类后，应运行上面的 Chrome 86 浏览器检查。

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button"
```

## GroupSelect

`src/components/group-select.tsx` provides a controlled group/user tree selector.
It does not fetch data or apply membership permissions; callers supply options,
localized text, and disabled states. `MemberGroupSelect` wraps it for member creation.

```tsx
import { useState } from "react"
import { GroupSelect, type GroupSelectionValue } from "@/components/group-select"

function AssigneeSelect() {
  const [value, setValue] = useState<GroupSelectionValue>({
    groupIds: [],
    userIds: [],
  })

  return (
    <GroupSelect
      options={[
        { id: "team", name: "团队", disabled: true },
        { id: "engineering", parentId: "team", name: "研发" },
      ]}
      users={[
        { id: "alice", name: "Alice", groupIds: ["engineering"] },
      ]}
      value={value}
      onValueChange={setValue}
      label="负责人"
      placeholder="选择负责人"
      emptyText="暂无可选项"
      locale="zh-CN"
      defaultExpanded
      collapsible
      multiple={false}
      selectionMode="users"
      searchable
      searchPlaceholder="搜索名称、邮箱或拼音"
      noResultsText="没有匹配的分组或用户"
    />
  )
}
```

| Prop | Default | Behavior |
| --- | --- | --- |
| `defaultExpanded` | `true` | Initial expansion of all folders, including leaves; later prop changes do not reset expansion. |
| `collapsible` | `true` | Enables clicking folder icons to expand/collapse independently of selection. |
| `multiple` | `true` | Allows multiple selections. When false, selecting an item replaces both ID lists and closes the popover. |
| `searchable` | `false` | Shows a fixed search field above the scrollable tree. Searches names, user emails, and Chinese pinyin (full spelling or initials), retaining ancestor paths and matched groups' subtrees. |
| `searchPlaceholder` | `label` | Localized search placeholder and accessible label. |
| `noResultsText` | `emptyText` | Localized message for no search matches. |
| `selectionMode` | `"groups"` | `"groups"` shows/selects folders only; `"users"` shows users with folders as containers; `"both"` allows selecting both. |
| `options` | Required | Flat `{ id, parentId?, name, disabled? }` group data. Missing parents appear at the top level. |
| `users` | `[]` | `{ id, name, groupIds, disabled? }` records. Users with no matching group appear at the top level; users in multiple groups share one selection. |
| `value` / `onValueChange` | Required | Controlled `{ groupIds, userIds }` value. |
| `cascadeGroups` | `false` | Authorization inheritance for multi-selection: selecting a group covers descendants and their users, removes redundant explicit grants, and shows inherited/partial checkbox states. Without it, selections are independent. |

Use `defaultExpanded={true}` with `collapsible={false}` for an always expanded tree.
With both false, folders remain closed. Reset the controlled value when changing
selection modes; in single mode, supply at most one selected ID across both lists.
Pass `id` to associate an external `FieldLabel`; otherwise an ID is generated.
The trigger displays selected names without ancestor paths.
Searching temporarily expands matching paths without modifying selections or saved
folder expansion. Clearing the query restores folder expansion; closing the
popover clears the query. Authorization inheritance always uses the complete tree,
even when search hides some nodes. Supply `email` on user options to enable email
matching; email addresses are not displayed in the tree. Pinyin supports joined or
spaced spelling (`zhangsan` / `zhang san`) and initials (`zs`), using the library's
contextual pronunciation for Chinese names. Search indexes are memoized so typing
does not repeat transliteration.
