import { TriageStatusSchema } from "@paaco/shared";
import { NextResponse } from "next/server";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";

export async function GET(request: Request) {
  const projectId = await resolveRequestProjectId(request);
  const url = new URL(request.url);
  const statusParam = url.searchParams.get("status");
  const parsedStatus = statusParam ? TriageStatusSchema.safeParse(statusParam) : null;

  const repo = getRepository();
  const alerts = await repo.listAlerts(
    projectId,
    parsedStatus?.success ? parsedStatus.data : undefined,
  );
  return NextResponse.json({ alerts });
}
