/** 工具展示语言。当前产品默认中文;后续设置页可直接传入 "en"。 */
export type ToolLocale = "zh-CN" | "en";

export const DEFAULT_TOOL_LOCALE: ToolLocale = "zh-CN";

const ZH_TOOL_LABELS: Record<string, string> = {
  Agent: "子代理",
  Task: "子代理",
  AskUserQuestion: "向你提问",
  Bash: "执行命令",
  Cmd: "执行命令",
  PowerShell: "执行 PowerShell",
  SendUserMessage: "发送消息",
  Brief: "发送消息",
  Config: "修改配置",
  CronCreate: "创建定时任务",
  CronDelete: "删除定时任务",
  CronList: "查看定时任务",
  EnterPlanMode: "进入计划模式",
  ExitPlanMode: "退出计划模式",
  EnterWorktree: "进入独立工作区",
  ExitWorktree: "退出独立工作区",
  Edit: "编辑文件",
  Read: "读取文件",
  Write: "写入文件",
  Glob: "查找文件",
  Grep: "搜索内容",
  ListMcpResourcesTool: "查看 MCP 资源",
  ReadMcpResourceTool: "读取 MCP 资源",
  LSP: "代码分析",
  NotebookEdit: "编辑笔记本",
  RemoteTrigger: "管理远程触发器",
  ReportFindings: "汇报审查发现",
  SendMessage: "发送协作消息",
  Skill: "调用技能",
  StructuredOutput: "输出结构化结果",
  TaskCreate: "创建任务",
  TaskGet: "查看任务详情",
  TaskList: "查看任务列表",
  TaskOutput: "查看任务输出",
  AgentOutputTool: "查看代理输出",
  BashOutputTool: "查看命令输出",
  TaskStop: "停止后台任务",
  KillShell: "停止后台命令",
  TaskUpdate: "更新任务",
  TeamCreate: "创建代理团队",
  TeamDelete: "解散代理团队",
  TodoWrite: "更新任务计划",
  ToolSearch: "查找工具",
  WebFetch: "读取网页",
  WebSearch: "搜索网页",
  TestingPermission: "测试权限",
  mcp: "调用 MCP 工具",
};

const COMMON_WORDS: Record<string, string> = {
  create: "创建",
  add: "添加",
  get: "获取",
  read: "读取",
  fetch: "获取",
  list: "列出",
  search: "搜索",
  find: "查找",
  update: "更新",
  edit: "编辑",
  write: "写入",
  delete: "删除",
  remove: "移除",
  send: "发送",
  open: "打开",
  close: "关闭",
  run: "运行",
  issue: "事项",
  issues: "事项",
  pull: "拉取请求",
  request: "请求",
  requests: "请求",
  comment: "评论",
  comments: "评论",
  repository: "仓库",
  repositories: "仓库",
  branch: "分支",
  branches: "分支",
  file: "文件",
  files: "文件",
  user: "用户",
  users: "用户",
  message: "消息",
  messages: "消息",
};

const SERVICE_LABELS: Record<string, string> = {
  "mc-browser": "浏览器",
  github: "GitHub",
  gitlab: "GitLab",
  slack: "Slack",
  notion: "Notion",
  postgres: "PostgreSQL",
  filesystem: "文件系统",
  browser: "浏览器",
  playwright: "浏览器",
};

/** 首方浏览器工具直接表达用户动作，不暴露 MCP 服务内部名。 */
const BROWSER_ACTIONS: Record<string, string> = {
  browser_navigate: "打开网页",
  browser_snapshot: "查看页面",
  browser_take_screenshot: "截取页面",
  browser_click: "点击页面元素",
  browser_type: "输入内容",
  browser_select_option: "选择页面选项",
  browser_press_key: "按下按键",
  browser_scroll: "滚动页面",
  browser_tabs: "管理标签页",
};

function identifierWords(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_./:-]+/)
    .filter(Boolean);
}

