import type { AuthSessionDto } from "@webeditor/domain";
import { LogOut, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAuthSession, login, logout } from "@/services/auth-api";

export function AuthBoundary({ children }: { readonly children: ReactNode }) {
  const [session, setSession] = useState<AuthSessionDto | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  const loadSession = () => {
    setError("");
    void getAuthSession()
      .then(setSession)
      .catch(() => setError("연결 실패"));
  };

  useEffect(loadSession, []);

  if (session === null) {
    return (
      <main className="auth-page" aria-busy={!error}>
        <Card className="auth-card">
          <CardHeader>
            <CardTitle role="heading" aria-level={1}>
              {error ? "연결 실패" : "확인 중"}
            </CardTitle>
          </CardHeader>
          {error && (
            <CardFooter>
              <Button type="button" onClick={loadSession}>
                다시 시도
              </Button>
            </CardFooter>
          )}
        </Card>
      </main>
    );
  }

  if (session.authenticationRequired && !session.authenticated) {
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setPending(true);
      setError("");
      void login(String(data.get("username")), String(data.get("password")))
        .then(setSession)
        .catch(() => setError("로그인 실패"))
        .finally(() => setPending(false));
    };
    return (
      <main className="auth-page">
        <Card className="auth-card">
          <CardHeader>
            <ShieldCheck aria-hidden="true" />
            <CardTitle role="heading" aria-level={1}>
              로그인
            </CardTitle>
            <CardDescription>관리자</CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="auth-form">
              <div className="auth-field">
                <Label htmlFor="auth-username">아이디</Label>
                <Input
                  id="auth-username"
                  name="username"
                  autoComplete="username"
                  defaultValue="admin"
                  minLength={3}
                  required
                />
              </div>
              <div className="auth-field">
                <Label htmlFor="auth-password">비밀번호</Label>
                <Input
                  id="auth-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>로그인 실패</AlertTitle>
                  <AlertDescription>정보를 확인하세요.</AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter>
              <Button className="auth-submit" type="submit" disabled={pending}>
                {pending ? "확인 중" : "로그인"}
              </Button>
            </CardFooter>
          </form>
        </Card>
      </main>
    );
  }

  return (
    <>
      {children}
      {session.authenticationRequired && (
        <Button
          className="auth-logout"
          type="button"
          variant="secondary"
          onClick={() => {
            setPending(true);
            void logout()
              .then(() =>
                setSession({
                  authenticationRequired: true,
                  authenticated: false,
                  username: null,
                  expiresAt: null,
                }),
              )
              .finally(() => setPending(false));
          }}
          disabled={pending}
        >
          <LogOut aria-hidden="true" />
          로그아웃
        </Button>
      )}
    </>
  );
}
