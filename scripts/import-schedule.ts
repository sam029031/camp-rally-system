/**
 * 排程匯入 CLI（第二十六節）。
 *
 *   npm run import:check                 只讀取 Excel＋套用 overrides＋validation，印出正規化排程表，不連資料庫
 *   npm run import                       validation 通過才寫入 Supabase（service role，只在本機執行）
 *   npm run import -- --reset            該遊戲已有打卡紀錄時，先清空執行期資料再匯入
 *   可選：--gold <path> --land <path>    指定 Excel 路徑（預設 data/ 下的兩份檔案）
 *
 * 結束碼：0 成功；1 validation 或匯入失敗；2 參數錯誤。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { config as loadDotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { PIN_LENGTH } from "../src/lib/constants";
import { describeOverrideOutcome } from "../src/lib/import/overrides";
import { formatIssues, formatScheduleTable } from "../src/lib/import/format";
import { loadScheduleFromFiles, resolveExcelPaths } from "../src/lib/import/excel";
import { ImportAbortError, importScheduleToDb } from "../src/lib/import/db";
import {
  adminIdentityExists,
  buildPinCsv,
  formatPinTable,
  isValidPin,
  pinCsvFileName,
  seedIdentities,
} from "../src/lib/import/identities";
import type { GameCode } from "../src/lib/types";

const USAGE = `用法：
  npm run import:check                     只做 validation（不連資料庫）
  npm run import                           validation 通過後匯入 Supabase
  npm run import -- --reset                清空已有的打卡等執行期資料後再匯入
  選項：--gold <黃金 Excel 路徑>  --land <大地 Excel 路徑>`;

interface CliArgs {
  check: boolean;
  reset: boolean;
  paths: Partial<Record<GameCode, string>>;
  help: boolean;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { check: false, reset: false, paths: {}, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf("=");
    const flag = a.startsWith("--") && eq > 0 ? a.slice(0, eq) : a;
    const inlineValue = a.startsWith("--") && eq > 0 ? a.slice(eq + 1) : null;
    const takeValue = (): string => {
      if (inlineValue !== null) return inlineValue;
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new UsageError(`${flag} 後面要接檔案路徑`);
      i++;
      return v;
    };
    switch (flag) {
      case "--check":
        args.check = true;
        break;
      case "--reset":
        args.reset = true;
        break;
      case "--gold":
        args.paths.gold = takeValue();
        break;
      case "--land":
        args.paths.land = takeValue();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new UsageError(`不認得的參數：${a}`);
    }
  }
  return args;
}

function log(line = ""): void {
  console.log(line);
}

function errorLine(line: string): void {
  console.error(line);
}

async function runImport(args: CliArgs, sourceFiles: Record<GameCode, string>, scheduleResult: ReturnType<typeof loadScheduleFromFiles>): Promise<number> {
  const schedule = scheduleResult.schedule;
  if (!schedule) return 1;

  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    loadDotenv({ path: envPath, quiet: true });
  } else {
    log(`提示：找不到 ${envPath}，改用目前的環境變數。`);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const eventDate = process.env.EVENT_DATE?.trim() || undefined;
  const adminPin = process.env.INITIAL_ADMIN_PIN?.trim() || null;

  const envErrors: string[] = [];
  if (!url) envErrors.push("NEXT_PUBLIC_SUPABASE_URL 未設定");
  if (!serviceKey) envErrors.push("SUPABASE_SERVICE_ROLE_KEY 未設定");
  if (adminPin !== null && !isValidPin(adminPin)) envErrors.push(`INITIAL_ADMIN_PIN 必須是 ${PIN_LENGTH} 位數字`);
  if (envErrors.length > 0) {
    errorLine("無法匯入，請先設定 .env.local：");
    envErrors.forEach((e) => errorLine(`  - ${e}`));
    return 1;
  }

  const client = createClient(url as string, serviceKey as string, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 寫入前先確認總召 PIN（尚未建立總召時必填）
  let adminExists: boolean;
  try {
    adminExists = await adminIdentityExists(client);
  } catch (err) {
    errorLine(`無法連線資料庫或讀取 identities：${err instanceof Error ? err.message : String(err)}`);
    errorLine("請確認 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 正確，且 migration 已全部執行。");
    return 1;
  }
  if (!adminExists && adminPin === null) {
    errorLine(`尚未建立總召身分，請在 .env.local 設定 INITIAL_ADMIN_PIN（${PIN_LENGTH} 位數字）。沒有寫入任何資料。`);
    return 1;
  }

  log("");
  log(`開始匯入 Supabase（${url}）${args.reset ? "，--reset：會先清空已有的執行期資料" : ""}`);
  let result;
  try {
    result = await importScheduleToDb(client, schedule, {
      reset: args.reset,
      eventDate,
      sourceFiles,
      overrideOutcomes: scheduleResult.overrideOutcomes,
      log,
    });
  } catch (err) {
    if (err instanceof ImportAbortError) {
      errorLine("");
      errorLine(`匯入中止：${err.message}`);
      return 1;
    }
    errorLine("");
    errorLine(`匯入失敗：${err instanceof Error ? err.message : String(err)}`);
    errorLine("已寫入的部分可以安全重跑（以自然鍵 upsert，不會產生重複）。修正問題後請重新執行 npm run import。");
    return 1;
  }

  let identities;
  try {
    identities = await seedIdentities(client, { teams: result.teams, stations: result.stations, adminPin });
  } catch (err) {
    errorLine("");
    errorLine(`排程已匯入，但建立 PIN 身分失敗：${err instanceof Error ? err.message : String(err)}`);
    errorLine("修正後重新執行 npm run import 即可（已存在的身分不會被覆蓋）。");
    return 1;
  }

  const created = identities.filter((r) => r.status === "created");
  log("");
  log(`PIN 身分：新建立 ${created.length} 組，已存在 ${identities.length - created.length} 組（已存在的 PIN 不變更）`);
  log(formatPinTable(identities));
  if (created.length > 0) {
    const file = path.resolve(process.cwd(), pinCsvFileName(new Date()));
    fs.writeFileSync(file, buildPinCsv(identities), "utf8");
    log("");
    log(`PIN 清單已存成本機檔案：${file}`);
    log("（含明碼，請妥善保管、不要上傳；資料庫只存 hash，之後在 /admin 只能重設、無法再查看）");
  } else {
    log("沒有新的 PIN，未產生 CSV。");
  }

  log("");
  log(`匯入完成。活動「${result.event.name}」，活動日期 ${result.event.event_date}${result.eventCreated ? "（新建立）" : ""}。`);
  return 0;
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      errorLine(err.message);
      errorLine(USAGE);
      return 2;
    }
    throw err;
  }
  if (args.help) {
    log(USAGE);
    return 0;
  }
  if (args.check && args.reset) {
    log("提示：--check 不連資料庫，--reset 會被忽略。");
  }

  const paths = resolveExcelPaths(args.paths);
  log(args.check ? "排程檢查（import:check，不連資料庫）" : "排程匯入（import）");
  log(`  黃金傳奇：${paths.gold}`);
  log(`  大地遊戲：${paths.land}`);

  // 讀取 Excel → 套用 overrides → validation
  const result = loadScheduleFromFiles(paths);
  if (result.overrideOutcomes.length > 0) {
    log("");
    log("Overrides：");
    result.overrideOutcomes.forEach((o) => log(`  ${describeOverrideOutcome(o)}`));
  }

  if (result.issues.length > 0 || !result.schedule) {
    errorLine("");
    errorLine(`Validation 失敗，共 ${result.issues.length} 個錯誤（不會匯入資料庫）：`);
    errorLine(formatIssues(result.issues));
    return 1;
  }

  log("");
  log(formatScheduleTable(result.schedule));
  log("");
  log("Validation 通過：兩份正式工作表的排程都合法。");

  if (args.check) {
    log("（import:check 不連線資料庫；確認無誤後執行 npm run import 寫入 Supabase）");
    return 0;
  }
  return runImport(args, paths, result);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    errorLine(`發生未預期的錯誤：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 1;
  });
