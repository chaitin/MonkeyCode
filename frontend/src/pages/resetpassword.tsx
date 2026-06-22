import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Field } from "@/components/ui/field";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/utils/requestUtils";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const missingToken = !token;
  const tokenErrorMessage = t("auth.resetPassword.invalidToken");
  const [pageError, setPageError] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const navigate = useNavigate();

  const handleResetPassword = async () => {
    if (password !== confirmPassword) {
      toast.error(t("auth.resetPassword.toast.passwordMismatch"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("auth.resetPassword.toast.passwordTooShort"));
      return;
    }
    setLoading(true);
    await apiRequest('v1UsersPasswordsResetUpdate', { new_password: password, token }, [], (resp) => {
      if (resp.code === 0) {
        setSuccessDialogOpen(true);
      } else {
        toast.error(resp.message || t("auth.resetPassword.toast.failed"));
      }
    });
    setLoading(false);
  };

  useEffect(() => {
    if (missingToken) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Surface the missing token state as page-local form error.
      setPageError(tokenErrorMessage);
      return;
    }

    const loadAccountInfo = async () => {
      setPageError('');
      setLoading(true);
      await apiRequest('v1UsersPasswordsAccountsDetail', {}, [token], (resp) => {
        console.log(resp);
        if (resp.code === 0) {
          setPageError('');
          setEmail(resp.data.user.email || '');
        } else {
          setEmail('');
          setPageError(tokenErrorMessage);
        }
      });
      setLoading(false);
    };

    void loadAccountInfo();
  }, [missingToken, token, tokenErrorMessage]);

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Link to="/">
            <h1 className="text-2xl hover:font-bold">{t("login.title")}</h1>
          </Link>
          <Card>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">{t("auth.resetPassword.account")}</FieldLabel>
                  <Input id="email" type="email" value={email} readOnly />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">{t("auth.resetPassword.password")}</FieldLabel>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={!!pageError}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">{t("auth.resetPassword.confirmPassword")}</FieldLabel>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={!!pageError}
                  />
                </Field>
                <Field>
                  <Button onClick={handleResetPassword} disabled={!!pageError || loading || !email || !password || !confirmPassword}>
                    {loading && <Spinner />}
                    {t("auth.resetPassword.action")}
                  </Button>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
          {pageError && (
            <Alert variant="destructive">
              <AlertTitle>{t("auth.resetPassword.invalidLinkTitle")}</AlertTitle>
              <AlertDescription>
                {pageError}
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>
      <AlertDialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("auth.resetPassword.successTitle")}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => navigate('/')}>
              {t("auth.resetPassword.ok")}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
