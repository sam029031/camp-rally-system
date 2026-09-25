/**
 * 黃金傳奇 Excel 匯入（第三、二十六、三十節）：直接讀 data/ 的真實 Excel。
 * 「每隊 8 個不同關卡」等只是本次檔案的已驗證事實，只在測試檢查，不是通用 validation。
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { OFFICIAL_SLOTS } from "@/lib/constants";
import { officialSheetFromWorkbook, readOfficialSheet, readOfficialWorkbook, resolveExcelPaths } from "@/lib/import/excel";
import {
  cloneGrid,
  formatIssue,
  processSheet,
  setCellA1,
  type NormalizedGame,
  type OfficialSheet,
} from "@/lib/import";

XLSX.set_fs(fs);

/** 任務給定的真實矩陣：列 = 第 1~8 時段，欄 = 關卡 A~M，值 = 小隊 */
const GOLD_MATRIX: number[][] = [
  [2, 4, 3, 1, 13, 12, 11, 9, 10, 8, 6, 7, 5],
  [1, 3, 2, 13, 12, 11, 10, 8, 9, 7, 5, 6, 4],
  [13, 2, 1, 12, 11, 10, 9, 7, 8, 6, 4, 5, 3],
  [12, 1, 13, 11, 10, 9, 8, 6, 7, 5, 3, 4, 2],
  [11, 13, 12, 10, 9, 8, 7, 5, 6, 4, 2, 3, 1],
  [10, 12, 11, 9, 8, 7, 6, 4, 5, 3, 1, 2, 13],
  [9, 11, 10, 8, 7, 6, 5, 3, 4, 2, 13, 1, 12],
  [8, 10, 9, 7, 6, 5, 4, 2, 3, 1, 12, 13, 11],
];
const CODES = "ABCDEFGHIJKLM".split("");
const NAMES = [
  "九九乘法",
  "按摩墊上的身影",
  "3的倍數",
  "繩采飛揚",
  "下午茶極與極",
  "吃定你了",
  "表情包猜詞",
  "鐵頭功",
  "節奏達人",
  "異口同聲",
  "跳跳36格",
  "幾隻小鳥幾隻腳",
  "紅旗白旗",
];

function minutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function route(game: NormalizedGame, team: string): string[] {
  return game.assignments
    .filter((a) => a.teamA === team || a.teamB === team)
    .sort((a, b) => a.slotNumber - b.slotNumber)
    .map((a) => a.stationCode);
}

let sheet: OfficialSheet;
let game: NormalizedGame;

beforeAll(() => {
  const read = readOfficialSheet(resolveExcelPaths().gold, "gold");
  expect(read.issues).toEqual([]);
  sheet = read.sheet!;
  const result = processSheet(sheet);
  expect(result.issues.map(formatIssue)).toEqual([]);
  game = result.game;
});

describe("黃金傳奇：真實 Excel 匯入結果", () => {
  it("8 個時段，時間與正式時段一致", () => {
    expect(game.slots).toHaveLength(8);
    expect(game.slots.map((s) => [s.start, s.end])).toEqual(OFFICIAL_SLOTS.gold.map(([a, b]) => [a, b]));
    expect(game.slots[0].start).toBe("09:10");
    expect(game.slots[7].end).toBe("11:59");
  });

  it("每個時段 15 分鐘", () => {
    for (const s of game.slots) expect((minutes(s.end) - minutes(s.start)) * 60).toBe(900);
  });

  it("跑關 7 分鐘：相鄰時段 end → 下一個 start 恰為 420 秒", () => {
    for (let i = 0; i + 1 < game.slots.length; i++) {
      expect((minutes(game.slots[i + 1].start) - minutes(game.slots[i].end)) * 60).toBe(420);
    }
  });

  it("13 個關卡，代號 A~M，名稱照 Excel（L 關顯示名稱去掉排程備註、原文另存）", () => {
    expect(game.stations.map((s) => s.code)).toEqual(CODES);
    expect(game.stations.map((s) => s.name)).toEqual(NAMES);
    const l = game.stations.find((s) => s.code === "L")!;
    expect(l.name).toBe("幾隻小鳥幾隻腳");
    expect(l.sourceName).toBe("幾隻小鳥幾隻腳(是大地變黃金)");
    for (const s of game.stations.filter((x) => x.code !== "L")) expect(s.sourceName).toBe(s.name);
  });

  it("13 支小隊、沒有幹部隊；team_b 一律 null", () => {
    const teams = new Set(game.assignments.map((a) => a.teamA));
    expect([...teams].sort((a, b) => Number(a) - Number(b))).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
    expect(teams.has("S")).toBe(false);
    expect(game.assignments.every((a) => a.teamB === null)).toBe(true);
  });

  it("每時段 13 個 assignment，13 個隊號恰為 1~13 的排列", () => {
    for (let s = 1; s <= 8; s++) {
      const list = game.assignments.filter((a) => a.slotNumber === s);
      expect(list).toHaveLength(13);
      expect(new Set(list.map((a) => a.stationCode)).size).toBe(13);
      expect(list.map((a) => Number(a.teamA)).sort((a, b) => a - b)).toEqual(Array.from({ length: 13 }, (_, i) => i + 1));
    }
  });

  it("矩陣與已確認的黃金排程完全一致", () => {
    for (let s = 0; s < 8; s++) {
      for (let c = 0; c < 13; c++) {
        const a = game.assignments.find((x) => x.slotNumber === s + 1 && x.stationCode === CODES[c]);
        expect(a?.teamA, `第${s + 1}時段 ${CODES[c]} 關`).toBe(String(GOLD_MATRIX[s][c]));
      }
    }
  });

  it("每隊 8 個時段走 8 個不同關卡；每關 8 個時段接待 8 支不同小隊", () => {
    for (let t = 1; t <= 13; t++) {
      const r = route(game, String(t));
      expect(r).toHaveLength(8);
      expect(new Set(r).size).toBe(8);
    }
    for (const code of CODES) {
      const teams = game.assignments.filter((a) => a.stationCode === code).map((a) => a.teamA);
      expect(teams).toHaveLength(8);
      expect(new Set(teams).size).toBe(8);
    }
  });

  it("第2小隊路線 A→C→B→M→K→L→J→H；第1小隊路線 D→A→C→B→M→K→L→J", () => {
    expect(route(game, "2")).toEqual(["A", "C", "B", "M", "K", "L", "J", "H"]);
    expect(route(game, "1")).toEqual(["D", "A", "C", "B", "M", "K", "L", "J"]);
  });

  it("黃金格子在 raw:false 下是字串 '2'，解析成整數", () => {
    expect(sheet.grid[1][1]).toBe("2");
    expect(game.assignments.find((a) => a.cell === "B2")?.teamA).toBe("2");
  });
});

