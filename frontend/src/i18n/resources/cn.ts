const cn = {
  meta: {
    default: {
      title: "MonkeyCode 智能开发平台",
      description:
        "MonkeyCode AI 是一个智能代码生成平台，通过AI驱动的编程助手、自动化工作流和智能开发工具，帮助开发者更快速地构建应用程序。",
      keywords: "AI代码生成, 智能编程, 开发者工具, 自动化编程, 代码助手, AI开发平台, MonkeyCode, 人工智能编程",
    },
  },
  login: {
    title: "MonkeyCode 智能开发平台",
    tabs: {
      user: "普通用户",
      manager: "团队管理员",
    },
    choices: {
      title: "选择登录方式",
      baizhi: "百智云登录 - 推荐",
      oidc: "企业登录",
      password: "账号密码登录",
      signup: "快速注册",
    },
    fields: {
      account: "账号",
      password: "密码",
    },
    actions: {
      login: "登录",
      back: "返回",
      forgotPassword: "找回密码",
    },
    agreement: {
      prefix: "我已阅读并同意",
      link: "《用户协议》",
    },
    toast: {
      acceptTerms: "请先阅读并同意用户协议",
      missingCredentials: "请输入账号和密码",
      loginFailed: "登录失败，请重试",
      captchaFailed: "验证码验证失败",
    },
  },
  consoleTasks: {
    title: "MonkeyCode 智能任务",
    hover: {
      taskName: "任务名称",
      taskContent: "任务内容",
      taskStatus: "任务状态",
      taskType: "任务类型",
      repository: "代码仓库",
      repositoryFile: "代码文件",
      branch: "仓库分支",
      developmentTool: "开发工具",
      model: "大模型",
      createdAt: "创建时间",
    },
    actions: {
      stop: "终止",
      delete: "删除",
    },
    status: {
      stopped: "已终止",
      recycleTip: "连续三天不对话的任务将自动回收",
      startFailed: "启动失败",
      starting: "正在启动",
      processing: "运行中",
    },
    toast: {
      deleted: "任务已删除",
      deleteFailed: "删除失败",
      stopped: "任务已终止",
      stopFailed: "终止失败",
      fetchFailed: "获取任务列表失败: {{message}}",
    },
    dialog: {
      common: {
        cancel: "取消",
      },
      delete: {
        title: "确认删除任务",
        description: "确定要删除任务「{{taskName}}」吗？此操作不可撤销。",
        confirming: "删除中...",
        confirm: "删除",
      },
      stop: {
        title: "确认终止任务",
        description: "确定要终止任务「{{taskName}}」吗？任务终止后无法恢复。",
        confirming: "终止中...",
        confirm: "终止",
      },
    },
  },
}

export default cn
