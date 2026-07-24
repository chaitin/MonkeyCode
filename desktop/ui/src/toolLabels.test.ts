import { describe, expect, it } from "vitest";
import { localizedToolTitleText, localizeToolTitle, presentToolCall, toolDisplayName } from "./toolLabels";

describe("工具标题本地化", () => {
  it("覆盖当前所有内置活动工具与别名", () => {
    const tools = [
      "Agent", "Task", "AskUserQuestion", "Bash", "Cmd", "PowerShell",
      "SendUserMessage", "Brief", "Config", "CronCreate", "CronDelete", "CronList",
      "EnterPlanMode", "ExitPlanMode", "EnterWorktree", "ExitWorktree",
      "Edit", "Read", "Write", "Glob", "Grep", "ListMcpResourcesTool",
      "ReadMcpResourceTool", "LSP", "NotebookEdit", "RemoteTrigger", "SendMessage",
      "Skill", "StructuredOutput", "TaskCreate", "TaskGet", "TaskList", "TaskOutput",
      "AgentOutputTool", "BashOutputTool", "TaskStop", "KillShell", "TaskUpdate",
      "TeamCreate", "TeamDelete", "TodoWrite", "ToolSearch", "WebFetch", "WebSearch",
    ];
    for (const tool of tools) expect(toolDisplayName(tool), tool).not.toBe("调用工具");
  });

  it("翻译内置工具动作但保留参数", () => {
    expect(localizeToolTitle("Read src/main.rs")).toEqual({
      action: "读取文件",
      target: "src/main.rs",
      rawTool: "Read",
    });
    expect(localizedToolTitleText("Bash cargo test --all")).toBe("执行命令 cargo test --all");
    expect(toolDisplayName("TaskUpdate")).toBe("更新任务");
  });

  it("中文上游标题原样保留", () => {
    expect(localizedToolTitleText("读取文件 README.md")).toBe("读取文件 README.md");
  });

  it("MCP 工具显示服务名并轻量翻译常见动作", () => {
    expect(localizeToolTitle("mcp__github__create_issue MonkeyCode")).toEqual({
      action: "调用 GitHub",
      target: "创建 事项 MonkeyCode",
      rawTool: "mcp__github__create_issue",
    });
  });

  it("优先用结构化入参展示完整文件路径，不隐藏 worktree", () => {
    const path = "/repo/.ohmyagent/worktrees/ohmyagent/internal/agent/loop.go";
    expect(presentToolCall("Edit /repo/.ohmyagent/worktrees/ohmyagent", { file_path: path })).toEqual({
      action: "编辑文件",
      target: path,
      targetKind: "path",
      rawTool: "Edit",
    });
  });

  it("命令使用完整 rawInput，而不是标题里的截断值", () => {
    const command = "go test -race ./internal/agent";
    expect(presentToolCall("Bash go test", { command })).toMatchObject({
      action: "执行命令",
      target: command,
      targetKind: "code",
    });
  });

  it("云端 kind 与 camelCase 入参复用本地动作和路径样式", () => {
    expect(presentToolCall("opencode_read", { filePath: "/workspace/src/app.ts" }, { toolKind: "read" })).toEqual({
      action: "读取文件",
      target: "/workspace/src/app.ts",
      targetKind: "path",
      rawTool: "opencode_read",
    });
    expect(presentToolCall("read", {}, {
      toolKind: "read",
      meta: { claudeCode: { toolResponse: { file: { filePath: "/workspace/README.md" } } } },
    })).toMatchObject({ action: "读取文件", target: "/workspace/README.md", targetKind: "path" });
  });

  it("云端命令数组和 parsed_cmd 都提取实际命令", () => {
    expect(presentToolCall("shell", { command: ["cd /workspace", "npm test"] }, { toolKind: "execute" })).toMatchObject({
      action: "执行命令",
      target: "npm test",
      targetKind: "code",
    });
    expect(presentToolCall("shell", { parsed_cmd: [{ cmd: "rg TODO src" }] }, { toolKind: "search" })).toMatchObject({
      action: "搜索内容",
      target: "rg TODO src",
      targetKind: "code",
    });
  });

  it("浏览器 MCP 按具体操作展示，不显示内部服务名", () => {
    expect(presentToolCall("mcp__mc-browser__browser_navigate", { url: "https://example.com" })).toEqual({
      action: "打开网页",
      target: "https://example.com",
      targetKind: "text",
      rawTool: "mcp__mc-browser__browser_navigate",
    });
    expect(presentToolCall("mcp__mc-browser__browser_take_screenshot", { full_page: true })).toMatchObject({
      action: "截取页面",
      target: "整页",
    });
  });

  it("未知工具使用可读兜底且保留原名", () => {
    expect(localizeToolTitle("CustomSearchTool keyword")).toEqual({
      action: "调用工具",
      target: "Custom 搜索 Tool keyword",
      rawTool: "CustomSearchTool",
    });
  });

  it("英文模式恢复原始工具名", () => {
    expect(localizeToolTitle("WebSearch Rust news", "en")).toEqual({
      action: "WebSearch",
      target: "Rust news",
      rawTool: "WebSearch",
    });
  });
});
