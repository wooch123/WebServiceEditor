import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { buildServer } from "../../src/app.js";

const directories: string[] = [];
const origin = "https://webeditor.dove9999.com";

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function cookieValues(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return (Array.isArray(value) ? value : [value]).map(
    (cookie) => cookie.split(";", 1)[0] ?? cookie,
  );
}

describe("authentication, security, and performance", () => {
  it("protects the API with Argon2id, strict cookies, CSRF, and security headers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webeditor-auth-"));
    directories.push(directory);
    const databasePath = join(directory, "metadata.sqlite");
    const app = buildServer({
      metadataDatabasePath: databasePath,
      storageRoot: join(directory, "storage"),
      staticRoot: false,
      authentication: {
        required: true,
        adminUsername: "admin",
        adminPassword: "correct horse battery staple",
        publicOrigin: origin,
        secureCookies: true,
        sessionLifetimeHours: 8,
      },
    });

    try {
      const health = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(health.statusCode).toBe(200);
      expect(health.headers["content-security-policy"]).toContain(
        "frame-ancestors 'none'",
      );
      expect(health.headers["strict-transport-security"]).toContain(
        "max-age=31536000",
      );
      expect(health.headers["x-content-type-options"]).toBe("nosniff");
      expect(health.headers["x-frame-options"]).toBe("DENY");
      expect(health.headers["referrer-policy"]).toBe("no-referrer");

      expect(
        (await app.inject({ method: "GET", url: "/api/v1/projects" }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/auth/login",
            headers: { origin },
            payload: { username: "admin", password: "incorrect" },
          })
        ).statusCode,
      ).toBe(401);

      const login = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        headers: { origin },
        payload: {
          username: "admin",
          password: "correct horse battery staple",
        },
      });
      expect(login.statusCode).toBe(200);
      const setCookies = Array.isArray(login.headers["set-cookie"])
        ? login.headers["set-cookie"]
        : [login.headers["set-cookie"] ?? ""];
      expect(setCookies.join("\n")).toContain("__Host-webeditor_session=");
      expect(setCookies.join("\n")).toContain("HttpOnly");
      expect(setCookies.join("\n")).toContain("Secure");
      expect(setCookies.join("\n")).toContain("SameSite=Strict");
      const cookies = cookieValues(login.headers["set-cookie"]);
      const cookieHeader = cookies.join("; ");
      const csrfCookie = cookies.find((cookie) =>
        cookie.startsWith("__Host-webeditor_csrf="),
      );
      const csrfToken = decodeURIComponent(csrfCookie?.split("=")[1] ?? "");
      expect(csrfToken.length).toBeGreaterThan(32);

      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/projects",
            headers: { cookie: cookieHeader, origin },
            payload: { name: "CSRF rejected" },
          })
        ).statusCode,
      ).toBe(403);
      const created = await app.inject({
        method: "POST",
        url: "/api/v1/projects",
        headers: {
          cookie: cookieHeader,
          origin,
          "x-csrf-token": csrfToken,
        },
        payload: { name: "Protected project" },
      });
      expect(created.statusCode).toBe(201);

      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/v1/auth/logout",
            headers: {
              cookie: cookieHeader,
              origin,
              "x-csrf-token": csrfToken,
            },
          })
        ).statusCode,
      ).toBe(204);
      expect(
        (
          await app.inject({
            method: "GET",
            url: "/api/v1/projects",
            headers: { cookie: cookieHeader },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.close();
    }

    const database = new Database(databasePath, { readonly: true });
    const account = database
      .prepare("SELECT password_hash FROM admin_accounts WHERE username = ?")
      .get("admin") as { password_hash: string };
    expect(account.password_hash).toMatch(/^\$argon2id\$/u);
    expect(account.password_hash).not.toContain("correct horse battery staple");
    expect(
      database
        .prepare("SELECT action FROM auth_events ORDER BY created_at, rowid")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { action: "AUTHORIZATION_REJECTED" },
        { action: "LOGIN_FAILURE" },
        { action: "LOGIN_SUCCESS" },
        { action: "CSRF_REJECTED" },
        { action: "LOGOUT" },
      ]),
    );
    database.close();
  });

  it("limits login attempts and keeps the 100-project list within budget", async () => {
    const directory = await mkdtemp(join(tmpdir(), "webeditor-performance-"));
    directories.push(directory);
    const app = buildServer({
      metadataDatabasePath: join(directory, "metadata.sqlite"),
      storageRoot: join(directory, "storage"),
      staticRoot: false,
    });
    try {
      for (let index = 0; index < 100; index += 1) {
        const response = await app.inject({
          method: "POST",
          url: "/api/v1/projects",
          payload: { name: `Performance ${String(index).padStart(3, "0")}` },
        });
        expect(response.statusCode).toBe(201);
      }

      const listStartedAt = performance.now();
      const list = await app.inject({ method: "GET", url: "/api/v1/projects" });
      const listDurationMs = performance.now() - listStartedAt;
      expect(list.statusCode).toBe(200);
      expect(list.json<{ projects: unknown[] }>().projects).toHaveLength(100);
      expect(listDurationMs).toBeLessThanOrEqual(2_000);

      const searchStartedAt = performance.now();
      const search = await app.inject({
        method: "GET",
        url: "/api/v1/projects?q=099&sort=name&direction=asc",
      });
      const searchDurationMs = performance.now() - searchStartedAt;
      expect(search.statusCode).toBe(200);
      expect(search.json<{ projects: unknown[] }>().projects).toHaveLength(1);
      expect(searchDurationMs).toBeLessThanOrEqual(300);

      const summary = await app.inject({
        method: "GET",
        url: "/api/v1/performance/summary",
      });
      expect(summary.statusCode).toBe(200);
      expect(summary.json()).toMatchObject({ sampleCount: 102 });
      expect(
        summary
          .json<{ routes: Array<{ route: string; p95Ms: number }> }>()
          .routes.find((route) => route.route === "/api/v1/projects")?.p95Ms,
      ).toBeLessThanOrEqual(2_000);
    } finally {
      await app.close();
    }

    const limitedDirectory = await mkdtemp(
      join(tmpdir(), "webeditor-rate-limit-"),
    );
    directories.push(limitedDirectory);
    const limited = buildServer({
      metadataDatabasePath: join(limitedDirectory, "metadata.sqlite"),
      storageRoot: join(limitedDirectory, "storage"),
      staticRoot: false,
      authentication: {
        required: true,
        adminUsername: "admin",
        adminPassword: "correct horse battery staple",
        publicOrigin: origin,
        secureCookies: true,
        sessionLifetimeHours: 8,
      },
    });
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        statuses.push(
          (
            await limited.inject({
              method: "POST",
              url: "/api/v1/auth/login",
              headers: { origin },
              payload: { username: "admin", password: "incorrect" },
            })
          ).statusCode,
        );
      }
      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses[5]).toBe(429);
    } finally {
      await limited.close();
    }
  }, 15_000);
});
