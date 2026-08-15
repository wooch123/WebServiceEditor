import { buildServer } from "./app.js";
import { resolveServerPort, SERVER_HOST } from "./config.js";

const app = buildServer({ logger: true });

try {
  await app.listen({ host: SERVER_HOST, port: resolveServerPort() });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
