import { NextResponse } from "next/server";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const detail = await repo.getTraceDetail(projectId, id);

  if (!detail) {
    return NextResponse.json({ error: "Trace not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
