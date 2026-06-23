import { triggerDeploy } from "@/lib/control-plane";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const result = await triggerDeploy(id);
    return Response.json(result, { status: 202 });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
