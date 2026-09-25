/**
 * 完整匯入流程（第五、二十六、三十節）：讀取 → overrides → validation。
 * 在記憶體修改 grid，不依賴 Excel 目前 C5 的內容，也不修改 Excel 檔。
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { buildScheduleFromReads, loadScheduleFromFiles, readOfficialSheet, resolveExcelPaths } from "@/lib/import/excel";
import { buildPinCsv, pinCsvFileName, randomPin, stationIdentityLabel } from "@/lib/import/identities";
import {
  SCHEDULE_OVERRIDES,
  applyOverrides,
  buildSchedule,
  cellText,
  cloneGrid,
  formatIssue,
  formatScheduleTable,
  parseLandGrid,
  processSheet,
  setCellA1,
  validateLand,
  type OfficialSheet,
  type ScheduleOverride,
} from "@/lib/import";

let gold: OfficialSheet;
let land: OfficialSheet;

beforeAll(() => {
  const paths = resolveExcelPaths();
  gold = readOfficialSheet(paths.gold, "gold").sheet!;
  land = readOfficialSheet(paths.land, "land").sheet!;
  expect(gold).toBeTruthy();
  expect(land).toBeTruthy();
});

function landWith(mutate: (grid: string[][]) => void): OfficialSheet {
  const grid = cloneGrid(land.grid);
  mutate(grid);
  return { ...land, grid };
}

describe("第五節：大地第4時段 B 關（C5）", () => {
  it("在記憶體把第4時段 B 關清空、不套用 overrides → validation 失敗，指出第4時段缺第2、4小隊", () => {
    const sheet = landWith((g) => setCellA1(g, "C5", ""));
    const parsed = parseLandGrid(sheet.grid, sheet.sheetName);
    expect(parsed.issues).toEqual([]);
    const issues = validateLand(parsed.game).map(formatIssue);
    expect(issues).toContain(
      "大地新跑關!B5:K5：第4時段：不是 7 組 PK（目前 6 組），休息關卡應為 3 個（目前 4 個）",
    );
    expect(issues).toContain("大地新跑關!B5:K5：第4時段：缺第2小隊、第4小隊");
    expect(issues).toHaveLength(2);
    // 用完整流程（overrides = []）也一樣失敗
    const full = processSheet(sheet, []);
    expect(full.issues.map(formatIssue)).toEqual(issues);
  });

  it("C5 是半形空白（原檔）→ 套用 override 後全部合法，並回報已套用", () => {
    const sheet = landWith((g) => setCellA1(g, "C5", " "));
    const result = processSheet(sheet);
    expect(result.issues).toEqual([]);
    expect(result.overrideOutcomes).toHaveLength(1);
    expect(result.overrideOutcomes[0]).toMatchObject({ status: "applied", cell: "C5", sheet: "大地新跑關" });
    const a = result.game.assignments.find((x) => x.slotNumber === 4 && x.stationCode === "B")!;
    expect([a.teamA, a.teamB]).toEqual(["2", "4"]);
  });

  it("C5 已改成 2/4 → override 只提示、不報錯，結果與套用 override 相同", () => {
    const fixed = processSheet(landWith((g) => setCellA1(g, "C5", "2/4")));
    const original = processSheet(landWith((g) => setCellA1(g, "C5", " ")));
    expect(fixed.issues).toEqual([]);
    expect(fixed.overrideOutcomes[0]).toMatchObject({ status: "already", cell: "C5", originalValue: "2/4" });
    expect(fixed.game).toEqual(original.game);
  });

  it("C5 變成其他值 3/5 → 報錯要求人工確認，不自動覆蓋", () => {
    const result = processSheet(landWith((g) => setCellA1(g, "C5", "3/5")));
    const messages = result.issues.map(formatIssue);
    expect(result.overrideOutcomes[0]).toMatchObject({ status: "error", originalValue: "3/5" });
    expect(messages.some((m) => m.startsWith("大地新跑關!C5：") && m.includes("3/5") && m.includes("人工確認"))).toBe(true);
    // 沒有被覆蓋：3/5 仍在解析結果中，validation 也會指出第3、5小隊重複與第2、4小隊缺席
    const c5 = result.game.assignments.find((a) => a.cell === "C5")!;
    expect([c5.teamA, c5.teamB]).toEqual(["3", "5"]);
    expect(messages).toContain("大地新跑關!B5:K5：第4時段：缺第2小隊、第4小隊");
  });

  it("applyOverrides 不修改傳入的 grid", () => {
    const grid = cloneGrid(land.grid);
    const before = JSON.stringify(grid);
    const out = applyOverrides(grid, "land", land.sheetName);
    expect(JSON.stringify(grid)).toBe(before);
    expect(cellText(out.grid, 4, 2)).toBe("2/4");
  });

  it("override 依第 12 列代號找欄位；找不到代號 → 報錯", () => {
    const bad: ScheduleOverride[] = [{ game: "land", slot: 4, station: "Z", value: "2/4", reason: "測試" }];
    const result = applyOverrides(land.grid, "land", land.sheetName, bad);
    expect(result.issues.map(formatIssue).some((m) => m.includes("找不到唯一的關卡代號「Z」"))).toBe(true);
  });

  it("override 清單集中在一處，且正是第五節那一筆", () => {
    expect(SCHEDULE_OVERRIDES).toEqual([
      { game: "land", slot: 4, station: "B", value: "2/4", reason: "原檔該格為空白字元，人工確認為第2、4小隊" },
    ]);
  });
});

describe("大地 PK 格解析錯誤（全部列出，指出儲存格）", () => {
  it("格式錯誤、同隊、超出範圍、幹在左邊都報錯；同時段缺隊與重複也列出", () => {
    const sheet = landWith((g) => {
      setCellA1(g, "B2", "6/6"); // 同隊
      setCellA1(g, "D2", "4/14"); // 超出範圍
      setCellA1(g, "E2", "幹/2"); // 幹只能在右邊
      setCellA1(g, "B3", "2026/6/8"); // 格式錯誤
      setCellA1(g, "H3", "7/8"); // 第2時段 G 關原本 3/10 → 第7、8小隊重複、缺第3、10小隊
    });
    const messages = processSheet(sheet).issues.map(formatIssue);
    expect(messages.some((m) => m.startsWith("大地新跑關!B2：") && m.includes("兩隊相同"))).toBe(true);
    expect(messages.some((m) => m.startsWith("大地新跑關!D2：") && m.includes("14"))).toBe(true);
    expect(messages.some((m) => m.startsWith("大地新跑關!E2：") && m.includes("不是 PK 格式"))).toBe(true);
    expect(messages.some((m) => m.startsWith("大地新跑關!B3：") && m.includes("不是 PK 格式"))).toBe(true);
    expect(messages).toContain("大地新跑關!B2:K2：第1時段：不是 7 組 PK（目前 4 組），休息關卡應為 3 個（目前 6 個）");
    expect(messages.some((m) => m.startsWith("大地新跑關!B3:K3：第2時段：") && m.includes("第7小隊重複出現 2 次（D3、H3）"))).toBe(true);
    expect(messages).toContain("大地新跑關!B3:K3：第2時段：缺第3小隊、第10小隊");
    expect(messages.some((m) => m.includes("第8小隊重複出現 2 次（D3、H3）"))).toBe(true);
    // 第2時段仍是 7 組 PK，不應報組數錯誤
    expect(messages.some((m) => m.startsWith("大地新跑關!B3:K3：第2時段：不是 7 組 PK"))).toBe(false);
  });

  it("時段時間不一致 → 指出儲存格", () => {
    const messages = processSheet(landWith((g) => setCellA1(g, "A5", "14:26 - 14:47"))).issues.map(formatIssue);
    expect(messages).toEqual(["大地新跑關!A5：第4時段時間 14:26 - 14:47 與正式時段 14:26 - 14:46 不一致"]);
  });

  it("關卡代號列不符 → 指出儲存格", () => {
    const messages = processSheet(landWith((g) => setCellA1(g, "K12", "K"))).issues.map(formatIssue);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^大地新跑關!K12：關卡代號應為「J」/);
  });
});

describe("完整流程（兩份真實 Excel）", () => {
  it("loadScheduleFromFiles：讀取＋override＋validation 全部合法，得到 14 隊與兩個遊戲", () => {
    const result = loadScheduleFromFiles(resolveExcelPaths());
    expect(result.issues.map(formatIssue)).toEqual([]);
    const schedule = result.schedule!;
    expect(schedule.teams.map((t) => t.code)).toEqual([...Array.from({ length: 13 }, (_, i) => String(i + 1)), "S"]);
    expect(schedule.teams.map((t) => t.sortOrder)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(schedule.teams.at(-1)).toEqual({ code: "S", name: "幹部隊", isStaffTeam: true, sortOrder: 14 });
    expect(schedule.teams[0]).toEqual({ code: "1", name: "第1小隊", isStaffTeam: false, sortOrder: 1 });
    expect(schedule.games.gold.assignments).toHaveLength(104);
    expect(schedule.games.land.assignments).toHaveLength(56);
    const table = formatScheduleTable(schedule);
    expect(table).toContain("第4時段 14:26–14:46（7 組 PK，休息：C、E、G）");
    expect(table).toContain("第2小隊 vs 第4小隊");
  });

  it("buildSchedule：C5 空白或 2/4 都通過；任一遊戲有錯 → schedule = null 且錯誤全部列出", () => {
    for (const c5 of [" ", "", "2/4"]) {
      const result = buildSchedule({ gold, land: landWith((g) => setCellA1(g, "C5", c5)) });
      expect(result.issues, `C5 = '${c5}'`).toEqual([]);
      expect(result.schedule).not.toBeNull();
    }
    const goldBad = { ...gold, grid: cloneGrid(gold.grid) };
    setCellA1(goldBad.grid, "F12", "ㄍ");
    const result = buildSchedule({ gold: goldBad, land: landWith((g) => setCellA1(g, "C5", "3/5")) });
    expect(result.schedule).toBeNull();
    const messages = result.issues.map(formatIssue);
    expect(messages.some((m) => m.startsWith("黃金新路線!F12："))).toBe(true);
    expect(messages.some((m) => m.startsWith("大地新跑關!C5："))).toBe(true);
  });

  it("找不到 Excel 檔案 → 明確錯誤", () => {
    const result = loadScheduleFromFiles({ gold: "data/不存在.xlsx", land: resolveExcelPaths().land });
    expect(result.schedule).toBeNull();
    expect(result.issues.map(formatIssue)[0]).toContain("找不到 Excel 檔案");
  });

  it("一份讀不到時，另一份仍跑完 overrides → 解析 → validation，錯誤一次全部列出（讀取錯誤在前）", () => {
    const missing = readOfficialSheet("data/不存在.xlsx", "gold");
    expect(missing.sheet).toBeNull();
    const result = buildScheduleFromReads({
      gold: missing,
      land: { sheet: landWith((g) => setCellA1(g, "C5", "3/5")), issues: [] },
    });
    expect(result.schedule).toBeNull();
    const messages = result.issues.map(formatIssue);
    expect(messages[0]).toContain("找不到 Excel 檔案");
    expect(messages.some((m) => m.startsWith("大地新跑關!C5："))).toBe(true);
    // 讀到的大地仍然套用了 overrides（C5 = 2/4 那一條）
    expect(result.overrideOutcomes.some((o) => o.override.game === "land")).toBe(true);
  });

  it("loadScheduleFromFiles：黃金檔案不存在時，大地照樣檢查（合法 → 只有讀取錯誤，但仍回報 override 結果）", () => {
    const result = loadScheduleFromFiles({ gold: "data/不存在.xlsx", land: resolveExcelPaths().land });
    expect(result.schedule).toBeNull();
    expect(result.issues).toHaveLength(1);
    expect(result.overrideOutcomes.map((o) => o.override.game)).toEqual(SCHEDULE_OVERRIDES.filter((o) => o.game === "land").map(() => "land"));
  });

  it("不會修改 Excel 檔", () => {
    const paths = resolveExcelPaths();
    const before = fs.statSync(paths.land).mtimeMs;
    loadScheduleFromFiles(paths);
    expect(fs.statSync(paths.land).mtimeMs).toBe(before);
  });
});

describe("PIN 身分輔助函式", () => {
  it("隨機 PIN 一律 6 位數字", () => {
    for (let i = 0; i < 200; i++) expect(randomPin()).toMatch(/^\d{6}$/);
  });

  it("關主 label 例如「黃金傳奇－九九乘法」", () => {
    expect(stationIdentityLabel("gold", "九九乘法")).toBe("黃金傳奇－九九乘法");
  });

  it("CSV 有 UTF-8 BOM，已存在的身分不含 PIN", () => {
    const csv = buildPinCsv([
      { role: "ADMIN", gameCode: null, code: null, label: "總召", stationId: null, teamId: null, pin: "123456", status: "created" },
      { role: "TEAM", gameCode: null, code: "2", label: "第2小隊", stationId: null, teamId: "t2", pin: null, status: "existing" },
    ]);
    expect(csv.startsWith("﻿角色,遊戲,代號,名稱,PIN,狀態\r\n")).toBe(true);
    expect(csv).toContain("總召,,,總召,123456,新建立");
    expect(csv).toContain("隊輔,,2,第2小隊,,已存在，未變更");
  });

  it("CSV 檔名 pins-YYYYMMDD-HHmmss.csv（Asia/Taipei）", () => {
    expect(pinCsvFileName(new Date("2026-09-25T01:02:03Z"))).toBe("pins-20260925-090203.csv");
  });
});
