import { NextResponse } from "next/server";
import { handleDemoMerchantRequest, isDemoScenario } from "@/lib/demo-merchants";

async function routeRequest(
  request: Request,
  context: { params: Promise<{ scenario: string }> },
) {
  const { scenario } = await context.params;
  if (!isDemoScenario(scenario)) {
    return NextResponse.json({ error: `Unknown demo scenario: ${scenario}` }, { status: 404 });
  }
  return handleDemoMerchantRequest(scenario, request);
}

export { routeRequest as GET, routeRequest as POST };
