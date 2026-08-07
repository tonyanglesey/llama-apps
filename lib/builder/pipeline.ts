// The full builder pipeline: prompt -> live URL. This is the thin conductor that
// wires the two NEW pieces (generate, publish) to the EXISTING deploy spine
// (createProject, triggerDeploy — already battle-tested in lib/control-plane).
//
//   generate  ── Claude → validated file tree
//   publish   ── new GitHub repo + initial commit
//   register  ── POST /projects { name, repo_url }   (existing)
//   deploy    ── POST /projects/:id/deploy { sha }    (existing)
//
// Each stage reports progress so a UI (or the CLI harness) can stream it. The
// heavy, slow part — build + container + Caddy — happens asynchronously inside
// the control plane; this returns once the deployment is queued, with the ids
// needed to follow its build logs.

import { generateApp, type GenerateInput, type GeneratedApp } from "./generate.js";
import { publishToGithub, type PublishResult } from "./publish.js";
import { createProject, triggerDeploy } from "../control-plane.js";

export type BuildStage =
  | "generating"
  | "publishing"
  | "registering"
  | "deploying"
  | "queued";

export interface BuildProgress {
  stage: BuildStage;
  detail?: string;
}

export interface BuildResult {
  app: GeneratedApp;
  repo: PublishResult;
  projectId: string;
  deploymentId: string;
  // Where it will be reachable once the build finishes. The control plane owns
  // the real hostname; this is the conventional <name>.<DEPLOY_DOMAIN> preview.
  previewUrl: string;
}

export interface BuildOptions extends GenerateInput {
  repoPrivate?: boolean;
  owner?: string; // GitHub org, if not the token's own user
  githubToken?: string;
  deployDomain?: string; // for the previewUrl hint only
  onProgress?: (p: BuildProgress) => void;
}

export async function buildApp(opts: BuildOptions): Promise<BuildResult> {
  const report = (stage: BuildStage, detail?: string) =>
    opts.onProgress?.({ stage, detail });

  // 1. Generate — the only step that can produce nonsense, so it's guarded
  //    hard inside generateApp() before we commit anything anywhere.
  report("generating");
  const app = await generateApp(opts);
  report("generating", `${app.name}: ${app.files.length} files`);

  // 2. Publish to a fresh repo the user owns.
  report("publishing");
  const repo = await publishToGithub({
    name: app.name,
    files: app.files,
    description: app.summary,
    private: opts.repoPrivate ?? true,
    owner: opts.owner,
    token: opts.githubToken,
  });
  report("publishing", repo.htmlUrl);

  // 3. Register the project with the deploy control plane.
  report("registering");
  const project = await createProject({
    name: app.name,
    repo_url: repo.repoUrl,
    default_branch: repo.branch,
  });
  report("registering", project.id);

  // 4. Trigger the first deploy at the exact SHA we just pushed.
  report("deploying");
  const { deployment } = await triggerDeploy(project.id, {
    branch: repo.branch,
    sha: repo.sha,
  });
  report("queued", deployment);

  const domain = opts.deployDomain ?? process.env.DEPLOY_DOMAIN ?? "apps.lla.ma";
  return {
    app,
    repo,
    projectId: project.id,
    deploymentId: deployment,
    previewUrl: `https://${app.name}.${domain}`,
  };
}