describe("黃金傳奇：validation 錯誤（在記憶體修改 grid）", () => {
  function run(mutate: (grid: string[][]) => void) {
    const grid = cloneGrid(sheet.grid);
    mutate(grid);
    return processSheet({ ...sheet, grid }).issues.map(formatIssue);
  }

  it("關卡代號列不符 → 指出儲存格", () => {
    const issues = run((g) => setCellA1(g, "F12", "ㄍ"));
    expect(issues.some((m) => m.startsWith("黃金新路線!F12：") && m.includes("「E」") && m.includes("ㄍ"))).toBe(true);
  });

  it("時段時間與正式時段不一致 → 指出儲存格", () => {
    const issues = run((g) => setCellA1(g, "A3", "09:32 - 09:48"));
    expect(issues).toContain("黃金新路線!A3：第2時段時間 09:32 - 09:48 與正式時段 09:32 - 09:47 不一致");
  });

  it("時段時間格式錯誤 → 指出儲存格", () => {
    const issues = run((g) => setCellA1(g, "A4", "09:54~10:09"));
    expect(issues.some((m) => m.startsWith("黃金新路線!A4：") && m.includes("格式不正確"))).toBe(true);
  });

  it("同一時段重複的小隊 → 指出缺哪隊、哪隊重複；非數字、超出範圍、幹部隊、空格都報錯，且全部列出", () => {
    const issues = run((g) => {
      setCellA1(g, "C2", "2"); // 第1時段 B 關原本第4小隊 → 第2小隊重複、缺第4小隊
      setCellA1(g, "D3", "abc");
      setCellA1(g, "E4", "14");
      setCellA1(g, "F5", "幹");
      setCellA1(g, "G6", "");
    });
    expect(issues).toContain("黃金新路線!B2:N2：第1時段：缺第4小隊");
    expect(issues.some((m) => m.startsWith("黃金新路線!B2:N2：第1時段：第2小隊重複出現 2 次（B2、C2）"))).toBe(true);
    expect(issues.some((m) => m.startsWith("黃金新路線!D3："))).toBe(true);
    expect(issues.some((m) => m.startsWith("黃金新路線!E4：") && m.includes("超出 1~13"))).toBe(true);
    expect(issues.some((m) => m.startsWith("黃金新路線!F5：") && m.includes("幹部隊"))).toBe(true);
    expect(issues.some((m) => m.startsWith("黃金新路線!G6：") && m.includes("沒有分配小隊"))).toBe(true);
    expect(issues.length).toBeGreaterThanOrEqual(9);
  });

  it("關卡範圍右邊有資料 → 報錯", () => {
    const issues = run((g) => setCellA1(g, "O12", "N"));
    expect(issues.some((m) => m.startsWith("黃金新路線!O12："))).toBe(true);
  });
});

describe("黃金傳奇：舊工作表「每個小隊跑的路線」不影響匯入", () => {
  it("只解析正式工作表；在記憶體把舊工作表整張改掉，結果完全相同", () => {
    const wb = XLSX.readFile(resolveExcelPaths().gold);
    expect(wb.SheetNames).toContain("每個小隊跑的路線");
    const baseline = processSheet(officialSheetFromWorkbook(wb, "gold").sheet!);

    const old = wb.Sheets["每個小隊跑的路線"];
    const range = XLSX.utils.decode_range(old["!ref"] ?? "A1:Z30");
    const garbage = Array.from({ length: range.e.r + 1 }, () => Array.from({ length: range.e.c + 1 }, () => "99"));
    XLSX.utils.sheet_add_aoa(old, garbage, { origin: "A1" });

    const after = processSheet(officialSheetFromWorkbook(wb, "gold").sheet!);
    expect(after.issues).toEqual([]);
    expect(after.game).toEqual(baseline.game);
    expect(route(after.game, "2")).toEqual(["A", "C", "B", "M", "K", "L", "J", "H"]);
  });

  it("readOfficialWorkbook 讀檔時根本不解析舊工作表", () => {
    const wb = readOfficialWorkbook(resolveExcelPaths().gold, "gold");
    expect(Object.keys(wb.Sheets)).toEqual(["黃金新路線"]);
  });
});
