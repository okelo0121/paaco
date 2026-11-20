import { getRepository } from "../db/repository";

export async function resolveRequestProjectId(request: Request): Promise<string> {
  const headerKey = request.headers.get("x-paaco-key");
  const auth = request.headers.get("authorization");
  const bearer = auth?.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : null;
  const repo = getRepository();
  return repo.resolveProjectIdForApiKey(headerKey ?? bearer);
}
