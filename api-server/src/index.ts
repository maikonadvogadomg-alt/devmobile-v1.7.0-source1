import app, { codeServerProxy } from "./app";
import { logger } from "./lib/logger";
import { startCodeServer } from "./lib/codeServer";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Start code-server in the background (don't block API startup)
startCodeServer().catch((err) => {
  logger.error({ err }, "code-server failed to start — VS Code tab will be unavailable");
});

const server = app.listen(port, (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
});

// Proxy ALL WebSocket upgrades to code-server
// (code-server uses WS for its integrated terminal, live reload, extension host, etc.)
// Only exclude /api routes which are handled by the Express router
const proxyUpgrade = (codeServerProxy as any).upgrade as
  ((req: any, socket: any, head: any) => void) | undefined;

if (proxyUpgrade) {
  server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/")) {
      proxyUpgrade.call(codeServerProxy, req, socket, head);
    }
  });
} else {
  logger.warn("WebSocket proxy upgrade handler not available — VS Code terminal may not work");
}
