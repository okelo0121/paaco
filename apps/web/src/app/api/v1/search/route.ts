import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/db/repository";
import { resolveRequestProjectId } from "@/lib/api-auth";
import { runNaturalLanguageLogSearch } from "@/lib/log-finder/query-engine";

const SearchBodySchema = z.object({
  query: z.string().max(400).default(""),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = SearchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid search query" }, { status: 400 });
  }

  const projectId = await resolveRequestProjectId(request);
  const repo = getRepository();
  const result = await runNaturalLanguageLogSearch(repo, projectId, parsed.data.query);
  return NextResponse.json(result);
}
