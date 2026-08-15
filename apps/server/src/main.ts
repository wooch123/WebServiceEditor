import { buildServer } from "./app.js";
import { SERVER_HOST, SERVER_PORT } from "./config.js";

const app = buildServer({ logger: true });

try {
  await app.listen({ host: SERVER_HOST, port: SERVER_PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
