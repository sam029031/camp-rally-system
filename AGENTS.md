<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 專案規則（宿營跑關即時管理系統）

- 規格全文：`docs/SPEC.md`；模組分工與介面：`docs/ARCHITECTURE.md`。動手前先讀這兩份與你負責的部分。
- 合約檔（`src/lib/types.ts`、`src/lib/derive/types.ts`、`src/lib/constants.ts`、`src/lib/errors.ts`、`src/lib/api/contract.ts`、
  `supabase/migrations/20260925000100_schema.sql`）不可改既有語意；需要新增欄位／型別時可以新增，並在回報中說明。
- 所有使用者看得到的文字用繁體中文。時間一律 Asia/Taipei 顯示、app 時鐘（見 ARCHITECTURE 第 2 節），不可用 `Date.now()` 當「現在」。
- 狀態不落地：任何狀態都由 `deriveGame()` 推導，不在 DB / localStorage 存狀態。
- 指令：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`npm run import:check`。
- 專案路徑可能含中文（例如 Windows 的 `D:\跑關`），指令與程式都要能處理。
