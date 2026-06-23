import { createProject } from "@/lib/control-plane";

// Browser → here → control plane (keeps the orchestrator private).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body?.name || !body?.repo_url) {
      return Response.json(
        { error: "name and repo_url are required" },
        { status: 400 },
      );
    }
    const project = await createProject(body);
    return Response.json({ project }, { status: 201 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
