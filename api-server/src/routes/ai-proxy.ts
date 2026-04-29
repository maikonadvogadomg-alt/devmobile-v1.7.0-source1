import { Router } from "express";
import { ai } from "@workspace/integrations-gemini-ai";

const router = Router();

const SYSTEM_PROMPT = `Você é um assistente de desenvolvimento profissional integrado ao DevMobile — um IDE no celular Android.

REGRAS:
1. Após cada ação confirmada, informe o que foi feito + próximo passo. Nunca pare sem dar feedback.
2. Termine propostas com perguntas de Sim/Não simples.
3. Para instalar bibliotecas, mostre o comando npm exato.
4. Se o usuário disser "OK", "pode", "faz" — execute e informe resultado + próximo passo.
5. Use ✅ para concluído, 📋 para planos, ⚠️ para avisos, 💡 para sugestões.
6. Seja conciso mas completo.`;

const ALLOWED_MODELS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
]);

router.post("/ai/chat", async (req, res) => {
  try {
    const { messages, systemPrompt, model: reqModel } = req.body as {
      messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
      systemPrompt?: string;
      model?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" });
      return;
    }

    const model = reqModel && ALLOWED_MODELS.has(reqModel) ? reqModel : "gemini-2.5-flash";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" as const : "user" as const,
        parts: [{ text: m.content }],
      }));

    const systemContext = systemPrompt || messages.find((m) => m.role === "system")?.content || SYSTEM_PROMPT;

    const stream = await ai.models.generateContentStream({
      model,
      contents: chatMessages,
      config: {
        maxOutputTokens: 8192,
        systemInstruction: systemContext,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) {
        res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro interno";
    res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
    res.end();
  }
});

router.options("/ai/chat", (_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.sendStatus(204);
});

export default router;
