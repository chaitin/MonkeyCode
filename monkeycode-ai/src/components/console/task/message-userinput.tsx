import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import "@/utils/plain-text-markdown.css"
import type { MessageType } from "./message"

export const UserInputMessageItem = ({ message }: { message: MessageType }) => {
  return (
    <div className="flex flex-col w-fit rounded-md bg-accent/50 px-4 py-3 max-w-[80%]">
      <div className="user-message-markdown break-all">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p({children, ...props}) {
              if (typeof children === 'string') {
                return (children as string).split('\n').map((line: string, index: number) => (
                  <p key={index} {...props}>{line}</p>
                ))
              } else {
                return <p {...props}>{children}</p>
              }
            }
          }}>
          {message.data.content}
        </ReactMarkdown>
      </div>
    </div>
  )
}
