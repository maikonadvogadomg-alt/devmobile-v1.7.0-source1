import { Router } from "express";
import { spawn } from "child_process";
import { mkdir, writeFile, readFile, readdir, stat } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const router = Router();
const BASE_DIR = "/tmp/devmobile-sessions";

// Full inherited PATH — includes node, npm, python, git, pip, nix-profile, cargo, etc.
const FULL_PATH = [
  "/home/runner/.local/bin",
  "/home/runner/.nix-profile/bin",
  "/home/runner/.cargo/bin",
  process.env.PATH || "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
].join(":");

function sanitizeSession(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-_]/g, "_").slice(0, 48) || "default";
}

async function ensureWorkspace(sessionId: string): Promise<string> {
  const dir = path.join(BASE_DIR, sanitizeSession(sessionId));
  await mkdir(dir, { recursive: true });
  return dir;
}

// Read the saved current-directory for a session (persists cd between commands)
async function getSessionCwd(workspaceDir: string): Promise<string> {
  const cwdFile = path.join(workspaceDir, ".devmobile_cwd");
  try {
    const saved = (await readFile(cwdFile, "utf8")).trim();
    if (saved && existsSync(saved)) return saved;
  } catch {}
  return workspaceDir;
}

async function saveSessionCwd(workspaceDir: string, cwd: string): Promise<void> {
  const cwdFile = path.join(workspaceDir, ".devmobile_cwd");
  await writeFile(cwdFile, cwd, "utf8").catch(() => {});
}

router.post("/terminal/exec", async (req, res) => {
  const { command, sessionId = "default" } = req.body as {
    command: string;
    sessionId?: string;
  };

  if (!command?.trim()) {
    res.status(400).json({ error: "command obrigatório" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  const safe = sanitizeSession(sessionId);
  const workspaceDir = await ensureWorkspace(safe);
  const currentCwd = await getSessionCwd(workspaceDir);

  const send = (type: string, data: string) => {
    try {
      res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
    } catch {}
  };

  const sendDone = (code: number) => {
    try {
      res.write(`data: ${JSON.stringify({ type: "exit", data: String(code) })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } catch {}
  };

  // Wrap command: run in correct cwd, then print new cwd on a unique marker line
  // Uses { } grouping (NOT subshell) so cd inside the command persists to the cwd capture
  const marker = `__CWD_${Date.now()}__`;
  const wrapped = [
    `cd ${JSON.stringify(currentCwd)} 2>/dev/null || true`,
    command,
    `_code=$?`,
    `printf '${marker}%s\\n' "$(pwd)"`,
    `exit $_code`,
  ].join("\n");

  const child = spawn("bash", ["-c", wrapped], {
    cwd: currentCwd,
    env: {
      ...process.env,
      HOME: workspaceDir,
      PATH: FULL_PATH,
      // Verbose output — user wants to see all download/install lines
      npm_config_loglevel: "verbose",
      npm_config_cache: path.join(workspaceDir, ".npm"),
      npm_config_prefix: workspaceDir,
      // Clear pnpm-specific configs that confuse npm
      npm_config_minimum_release_age: "",
      npm_config_npm_globalconfig: "",
      npm_config_verify_deps_before_run: "",
      npm_config__jsr_registry: "",
      npm_config_catalog: "",
      npm_config_recursive: "",
      npm_config_overrides: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const killTimer = setTimeout(() => {
    send("stdout", "\n⏱ Tempo limite atingido (2 horas).\n");
    child.kill("SIGKILL");
  }, 120 * 60_000);

  let stdoutBuf = "";

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    // Process complete lines only, keeping incomplete line in buffer
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop() ?? ""; // keep last incomplete line
    for (const line of lines) {
      if (line.startsWith(marker)) {
        // This is the cwd marker line — save new cwd, don't display
        const newCwd = line.slice(marker.length).trim();
        if (newCwd) saveSessionCwd(workspaceDir, newCwd);
      } else {
        send("stdout", line + "\n");
      }
    }
  });

  child.stderr.on("data", (chunk: Buffer) => {
    // Show stderr as regular output (not red) — npm warns, etc.
    send("stdout", chunk.toString());
  });

  child.on("close", (code) => {
    clearTimeout(killTimer);
    // Flush remaining buffer
    if (stdoutBuf && !stdoutBuf.startsWith(marker)) {
      send("stdout", stdoutBuf);
    }
    sendDone(code ?? 0);
  });

  child.on("error", (err) => {
    clearTimeout(killTimer);
    send("stdout", `Erro: ${err.message}\n`);
    sendDone(1);
  });

  req.on("close", () => {
    // Don't kill the process — nohup servers should keep running
    clearTimeout(killTimer);
    // Only kill if the process is still running (not a background process)
    // Background processes (nohup &) detach from stdin, so they survive
    try { child.kill("SIGTERM"); } catch {}
  });
});

router.post("/terminal/write", async (req, res) => {
  const { sessionId = "default", files } = req.body as {
    sessionId?: string;
    files: Array<{ path: string; content: string }>;
  };

  if (!Array.isArray(files)) {
    res.status(400).json({ error: "files deve ser um array" });
    return;
  }

  const cwd = await ensureWorkspace(sessionId);

  for (const file of files) {
    const safe = file.path.replace(/\.\./g, "").replace(/^\/+/, "");
    const dest = path.join(cwd, safe);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, file.content ?? "", "utf8");
  }

  res.json({ ok: true, cwd, count: files.length });
});

router.get("/terminal/ls", async (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const cwd = await ensureWorkspace(sessionId);

  try {
    const entries = await readdir(cwd);
    const details = await Promise.all(
      entries.map(async (name) => {
        const s = await stat(path.join(cwd, name)).catch(() => null);
        return { name, isDir: s?.isDirectory() ?? false, size: s?.size ?? 0 };
      })
    );
    res.json({ cwd, files: details });
  } catch {
    res.json({ cwd, files: [] });
  }
});

router.get("/terminal/read", async (req, res) => {
  const sessionId = (req.query.sessionId as string) || "default";
  const cwd = await ensureWorkspace(sessionId);

  async function collectFiles(
    dir: string,
    rel: string
  ): Promise<Array<{ path: string; content: string }>> {
    const entries = await readdir(dir).catch(() => [] as string[]);
    const results: Array<{ path: string; content: string }> = [];
    for (const name of entries) {
      if (name.startsWith(".devmobile_")) continue; // skip internal files
      const abs = path.join(dir, name);
      const relPath = rel ? `${rel}/${name}` : name;
      const s = await stat(abs).catch(() => null);
      if (!s) continue;
      if (s.isDirectory()) {
        const sub = await collectFiles(abs, relPath);
        results.push(...sub);
      } else if (s.size < 2_000_000) {
        const content = await readFile(abs, "utf8").catch(() => null);
        if (content !== null) results.push({ path: relPath, content });
      }
    }
    return results;
  }

  const files = await collectFiles(cwd, "");
  res.json({ ok: true, cwd, files });
});

router.delete("/terminal/session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const dir = path.join(BASE_DIR, sanitizeSession(sessionId));
  if (existsSync(dir)) {
    const { rm } = await import("fs/promises");
    await rm(dir, { recursive: true, force: true });
  }
  res.json({ ok: true });
});

export { router as terminalRouter };
