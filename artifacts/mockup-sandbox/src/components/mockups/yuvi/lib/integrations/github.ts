// lib/integrations/github.ts — thin client for the /api/github/memory
// server proxy (routes/github-memory.ts, Phase 2/5). This file never holds
// a token — only username/repo, which aren't secrets.
//
// Ported from aa-os-yuvi/integrations/github.js.

export interface GitHubConfig {
  username: string;
  repo: string;
}

const LS_USER = "yuvi_gh_user";
const LS_REPO = "yuvi_gh_repo";

export function getConfig(): GitHubConfig {
  return {
    username: localStorage.getItem(LS_USER) || "",
    repo: localStorage.getItem(LS_REPO) || "",
  };
}

export function setConfig(cfg: GitHubConfig): void {
  localStorage.setItem(LS_USER, cfg.username);
  localStorage.setItem(LS_REPO, cfg.repo);
}

export function isConfigured(): boolean {
  const { username, repo } = getConfig();
  return !!(username && repo);
}

async function proxyCall(body: Record<string, unknown>): Promise<{ content?: unknown; sha?: string | null }> {
  const res = await fetch("/api/github/memory", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `GitHub proxy error ${res.status}`);
  return data;
}

export async function readFile(path = "memory.json"): Promise<{ content: unknown; sha: string | null }> {
  const { username, repo } = getConfig();
  if (!username || !repo) throw new Error("GitHub not configured. Add username/repo in Settings.");
  const result = await proxyCall({ action: "read", username, repo, path });
  return { content: result.content ?? null, sha: result.sha ?? null };
}

export async function writeFile(content: unknown, path = "memory.json", message = "YUVI sync"): Promise<unknown> {
  const { username, repo } = getConfig();
  if (!username || !repo) throw new Error("GitHub not configured. Add username/repo in Settings.");
  return proxyCall({ action: "write", username, repo, path, content, message });
}
