import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, FileKey2, KeyRound, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  Api,
  DomainLicenseState,
  type DomainLicenseStatusResp,
} from "@/api/Api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Empty, EmptyHeader, EmptyMedia } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type LicenseStatus = DomainLicenseStatusResp & {
  id?: string;
  subject?: string;
  plan?: string;
  mode?: string;
  machine_code?: string;
  limits?: {
    max_members?: number;
    max_concurrent_tasks?: number;
  };
};

type LicenseMachineCodeResp = {
  machine_code?: string;
};

const stateLabels: Record<string, string> = {
  [DomainLicenseState.LicenseStateMissing]: "未导入",
  [DomainLicenseState.LicenseStateActive]: "有效",
  valid: "有效",
  [DomainLicenseState.LicenseStateExpired]: "已过期",
  [DomainLicenseState.LicenseStateInvalid]: "无效",
};

function stateVariant(state?: string) {
  if (state === DomainLicenseState.LicenseStateActive || state === "valid")
    return "default";
  if (state === DomainLicenseState.LicenseStateInvalid) return "destructive";
  if (state === DomainLicenseState.LicenseStateExpired) return "secondary";
  return "outline";
}

function formatTime(value?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-");
}

function formatText(value?: string | number) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

export default function TeamManagerLicense() {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [machineCodeLoading, setMachineCodeLoading] = useState(true);
  const [machineCode, setMachineCode] = useState("");
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const state = status?.state;
  const displayMachineCode = machineCode || status?.machine_code || "";
  const customerName = status?.customer_name || status?.subject;
  const licenseId = status?.license_id || status?.id;
  const memberLimit = status?.limits?.max_members ?? status?.seats;
  const taskLimit = status?.limits?.max_concurrent_tasks;
  const usageText = useMemo(() => {
    if (status?.used_seats === undefined && status?.seats === undefined) {
      return formatText(memberLimit);
    }
    return `${status?.used_seats ?? 0} / ${status?.seats ?? 0}`;
  }, [memberLimit, status?.seats, status?.used_seats]);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const api = new Api();
      const resp = await api.api.v1LicenseStatusList();
      if (resp.data?.code === 0) {
        setStatus((resp.data.data ?? null) as LicenseStatus | null);
      } else {
        toast.error(resp.data?.message || "获取 License 状态失败");
      }
    } catch (error) {
      toast.error((error as Error).message || "获取 License 状态失败");
    } finally {
      setLoading(false);
    }
  };

  const fetchMachineCode = async () => {
    setMachineCodeLoading(true);
    try {
      const api = new Api();
      const resp = await api.api.v1LicenseMachineCodeList();
      if (resp.data?.code === 0) {
        const data = (resp.data.data ?? null) as LicenseMachineCodeResp | null;
        setMachineCode(data?.machine_code ?? "");
      } else {
        toast.error(resp.data?.message || "获取机器码失败");
      }
    } catch (error) {
      toast.error((error as Error).message || "获取机器码失败");
    } finally {
      setMachineCodeLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([fetchStatus(), fetchMachineCode()]);
  }, []);

  const handleCopyMachineCode = async () => {
    if (!displayMachineCode) {
      toast.error("暂无机器码");
      return;
    }
    try {
      await navigator.clipboard.writeText(displayMachineCode);
      toast.success("机器码已复制");
    } catch (error) {
      toast.error("复制失败");
      console.error("复制机器码失败:", error);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast.error("请选择 license.lic 文件");
      return;
    }
    setUploading(true);
    try {
      const api = new Api();
      const resp = await api.api.v1LicenseImportCreate({ file: selectedFile });
      if (resp.data?.code === 0) {
        toast.success("License 已导入");
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        await Promise.all([fetchStatus(), fetchMachineCode()]);
      } else {
        toast.error(resp.data?.message || "导入 License 失败");
      }
    } catch (error) {
      toast.error((error as Error).message || "导入 License 失败");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound />
            License
          </CardTitle>
          <CardDescription>
            查看当前私有化授权状态，复制机器码并导入 license.lic。
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={loading || machineCodeLoading}
              onClick={() =>
                void Promise.all([fetchStatus(), fetchMachineCode()])
              }
            >
              <RefreshCw
                className={
                  loading || machineCodeLoading
                    ? "size-4 animate-spin"
                    : "size-4"
                }
              />
              刷新
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner className="size-6" />
                </EmptyMedia>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">授权状态</div>
                <div className="mt-2">
                  <Badge variant={stateVariant(state)}>
                    {state ? (stateLabels[state] ?? state) : "-"}
                  </Badge>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">授权主体</div>
                <div className="mt-2 break-words text-sm font-medium">
                  {formatText(customerName)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">成员席位</div>
                <div className="mt-2 text-sm font-medium">{usageText}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">并发任务</div>
                <div className="mt-2 text-sm font-medium">
                  {formatText(taskLimit)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">到期时间</div>
                <div className="mt-2 text-sm font-medium">
                  {formatTime(status?.expires_at)}
                </div>
              </div>
              <div className="rounded-md border p-3 md:col-span-2 xl:col-span-4">
                <div className="text-sm text-muted-foreground">License ID</div>
                <div className="mt-2 break-all font-mono text-sm">
                  {formatText(licenseId)}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileKey2 />
            机器码
          </CardTitle>
          <CardDescription>
            将机器码提供给授权签发方，生成与当前私有化部署绑定的 license.lic。
          </CardDescription>
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              type="button"
              disabled={!displayMachineCode}
              onClick={() => void handleCopyMachineCode()}
            >
              <Copy className="size-4" />
              复制机器码
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {machineCodeLoading ? (
            <Empty className="bg-muted">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Spinner className="size-6" />
                </EmptyMedia>
              </EmptyHeader>
            </Empty>
          ) : displayMachineCode ? (
            <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 font-mono text-sm whitespace-pre-wrap break-all">
              {displayMachineCode}
            </pre>
          ) : (
            <Alert>
              <KeyRound className="size-4" />
              <AlertTitle>暂无机器码</AlertTitle>
              <AlertDescription>
                获取机器码失败或当前接口没有返回机器码，请刷新页面后重试。
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload />
            导入 License
          </CardTitle>
          <CardDescription>
            上传签发后的 license.lic，导入成功后会自动刷新授权状态。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:max-w-xl">
            <div className="grid gap-2">
              <Label htmlFor="license-file">License 文件</Label>
              <Input
                ref={fileInputRef}
                id="license-file"
                type="file"
                accept=".lic"
                onChange={(event) =>
                  setSelectedFile(event.target.files?.[0] ?? null)
                }
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                disabled={uploading || !selectedFile}
                onClick={() => void handleImport()}
              >
                {uploading ? (
                  <Spinner className="size-4" />
                ) : (
                  <Upload className="size-4" />
                )}
                导入 License
              </Button>
              <div className="min-w-0 truncate text-sm text-muted-foreground">
                {selectedFile ? selectedFile.name : "未选择文件"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
