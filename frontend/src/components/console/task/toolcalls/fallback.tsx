import type { MessageType } from "../message";
import { taskDetailT } from "../task-i18n";



export const renderTitle = (message: MessageType) => {
    const renderEditTitle = (filePath?: string) => {
      const action = message.data.status === "failed"
        ? taskDetailT("toolcall.editFailed")
        : message.data.status === "pending" || message.data.status === "in_progress"
          ? taskDetailT("toolcall.editingFile")
          : taskDetailT("toolcall.editFile")
      return `${action}${filePath ? ` "${filePath}"` : ""}`
    }

    if (typeof message.data?.title === 'string' && message.data?.title?.length < 20 && /[\u4e00-\u9fa5]/.test(message.data.title ?? "")) {
      return message.data.title;
    }
    if (typeof message.data?.rawInput?.description === 'string' && /[\u4e00-\u9fa5]/.test(message.data?.rawInput?.description ?? "")) {
      return message.data.rawInput.description
    }

    if (message.data.rawInput?.parsed_cmd?.length > 0) {
      if (message.data.kind === 'execute') {
        return `${taskDetailT("toolcall.executeCommand")} "${message.data.rawInput?.parsed_cmd[0]?.cmd}"`
      } else if (message.data.kind === 'search') {
        return `${taskDetailT("toolcall.searchContent")} "${message.data.rawInput?.parsed_cmd[0]?.cmd}"`
      } else if (message.data.kind === 'read') {
        return `${taskDetailT("toolcall.readContent")} "${message.data.rawInput?.parsed_cmd[0]?.path}"`
      }
    } else if (message.data.kind === 'execute' && !!message.data.rawInput?.command) {
      return `${taskDetailT("toolcall.executeCommand")} "${message.data.rawInput.command}"`
    } else if (message.data.kind === 'search' && !!message.data.rawInput?.path && !!message.data.rawInput?.pattern) {
      return `${taskDetailT("toolcall.searchContent")} "${message.data.rawInput.pattern} in ${message.data.rawInput.path}"`
    } else if (message.data.kind === 'search' && !!message.data.rawInput?.pattern) {
      return `${taskDetailT("toolcall.searchContent")} "${message.data.rawInput.pattern}"`
    } else if (message.data.kind === 'read' && !!message.data.rawInput?.file_path) {
      return `${taskDetailT("toolcall.readContent")} "${message.data.rawInput.file_path}"`
    } else if (message.data.kind === 'read' && !!message.data.rawInput?.filePath) {
      return `${taskDetailT("toolcall.readContent")} "${message.data.rawInput.filePath}"`
    } else if (message.data.kind === 'read') {
      return taskDetailT("toolcall.readContent")
    } else if (message.data.kind === 'edit' && !!message.data.rawInput?.file_path) {
      return renderEditTitle(message.data.rawInput.file_path)
    }  else if (message.data.kind === 'edit' && !!message.data.rawInput?.filePath) {
      return renderEditTitle(message.data.rawInput.filePath)
    } else if (message.data.kind === 'edit') {
      return renderEditTitle()
    }
    return message.data.title
  }


 export const renderDetail = (message: MessageType) => {
    const cwd = message.data.rawInput?.cwd || ''
    let input = ''
    let output = ''

    if (Array.isArray(message.data.rawInput?.command) && message.data.rawInput?.command?.length > 0) {
      input = message.data.rawInput.command[message.data.rawInput.command.length - 1]
    }


    if (message.data.rawOutput?.stdout?.length > 0) {
      output = message.data.rawOutput.stdout
    }

    if (message.data.rawOutput?.stderr?.length > 0) {
      if (output.length > 0) {
        output += '\n'
      }
      output += message.data.rawOutput.stderr
    }

    if (output.length === 0 && Array.isArray(message.data.content) && message.data.content?.length > 0 && message.data.content[0].type === 'content' && message.data.content[0].content.type === 'text' && message.data.content[0].content.text?.length > 0) {
      output = message.data.content[0].content.text
    }

    if (typeof message.data.rawInput?.command === 'string') {
      input = message.data.rawInput.command
    }

    if (typeof message.data.rawOutput?.output === 'string') {
      output = message.data.rawOutput.output
    }



    if (input.length > 0) {
      return <div className="flex flex-col gap-2 text-xs p-3">
        <pre className="">
          <code className="text-primary">{cwd}</code>
          <code className="text-muted-foreground">$ </code>
          <code className="text-foreground">{input}</code>
        </pre>
        <pre className="">
          <code className="text-muted-foreground">{output || taskDetailT("toolcall.commandOutputEmpty")}</code>
        </pre>
      </div>
    }

    return <>
      <pre className="text-xs p-3">
        {JSON.stringify(message.data, null, 2)}
      </pre>
    </>
  }
