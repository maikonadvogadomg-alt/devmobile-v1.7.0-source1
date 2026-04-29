import { spawn, type ChildProcess } from "child_process";
import { mkdir } from "fs/promises";
import { logger } from "./logger";

const CODE_SERVER_BIN =
  "/home/runner/workspace/.code-server/bin/code-server";

export const VSCODE_SESSION_ID = "vscode_workspace";
export const WORKSPACE_DIR = "/tmp/devmobile-sessions/vscode_workspace";
export const CODE_SERVER_PORT = 3001;

let proc: ChildProcess | null = null;
let ready = false;
let startPromise: Promise<void> | null = null;

async function waitForPort(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, {
        signal: AbortSignal.timeout(800),
      });
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`code-server not ready after ${timeoutMs}ms`);
}

// Lines from code-server that are pure noise — suppress completely
const NOISY_PATTERNS = [
  "i18next:",
  "debug:",
  "initAsync:",
  "keySeparator:",
  "nsSeparator:",
  "pluralSeparator:",
  "contextSeparator:",
  "saveMissing:",
  "interpolation:",
  "resources:",
  "showSupportNotice:",
  "ignoreJSONStructure:",
  "cacheInBuiltFormats:",
  "fallbackLng:",
  "supportedLngs:",
  "postProcess:",
  "returnNull:",
  "overloadTranslation",
  "escapeValue:",
  "format:",
  "nestingPrefix:",
  "maxReplaces:",
  "skipOnVariables:",
  "loadPath:",
  "ns:",
  "defaultNS:",
  "{",
  "}",
  "[reconnection-grace-time]",
];

function isNoisy(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  return NOISY_PATTERNS.some((p) => trimmed.includes(p));
}

export async function startCodeServer(): Promise<void> {
  if (ready) return;
  if (startPromise) return startPromise;

  startPromise = (async () => {
    await mkdir(WORKSPACE_DIR, { recursive: true });

    logger.info("Starting code-server on port " + CODE_SERVER_PORT);

    proc = spawn(
      CODE_SERVER_BIN,
      [
        "--port", String(CODE_SERVER_PORT),
        "--bind-addr", `127.0.0.1:${CODE_SERVER_PORT}`,
        "--auth", "none",
        "--disable-telemetry",
        "--disable-update-check",
        "--disable-workspace-trust",
        "--app-name", "VS Code",
        "--log", "warn",
        "--trusted-origins", "*",
        WORKSPACE_DIR,
      ],
      {
        env: {
          ...process.env,
          HOME: "/home/runner",
          SHELL: "/bin/bash",
          PATH:
            (process.env.PATH || "/usr/bin:/bin") +
            ":/usr/local/bin:/home/runner/workspace/.code-server/bin:/home/runner/.nix-profile/bin",
          PASSWORD: "",
          VSCODE_EXTENSIONS_GALLERY: JSON.stringify({
            serviceUrl: "https://marketplace.visualstudio.com/_apis/public/gallery",
            cacheUrl: "https://vscode.blob.core.windows.net/gallery/index",
            itemUrl: "https://marketplace.visualstudio.com/items",
          }),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    proc.stdout?.on("data", (d: Buffer) => {
      const text = d.toString();
      for (const line of text.split("\n")) {
        if (!isNoisy(line)) {
          logger.info("[code-server] " + line.trim());
        }
      }
    });

    proc.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
      for (const line of text.split("\n")) {
        if (!isNoisy(line)) {
          logger.warn("[code-server] " + line.trim());
        }
      }
    });

    proc.on("exit", (code) => {
      logger.warn("code-server exited with code " + code);
      ready = false;
      proc = null;
      startPromise = null;
      if (code !== 0) {
        setTimeout(() => {
          logger.info("Auto-restarting code-server…");
          startCodeServer().catch(() => {});
        }, 3000);
      }
    });

    await waitForPort(CODE_SERVER_PORT, 60_000);
    ready = true;
    logger.info("code-server is ready on port " + CODE_SERVER_PORT);
  })();

  return startPromise;
}

export function isCodeServerReady() {
  return ready;
}

process.on("exit", () => { if (proc) proc.kill("SIGTERM"); });
process.on("SIGTERM", () => { if (proc) proc.kill("SIGTERM"); });
