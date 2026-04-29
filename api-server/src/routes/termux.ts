import { Router } from "express";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execFile } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_FILE = path.resolve(__dirname, "../../../scripts/termux-server/server.mjs");

const router = Router();

// GET /api/termux/server.mjs — baixar o servidor standalone para Termux
router.get("/termux/server.mjs", async (req, res) => {
  try {
    const content = await readFile(SERVER_FILE, "utf8");
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="server.mjs"');
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.send(content);
  } catch {
    res.status(404).json({ error: "Arquivo não encontrado" });
  }
});

// GET /api/termux/setup.sh — script de instalação automática para Termux
router.get("/termux/setup.sh", (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "localhost:8080";
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const baseUrl = `${proto}://${host}`;

  const script = `#!/data/data/com.termux/files/usr/bin/bash
# DevMobile Server — Script de Instalação Automática
# Gerado em: ${new Date().toISOString()}
set -e

echo ""
echo "╔════════════════════════════════════╗"
echo "║   DevMobile — Instalação Termux    ║"
echo "╚════════════════════════════════════╝"
echo ""

echo "1/6  Atualizando pacotes..."
pkg update -y 2>/dev/null || true

echo "2/6  Instalando Node.js, git e curl..."
pkg install nodejs git curl -y

echo "3/6  Criando diretório do servidor..."
mkdir -p ~/devmobile-server
cd ~/devmobile-server

echo "4/6  Baixando servidor DevMobile..."
curl -fsSL -o server.mjs "${baseUrl}/api/termux/server.mjs"
echo '{"name":"devmobile-server","version":"1.7.0","type":"module","scripts":{"start":"node server.mjs"}}' > package.json

echo "5/6  Instalando dependências npm (express, cors)..."
npm install express cors --save 2>&1 | tail -5

echo "6/6  Instalando VS Code (code-server)..."
pkg install code-server -y 2>/dev/null || \\
  npm install -g code-server 2>&1 | tail -3 || \\
  echo "⚠️  code-server não instalado — aba VS Code indisponível"

# Script de inicialização rápida
cat > ~/start-devmobile.sh << 'STARTSCRIPT'
#!/data/data/com.termux/files/usr/bin/bash
cd ~/devmobile-server && node server.mjs
STARTSCRIPT
chmod +x ~/start-devmobile.sh

echo ""
echo "╔════════════════════════════════════╗"
echo "║  ✅  Instalação concluída!          ║"
echo "╚════════════════════════════════════╝"
echo ""
echo "Para iniciar o servidor:"
echo "  bash ~/start-devmobile.sh"
echo ""
echo "No app DevMobile:"
echo "  Configurações → Modo Termux → Ativar"
echo "  URL: http://localhost:8080"
echo ""
read -p "Iniciar agora? (s/N): " resp
if [[ "\\$resp" =~ ^[Ss]\\$ ]]; then
  node ~/devmobile-server/server.mjs
fi
`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="install-devmobile.sh"');
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.send(script);
});

// GET /api/termux/download — baixar código-fonte do DevMobile como ZIP
router.get("/termux/download", async (req, res) => {
  const ROOT = path.resolve(__dirname, "../../..");
  const MOBILE_DIR = path.join(ROOT, "artifacts", "mobile");
  const ZIP_PATH = "/tmp/devmobile-source.zip";

  const SKIP = ["node_modules", ".expo", "dist", ".git", "__pycache__", ".turbo"];

  const pyScript = `
import zipfile, os, pathlib, sys

src = pathlib.Path(sys.argv[1])
out = sys.argv[2]
skip = set(${JSON.stringify(SKIP)})

with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as zf:
    for f in src.rglob('*'):
        if any(p in skip for p in f.parts):
            continue
        if f.is_file():
            zf.write(f, 'devmobile/' + str(f.relative_to(src)))
print('ok')
`;

  await new Promise<void>((resolve, reject) => {
    execFile("python3", ["-c", pyScript, MOBILE_DIR, ZIP_PATH], (err) => {
      if (err) reject(err); else resolve();
    });
  });

  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", 'attachment; filename="devmobile-v1.7.0-source.zip"');
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-cache");

  const { createReadStream } = await import("fs");
  createReadStream(ZIP_PATH).pipe(res);
});

// GET /api/termux/info — info sobre o modo termux
router.get("/termux/info", (_req, res) => {
  res.json({
    version: "1.6.0",
    description: "DevMobile Server — Modo Termux (celular como servidor)",
    download: {
      server: "/api/termux/server.mjs",
      setup: "/api/termux/setup.sh",
    },
    requirements: {
      termux: "https://f-droid.org/packages/com.termux/",
      nodejs: "pkg install nodejs",
      dependencies: "npm install express cors",
      vscode: "pkg install code-server (opcional)",
    },
    install_command: "curl -fsSL /api/termux/setup.sh | bash",
  });
});

export { router as termuxRouter };
