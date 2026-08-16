import type { AuthSessionDto, LoginResponse } from "@webeditor/domain";

import { apiFetch } from "./api-fetch";

interface ErrorEnvelope {
  readonly error?: { readonly message?: unknown };
}

async function responseBody<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let envelope: ErrorEnvelope = {};
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      // The concise fallback covers malformed proxy responses.
    }
    throw new Error(
      typeof envelope.error?.message === "string"
        ? envelope.error.message
        : "인증 실패",
    );
  }
  return (await response.json()) as T;
}

export async function getAuthSession(): Promise<AuthSessionDto> {
  const response = await apiFetch("/api/v1/auth/session");
  return (await responseBody<{ session: AuthSessionDto }>(response)).session;
}

export async function login(
  username: string,
  password: string,
): Promise<AuthSessionDto> {
  const response = await apiFetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return (await responseBody<LoginResponse>(response)).session;
}

export async function logout(): Promise<void> {
  const response = await apiFetch("/api/v1/auth/logout", { method: "POST" });
  if (!response.ok) await responseBody<never>(response);
}
