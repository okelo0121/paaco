import { TriageRequestSchema } from "@paaco/shared";
import { NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import { getRepository } from "@/db/repository";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = TriageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid triage decision", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const repo = getRepository();
  const existing = await repo.getAlert(id);
  if (!existing) {
    return NextResponse.json({ error: "Alert not found" }, { status: 404 });
  }

  let workflowResumed = false;
  if (existing.workflowHookToken) {
    try {
      await resumeHook(existing.workflowHookToken, {
        status: parsed.data.status,
        note: parsed.data.note,
      });
      workflowResumed = true;
    } catch {
      workflowResumed = false;
    }
  }

  const updated = await repo.triageAlert(id, {
    status: parsed.data.status,
    note: parsed.data.note,
  });

  return NextResponse.json({
    ok: true,
    workflowResumed,
    alert: updated,
  });
}
