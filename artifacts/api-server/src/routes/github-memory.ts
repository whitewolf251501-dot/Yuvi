import { Router, type IRouter, type Request, type Response } from "express";

/**
 * routes/github-memory.ts — server-side proxy for reading/writing files to
 * a GitHub-backed memory store.
 *
 * WHY THIS FILE EXISTS:
 * Without this, the browser would need to hold a GitHub Personal Access
 * Token client-side and call api.github.com directly — visible in the
 * Network tab on every memory read/write, same exposure problem the Groq
 * key had before routes/groq.ts. Instead, the browser sends
 * { action, username, repo, path, content, message } to this same-origin
 * endpoint with no token attached. This route reads GITHUB_TOKEN from a
 * server-only env var, talks to GitHub itself, and returns the result.
 *
 * Ported from aa-os-yuvi/api/github-proxy.js, adapted to Express + TypeScript.
 */

const router: IRouter = Router();

interface GithubMemoryBody {
  action?: "read" | "write";
  username?: string;
  repo?: string;
  path?: string;
  content?: unknown;
  message?: string;
}

router.post("/api/github/memory", async (req: Request, res: Response) => {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    res.status(500).json({
      error:
        "Server is missing GITHUB_TOKEN. Add it in your deployment's environment variables, then redeploy.",
    });
    return;
  }

  const { action, username, repo, path, content, message } = (req.body || {}) as GithubMemoryBody;

  if (!username || !repo || !path) {
    res.status(400).json({ error: "username, repo, and path are required." });
    return;
  }
  if (action !== "read" && action !== "write") {
    res.status(400).json({ error: 'action must be "read" or "write".' });
    return;
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(username)}/${encodeURIComponent(repo)}/contents/${path}`;
  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" };

  try {
    if (action === "read") {
      const ghRes = await fetch(url, { headers });
      if (ghRes.status === 404) {
        res.status(200).json({ content: null, sha: null });
        return;
      }
      if (!ghRes.ok) {
        const errText = await ghRes.text();
        res.status(ghRes.status).json({ error: `GitHub read error ${ghRes.status}: ${errText}` });
        return;
      }
      const data = (await ghRes.json()) as { content: string; sha: string };
      const decoded = Buffer.from(data.content, "base64").toString("utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(decoded);
      } catch {
        parsed = decoded;
      }
      res.status(200).json({ content: parsed, sha: data.sha });
      return;
    }

    // action === "write"
    // Always fetch the current sha right before writing — avoids relying on
    // a client-cached sha that might be stale, and avoids the client ever
    // needing to track sha values itself.
    let sha: string | null = null;
    const shaRes = await fetch(url, { headers });
    if (shaRes.ok) {
      const shaData = (await shaRes.json()) as { sha: string };
      sha = shaData.sha;
    }

    const encoded = Buffer.from(JSON.stringify(content, null, 2), "utf8").toString("base64");
    const putRes = await fetch(url, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: message || "YUVI sync",
        content: encoded,
        ...(sha ? { sha } : {}),
      }),
    });
    if (!putRes.ok) {
      const errText = await putRes.text();
      res.status(putRes.status).json({ error: `GitHub write error ${putRes.status}: ${errText}` });
      return;
    }
    const putData = await putRes.json();
    res.status(200).json(putData);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Proxy request failed." });
  }
});

export default router;
