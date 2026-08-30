// Real Groq connectivity test. This calls Groq's models endpoint directly from the browser
// with the key the user entered. It is intentionally the smallest real check possible:
// no chat completion, no cost, just "does this key authenticate."
//
// Caveat we surface honestly in the UI: calling Groq directly from the browser means the key
// only ever leaves the user's machine to Groq itself (never to us), but it does mean the key
// sits in this tab's memory/localStorage. A production deployment should proxy this call
// through the existing API server instead — this preview keeps the seam ready for that
// (this is the only function that would need to move).

export type GroqTestResult =
  | { ok: true; modelCount: number }
  | { ok: false; reason: string };

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type GroqChatResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

// Real chat completion call. Runs directly from the browser using the key the user saved
// in Settings → API & AI. Same caveat as testGroqConnection: the key stays in this tab's
// storage and is only ever sent to Groq directly — never to any server we control.
import { DEFAULT_GROQ_MODEL } from "./store";

export async function askGroq(
  messages: ChatMessage[],
  apiKey: string,
  model: string = DEFAULT_GROQ_MODEL,
): Promise<GroqChatResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, reason: "No Groq API key saved yet. Add one in Settings → API & AI." };
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0.6, max_tokens: 1024 }),
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Groq rejected this key (unauthorized). Check it in Settings." };
    }
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      if (res.status === 404 && errBody.includes("model_not_found")) {
        // Safe, human-readable message for the UI; the raw body (no keys/headers) still
        // goes to the console for developers debugging a bad model id.
        console.error("Groq model_not_found:", errBody.slice(0, 300));
        return { ok: false, reason: "YUVI could not access the selected Groq model. Check the selected model or Groq project access." };
      }
      return { ok: false, reason: `Groq returned an error (HTTP ${res.status}). ${errBody.slice(0, 160)}` };
    }
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return { ok: false, reason: "Groq responded but returned no message content." };
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "Could not reach Groq from the browser (network or CORS block)." };
  }
}

export async function testGroqConnection(apiKey: string): Promise<GroqTestResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, reason: "Enter a Groq API key first." };
  try {
    const res = await fetch("https://api.groq.com/openai/v1/models", {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` }
    });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: "Groq rejected this key (unauthorized)." };
    }
    if (!res.ok) {
      return { ok: false, reason: `Groq returned an error (HTTP ${res.status}).` };
    }
    const data = await res.json().catch(() => null);
    const count = Array.isArray(data?.data) ? data.data.length : 0;
    return { ok: true, modelCount: count };
  } catch {
    // Covers network failure and CORS rejection — in a browser-only deployment without the
    // API-server proxy, some networks/extensions can block this cross-origin call.
    return { ok: false, reason: "Could not reach Groq from the browser. If this persists, the call needs to go through the API server instead of directly from the browser." };
  }
}