function readableIdentifier(value: string): string {
  return identifierWords(value)
    .map((word) => COMMON_WORDS[word.toLowerCase()] ?? word)
    .join(" ");
}

function mcpParts(tool: string): { service: string; operation: string } | null {
  const parts = tool.split("__");
  if (parts.length < 3 || parts[0].toLowerCase() !== "mcp") return null;
  return { service: parts[1], operation: parts.slice(2).join("_") };
}

export interface ToolTitleParts {
  /** 中文动作(或英文模式下的原始工具名) */
  action: string;
  /** 路径/命令/搜索词等原参数;未知工具会在这里保留可读名称 */
  target: string;
  /** 审计与 tooltip 使用的原始工具名 */
  rawTool: string;
}

export type ToolTargetKind = "path" | "code" | "text";

export interface ToolPresentation extends ToolTitleParts {
  /** 视图用它选择路径中间省略、等宽命令或普通文本 */
  targetKind: ToolTargetKind;
}

function inputRecord(input: unknown): Record<string, unknown> | null {
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : null;
}

function nestedInput(input: unknown, keys: string[]): unknown {
  let value = input;
  for (const key of keys) {
    const source = inputRecord(value);
    if (!source) return undefined;
    value = source[key];
  }
  return value;
}

function inputValue(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.filter((v) => typeof v === "string" || typeof v === "number").join(", ");
  return "";
}

function joinedInput(input: Record<string, unknown>, keys: string[]): string {
  return keys.map((key) => inputValue(input, key)).filter(Boolean).join(" · ");
}

function commandInput(input: Record<string, unknown>): string {
  if (typeof input.command === "string") return input.command;
  if (Array.isArray(input.command)) {
    for (let i = input.command.length - 1; i >= 0; i--) {
      const value = input.command[i];
      if (typeof value === "string" && value.trim()) return value;
    }
  }
  if (Array.isArray(input.parsed_cmd)) {
    for (const value of input.parsed_cmd) {
      const parsed = inputRecord(value);
      if (parsed) {
        const command = inputValue(parsed, "cmd");
        if (command) return command;
      }
    }
  }
  return "";
}

