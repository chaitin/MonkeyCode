import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconArticle, IconPlus, IconShare, IconLoader, IconX, IconCheck, IconSelector, IconFileCode } from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";
import { Field, FieldLabel } from "../components/ui/field";
import { Input } from "../components/ui/input";
import MarkdownEditor from "../components/common/markdown-editor";
import { Button } from "../components/ui/button";
import { Api, ConstsTaskStatus, type DomainProjectTask } from "../api/Api";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { apiRequest } from "../utils/requestUtils";
import { cn } from "../lib/utils";
import FilePickerDialog from "../components/console/files/file-picker-dialog";
import JSZip from "jszip";
import { useNavigate, useSearchParams } from "react-router-dom";

type PostType = "article" | "task" | "project" | null;

const postTypeOptions = [
  {
    value: "article" as const,
    label: "写一篇文章",
    description: "分享你的想法、教程或经验",
    icon: IconArticle,
  },
  {
    value: "task" as const,
    label: "分享你执行过的任务",
    description: "分享你执行过的任务，让更多人了解你的技能",
    icon: IconShare,
  }
];

const PostCreate = () => {
  const [searchParams] = useSearchParams();
  const taskIdFromUrl = searchParams.get("taskid");
  
  const [showTypeDialog, setShowTypeDialog] = useState(!taskIdFromUrl);
  const [postType, setPostType] = useState<PostType>(taskIdFromUrl ? "task" : null);
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [posting, setPosting] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [taskId, setTaskId] = useState(taskIdFromUrl || "");
  const [projectId, setProjectId] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tasks, setTasks] = useState<DomainProjectTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [taskPopoverOpen, setTaskPopoverOpen] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [filePickerOpen, setFilePickerOpen] = useState(false);

  // 当选择任务类型时，拉取任务列表
  useEffect(() => {
    if (postType === "task" && tasks.length === 0) {
      setLoadingTasks(true);
      apiRequest("v1UsersTasksList", {}, [], (resp) => {
        if (resp.code === 0) {
          setTasks(resp.data?.tasks || []);
        } else {
          toast.error("获取任务列表失败: " + resp.message);
        }
        setLoadingTasks(false);
      });
    }
  }, [postType]);

  const onEditAddImage = (imageUrl: string) => {
    if (!images.includes(imageUrl)) {
      setImages([...images, imageUrl]);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    setUploading(true);
    try {
      const api = new Api();
      const response = await api.api.v1UploaderCreate({
        file: file,
      });

      if (response.data?.code === 0 && response.data?.data) {
        const imageUrl = response.data.data;
        setImages([...images, imageUrl]);
        toast.success("图片上传成功");
      } else {
        toast.error("图片上传失败: " + (response.data?.message || "未知错误"));
      }
    } catch (error) {
      toast.error("图片上传失败: " + (error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveImage = (imageUrl: string) => {
    setImages(images.filter((img) => img !== imageUrl));
  };

  const handleSelectType = (type: PostType) => {
    setPostType(type);
    setShowTypeDialog(false);
  };

  const zipFile = async (): Promise<string | null> => {
    const selectedTask = tasks.find((t) => t.id === taskId);
    if (files.length === 0 || !selectedTask?.virtualmachine?.id) {
      return null;
    }

    const zip = new JSZip();
    const envid = selectedTask.virtualmachine.id;

    // Download all files and add them to the zip
    const downloadPromises = files.map(async (filePath) => {
      try {
        const response = await fetch(
          `/api/v1/users/files/download?id=${envid}&path=${encodeURIComponent(filePath)}`
        );
        if (!response.ok) {
          throw new Error(`Failed to download ${filePath}: ${response.status}`);
        }
        const blob = await response.blob();
        // Preserve directory structure, remove leading slash
        const zipPath = filePath.startsWith("/") ? filePath.slice(1) : filePath;
        zip.file(zipPath, blob);
      } catch (error) {
        console.error(`Error downloading ${filePath}:`, error);
        throw error;
      }
    });

    await Promise.all(downloadPromises);

    // Generate the zip file
    const zipBlob = await zip.generateAsync({ type: "blob" });

    // Convert Blob to File and upload
    const zipFileName = `files-${Date.now()}.zip`;
    const zipFileObj = new File([zipBlob], zipFileName, { type: "application/zip" });

    const api = new Api();
    const response = await api.api.v1UploaderCreate({
      file: zipFileObj,
    });

    if (response.data?.code === 0 && response.data?.data) {
      return response.data.data;
    } else {
      return "";
    }
  };

  const handlePostArticle = async () => {
    await apiRequest(
      "v1UsersPlaygroundNormalPostsCreate",
      {
        title: title.trim(),
        content: content.trim(),
        images: images,
      },
      [],
      (resp) => {
        if (resp.code === 0) {
          toast.success("发布成功，审核后会显示在广场上");
          navigate("/playground");
        } else {
          toast.error("发布失败: " + resp.message);
        }
      }
    );
  };

  const handlePostTask = async () => {
    let zipFileUrl: string | undefined = undefined;
    if (files.length > 0) {
      const result = await zipFile();
      if (!result) {
        toast.error("分享失败: 无法打包代码文件");
        return;
      }
      zipFileUrl = result;
    }

    await apiRequest(
      "v1UsersPlaygroundTaskPostsCreate",
      {
        title: title.trim(),
        content: content.trim(),
        images: images,
        code: zipFileUrl,
      },
      [taskId],
      (resp) => {
        if (resp.code === 0) {
          toast.success("分享成功，审核后会显示在广场上");
          navigate("/playground");
        } else {
          toast.error("分享失败: " + resp.message);
        }
      }
    );
  };

  const handlePost = async () => {
    setPosting(true);

    if (postType === "article") {
      await handlePostArticle();
    } else if (postType === "task") {
      await handlePostTask();
    }

    setPosting(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-6">
      {/* 类型选择弹窗 */}
      <Dialog open={showTypeDialog} onOpenChange={setShowTypeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">选择发布类型</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-4">
            {postTypeOptions.map((option) => (
              <div
                key={option.value}
                onClick={() => handleSelectType(option.value)}
                className="flex items-center gap-4 p-4 rounded-lg border border-border hover:border-primary hover:bg-accent cursor-pointer transition-all"
              >
                <div className="flex-shrink-0 size-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <option.icon className="size-6 text-primary" />
                </div>
                <div className="flex-1">
                  <div className="font-medium">{option.label}</div>
                  <div className="text-sm text-muted-foreground">{option.description}</div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* 表单区域 */}
      {postType && (
        <div className="space-y-6">
          <h1 className="text-xl font-semibold">{postTypeOptions.find((option) => option.value === postType)?.label}</h1>

          {/* 任务特有字段 - 选择任务放在标题上面 */}
          {postType === "task" && (
            <Field>
              <FieldLabel>任务</FieldLabel>
              <Popover open={taskPopoverOpen} onOpenChange={setTaskPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={taskPopoverOpen}
                    className="w-full justify-between font-normal"
                    disabled={posting || loadingTasks}
                  >
                    {loadingTasks ? (
                      <span className="text-muted-foreground">加载中...</span>
                    ) : taskId ? (
                      <span className="truncate">
                        {tasks.find((t) => t.id === taskId)?.content || `任务 ${taskId}`}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">请选择要分享的任务</span>
                    )}
                    <IconSelector className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full max-w-3xl p-0" align="start">
                  <Command>
                    <CommandInput placeholder="搜索任务..." />
                    <CommandList className="max-h-[200px] w-full">
                      <CommandEmpty>暂无任务</CommandEmpty>
                      <CommandGroup>
                        {tasks.map((task) => (
                          <CommandItem
                            key={task.id}
                            value={task.id || ""}
                            onSelect={() => {
                              setTaskId(task.id || "");
                              setFiles([]);
                              setTaskPopoverOpen(false);
                            }}
                            className="cursor-pointer"
                          >
                            <span className="line-clamp-1">{task.content || `任务 ${task.id}`}</span>
                            <IconCheck className={cn("size-4", taskId === task.id ? "opacity-100" : "opacity-0")} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>
          )}

          <Field>
            <FieldLabel>标题</FieldLabel>
            <Input
              placeholder="请输入标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={posting}
            />
          </Field>

          {/* 项目特有字段 */}
          {postType === "project" && (
            <Field>
              <FieldLabel>项目 ID</FieldLabel>
              <Input
                placeholder="请输入要分享的项目 ID"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={posting}
              />
            </Field>
          )}

          <Field>
            <FieldLabel>内容</FieldLabel>
            <div className="h-[50vh]">
              <MarkdownEditor
                disabled={posting}
                value={content}
                onChange={setContent}
                onAddImage={onEditAddImage}
              />
            </div>
          </Field>

          <Field>
            <FieldLabel>图片</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {images.map((image) => (
                <div
                  key={image}
                  className="size-20 relative group cursor-pointer border rounded-md border-dashed"
                >
                  <img src={image} className="size-full object-contain rounded-md" />
                  <div
                    className="absolute inset-0 bg-accent/80 opacity-0 group-hover:opacity-100 transition-opacity rounded-md flex items-center justify-center"
                    onClick={() => handleRemoveImage(image)}
                  >
                    <IconX className="size-6 text-muted-foreground" />
                  </div>
                </div>
              ))}
              <div
                className="size-20 bg-muted/30 hover:bg-muted border border-dashed rounded-md flex items-center justify-center cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                  <IconLoader className="size-6 text-muted-foreground animate-spin" />
                ) : (
                  <IconPlus className="size-6 text-muted-foreground" />
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          </Field>

          {/* 产出物文件选择 - 仅当任务模式且任务正在执行时显示 */}
          {postType === "task" && taskId && (() => {
            const selectedTask = tasks.find((t) => t.id === taskId);
            const isOnline = selectedTask?.status === ConstsTaskStatus.TaskStatusProcessing;
            if (!isOnline || !selectedTask?.virtualmachine?.id) {
              return null;
            }
            return (
              <Field>
                <FieldLabel>产出物</FieldLabel>
                <div className="flex flex-wrap gap-2 text-xs">
                  <div
                    className="w-fit relative group cursor-pointer border rounded-md border-dashed px-3 py-2 flex items-center justify-center bg-muted/30 hover:bg-muted gap-2"
                    onClick={() => setFilePickerOpen(true)}
                  >
                    <IconFileCode className="size-4 text-muted-foreground" />
                    {files.length > 0 ? `已选择 ${files.length} 个文件` : '未选择文件'}
                  </div>
                </div>
                <FilePickerDialog
                  open={filePickerOpen}
                  onOpenChange={setFilePickerOpen}
                  envid={selectedTask.virtualmachine.id}
                  defaultSelectedFiles={files}
                  onSelect={(filePaths) => {
                    setFiles(filePaths);
                  }}
                />
              </Field>
            );
          })()}

          <Button
            onClick={handlePost}
            disabled={posting || !title.trim() || !content.trim() || images.length === 0 || (postType === "task" && !taskId)}
            className="w-full"
            size="lg"
          >
            发布
          </Button>
        </div>
      )}
    </div>
  );
};

export default PostCreate;
