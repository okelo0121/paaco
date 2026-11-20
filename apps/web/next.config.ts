import { withWorkflow } from "workflow/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@paaco/shared", "@paaco/sdk"],
};

export default withWorkflow(nextConfig);
