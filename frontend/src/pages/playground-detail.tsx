import Header from "@/components/welcome/header"
import Footer from "@/components/welcome/footer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiRequest } from "@/utils/requestUtils";
import { ConstsPostKind, type DomainPlaygroundPost } from "@/api/Api";
import { Markdown } from "@/components/common/markdown";
import JSZip from "jszip";
import { IconFile, IconFileCode, IconFolder, IconFolderOpen, IconLoader, IconPlayerPlayFilled } from "@tabler/icons-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AceEditor from "react-ace";
import "ace-builds";
import "ace-builds/src-noconflict/theme-tomorrow";
import "ace-builds/src-noconflict/mode-text";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-typescript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-markdown";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/mode-css";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-sh";
import "ace-builds/src-noconflict/mode-golang";
import "ace-builds/src-noconflict/mode-rust";
import "ace-builds/src-noconflict/mode-java";
import "ace-builds/src-noconflict/mode-c_cpp";
import "ace-builds/src-noconflict/theme-github";
import "ace-builds/src-noconflict/theme-monokai";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import { AuthProvider } from "@/components/auth-provider";
import { TaskChatPanel } from "@/components/console/task/chat-panel";
import type { TaskStreamStatus } from "@/components/console/task/task-shared";
import React from "react";
import type { MessageType } from "@/components/console/task/message";
import { loadAllTaskRoundMessages } from "@/components/console/task/task-rounds";

interface ZipFileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  content?: string;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  content?: string;
  children: TreeNode[];
}

