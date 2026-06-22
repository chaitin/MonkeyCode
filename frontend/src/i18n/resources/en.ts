const en = {
  meta: {
    default: {
      title: "MonkeyCode AI Platform",
      description:
        "MonkeyCode AI is an intelligent code generation platform that helps developers build applications faster with AI-powered coding assistants, automated workflows, and smart development tools.",
      keywords: "AI code generation, intelligent programming, developer tools, automated programming, code assistant, AI development platform, MonkeyCode, artificial intelligence programming",
    },
  },
  login: {
    title: "MonkeyCode AI Platform",
    tabs: {
      user: "User",
      manager: "Admin",
    },
    choices: {
      title: "Choose a sign-in method",
      baizhi: "Baizhi Cloud Sign-in - Recommended",
      oidc: "Enterprise Sign-in",
      password: "Email and Password",
      signup: "Quick Sign-up",
    },
    fields: {
      account: "Account",
      password: "Password",
    },
    actions: {
      login: "Sign in",
      back: "Back",
      forgotPassword: "Forgot password",
    },
    agreement: {
      prefix: "I have read and agree to",
      link: "User Agreement",
    },
    toast: {
      acceptTerms: "Please read and agree to the User Agreement first",
      missingCredentials: "Please enter your account and password",
      loginFailed: "Sign-in failed, please try again",
      captchaFailed: "Captcha verification failed",
    },
  },
  consoleTasks: {
    title: "MonkeyCode AI Tasks",
    hover: {
      taskName: "Task name",
      taskContent: "Task content",
      taskStatus: "Task status",
      taskType: "Task type",
      repository: "Repository",
      repositoryFile: "Repository file",
      branch: "Branch",
      developmentTool: "Development tool",
      model: "Model",
      createdAt: "Created at",
    },
    actions: {
      stop: "Stop",
      delete: "Delete",
    },
    status: {
      stopped: "Stopped",
      recycleTip: "Tasks with no activity for three days will be automatically reclaimed",
      startFailed: "Failed to start",
      starting: "Starting",
      processing: "Running",
    },
    toast: {
      deleted: "Task deleted",
      deleteFailed: "Delete failed",
      stopped: "Task stopped",
      stopFailed: "Stop failed",
      fetchFailed: "Failed to load task list: {{message}}",
    },
    dialog: {
      common: {
        cancel: "Cancel",
      },
      delete: {
        title: "Delete task",
        description: "Delete task \"{{taskName}}\"? This action cannot be undone.",
        confirming: "Deleting...",
        confirm: "Delete",
      },
      stop: {
        title: "Stop task",
        description: "Stop task \"{{taskName}}\"? This action cannot be restored.",
        confirming: "Stopping...",
        confirm: "Stop",
      },
    },
  },
}

export default en
