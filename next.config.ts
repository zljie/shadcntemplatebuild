import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  // Template JSON is read at runtime (template library, SQLite seed); trace it into serverless bundles.
  outputFileTracingIncludes: { "/**": ["./templates/**/*.json"] },
};
export default config;
