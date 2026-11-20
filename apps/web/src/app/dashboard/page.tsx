import { hasDatabaseUrl } from "@/db";
import { getRepository } from "@/db/repository";
import { DEMO_PROJECT_ID } from "@/db/seed-data";
import { DashboardClient } from "@/components/dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const repo = getRepository();
  const [economics, alerts, keys] = await Promise.all([
    repo.getUnitEconomics(DEMO_PROJECT_ID),
    repo.listAlerts(DEMO_PROJECT_ID),
    repo.listApiKeys(DEMO_PROJECT_ID),
  ]);

  return (
    <DashboardClient
      initialEconomics={economics}
      initialAlerts={alerts}
      initialKeys={keys}
      databaseConfigured={hasDatabaseUrl()}
    />
  );
}