/** 完整 rawInput → 卡片的主目标；不展示 Write.content/Edit.new_string 等大段正文。 */
function structuredTarget(rawTool: string, rawInput: unknown, toolKind?: string, meta?: unknown): { target: string; kind: ToolTargetKind } | null {
  const input = inputRecord(rawInput) ?? {};
  const toolResponse = nestedInput(meta, ["claudeCode", "toolResponse"]);
  const metaPath = inputValue(inputRecord(toolResponse) ?? {}, "filePath")
    || inputValue(inputRecord(nestedInput(toolResponse, ["file"])) ?? {}, "filePath");

  const mcp = mcpParts(rawTool);
  if (mcp && ["mc-browser", "browser", "playwright"].includes(mcp.service.toLowerCase())) {
    switch (mcp.operation) {
      case "browser_navigate":
        return { target: inputValue(input, "url"), kind: "text" };
      case "browser_snapshot":
        return { target: "", kind: "text" };
      case "browser_take_screenshot":
        return { target: inputValue(input, "full_page") === "true" ? "整页" : "", kind: "text" };
      case "browser_click":
        return { target: inputValue(input, "ref"), kind: "code" };
      case "browser_type":
        return { target: joinedInput(input, ["ref", "text"]), kind: "code" };
      case "browser_select_option":
        return { target: joinedInput(input, ["ref", "values"]), kind: "code" };
      case "browser_press_key":
        return { target: inputValue(input, "key"), kind: "code" };
      case "browser_scroll":
        return { target: joinedInput(input, ["direction", "ref"]), kind: "code" };
      case "browser_tabs":
        return { target: joinedInput(input, ["action", "tab_id", "url"]), kind: "code" };
    }
  }

  switch (rawTool) {
    case "Read":
    case "Write":
    case "Edit":
      return { target: joinedInput(input, ["file_path", "filePath", "path"]) || metaPath, kind: "path" };
    case "NotebookEdit":
      return { target: joinedInput(input, ["notebook_path", "file_path"]), kind: "path" };
    case "LSP":
      return { target: joinedInput(input, ["file_path", "operation"]), kind: "path" };
    case "Bash":
    case "Cmd":
    case "PowerShell":
      return { target: commandInput(input), kind: "code" };
    case "Grep":
    case "Glob":
      return { target: joinedInput(input, ["pattern", "path"]), kind: "code" };
    case "WebFetch":
      return { target: inputValue(input, "url"), kind: "text" };
    case "WebSearch":
      return { target: joinedInput(input, ["query", "search_query"]), kind: "text" };
    case "Agent":
    case "Task":
      return { target: inputValue(input, "description"), kind: "text" };
    case "TaskCreate":
      return { target: inputValue(input, "subject"), kind: "text" };
    case "TaskGet":
    case "TaskOutput":
    case "TaskStop":
      return { target: joinedInput(input, ["task_id", "id"]), kind: "code" };
    case "TaskUpdate":
      return { target: joinedInput(input, ["task_id", "id", "status"]), kind: "code" };
    case "EnterWorktree":
      return { target: inputValue(input, "name"), kind: "text" };
    case "ExitWorktree":
      return { target: inputValue(input, "worktree_path"), kind: "path" };
    case "Skill":
      return { target: joinedInput(input, ["skill", "name"]), kind: "text" };
    case "SendMessage":
      return { target: joinedInput(input, ["to", "target"]), kind: "text" };
    case "ReportFindings": {
      // 流式期间 rawInput 可能还没到,不能把"没数据"渲染成"没问题"
      if (!Array.isArray(input.findings)) return { target: "", kind: "text" };
      return { target: input.findings.length ? `${input.findings.length} 项发现` : "未发现问题", kind: "text" };
    }
  }

  switch (toolKind) {
    case "read":
    case "edit":
    case "create":
    case "delete":
    case "move": {
      const path = joinedInput(input, ["file_path", "filePath", "path"]) || metaPath;
      if (path) return { target: path, kind: "path" };
      if (Array.isArray(input.parsed_cmd)) {
        for (const value of input.parsed_cmd) {
          const parsed = inputRecord(value);
          const parsedPath = parsed ? inputValue(parsed, "path") : "";
          if (parsedPath) return { target: parsedPath, kind: "path" };
        }
      }
      break;
    }
    case "execute": {
      const command = commandInput(input);
      if (command) return { target: command, kind: "code" };
      break;
    }
    case "search": {
      const target = joinedInput(input, ["pattern", "path"]) || commandInput(input);
      if (target) return { target, kind: "code" };
      break;
    }
    case "fetch": {
      const url = inputValue(input, "url");
      if (url) return { target: url, kind: "text" };
      break;
    }
  }

  for (const key of ["file_path", "filePath", "path", "command", "pattern", "query", "url", "description", "name", "id"]) {
    const target = key === "command" ? commandInput(input) : inputValue(input, key);
    if (target) return { target, kind: key === "file_path" || key === "filePath" || key === "path" ? "path" : key === "command" ? "code" : "text" };
  }
  return null;
}

