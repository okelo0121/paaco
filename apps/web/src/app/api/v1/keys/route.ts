import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";

const CreateKeySchema = z.object({
  name: z.string().min(1).max(80),
});

export async function GET(request: Request) {
  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const keys = await repo.listApiKeys(projectId);
  return NextResponse.json({ keys });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = CreateKeySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid key name" }, { status: 400 });
  }

  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const created = await repo.createApiKey(projectId, parsed.data.name);
  return NextResponse.json(created, { status: 201 });
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const keyId = url.searchParams.get("id");
  if (!keyId) {
    return NextResponse.json({ error: "Missing key id" }, { status: 400 });
  }
  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const revoked = await repo.revokeApiKey(projectId, keyId);
  return NextResponse.json({ ok: revoked });
}
