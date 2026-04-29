import { Router } from "express";

const router = Router();

// GET /api/search?q=query
// Free web search using DuckDuckGo Instant Answer API — no key required
router.get("/search", async (req, res) => {
  const q = (req.query.q as string || "").trim();
  if (!q) return res.status(400).json({ error: "Query obrigatória" });

  try {
    const ddgUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1&t=devmobile-ide`;
    const r = await fetch(ddgUrl, {
      headers: { "Accept": "application/json", "User-Agent": "DevMobile-IDE/1.0" },
    });

    if (!r.ok) return res.status(502).json({ error: "Falha ao buscar" });

    const data = await r.json() as any;

    const results: { title: string; body: string; url: string }[] = [];

    // Abstract (main answer)
    if (data.AbstractText) {
      results.push({
        title: data.Heading || q,
        body: data.AbstractText,
        url: data.AbstractURL || data.AbstractSource || "",
      });
    }

    // Related topics
    for (const topic of (data.RelatedTopics || []).slice(0, 5)) {
      if (topic.Text && topic.FirstURL) {
        results.push({ title: topic.Text.split(" - ")[0] || q, body: topic.Text, url: topic.FirstURL });
      } else if (topic.Topics) {
        for (const sub of (topic.Topics || []).slice(0, 3)) {
          if (sub.Text && sub.FirstURL) {
            results.push({ title: sub.Text.split(" - ")[0] || q, body: sub.Text, url: sub.FirstURL });
          }
        }
      }
    }

    // Answer box
    if (data.Answer) {
      results.unshift({ title: "Resposta direta", body: data.Answer, url: "" });
    }

    // Definition
    if (data.Definition) {
      results.push({ title: "Definição", body: data.Definition, url: data.DefinitionURL || "" });
    }

    res.json({ query: q, results: results.slice(0, 8) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

export default router;
