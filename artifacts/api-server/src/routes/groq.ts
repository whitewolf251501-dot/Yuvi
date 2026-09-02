import { Router, type IRouter, type Request, type Response } from "express";

/**
 * routes/groq.ts — server-side Groq chat proxy.
 *
 * WHY THIS FILE EXISTS:
 * Previously the frontend (lib/groq.ts) called api.groq.com directly from
 * the browser, meaning GROQ_API_KEY was visible in the Network tab on every
 * request. This route moves that call server-side: the browser now POSTs
 * messages to this same-origin endpoint with no key attached, this route
 * reads the real key from a server-only env var, calls Groq itself, and
 * returns the response. The key never reaches the browser.
 *
 * Ported from aa-os-yuvi/api/groq-chat.js, adapted to Express + TypeScript.
 */

const router: IRouter = Router();

interface GroqChatBody {
  messages?: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  testKey?: string; // Settings "Test Key" button only — never persisted server-side
}

router.post("/api/groq/chat", async (req: Request, res: Response) => {
  const { messages, model, temperature, max_tokens, testKey } =
    (req.body || {}) as GroqChatBody;

  const apiKey = testKey || process.env.GROQ_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Server is missing GROQ_API_KEY. Add it in your deployment's environment variables, then redeploy.",
    });
    return;
  }

  if (!Array.isArray(messages) || !messages.length) {
    res.status(400).json({ error: "messages array is required." });
    return;
  }

  try {
    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || "openai/gpt-oss-120b",
        messages,
        temperature: temperature ?? 0.7,
        max_tokens: max_tokens ?? 1024,
      }),
    });

    const data = await groqRes.json();

    if (!groqRes.ok) {
      res.status(groqRes.status).json({ error: data?.error?.message || "Groq API error." });
      return;
    }

    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Proxy request failed." });
  }
});

export default router;
