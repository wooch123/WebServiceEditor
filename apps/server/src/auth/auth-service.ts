import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type { AuthSessionDto } from "@webeditor/domain";
import { hashSync, verifySync } from "@node-rs/argon2";
import type { FastifyReply, FastifyRequest } from "fastify";

import type { AuthenticationConfig } from "../config.js";
import { ApiError, assertApi } from "../errors.js";
import type { MetadataDatabase } from "../metadata/database.js";

const SESSION_COOKIE = "__Host-webeditor_session";
const CSRF_COOKIE = "__Host-webeditor_csrf";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const PUBLIC_API_PATHS = new Set([
  "/api/v1/health",
  "/api/v1/ready",
  "/api/v1/auth/login",
  "/api/v1/auth/session",
]);

interface AccountRow {
  readonly id: string;
  readonly username: string;
  readonly password_hash: string;
  readonly disabled: number;
}

interface SessionRow {
  readonly id: string;
  readonly account_id: string;
  readonly username: string;
  readonly csrf_hash: string;
  readonly expires_at: string;
  readonly revoked_at: string | null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.byteLength === rightBuffer.byteLength &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function requestPath(request: FastifyRequest): string {
  return request.url.split("?", 1)[0] ?? request.url;
}

function clientAddress(request: FastifyRequest): string {
  return request.ip || "unknown";
}

export class AuthService {
  readonly #dummyPasswordHash: string | undefined;

  constructor(
    readonly metadataDatabase: MetadataDatabase,
    readonly config: AuthenticationConfig,
    readonly clock: () => Date = () => new Date(),
  ) {
    this.#dummyPasswordHash = config.required
      ? hashSync(randomBytes(32), {
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        })
      : undefined;
    this.#initializeAdministrator();
    this.#expireSessions();
  }

  session(request: FastifyRequest): AuthSessionDto {
    if (!this.config.required) {
      return {
        authenticationRequired: false,
        authenticated: true,
        username: "local",
        expiresAt: null,
      };
    }
    const session = this.#activeSession(request);
    return session === undefined
      ? {
          authenticationRequired: true,
          authenticated: false,
          username: null,
          expiresAt: null,
        }
      : {
          authenticationRequired: true,
          authenticated: true,
          username: session.username,
          expiresAt: session.expires_at,
        };
  }

