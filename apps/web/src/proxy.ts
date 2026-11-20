import { NextResponse, type NextRequest } from "next/server";

export function proxy(_request: NextRequest) {
  // Zero-signup demo mode allows public exploration across Explorer, Dashboard, Docs, and MCP.
  // When Better Auth + DATABASE_URL are configured, session cookies govern workspace mutations.
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Explicitly exclude Vercel Workflow internals, static assets, Explorer, Docs,
     * MCP Server, Demo Merchants, Playground, and Public Ingest/Read APIs.
     */
    "/((?!\\.well-known/workflow|_next/static|_next/image|favicon.ico|api/mcp|api/v1|api/playground|api/demo-merchants|api/auth|docs|$).*)",
  ],
};
