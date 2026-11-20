import { NextResponse } from "next/server";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";

export async function GET(request: Request) {
  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const report = await repo.getUnitEconomics(projectId);
  return NextResponse.json(report);
}
