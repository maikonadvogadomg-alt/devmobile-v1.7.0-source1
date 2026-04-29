import { Router } from "express";
import { Client } from "pg";

const dbRouter = Router();

// POST /api/db/test-connection
dbRouter.post("/db/test-connection", async (req, res) => {
  const { connectionString } = req.body as { connectionString?: string };
  if (!connectionString || typeof connectionString !== "string") {
    return res.status(400).json({ error: "connectionString obrigatória" });
  }
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 8000,
    ssl: connectionString.includes("neon.tech") || connectionString.includes("ssl=true")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  try {
    await client.connect();
    const result = await client.query("SELECT version()");
    await client.end();
    const version = (result.rows[0]?.version as string | undefined) ?? "PostgreSQL OK";
    return res.json({ ok: true, version: version.split(" ").slice(0, 2).join(" ") });
  } catch (err: unknown) {
    try { await client.end(); } catch {}
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ ok: false, error: msg });
  }
});

// POST /api/db/execute
dbRouter.post("/db/execute", async (req, res) => {
  const { connectionString, query } = req.body as { connectionString?: string; query?: string };
  if (!connectionString || !query) {
    return res.status(400).json({ error: "connectionString e query são obrigatórias" });
  }
  const lowerQuery = query.trim().toLowerCase();
  const dangerousPatterns = /^\s*(drop\s+database|drop\s+schema|truncate\s+all|delete\s+from\s+\S+\s*;?\s*$)/i;
  if (dangerousPatterns.test(lowerQuery)) {
    return res.status(400).json({ error: "Comando perigoso bloqueado por segurança." });
  }
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    ssl: connectionString.includes("neon.tech") || connectionString.includes("ssl=true")
      ? { rejectUnauthorized: false }
      : undefined,
  });
  try {
    await client.connect();
    const result = await client.query(query);
    await client.end();
    return res.json({
      rows: result.rows,
      rowCount: result.rowCount,
      command: result.command,
    });
  } catch (err: unknown) {
    try { await client.end(); } catch {}
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: msg });
  }
});

export default dbRouter;
