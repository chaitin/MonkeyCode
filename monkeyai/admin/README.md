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

## 成员与分组虚拟滚动

左侧分组树只展开顶层分组，将可见层级整理成扁平行并虚拟渲染；成员索引、排序及跨组去重人数只在数据或语言变化时重新计算。展开状态和批量选择独立于行组件保存，滚动卸载不会丢失；同一成员在不同分组中使用独立的来源键。

右侧成员卡片使用 TanStack Virtual 和 ResizeObserver 测量实际高度，保留多分组徽章换行。两侧移动端都有固定高度的滚动区域；焦点、菜单和拖拽涉及的行会临时保留，避免操作过程中失去节点。现有成员与分组接口仍返回完整数据，虚拟滚动限制的是挂载数量。

独立浏览器回归使用一万名模拟成员，覆盖首尾滚动、卡片高度、展开和勾选状态、菜单与拖拽节点、批量状态操作、移动来源、搜索重置及移动布局：

```sh
CHROME_BIN=/path/to/chrome86 pnpm test:browser:members
CHROME_BIN=/path/to/current-chrome pnpm test:browser:members
```

费用设置的成员额度卡片复用相同的虚拟滚动，按实际行高测量；过滤、姓名/积分排序和重置选择器的成员选项按数据变化缓存。搜索或切换排序回到顶部，账户详情打开时保留来源行，关闭刷新后继续使用当前搜索和排序。

```sh
CHROME_BIN=/path/to/chrome86 pnpm test:browser:quotas
CHROME_BIN=/path/to/current-chrome pnpm test:browser:quotas
```

## 扣费记录用户筛选

用户输入框按需查询候选，选中后使用 `user_id` 精确筛选，并保留分页、刷新和账户详情链接中的选择。重名用户通过邮箱区分，停用或已删除用户仍可查询历史流水。直接输入后搜索则沿用流水历史姓名／邮箱的子串匹配；修改已选姓名会退出精确筛选。

```sh
CHROME_BIN=/path/to/chrome86 pnpm test:browser:billing-users
CHROME_BIN=/path/to/current-chrome pnpm test:browser:billing-users
```

此回归使用真实构建产物与模拟 API，覆盖键盘／鼠标选择、重名、刷新、分页、清空、旧文字查询、过期请求、失败重试和已删除用户。

## 客户端接入清单

客户端页面使用管理员接口 `/api/admin/v1/endpoints` 和 `/api/admin/v1/endpoints/overview`，以 `endpoints` 关联 `users` 展示当前登记信息；每行对应 `(user_id, machine_id)`，不依赖会话、对话上报。默认显示全部登记记录，包含已撤销登记及已删除用户；同一设备在不同用户下分别计为登记记录。设备升级后更新原记录，不累积版本历史。

默认仅展示用户、设备名称、操作系统、最近活动时间四列。系统版本、客户端类型／名称／版本、CPU 架构、语言、runtime／引擎版本、首次登记等可通过“选择列”开启，操作系统与系统版本保持独立。Electron 版本和发布渠道不在此清单中展示。首次登记为记录创建时间，最近活动为设备记录中最近可见与信息上报的较新时间，不将登记状态解读为在线状态。最新登记字段不足以追溯首次实际连接，多个客户端共用同一用户和设备 ID 时仍只保留一条登记。

搜索支持用户姓名／邮箱、设备名称／别名、客户端名称及设备 ID；操作系统、客户端类型、CPU、版本、登记状态和最近活动日期可独立筛选。最近活动默认不限制，支持单边日期；列表与三个分布使用同一筛选口径，页面不另显示标题、说明或登记数／用户数摘要。列表为 `page_size+1/has_next` 分页，默认 50，切换筛选或页容量回到第一页。图表分页独立，失败时分别重试。

```sh
CHROME_BIN=/path/to/chrome86 pnpm test:browser:client-devices
CHROME_BIN=/path/to/current-chrome pnpm test:browser:client-devices
```

回归使用真实构建产物和模拟 API，覆盖桌面／手机、中文／阿拉伯语、系统分列、旧设备显示、默认无时间限制、筛选、分页、单边日期、加载、独立失败重试及空页恢复。后端实际 PostgreSQL 测试验证没有任何会话的登记、跨用户设备 ID、当前字段更新、时间边界、空活动时间、已撤销／已删除记录、权限及返回字段白名单。

## 客户端登录授权

`/client-login` 登录后必须明确确认当前账号、实际返回地址和附加权限，空权限列表也不会自动完成。确认提交始终携带 `X-CSRF-Token` 和 `approved_scopes` 数组。后台仅允许登记的应用回调，或桌面端固定路径的本机回环动态端口（`localhost`、`127.0.0.1`、`[::1]`）；前端还会核对最终返回地址与确认页展示的地址一致，拒绝外部网站、脚本 URL 和其他未登记目标。

```sh
CHROME_BIN=/path/to/chrome86 pnpm test:browser:auth
CHROME_BIN=/path/to/current-chrome pnpm test:browser:auth
```

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
