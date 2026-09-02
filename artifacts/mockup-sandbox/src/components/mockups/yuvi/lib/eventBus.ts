// lib/eventBus.ts — minimal pub/sub so Skills (and other modules) can react
// to each other without direct coupling, plus a persisted event log.
//
// Ported from aa-os-yuvi/brain/eventBus.js. Module-level singleton, same
// as the original's window.YuviBus — one bus per page load.

export interface EventRecord<TPayload = unknown> {
  type: string;
  payload: TPayload;
  ts: string;
}

type Handler = (record: EventRecord) => void;

const listeners = new Map<string, Set<Handler>>();
const LOG_KEY = "yuvi_event_log";
const MAX_LOG = 500;

function safeParseLog(): EventRecord[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as EventRecord[]) : [];
  } catch (e) {
    console.warn("[eventBus] Corrupt yuvi_event_log — resetting.", e instanceof Error ? e.message : e);
    return [];
  }
}

// Returns an unsubscribe function, same ergonomics as the original.
export function on(type: string, handler: Handler): () => void {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type)!.add(handler);
  return () => listeners.get(type)?.delete(handler);
}

export function emit<TPayload = unknown>(type: string, payload: TPayload = {} as TPayload): EventRecord<TPayload> {
  const record: EventRecord<TPayload> = { type, payload, ts: new Date().toISOString() };
  const log = safeParseLog();
  log.push(record as EventRecord);
  if (log.length > MAX_LOG) log.shift();
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    // storage full — non-fatal, in-memory listeners still fire below
  }

  (listeners.get(type) || new Set()).forEach((h) => {
    try {
      h(record);
    } catch (e) {
      console.error("[eventBus] handler error", type, e);
    }
  });
  (listeners.get("*") || new Set()).forEach((h) => {
    try {
      h(record);
    } catch (e) {
      console.error("[eventBus] wildcard handler error", e);
    }
  });
  return record;
}

export function getLog(type: string | null = null): EventRecord[] {
  const log = safeParseLog();
  return type ? log.filter((e) => e.type === type) : log;
}
