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
import { useTranslation } from "react-i18next";

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

type Translate = (key: string) => string;

function stateLabel(state: string, t: Translate) {
  switch (state) {
    case DomainLicenseState.LicenseStateMissing:
      return t("managerLicense.states.missing");
    case DomainLicenseState.LicenseStateActive:
    case "valid":
      return t("managerLicense.states.active");
    case DomainLicenseState.LicenseStateExpired:
      return t("managerLicense.states.expired");
    case DomainLicenseState.LicenseStateInvalid:
      return t("managerLicense.states.invalid");
    default:
      return state;
  }
}

function stateVariant(state?: string) {
  if (state === DomainLicenseState.LicenseStateActive || state === "valid")
    return "default";
  if (state === DomainLicenseState.LicenseStateInvalid) return "destructive";
  if (state === DomainLicenseState.LicenseStateExpired) return "secondary";
  return "outline";
}

function formatTime(value?: string, language?: string) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const locale = language === "cn" ? "zh-CN" : "en-US";
  return date.toLocaleString(locale, { hour12: false }).replace(/\//g, "-");
}

function formatText(value?: string | number) {
  if (value === undefined || value === null || value === "") return "-";
  return String(value);
}

export default function TeamManagerLicense() {
  const { i18n, t } = useTranslation();
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
        toast.error(resp.data?.message || t("managerLicense.toast.fetchStatusFailed"));
      }
    } catch (error) {
      toast.error((error as Error).message || t("managerLicense.toast.fetchStatusFailed"));
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
        toast.error(resp.data?.message || t("managerLicense.toast.fetchMachineCodeFailed"));
      }
    } catch (error) {
      toast.error((error as Error).message || t("managerLicense.toast.fetchMachineCodeFailed"));
    } finally {
      setMachineCodeLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([fetchStatus(), fetchMachineCode()]);
  }, []);

  const handleCopyMachineCode = async () => {
    if (!displayMachineCode) {
      toast.error(t("managerLicense.toast.noMachineCode"));
      return;
    }
    try {
      await navigator.clipboard.writeText(displayMachineCode);
      toast.success(t("managerLicense.toast.machineCodeCopied"));
    } catch (error) {
      toast.error(t("managerLicense.toast.copyFailed"));
      console.error("Failed to copy machine code:", error);
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast.error(t("managerLicense.toast.selectFile"));
      return;
    }
    setUploading(true);
    try {
      const api = new Api();
      const resp = await api.api.v1LicenseImportCreate({ file: selectedFile });
      if (resp.data?.code === 0) {
        toast.success(t("managerLicense.toast.imported"));
        setSelectedFile(null);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
        await Promise.all([fetchStatus(), fetchMachineCode()]);
      } else {
        toast.error(resp.data?.message || t("managerLicense.toast.importFailed"));
      }
    } catch (error) {
      toast.error((error as Error).message || t("managerLicense.toast.importFailed"));
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
            {t("managerLicense.description")}
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
              {t("managerLicense.actions.refresh")}
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
                <div className="text-sm text-muted-foreground">
                  {t("managerLicense.fields.status")}
                </div>
                <div className="mt-2">
                  <Badge variant={stateVariant(state)}>
                    {state ? stateLabel(state, t) : "-"}
                  </Badge>
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">
                  {t("managerLicense.fields.subject")}
                </div>
                <div className="mt-2 break-words text-sm font-medium">
                  {formatText(customerName)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">
                  {t("managerLicense.fields.memberSeats")}
                </div>
                <div className="mt-2 text-sm font-medium">{usageText}</div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">
                  {t("managerLicense.fields.concurrentTasks")}
                </div>
                <div className="mt-2 text-sm font-medium">
                  {formatText(taskLimit)}
                </div>
              </div>
              <div className="rounded-md border p-3">
                <div className="text-sm text-muted-foreground">
                  {t("managerLicense.fields.expiresAt")}
                </div>
                <div className="mt-2 text-sm font-medium">
                  {formatTime(status?.expires_at, i18n.language)}
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
            {t("managerLicense.machineCode.title")}
          </CardTitle>
          <CardDescription>
            {t("managerLicense.machineCode.description")}
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
              {t("managerLicense.machineCode.copy")}
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
              <AlertTitle>{t("managerLicense.machineCode.emptyTitle")}</AlertTitle>
              <AlertDescription>
                {t("managerLicense.machineCode.emptyDescription")}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card className="w-full shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload />
            {t("managerLicense.import.title")}
          </CardTitle>
          <CardDescription>
            {t("managerLicense.import.description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 md:max-w-xl">
            <div className="grid gap-2">
              <Label htmlFor="license-file">{t("managerLicense.import.fileLabel")}</Label>
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
                {t("managerLicense.import.action")}
              </Button>
              <div className="min-w-0 truncate text-sm text-muted-foreground">
                {selectedFile ? selectedFile.name : t("managerLicense.import.noFile")}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
