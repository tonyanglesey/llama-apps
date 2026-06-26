// Server-side client for the lla.ma Apps control plane (the private orchestrator).
// The browser NEVER calls the control plane directly: Server Components call these
// helpers, and Client Components go through Next route handlers (app/api/*) that
// proxy here. Configure CONTROL_PLANE_URL (a loopback/tunnel address) in .env.local.

export const controlPlaneBase =
  process.env.CONTROL_PLANE_URL ?? "http://127.0.0.1:8787";

export interface Project {
  id: string;
  name: string;
  repo_url: string;
  default_branch: string;
  production_domain: string | null;
  created_at: string;
}

export type DeploymentStatus =
  | "queued"
  | "building"
  | "running"
  | "failed"
  | "cancelled";

export interface Deployment {
  id: string;
  project_id: string;
  status: DeploymentStatus;
  git_branch: string;
  git_sha: string;
  url: string | null;
  error?: string | null;
  created_at: string;
}

async function cp<T>(path: string, init?: RequestInit): Promise<T> {
  // Always fresh — the dashboard reflects live deploy state (Next 16 fetch is
  // uncached by default, but we're explicit).
  const res = await fetch(`${controlPlaneBase}${path}`, {
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `control plane ${path} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  return res.json() as Promise<T>;
}

export async function getProjects(): Promise<Project[]> {
  return (await cp<{ projects: Project[] }>("/projects")).projects ?? [];
}

export async function getDeployments(): Promise<Deployment[]> {
  return (await cp<{ deployments: Deployment[] }>("/deployments")).deployments ?? [];
}

export interface ProjectDetail extends Project {
  env: Record<string, string>;
}

export async function getProject(
  id: string,
): Promise<{ project: ProjectDetail; deployments: Deployment[] } | null> {
  try {
    return await cp<{ project: ProjectDetail; deployments: Deployment[] }>(
      `/projects/${id}`,
    );
  } catch (err) {
    if (String((err as Error).message).includes("404")) return null;
    throw err;
  }
}

export interface NewProjectInput {
  name: string;
  repo_url: string;
  default_branch?: string;
  production_domain?: string;
}

// Used by route handlers (server-side proxies for the browser).
export async function createProject(input: NewProjectInput): Promise<Project> {
  const r = await cp<{ project: Project }>("/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return r.project;
}

export async function triggerDeploy(
  projectId: string,
): Promise<{ deployment: string }> {
  return cp<{ deployment: string }>(`/projects/${projectId}/deploy`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

// Partial project update — only the provided fields are changed. `env` replaces
// the whole env map. Changes apply on the next deploy.
export interface ProjectUpdate {
  name?: string;
  default_branch?: string;
  production_domain?: string | null;
  env?: Record<string, string>;
}

export async function updateProject(
  projectId: string,
  patch: ProjectUpdate,
): Promise<Project> {
  const r = await cp<{ project: Project }>(`/projects/${projectId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  return r.project;
}

// Delete a project and tear down its infra (containers + route + cascaded rows).
export async function deleteProject(projectId: string): Promise<void> {
  await cp<{ ok: true }>(`/projects/${projectId}`, { method: "DELETE" });
}

export interface DeploymentDetail extends Deployment {
  container_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  project_name: string;
  repo_url: string;
  production_domain: string | null;
}

export async function getDeployment(
  id: string,
): Promise<DeploymentDetail | null> {
  try {
    return (await cp<{ deployment: DeploymentDetail }>(`/deployments/${id}`))
      .deployment;
  } catch (err) {
    if (String((err as Error).message).includes("404")) return null;
    throw err;
  }
}
