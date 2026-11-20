import { getDb, hasDatabaseUrl } from "./index";
import { PostgresTraceRepository, hashApiKey } from "./repository";
import { apiKeys, projects } from "./schema";
import { DEMO_API_KEY, DEMO_PROJECT_ID, SEED_BATCHES } from "./seed-data";

async function main() {
  if (!hasDatabaseUrl()) {
    console.log("No DATABASE_URL set; skipping Neon seed (in-memory demo mode auto-seeds).");
    return;
  }
  const db = getDb()!;
  await db
    .insert(projects)
    .values({ id: DEMO_PROJECT_ID, name: "Paaco Demo Project" })
    .onConflictDoNothing();

  await db
    .insert(apiKeys)
    .values({
      id: "key_demo_default",
      projectId: DEMO_PROJECT_ID,
      name: "Demo Playground & MCP Key",
      keyPrefix: `${DEMO_API_KEY.slice(0, 12)}...`,
      keyHash: hashApiKey(DEMO_API_KEY),
    })
    .onConflictDoNothing();

  const repo = new PostgresTraceRepository();
  for (const batch of SEED_BATCHES) {
    await repo.ingestBatch(DEMO_PROJECT_ID, batch);
  }
  console.log(`Seeded ${SEED_BATCHES.length} demo traces into ${DEMO_PROJECT_ID}.`);
}

main().catch((err) => {
  console.error("Failed to seed database:", err);
  process.exit(1);
});
