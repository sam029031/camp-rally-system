import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // DB 測試會打真的 Postgres：同一個檔案內依序執行
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
