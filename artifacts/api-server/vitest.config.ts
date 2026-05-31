import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // DB integration tests share one Postgres; don't run files in parallel.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
