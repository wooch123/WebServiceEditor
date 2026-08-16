import type { FastifyInstance } from "fastify";

import type { AuthService } from "../auth/auth-service.js";

export async function registerAuthRoutes(
  server: FastifyInstance,
  options: { readonly authService: AuthService },
): Promise<void> {
  server.get("/api/v1/auth/session", async (request) => ({
    session: options.authService.session(request),
  }));

  server.post(
    "/api/v1/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => ({
      session: options.authService.login(request, reply, request.body),
    }),
  );

  server.post("/api/v1/auth/logout", async (request, reply) => {
    options.authService.logout(request, reply);
    return reply.code(204).send();
  });
}
