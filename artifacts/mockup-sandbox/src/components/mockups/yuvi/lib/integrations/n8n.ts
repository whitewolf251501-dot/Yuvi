// lib/integrations/n8n.ts — n8n compatibility client.
//
// IMPORTANT: this file does not know your Groq key, and n8n never sees
// it. It does not know n8n credentials either — those live entirely
// inside your local n8n instance's own credential store. This only speaks
// a small task-queue contract across the boundary:
//
//   app --(queued tasks)--> n8n --(status updates)--> app
//
// n8n is local-hosted and only reachable when it's running. Every function
// here fails soft: if n8n is unreachable, the app keeps working on Groq
// alone and tasks simply wait in the local queue.
//
// STATUS AS OF THIS PORT: n8n is currently offline (confirmed by Shlok).
// This file is the client only — nothing here assumes any specific n8n
// workflow exists or is running. Wire the webhook URL in Settings once
// the actual n8n flows are built and it's back online; until then every
// call below simply no-ops or queues locally, by design, not as a bug.
//
// Ported from aa-os-yuvi/integrations/n8n.js. Task queue (which the
// original delegated to global v7GetQueue/v7EnqueueTask/v7SaveQueue
// functions elsewhere in that app) is reimplemented here as a small
// self-contained localStorage queue, since this app has no equivalent.

import { safeGetLocal, safeSetLocal } from "../security";

const LS_WEBHOOK_URL = "yuvi_n8n_webhook_url";
const LS_QUEUE = "yuvi_n8n_task_queue";

export type TaskStatus = "queued" | "working" | "done" | "failed";
export interface N8nTask {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  status: TaskStatus;
}

function getQueue(): N8nTask[] {
  return safeGetLocal<N8nTask[]>(LS_QUEUE, []) || [];
}
function saveQueue(queue: N8nTask[]): void {
  safeSetLocal(LS_QUEUE, queue);
}

export function getWorkspaceUrl(): string {
  return localStorage.getItem(LS_WEBHOOK_URL)?.trim() || "http://localhost:5678";
}
export function setWorkspaceUrl(url: string): void {
  localStorage.setItem(LS_WEBHOOK_URL, url.trim());
}

/** Health-checks the configured n8n instance. Returns false (not an error) if unreachable. */
export async function pingWorkspace(): Promise<boolean> {
  const base = getWorkspaceUrl();
  if (!base) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`${base.replace(/\/$/, "")}/healthz`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false; // n8n offline — expected, not an error state
  }
}

export function enqueue(task: Omit<N8nTask, "status">): void {
  const queue = getQueue();
  queue.push({ ...task, status: "queued" });
  saveQueue(queue);
}

export function getTaskQueue(): N8nTask[] {
  return getQueue();
}

/** Attempts to push queued tasks to n8n and apply any status updates it returns. No-ops harmlessly if n8n is unreachable. */
export async function syncQueueWhenOnline(): Promise<void> {
  const queued = getQueue().filter((t) => t.status === "queued");
  if (!queued.length) return;
  const base = getWorkspaceUrl();
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/webhook/yuvi-tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: queued }),
      // No API keys attached — n8n authenticates its own downstream
      // services using its own stored credentials.
    });
    if (res.ok) {
      const result = (await res.json().catch(() => ({}))) as { updates?: { id: string; status: TaskStatus }[] };
      applyStatusUpdates(result.updates || []);
    }
  } catch {
    // n8n offline mid-sync — tasks stay 'queued', retried on next poll.
  }
}

function applyStatusUpdates(updates: { id: string; status: TaskStatus }[]): void {
  const queue = getQueue();
  updates.forEach((u) => {
    const t = queue.find((x) => x.id === u.id);
    if (t) t.status = u.status;
  });
  saveQueue(queue);
}
