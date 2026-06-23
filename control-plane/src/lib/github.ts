import crypto from "node:crypto";
import { execa } from "execa";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Verify GitHub's X-Hub-Signature-256, computed over the RAW request body.
export function verifyGithubSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature || !secret) return false;
  const digest =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(digest);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface PushEvent {
  repoUrl: string;
  branch: string;
  sha: string;
}

// Pull the bits we need out of a GitHub push payload.
export function parsePushEvent(body: any): PushEvent | null {
  if (!body?.ref || !body?.after || !body?.repository) return null;
  return {
    repoUrl: body.repository.clone_url ?? body.repository.html_url,
    branch: String(body.ref).replace(/^refs\/heads\//, ""),
    sha: body.after,
  };
}

// Resolve a branch's current HEAD sha without cloning (for manual deploys).
export async function resolveSha(
  repoUrl: string,
  branch: string,
  token?: string,
): Promise<string> {
  const { stdout } = await execa("git", [
    "ls-remote",
    token ? authUrl(repoUrl, token) : repoUrl,
    `refs/heads/${branch}`,
  ]);
  const sha = stdout.split(/\s+/)[0];
  if (!sha) throw new Error(`could not resolve ${branch} on ${repoUrl}`);
  return sha;
}

// Clone a repo at an exact SHA into a fresh temp dir; returns the dir path.
export async function cloneAtSha(opts: {
  repoUrl: string;
  sha: string;
  token?: string;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "llama-build-"));
  const url = opts.token ? authUrl(opts.repoUrl, opts.token) : opts.repoUrl;
  await execa("git", ["init", "-q", dir]);
  await execa("git", ["-C", dir, "remote", "add", "origin", url]);
  // GitHub allows fetching a specific reachable commit.
  await execa("git", ["-C", dir, "fetch", "-q", "--depth", "1", "origin", opts.sha]);
  await execa("git", ["-C", dir, "checkout", "-q", "FETCH_HEAD"]);
  return dir;
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

function authUrl(repoUrl: string, token: string): string {
  return repoUrl.replace(/^https:\/\//, `https://x-access-token:${token}@`);
}
