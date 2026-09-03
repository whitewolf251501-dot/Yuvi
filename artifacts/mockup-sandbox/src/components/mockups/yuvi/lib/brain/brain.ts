// lib/brain/brain.ts — single AI execution path. Chat messages route
// through here: handle() tries a deterministic skill dispatch first
// (intentDetector → skillOrchestrator, no AI call), and chat() is the
// composed-prompt fallback for everything else, grounded by
// promptComposer's real skills list.
//
// Ported from aa-os-yuvi/brain/brain.js, adapted to call askGroq (this
// app's existing Groq wrapper, itself routed through the server-side proxy
// from Phase 1) instead of a separate YuviGroq module, and to skip the
// retry/timeout wrapper's dependency on a global logger that doesn't exist
// here (console is used directly instead).

import { askGroq, type ChatMessage } from "../groq";
import { emit } from "../eventBus";
import { detect } from "./intentDetector";
import { execute as executeSkill, runChain as runSkillChain, type ChainStep } from "./skillOrchestrator";
import { compose, type PromptMode } from "./promptComposer";

const MAX_RETRY = 3;
const TIMEOUT_MS = 30000;
let _pending = false;

async function withRetry<T>(fn: () => Promise<T>, n: number): Promise<T> {
  let err: unknown;
  for (let i = 0; i < n; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      if (i < n - 1) {
        const ms = Math.min(1000 * 2 ** i, 8000);
        console.warn(`[brain] Retry ${i + 1}/${n} in ${ms}ms:`, e instanceof Error ? e.message : e);
        await new Promise((r) => setTimeout(r, ms));
      }
    }
  }
  throw err;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`AI timed out after ${ms / 1000}s`)), ms)),
  ]);
}

export interface ChatOpts {
  mode?: PromptMode;
  extraContext?: string;
  history?: ChatMessage[];
  apiKey: string;
  modelId: string;
  temperature?: number;
  retries?: number;
  timeout?: number;
}

async function _execute(messages: ChatMessage[], opts: ChatOpts): Promise<string> {
  if (_pending) throw new Error("Please wait for the current response to finish.");
  _pending = true;
  const t0 = Date.now();
  emit("brain.chat.start", { mode: opts.mode || "chat" });
  try {
    const response = await withTimeout(
      withRetry(async () => {
        const result = await askGroq(messages, opts.apiKey, opts.modelId);
        if (!result.ok) throw new Error(result.reason);
        return result.text;
      }, opts.retries || MAX_RETRY),
      opts.timeout || TIMEOUT_MS,
    );
    const ms = Date.now() - t0;
    emit("brain.chat.complete", { mode: opts.mode || "chat", ms, chars: response.length });
    return response;
  } catch (e) {
    emit("brain.chat.error", { error: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally {
    _pending = false;
  }
}

/** Intent → Skill, no AI call. Returns null if the message doesn't match a known intent. */
export async function handle(message: string): Promise<string | null> {
  const intent = detect(message);
  if (!intent) return null;
  const result = await executeSkill(intent.id, intent.args);
  if (result === null) return null;
  emit("brain.intent.handled", { intent: intent.id });
  return typeof result === "string" ? result : JSON.stringify(result, null, 2);
}

/** Composed path: caller → Brain → PromptComposer → Groq. This is the fallback when handle() finds no matching intent. */
export async function chat(userMessage: string, opts: ChatOpts): Promise<string> {
  if (!userMessage?.trim()) throw new Error("Cannot send empty message.");
  const sys = compose({ mode: opts.mode || "chat", extraContext: opts.extraContext || "" });
  const history = Array.isArray(opts.history) ? opts.history.slice(-10) : [];
  const messages: ChatMessage[] = [{ role: "system", content: sys }, ...history, { role: "user", content: userMessage.trim() }];
  return _execute(messages, { ...opts, mode: opts.mode || "chat" });
}

/** Raw path: caller builds messages directly (bypasses promptComposer). */
export async function rawChat(messages: ChatMessage[], opts: ChatOpts): Promise<string> {
  if (!messages?.length) throw new Error("rawChat requires a non-empty messages array.");
  return _execute(messages, opts);
}

export async function runChain(steps: ChainStep[]) {
  return runSkillChain(steps);
}

export function isPending(): boolean {
  return _pending;
}
