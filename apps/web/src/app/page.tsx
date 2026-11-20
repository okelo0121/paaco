import { getRepository } from "@/db/repository";
import { DEMO_PROJECT_ID } from "@/db/seed-data";
import { ExplorerClient } from "@/components/explorer-client";

export const dynamic = "force-dynamic";

export default async function ExplorerPage() {
  const repo = getRepository();
  const [traces, economics] = await Promise.all([
    repo.listTraces(DEMO_PROJECT_ID, { limit: 25 }),
    repo.getUnitEconomics(DEMO_PROJECT_ID),
  ]);

  const initialDetail = traces[0]
    ? await repo.getTraceDetail(DEMO_PROJECT_ID, traces[0].id)
    : null;

  return (
    <ExplorerClient
      initialTraces={traces}
      initialDetail={initialDetail}
      initialEconomics={economics}
    />
  );
}
