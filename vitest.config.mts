import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    coverage: {
      include: ["src/**"],
      thresholds: { statements: 85, branches: 85, functions: 85, lines: 85 },
    },
  },
});
