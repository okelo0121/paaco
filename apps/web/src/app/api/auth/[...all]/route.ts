import { toNextJsHandler } from "better-auth/next-js";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";

export async function GET(request: Request) {
  const auth = getAuth();
  if (!auth) {
    return NextResponse.json(
      { error: "Auth requires DATABASE_URL (running in zero-signup demo mode)." },
      { status: 503 },
    );
  }
  return toNextJsHandler(auth).GET(request);
}

export async function POST(request: Request) {
  const auth = getAuth();
  if (!auth) {
    return NextResponse.json(
      { error: "Auth requires DATABASE_URL (running in zero-signup demo mode)." },
      { status: 503 },
    );
  }
  return toNextJsHandler(auth).POST(request);
}
