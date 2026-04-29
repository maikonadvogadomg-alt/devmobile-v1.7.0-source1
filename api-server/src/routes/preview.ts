import { Router } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const router = Router();

// GET /api/preview/check?port=3000  — check if a port is open
router.get("/preview/check", async (req, res) => {
  const port = Number(req.query.port);
  if (!port || port < 1 || port > 65535) {
    res.status(400).json({ error: "port inválido" });
    return;
  }
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
    }).catch(() => null);
    res.json({ open: r !== null, status: r?.status ?? null, port });
  } catch {
    res.json({ open: false, port });
  }
});

// ALL /api/preview/port/:port/* — proxy to the running process on that port
// Example: GET /api/preview/port/3000/index.html → GET http://127.0.0.1:3000/index.html
router.use(
  "/preview/port/:port",
  (req, _res, next) => {
    const port = Number(req.params.port);
    if (!port || port < 1 || port > 65535) {
      next(new Error("Porta inválida"));
      return;
    }
    (req as any).__proxyPort = port;
    next();
  },
  createProxyMiddleware({
    router: (req) => `http://127.0.0.1:${(req as any).__proxyPort}`,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(/^\/api\/preview\/port\/\d+/, "") || "/",
    ws: true,
    on: {
      error: (_err, _req, res) => {
        if (typeof (res as any).status === "function") {
          const port = (_req as any).__proxyPort;
          (res as any)
            .status(503)
            .send(
              `<!DOCTYPE html><html><body style="background:#0a0a0a;color:#ccc;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px"><div style="font-size:48px">🚫</div><h2 style="margin:0">Porta ${port} fechada</h2><p style="color:#666">Nenhum servidor rodando nesta porta.<br>Execute seu app no terminal primeiro.</p><button onclick="location.reload()" style="background:#007acc;color:#fff;border:0;padding:10px 20px;border-radius:8px;font-size:14px;cursor:pointer;margin-top:8px">↺ Tentar novamente</button></body></html>`,
            );
        }
      },
    },
  }),
);

export default router;
