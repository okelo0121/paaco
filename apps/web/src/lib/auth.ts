import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { getDb } from "../db/index";
import * as schema from "../db/schema";

function createAuth(db: NonNullable<ReturnType<typeof getDb>>) {
  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "pg",
      schema,
    }),
    emailAndPassword: {
      enabled: true,
    },
    secret: process.env.BETTER_AUTH_SECRET || "paaco-local-dev-secret-change-in-prod",
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:3000",
  });
}

let cachedAuth: ReturnType<typeof createAuth> | null = null;

export function getAuth() {
  const db = getDb();
  if (!db) return null;
  if (!cachedAuth) {
    cachedAuth = createAuth(db);
  }
  return cachedAuth;
}
