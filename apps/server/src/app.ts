import Fastify, { type FastifyInstance } from "fastify";

import { resolveMetadataDatabasePath } from "./config.js";
import { MetadataDatabase } from "./metadata/database.js";
import { registerSystemRoutes } from "./routes/system.js";

export interface BuildServerOptions {
  readonly logger?: boolean;
  readonly metadataDatabasePath?: string;
}

export function buildServer(options: BuildServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const metadataDatabase = new MetadataDatabase(
    resolveMetadataDatabasePath(options.metadataDatabasePath),
  );

  app.addHook("onClose", async () => {
    metadataDatabase.close();
  });
  void app.register(registerSystemRoutes, { metadataDatabase });

  return app;
}