const PlaygroundDetailPage = () => {
  const [searchParams] = useSearchParams()
  const [postId] = useState(searchParams.get('id'));
  const [post, setPost] = useState<DomainPlaygroundPost>();
  const [zipFiles, setZipFiles] = useState<ZipFileItem[]>([]);
  const [loadingZip, setLoadingZip] = useState(false);
  const [selectedFile, setSelectedFile] = useState<ZipFileItem | null>(null);
  const [fileDialogOpen, setFileDialogOpen] = useState(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  const [streamStatus, setStreamStatus] = React.useState<TaskStreamStatus>('inited')
  const [messages, setMessages] = React.useState<MessageType[]>([])
  const [sending] = React.useState(false)
  
  const [showPlayOverlay, setShowPlayOverlay] = useState(true);

  const handlePlayClick = async () => {
    setShowPlayOverlay(false)
    if (!post?.task_post?.task_id || messages.length > 0) {
      return
    }

    setStreamStatus('inited')
    try {
      const nextMessages = await loadAllTaskRoundMessages(post.task_post.task_id)
      setMessages(nextMessages)
      setStreamStatus('waiting')
    } catch {
      setStreamStatus('error')
    }
  }

  // Build tree structure from flat file list
  const buildTree = (files: ZipFileItem[]): TreeNode[] => {
    const root: TreeNode[] = [];
    const nodeMap = new Map<string, TreeNode>();

    // Sort files so directories come first, then alphabetically
    const sortedFiles = [...files].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

    for (const file of sortedFiles) {
      const parts = file.path.split('/').filter(Boolean);
      let currentPath = '';
      let currentLevel = root;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        const isLast = i === parts.length - 1;

        let node = nodeMap.get(currentPath);
        if (!node) {
          node = {
            name: part,
            path: currentPath,
            isDirectory: isLast ? file.isDirectory : true,
            content: isLast ? file.content : undefined,
            children: [],
          };
          nodeMap.set(currentPath, node);
          currentLevel.push(node);
          // Sort current level: directories first, then alphabetically
          currentLevel.sort((a, b) => {
            if (a.isDirectory !== b.isDirectory) {
              return a.isDirectory ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
          });
        }
        currentLevel = node.children;
      }
    }

    return root;
  };

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const fileTree = buildTree(zipFiles);

  useEffect(() => {
    fetchPost()
  }, [postId])

  useEffect(() => {
    if (post?.task_post?.code) {
      loadZipFile(post.task_post.code)
    }
  }, [post?.task_post?.code])

  // Expand all directories by default when files are loaded
  useEffect(() => {
    if (zipFiles.length > 0) {
      const allDirPaths = new Set<string>();
      zipFiles.forEach(file => {
        const parts = file.path.split('/').filter(Boolean);
        let currentPath = '';
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
          allDirPaths.add(currentPath);
        }
        if (file.isDirectory) {
          allDirPaths.add(file.path.replace(/\/$/, ''));
        }
      });
      setExpandedDirs(allDirPaths);
    }
  }, [zipFiles])

  const fetchPost = async () => {
    if (!postId) {
      return
    }
    await apiRequest('v1PlaygroundPostsDetail', {}, [postId], (resp) => {
      if (resp.code === 0) {
        setPost(resp.data)
      }
    })
  }

  const loadZipFile = async (url: string) => {
    setLoadingZip(true)
    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Failed to download zip: ${response.status}`)
      }
      const blob = await response.blob()
      const zip = await JSZip.loadAsync(blob)
      
      const files: ZipFileItem[] = []
      
      for (const [path, zipEntry] of Object.entries(zip.files)) {
        if (zipEntry.dir) {
          files.push({
            name: path.split('/').filter(Boolean).pop() || path,
            path: path,
            isDirectory: true,
          })
        } else {
          // Try to read as text for text files
          let content: string | undefined
          try {
            content = await zipEntry.async('string')
          } catch {
            content = '[Binary file]'
          }
          
          files.push({
            name: path.split('/').filter(Boolean).pop() || path,
            path: path,
            isDirectory: false,
            content: content,
          })
        }
      }
      
      // Sort: directories first, then files, both alphabetically
      files.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
          return a.isDirectory ? -1 : 1
        }
        return a.path.localeCompare(b.path)
      })
      
      setZipFiles(files)
    } catch (error) {
      console.error('Error loading zip file:', error)
    } finally {
      setLoadingZip(false)
    }
  }

  const handleFileClick = (file: ZipFileItem) => {
    if (!file.isDirectory) {
      setSelectedFile(file)
      setFileDialogOpen(true)
    }
  }

  const getLanguageMode = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase()
    const modeMap: Record<string, string> = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'sh': 'sh',
      'bash': 'sh',
      'zsh': 'sh',
      'sql': 'sql',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'json': 'json',
      'yaml': 'yaml',
      'yml': 'yaml',
      'md': 'markdown',
      'markdown': 'markdown',
      'go': 'golang',
      'rs': 'rust',
      'java': 'java',
      'c': 'c_cpp',
      'cpp': 'c_cpp',
      'h': 'c_cpp',
      'hpp': 'c_cpp',
    }
    return modeMap[ext || ''] || 'text'
  }

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    const isExpanded = expandedDirs.has(node.path);
    const paddingLeft = depth * 16;

    if (node.isDirectory) {
      return (
        <div key={node.path}>
          <div
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer transition-colors text-sm"
            style={{ paddingLeft: `${paddingLeft + 8}px` }}
            onClick={() => toggleDir(node.path)}
          >
            {isExpanded ? (
              <IconFolderOpen className="size-4 text-amber-500 shrink-0" />
            ) : (
              <IconFolder className="size-4 text-amber-500 shrink-0" />
            )}
            <span className="truncate font-medium" title={node.path}>
              {node.name}
            </span>
          </div>
          {isExpanded && node.children.length > 0 && (
            <div>
              {node.children.map(child => renderTreeNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    }

    return (
      <div
        key={node.path}
        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-accent cursor-pointer transition-colors text-sm"
        style={{ paddingLeft: `${paddingLeft + 8 + 18}px` }}
        onClick={() => handleFileClick(node)}
      >
        <IconFileCode className="size-4 shrink-0" />
        <span className="truncate" title={node.path}>
          {node.name}
        </span>
      </div>
    );
  };

  const images = post?.task_post?.images || post?.normal_post?.images || []

  return (
    <AuthProvider>
      <div className="flex flex-col h-screen">
        <Header />
        <main className="flex flex-col w-full px-10 pt-20 gap-4 flex-1">
          <div className="max-w-[1200px] w-full mx-auto flex flex-col gap-4">
            <div className="text-4xl font-bold line-clamp-1">
              {post?.kind === ConstsPostKind.PostKindTask ? post?.task_post?.title : post?.normal_post?.title}
            </div>
            <div className="flex flex-row items-center gap-10 text-sm text-muted-foreground">
              <div className="flex flex-row items-center gap-2 hover:text-primary cursor-pointer">
                <Avatar className="size-6">
                  <AvatarImage src={post?.user?.avatar_url || "/logo-colored.png"} />
                  <AvatarFallback>CN</AvatarFallback>
                </Avatar>
                {post?.user?.name}
              </div>
              <div className="">
                {dayjs((post?.created_at || 0) * 1000).fromNow()}发布
              </div>
              <div className="">
                {post?.views} 次浏览
              </div>
            </div>
          </div>
          <div className="max-w-[1200px] w-full mx-auto grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
            <div className="flex flex-col gap-4 md:col-span-2">
              {post?.kind === ConstsPostKind.PostKindTask && <AspectRatio ratio={4 / 3} >
                <div className="flex w-full h-full overflow-y-auto relative">
                  <TaskChatPanel 
                    messages={messages} 
                    streamStatus={streamStatus}
                    disabled={true} 
                    sending={sending}
                    availableCommands={null}
                    queueSize={0}
                    sendUserInput={() => {}}
                    sendCancelCommand={() => {}}
                  />
                  {showPlayOverlay && (
                    <div className="absolute inset-0 flex items-center justify-center cursor-pointer hover:text-primary" onClick={handlePlayClick} >
                      <div className="absolute inset-0" style={{
                          backgroundImage: `url('${post?.task_post?.images?.[0]}')`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          backgroundRepeat: 'no-repeat',
                        }}>
                      </div>
                      <div className="absolute inset-0 bg-muted/50 backdrop-blur-sm">
                      </div>
                      <IconPlayerPlayFilled className="size-16 relative flex gap-2 items-center" />
                    </div>
                  )}
                </div>
              </AspectRatio>}
              <div className="border rounded-md p-4">
                <Markdown allowHtml>{post?.kind === ConstsPostKind.PostKindTask ? (post?.task_post?.content || '') : (post?.normal_post?.content || '')}</Markdown>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="border rounded-md p-4">
                <div className={`grid gap-4 ${images.length < 2 ? "grid-cols-1" : "grid-cols-2"}`} >
                  {images.map((image, idx) => (
                    <AspectRatio ratio={16 / 9} key={idx} className="border rounded-md bg-muted/50 cursor-pointer hover:opacity-80 transition-opacity" onClick={() => setPreviewImage(image)} >
                      <img src={image} className={`w-full h-full object-cover rounded`} />
                    </AspectRatio>
                  ))}
                </div>
              </div>
              {!!post?.task_post?.code && <div className="border rounded-md p-4">
                <div className="flex flex-row items-center justify-between mb-3">
                  <Label>代码文件</Label>
                  {post?.task_post?.code && <Button variant="link" size="sm" asChild>
                    <a href={post?.task_post?.code} download>
                      下载
                    </a>
                  </Button>}
                </div>
                {loadingZip ? (
                  <div className="flex items-center justify-center py-8">
                    <IconLoader className="size-6 animate-spin text-muted-foreground" />
                  </div>
                ) : zipFiles.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    无代码文件
                  </div>
                ) : (
                  <div className="flex flex-col pr-3">
                    {fileTree.map(node => renderTreeNode(node, 0))}
                  </div>
                )}
              </div>}
              <div className="border rounded-md p-4">
                <Label>网友评论</Label>
              </div>
            </div>
          </div>
        </main>
        <Footer />

        {/* File Content Dialog */}
        <Dialog open={fileDialogOpen} onOpenChange={setFileDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col sm:max-w-[60vw]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-mono text-sm">
                <IconFile className="size-4 text-blue-500" />
                {selectedFile?.path}
              </DialogTitle>
            </DialogHeader>
            <div className="border rounded-md h-[60vh] overflow-hidden">
              <AceEditor
                mode={getLanguageMode(selectedFile?.name || '')}
                theme={'tomorrow'}
                value={selectedFile?.content || ''}
                readOnly={true}
                width="100%"
                height="100%"
                fontSize={14}
                showPrintMargin={false}
                highlightActiveLine={false}
                setOptions={{
                  showLineNumbers: true,
                  tabSize: 2,
                  useWorker: false,
                }}
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* Image Preview Dialog */}
        <Dialog open={!!previewImage} onOpenChange={(open) => !open && setPreviewImage(null)}>
          <DialogContent className=" sm:max-w-[80vw] sm:max-h-[80vh] w-fit h-fit p-0">
            <DialogHeader className="sr-only">
              <DialogTitle></DialogTitle>
            </DialogHeader>
            {previewImage && (
              <img
                src={previewImage}
                className="w-full h-full object-cover rounded-md"
                alt="预览图片"
              />
            )}
          </DialogContent>
        </Dialog>
      </div>
    </AuthProvider>
  )
}

export default PlaygroundDetailPage