export function localizeToolTitle(title: string, locale: ToolLocale = DEFAULT_TOOL_LOCALE): ToolTitleParts {
  const trimmed = title.trim();
  if (!trimmed) return { action: locale === "zh-CN" ? "调用工具" : "Tool", target: "", rawTool: "" };
  const split = trimmed.search(/\s/);
  const rawToken = split < 0 ? trimmed : trimmed.slice(0, split);
  const rawTool = rawToken.replace(/:+$/, "");
  const argument = split < 0 ? "" : trimmed.slice(split).trim();

  if (locale === "en") return { action: rawTool, target: argument, rawTool };

  const known = ZH_TOOL_LABELS[rawTool];
  if (known) return { action: known, target: argument, rawTool };

  // 已由上游产出中文标题时不再套“调用工具”前缀。
  if (/[\u3400-\u9fff]/.test(rawTool)) return { action: rawTool, target: argument, rawTool };

  const mcp = mcpParts(rawTool);
  if (mcp) {
    const browserAction = ["mc-browser", "browser", "playwright"].includes(mcp.service.toLowerCase())
      ? BROWSER_ACTIONS[mcp.operation]
      : undefined;
    if (browserAction) return { action: browserAction, target: argument, rawTool };
    const service = SERVICE_LABELS[mcp.service.toLowerCase()] ?? readableIdentifier(mcp.service);
    const operation = readableIdentifier(mcp.operation);
    return {
      action: `调用 ${service}`,
      target: [operation, argument].filter(Boolean).join(" "),
      rawTool,
    };
  }

  return {
    action: "调用工具",
    target: [readableIdentifier(rawTool), argument].filter(Boolean).join(" "),
    rawTool,
  };
}

export interface ToolPresentationOptions {
  locale?: ToolLocale;
  /** 云端 ACP 的语义类型；标题不是标准本地工具名时用于统一动作名。 */
  toolKind?: string;
  /** Claude 等 CLI 把文件路径补充在 provider metadata 中。 */
  meta?: unknown;
}

function actionForKind(kind: string | undefined, locale: ToolLocale): string {
  const en: Record<string, string> = {
    read: "Read file", edit: "Edit file", create: "Write file", execute: "Run command",
    search: "Search content", fetch: "Fetch web page", delete: "Delete file", move: "Move file", think: "Think",
  };
  const zh: Record<string, string> = {
    read: "读取文件", edit: "编辑文件", create: "写入文件", execute: "执行命令",
    search: "搜索内容", fetch: "读取网页", delete: "删除文件", move: "移动文件", think: "思考",
  };
  return (locale === "en" ? en : zh)[kind ?? ""] ?? "";
}

/** 标题决定动作，结构化入参决定完整目标；云端 kind 补足非标准标题。 */
export function presentToolCall(
  title: string,
  rawInput?: unknown,
  options: ToolLocale | ToolPresentationOptions = DEFAULT_TOOL_LOCALE,
): ToolPresentation {
  const locale = typeof options === "string" ? options : options.locale ?? DEFAULT_TOOL_LOCALE;
  const toolKind = typeof options === "string" ? undefined : options.toolKind;
  const meta = typeof options === "string" ? undefined : options.meta;
  const base = localizeToolTitle(title, locale);
  const structured = structuredTarget(base.rawTool, rawInput, toolKind, meta);
  const kindAction = actionForKind(toolKind, locale);
  const titleHasSpecificAction = !!ZH_TOOL_LABELS[base.rawTool]
    || !!mcpParts(base.rawTool)
    || /[\u3400-\u9fff]/.test(base.rawTool);
  return {
    ...base,
    action: kindAction && !titleHasSpecificAction ? kindAction : base.action,
    target: structured?.target ?? base.target,
    targetKind: structured?.kind ?? (
      base.rawTool === "Read" || base.rawTool === "Write" || base.rawTool === "Edit"
      || ["read", "edit", "create", "delete", "move"].includes(toolKind ?? "")
        ? "path"
        : toolKind === "execute" ? "code" : "text"
    ),
  };
}

export function toolDisplayName(tool: string, locale: ToolLocale = DEFAULT_TOOL_LOCALE): string {
  return localizeToolTitle(tool, locale).action;
}

export function localizedToolTitleText(title: string, locale: ToolLocale = DEFAULT_TOOL_LOCALE): string {
  const { action, target } = localizeToolTitle(title, locale);
  return target ? `${action} ${target}` : action;
}
