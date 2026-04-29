import { Router } from "express";

const router = Router();

const GH_API = "https://api.github.com";

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "DevMobile-IDE/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// GET /api/github/user
router.get("/github/user", async (req, res) => {
  const token = req.headers["x-github-token"] as string;
  if (!token) return res.status(401).json({ error: "Token não fornecido" });
  try {
    const r = await fetch(`${GH_API}/user`, { headers: ghHeaders(token) });
    if (!r.ok) return res.status(r.status).json({ error: "Token inválido ou expirado" });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// GET /api/github/repos
router.get("/github/repos", async (req, res) => {
  const token = req.headers["x-github-token"] as string;
  if (!token) return res.status(401).json({ error: "Token não fornecido" });
  try {
    const r = await fetch(`${GH_API}/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator`, {
      headers: ghHeaders(token),
    });
    if (!r.ok) return res.status(r.status).json({ error: "Falha ao buscar repositórios" });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/github/clone
// Body: { token, owner, repo } or { token, url } for public repos
router.post("/github/clone", async (req, res) => {
  const { token, owner: ownerIn, repo: repoIn, url } = req.body;

  let owner = ownerIn;
  let repo = repoIn;

  // Parse from URL if provided
  if (url && !owner) {
    const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!match) return res.status(400).json({ error: "URL inválida. Use: https://github.com/usuario/repositorio" });
    owner = match[1];
    repo = match[2].replace(/\.git$/, "");
  }

  if (!owner || !repo) return res.status(400).json({ error: "Informe o repositório" });

  const headers = token ? ghHeaders(token) : { "User-Agent": "DevMobile-IDE/1.0" };

  try {
    // Get repo info
    const repoR = await fetch(`${GH_API}/repos/${owner}/${repo}`, { headers });
    if (!repoR.ok) {
      const err = await repoR.json() as any;
      return res.status(repoR.status).json({ error: err.message || "Repositório não encontrado ou privado" });
    }
    const repoData = await repoR.json() as any;
    const branch = repoData.default_branch || "main";

    // Get file tree recursively
    const treeR = await fetch(`${GH_API}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers });
    if (!treeR.ok) return res.status(500).json({ error: "Falha ao obter árvore de arquivos" });
    const treeData = await treeR.json() as any;

    const items = (treeData.tree || []).filter((item: any) => item.type === "blob");
    const filesToFetch = items.slice(0, 80);

    const files: { path: string; content: string }[] = [];

    await Promise.all(
      filesToFetch.map(async (item: any) => {
        try {
          const contentR = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${item.path}?ref=${branch}`, { headers });
          if (contentR.ok) {
            const contentData = await contentR.json() as any;
            if (contentData.encoding === "base64" && contentData.content) {
              const decoded = Buffer.from(contentData.content.replace(/\n/g, ""), "base64").toString("utf-8");
              files.push({ path: item.path, content: decoded });
            }
          }
        } catch {}
      })
    );

    res.json({
      files,
      branch,
      repoName: repo,
      truncated: items.length > 80,
      total: items.length,
      fetched: files.length,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/github/create-repo
// Body: { token, name, description, isPrivate }
router.post("/github/create-repo", async (req, res) => {
  const { token, name, description, isPrivate } = req.body;
  if (!token || !name) return res.status(400).json({ error: "Parâmetros inválidos" });
  try {
    const r = await fetch(`${GH_API}/user/repos`, {
      method: "POST",
      headers: { ...ghHeaders(token), "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description: description || "",
        private: isPrivate || false,
        auto_init: false,
      }),
    });
    if (!r.ok) {
      const err = await r.json() as any;
      return res.status(r.status).json({ error: err.message || "Falha ao criar repositório" });
    }
    const data = await r.json() as any;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /api/github/push-files
// Body: { token, owner, repo, files: [{path, content}], message, branch? }
router.post("/github/push-files", async (req, res) => {
  const { token, owner, repo, files, message, branch = "main" } = req.body;
  if (!token || !owner || !repo || !files?.length) return res.status(400).json({ error: "Parâmetros inválidos" });

  try {
    let pushed = 0;
    const errors: string[] = [];

    for (const file of files) {
      try {
        let sha: string | undefined;
        const existingR = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`, {
          headers: ghHeaders(token),
        });
        if (existingR.ok) {
          const existingData = await existingR.json() as any;
          sha = existingData.sha;
        }

        const body: any = {
          message: message || `DevMobile: atualiza ${file.path}`,
          content: Buffer.from(file.content || "", "utf-8").toString("base64"),
          branch,
        };
        if (sha) body.sha = sha;

        const r = await fetch(`${GH_API}/repos/${owner}/${repo}/contents/${file.path}`, {
          method: "PUT",
          headers: { ...ghHeaders(token), "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (r.ok) {
          pushed++;
        } else {
          const err = await r.json() as any;
          errors.push(`${file.path}: ${err.message}`);
        }
      } catch (e) {
        errors.push(`${file.path}: ${String(e)}`);
      }
    }

    res.json({ pushed, total: files.length, errors });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
