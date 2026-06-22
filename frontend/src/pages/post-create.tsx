import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IconArticle, IconPlus, IconShare, IconLoader, IconX, IconCheck, IconSelector, IconFileCode } from "@tabler/icons-react";
import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
    labelKey: "playground.create.options.article.label",
    descriptionKey: "playground.create.options.article.description",
    icon: IconArticle,
  },
  {
    value: "task" as const,
    labelKey: "playground.create.options.task.label",
    descriptionKey: "playground.create.options.task.description",
    icon: IconShare,
  }
];

const PostCreate = () => {
  const { t } = useTranslation();
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

  // Fetch the task list when task sharing is selected.
  useEffect(() => {
    if (postType === "task" && tasks.length === 0) {
      setLoadingTasks(true);
      apiRequest("v1UsersTasksList", {}, [], (resp) => {
        if (resp.code === 0) {
          setTasks(resp.data?.tasks || []);
        } else {
          toast.error(t("playground.create.toast.fetchTasksFailed", {
            message: resp.message || t("playground.create.toast.unknownError"),
          }));
        }
        setLoadingTasks(false);
      });
    }
  }, [postType, tasks.length, t]);

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
      toast.error(t("playground.create.toast.invalidImage"));
      return;
    }

    setUploading(true);
    try {
      const api = new Api();
      const response = await api.api.v1UploaderCreate({
        usage: "spec",
        file: file,
      });

      if (response.data?.code === 0 && response.data?.data) {
        const imageUrl = response.data.data;
        setImages([...images, imageUrl]);
        toast.success(t("playground.create.toast.imageUploaded"));
      } else {
        toast.error(t("playground.create.toast.imageUploadFailed", {
          message: response.data?.message || t("playground.create.toast.unknownError"),
        }));
      }
    } catch (error) {
      toast.error(t("playground.create.toast.imageUploadFailed", { message: (error as Error).message }));
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
      usage: "spec",
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
          toast.success(t("playground.create.toast.postSuccess"));
          navigate("/playground");
        } else {
          toast.error(t("playground.create.toast.postFailed", {
            message: resp.message || t("playground.create.toast.unknownError"),
          }));
        }
      }
    );
  };

  const handlePostTask = async () => {
    let zipFileUrl: string | undefined = undefined;
    if (files.length > 0) {
      const result = await zipFile();
      if (!result) {
        toast.error(t("playground.create.toast.zipFailed"));
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
          toast.success(t("playground.create.toast.shareSuccess"));
          navigate("/playground");
        } else {
          toast.error(t("playground.create.toast.shareFailed", {
            message: resp.message || t("playground.create.toast.unknownError"),
          }));
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
      <Dialog open={showTypeDialog} onOpenChange={setShowTypeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-xl">{t("playground.create.typeTitle")}</DialogTitle>
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
                  <div className="font-medium">{t(option.labelKey)}</div>
                  <div className="text-sm text-muted-foreground">{t(option.descriptionKey)}</div>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {postType && (
        <div className="space-y-6">
          <h1 className="text-xl font-semibold">
            {t(postTypeOptions.find((option) => option.value === postType)?.labelKey || "")}
          </h1>

          {postType === "task" && (
            <Field>
              <FieldLabel>{t("playground.create.fields.task")}</FieldLabel>
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
                      <span className="text-muted-foreground">{t("playground.create.task.loading")}</span>
                    ) : taskId ? (
                      <span className="truncate">
                        {tasks.find((task) => task.id === taskId)?.content || t("playground.create.task.fallbackName", { taskId })}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">{t("playground.create.task.selectPlaceholder")}</span>
                    )}
                    <IconSelector className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full max-w-3xl p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t("playground.create.task.searchPlaceholder")} />
                    <CommandList className="max-h-[200px] w-full">
                      <CommandEmpty>{t("playground.create.task.empty")}</CommandEmpty>
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
                            <span className="line-clamp-1">
                              {task.content || t("playground.create.task.fallbackName", { taskId: task.id })}
                            </span>
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
            <FieldLabel>{t("playground.create.fields.title")}</FieldLabel>
            <Input
              placeholder={t("playground.create.placeholders.title")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={posting}
            />
          </Field>

          {postType === "project" && (
            <Field>
              <FieldLabel>{t("playground.create.fields.projectId")}</FieldLabel>
              <Input
                placeholder={t("playground.create.placeholders.projectId")}
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                disabled={posting}
              />
            </Field>
          )}

          <Field>
            <FieldLabel>{t("playground.create.fields.content")}</FieldLabel>
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
            <FieldLabel>{t("playground.create.fields.images")}</FieldLabel>
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

          {postType === "task" && taskId && (() => {
            const selectedTask = tasks.find((t) => t.id === taskId);
            const isOnline = selectedTask?.status === ConstsTaskStatus.TaskStatusProcessing;
            if (!isOnline || !selectedTask?.virtualmachine?.id) {
              return null;
            }
            return (
              <Field>
                <FieldLabel>{t("playground.create.fields.artifact")}</FieldLabel>
                <div className="flex flex-wrap gap-2 text-xs">
                  <div
                    className="w-fit relative group cursor-pointer border rounded-md border-dashed px-3 py-2 flex items-center justify-center bg-muted/30 hover:bg-muted gap-2"
                    onClick={() => setFilePickerOpen(true)}
                  >
                    <IconFileCode className="size-4 text-muted-foreground" />
                    {files.length > 0
                      ? t("playground.create.task.selectedFiles", { count: files.length })
                      : t("playground.create.task.noFilesSelected")}
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
            {t("playground.actions.publish")}
          </Button>
        </div>
      )}
    </div>
  );
};

export default PostCreate;
