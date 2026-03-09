import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import { Field } from "@/components/ui/field";
import { FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiRequest } from "@/utils/requestUtils";
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const navigate = useNavigate();

  const handleResetPassword = async () => {
    if (password !== confirmPassword) {
      toast.error('密码和确认密码不一致');
      return;
    }
    if (password.length < 6) {
      toast.error('密码长度不能小于6位');
      return;
    }
    setLoading(true);
    await apiRequest('v1UsersPasswordsResetUpdate', { new_password: password, token }, [], (resp) => {
      if (resp.code === 0) {
        setSuccessDialogOpen(true);
      } else {
        toast.error(resp.message || '密码重置失败');
      }
    });
    setLoading(false);
  };

  useEffect(() => {
    if (token) {
      setLoading(true);
      apiRequest('v1UsersPasswordsAccountsDetail', {}, [token], (resp) => {
        console.log(resp);
        if (resp.code === 0) {
          setEmail(resp.data.user.email || '');
        } else {
          toast.error(resp.message || '获取账户信息失败');
        }
      });
      setLoading(false);
    }
  }, [token]);

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Link to="/">
            <h1 className="text-2xl hover:font-bold">MonkeyCode 智能开发平台</h1>
          </Link>
          <Card>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="email">账号</FieldLabel>
                  <Input id="email" type="email" value={email} readOnly />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">密码</FieldLabel>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="password">确认密码</FieldLabel>
                  <Input id="confirm-password" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
                </Field>
                <Field>
                  <Button onClick={handleResetPassword} disabled={loading || !email || !password || !confirmPassword}>
                    {loading && <Spinner />}
                    重置密码
                  </Button>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>
        </div>
      </div>
      <AlertDialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>密码重置成功</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => navigate('/')}>
              知道了
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