  login(
    request: FastifyRequest,
    reply: FastifyReply,
    body: unknown,
  ): AuthSessionDto {
    assertApi(
      typeof body === "object" && body !== null && !Array.isArray(body),
      400,
      "INVALID_LOGIN_REQUEST",
      "Login request must be a JSON object",
    );
    const value = body as Record<string, unknown>;
    assertApi(
      typeof value.username === "string" &&
        value.username.length >= 3 &&
        value.username.length <= 64 &&
        typeof value.password === "string" &&
        value.password.length >= 1 &&
        value.password.length <= 1024,
      400,
      "INVALID_LOGIN_REQUEST",
      "Username or password format is invalid",
    );
    assertApi(
      this.config.required,
      409,
      "AUTHENTICATION_DISABLED",
      "Authentication is disabled for this local service",
    );
    this.#assertOrigin(request);
    const account = this.metadataDatabase.connection
      .prepare("SELECT * FROM admin_accounts WHERE username = ?")
      .get(value.username) as AccountRow | undefined;
    const credentialMatches = verifySync(
      account?.password_hash ?? this.#dummyPasswordHash ?? "",
      value.password,
    );
    const valid =
      account !== undefined && account.disabled === 0 && credentialMatches;
    if (!valid || account === undefined) {
      this.#audit(null, value.username, "LOGIN_FAILURE", request);
      throw new ApiError(
        401,
        "INVALID_CREDENTIALS",
        "Username or password is incorrect",
      );
    }
    const sessionToken = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const createdAt = this.clock();
    const expiresAt = new Date(
      createdAt.getTime() + this.config.sessionLifetimeHours * 60 * 60 * 1000,
    );
    this.metadataDatabase.transaction(() => {
      this.metadataDatabase.connection
        .prepare(
          `INSERT INTO auth_sessions
            (id, account_id, token_hash, csrf_hash, created_at, expires_at,
             last_seen_at, user_agent_hash, ip_hash)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          account.id,
          sha256(sessionToken),
          sha256(csrfToken),
          createdAt.toISOString(),
          expiresAt.toISOString(),
          createdAt.toISOString(),
          sha256(request.headers["user-agent"] ?? "unknown"),
          sha256(clientAddress(request)),
        );
      this.#audit(account.id, account.username, "LOGIN_SUCCESS", request);
    });
    this.#setCookies(reply, sessionToken, csrfToken, expiresAt);
    return {
      authenticationRequired: true,
      authenticated: true,
      username: account.username,
      expiresAt: expiresAt.toISOString(),
    };
  }

  logout(request: FastifyRequest, reply: FastifyReply): void {
    const sessionToken = request.cookies[SESSION_COOKIE];
    if (typeof sessionToken === "string") {
      const session = this.#activeSession(request);
      this.metadataDatabase.connection
        .prepare(
          "UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL",
        )
        .run(this.clock().toISOString(), sha256(sessionToken));
      if (session !== undefined) {
        this.#audit(session.account_id, session.username, "LOGOUT", request);
      }
    }
    this.#clearCookies(reply);
  }

  guard(request: FastifyRequest): void {
    if (!this.config.required || !requestPath(request).startsWith("/api/v1")) {
      return;
    }
    if (PUBLIC_API_PATHS.has(requestPath(request))) return;
    const session = this.#activeSession(request);
    if (session === undefined) {
      this.#audit(null, null, "AUTHORIZATION_REJECTED", request);
      throw new ApiError(401, "AUTHENTICATION_REQUIRED", "Sign in is required");
    }
    if (!MUTATING_METHODS.has(request.method)) return;
    try {
      this.#assertOrigin(request);
      const header = request.headers["x-csrf-token"];
      const cookie = request.cookies[CSRF_COOKIE];
      assertApi(
        typeof header === "string" &&
          typeof cookie === "string" &&
          safeEqual(header, cookie) &&
          safeEqual(sha256(header), session.csrf_hash),
        403,
        "CSRF_TOKEN_INVALID",
        "The request could not be verified",
      );
    } catch (error) {
      this.#audit(
        session.account_id,
        session.username,
        "CSRF_REJECTED",
        request,
      );
      throw error;
    }
  }

  #initializeAdministrator(): void {
    if (!this.config.required) return;
    const existing = this.metadataDatabase.connection
      .prepare("SELECT id FROM admin_accounts LIMIT 1")
      .get();
    if (existing !== undefined) return;
    const password = this.config.adminPassword;
    if (password === undefined) {
      throw new Error("Administrator password is required");
    }
    const now = this.clock().toISOString();
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO admin_accounts
          (id, username, password_hash, disabled, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      )
      .run(
        randomUUID(),
        this.config.adminUsername,
        hashSync(password, {
          memoryCost: 19_456,
          timeCost: 2,
          parallelism: 1,
        }),
        now,
        now,
      );
  }

  #activeSession(request: FastifyRequest): SessionRow | undefined {
    const token = request.cookies[SESSION_COOKIE];
    if (typeof token !== "string" || token.length < 32 || token.length > 128) {
      return undefined;
    }
    const now = this.clock().toISOString();
    const session = this.metadataDatabase.connection
      .prepare(
        `SELECT auth_sessions.id, auth_sessions.account_id,
                admin_accounts.username, auth_sessions.csrf_hash,
                auth_sessions.expires_at, auth_sessions.revoked_at
         FROM auth_sessions
         JOIN admin_accounts ON admin_accounts.id = auth_sessions.account_id
         WHERE auth_sessions.token_hash = ?
           AND auth_sessions.revoked_at IS NULL
           AND auth_sessions.expires_at > ?
           AND admin_accounts.disabled = 0`,
      )
      .get(sha256(token), now) as SessionRow | undefined;
    if (session !== undefined) {
      this.metadataDatabase.connection
        .prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?")
        .run(now, session.id);
    }
    return session;
  }

  #assertOrigin(request: FastifyRequest): void {
    assertApi(
      request.headers.origin === this.config.publicOrigin,
      403,
      "ORIGIN_NOT_ALLOWED",
      "Request origin is not allowed",
    );
  }

  #setCookies(
    reply: FastifyReply,
    sessionToken: string,
    csrfToken: string,
    expiresAt: Date,
  ): void {
    const common = {
      path: "/",
      secure: this.config.secureCookies,
      sameSite: "strict" as const,
      expires: expiresAt,
    };
    reply.setCookie(SESSION_COOKIE, sessionToken, {
      ...common,
      httpOnly: true,
      priority: "high",
    });
    reply.setCookie(CSRF_COOKIE, csrfToken, {
      ...common,
      httpOnly: false,
      priority: "high",
    });
  }

  #clearCookies(reply: FastifyReply): void {
    const options = {
      path: "/",
      secure: this.config.secureCookies,
      sameSite: "strict" as const,
    };
    reply.clearCookie(SESSION_COOKIE, options);
    reply.clearCookie(CSRF_COOKIE, options);
  }

  #audit(
    accountId: string | null,
    username: string | null,
    action: string,
    request: FastifyRequest,
  ): void {
    this.metadataDatabase.connection
      .prepare(
        `INSERT INTO auth_events
          (id, account_id, username, action, ip_hash, created_at, detail_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        accountId,
        username,
        action,
        sha256(clientAddress(request)),
        this.clock().toISOString(),
        JSON.stringify({ method: request.method, path: requestPath(request) }),
      );
  }

  #expireSessions(): void {
    const now = this.clock().toISOString();
    this.metadataDatabase.connection
      .prepare(
        "UPDATE auth_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at <= ?",
      )
      .run(now, now);
  }
}
