/**
 * 大地遊戲 Excel 匯入（第三、四、五、二十六、三十節）：直接讀 data/ 的真實 Excel，並套用第五節 overrides。
 * 「沒有重複 PK」「各關啟用次數」等只是本次檔案的已驗證事實，只在測試檢查，不是通用 validation。
 */
import { beforeAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as XLSX from "xlsx";
import { OFFICIAL_SLOTS } from "@/lib/constants";
import { officialSheetFromWorkbook, readOfficialSheet, resolveExcelPaths } from "@/lib/import/excel";
import { cellText, formatIssue, parseCellAddress, processSheet, type NormalizedGame, type OfficialSheet } from "@/lib/import";

XLSX.set_fs(fs);

/** 任務給定的真實矩陣（第4時段 B 關為 override 2/4）："-" = 休息，S = 幹部隊 */
const LAND_MATRIX: string[][] = [
  ["6/8", "7/S", "4/10", "2/12", "-", "3/11", "-", "1/13", "5/9", "-"],
  ["-", "-", "7/8", "6/9", "1/2", "5/S", "3/10", "11/12", "-", "4/13"],
  ["2/13", "1/12", "3/S", "-", "4/5", "-", "8/9", "-", "10/11", "6/7"],
  ["1/9", "2/4", "-", "5/10", "-", "6/13", "-", "3/7", "12/S", "8/11"],
  ["5/12", "-", "1/6", "7/13", "3/8", "4/9", "2/11", "10/S", "-", "-"],
  ["-", "6/11", "5/13", "-", "9/S", "7/10", "4/12", "-", "2/8", "1/3"],
  ["3/4", "8/13", "-", "1/S", "7/11", "-", "5/6", "2/9", "-", "10/12"],
  ["-", "9/10", "-", "4/11", "6/12", "-", "1/7", "5/8", "3/13", "2/S"],
];
const CODES = "ABCDEFGHIJ".split("");
const NAMES = ["ㄇㄉㄈㄎ", "歐北共", "戲劇之王", "(水)你坡我擋", "幾個人來的", "就是要你濕濕(水)", "跳跳TEMPO", "敲敲杯(水)", "躲避球", "複製人"];
/** 第三節列出的各時段休息關卡 */
const REST_BY_SLOT = ["EGJ", "ABI", "DFH", "CEG", "BIJ", "ADH", "CFI", "ACF"];
const ALL_TEAM_CODES = [...Array.from({ length: 13 }, (_, i) => String(i + 1)), "S"];

function minutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function slotAssignments(game: NormalizedGame, slot: number) {
  return game.assignments.filter((a) => a.slotNumber === slot);
}

let sheet: OfficialSheet;
let game: NormalizedGame;

beforeAll(() => {
  const read = readOfficialSheet(resolveExcelPaths().land, "land");
  expect(read.issues).toEqual([]);
  sheet = read.sheet!;
  const result = processSheet(sheet);
  expect(result.issues.map(formatIssue)).toEqual([]);
  game = result.game;
});

describe("大地遊戲：真實 Excel 匯入結果（含第五節 override）", () => {
  it("8 個時段，時間與正式時段一致；每段 20 分鐘；時段間隔恰為 420 秒", () => {
    expect(game.slots).toHaveLength(8);
    expect(game.slots.map((s) => [s.start, s.end])).toEqual(OFFICIAL_SLOTS.land.map(([a, b]) => [a, b]));
    for (const s of game.slots) expect((minutes(s.end) - minutes(s.start)) * 60).toBe(1200);
    for (let i = 0; i + 1 < game.slots.length; i++) {
      expect((minutes(game.slots[i + 1].start) - minutes(game.slots[i].end)) * 60).toBe(420);
    }
    expect(game.slots[0].start).toBe("13:05");
    expect(game.slots[7].end).toBe("16:34");
  });

  it("10 個關卡，代號 A~J，名稱照 Excel 原文（「(水)」保留）", () => {
    expect(game.stations.map((s) => s.code)).toEqual(CODES);
    expect(game.stations.map((s) => s.name)).toEqual(NAMES);
    expect(game.stations.every((s) => s.name === s.sourceName)).toBe(true);
  });

  it("14 隊（13 小隊＋幹部隊）；team_b 一律非 null 且與 team_a 不同", () => {
    const teams = new Set(game.assignments.flatMap((a) => [a.teamA, a.teamB as string]));
    expect([...teams].sort()).toEqual([...ALL_TEAM_CODES].sort());
    for (const a of game.assignments) {
      expect(a.teamB).not.toBeNull();
      expect(a.teamB).not.toBe(a.teamA);
    }
  });

  it("每時段 7 個啟用關卡、7 組 PK、14 隊各恰好出現一次、3 關休息", () => {
    for (let s = 1; s <= 8; s++) {
      const list = slotAssignments(game, s);
      expect(list).toHaveLength(7);
      expect(new Set(list.map((a) => a.stationCode)).size).toBe(7);
      const teams = list.flatMap((a) => [a.teamA, a.teamB as string]);
      expect(teams).toHaveLength(14);
      expect([...teams].sort()).toEqual([...ALL_TEAM_CODES].sort());
      expect(CODES.length - list.length).toBe(3);
    }
  });

  it("各時段休息關卡與第三節列出的完全一致", () => {
    for (let s = 1; s <= 8; s++) {
      const active = new Set(slotAssignments(game, s).map((a) => a.stationCode));
      const rest = CODES.filter((c) => !active.has(c)).join("");
      expect(rest, `第${s}時段`).toBe(REST_BY_SLOT[s - 1]);
    }
  });

  it("矩陣與已確認的大地排程完全一致（左 = team_a、右 = team_b）", () => {
    for (let s = 0; s < 8; s++) {
      for (let c = 0; c < 10; c++) {
        const a = game.assignments.find((x) => x.slotNumber === s + 1 && x.stationCode === CODES[c]);
        const actual = a ? `${a.teamA}/${a.teamB}` : "-";
        expect(actual, `第${s + 1}時段 ${CODES[c]} 關`).toBe(LAND_MATRIX[s][c]);
      }
    }
  });

  it("全天沒有重複的 PK 組合", () => {
    const pairs = game.assignments.map((a) => [a.teamA, a.teamB as string].sort().join("-"));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs).toHaveLength(56);
  });

  it("各關全天啟用次數 A5 B6 C5 D6 E6 F5 G6 H6 I5 J6", () => {
    const usage = Object.fromEntries(CODES.map((c) => [c, game.assignments.filter((a) => a.stationCode === c).length]));
    expect(usage).toEqual({ A: 5, B: 6, C: 5, D: 6, E: 6, F: 5, G: 6, H: 6, I: 5, J: 6 });
  });

  it("每隊（含幹部隊）8 個時段去 8 個不同關卡", () => {
    for (const t of ALL_TEAM_CODES) {
      const stations = game.assignments.filter((a) => a.teamA === t || a.teamB === t).map((a) => a.stationCode);
      expect(stations, `隊伍 ${t}`).toHaveLength(8);
      expect(new Set(stations).size).toBe(8);
    }
  });

  it("出關後兩隊各自的下一關不同：第1時段 A 關第6小隊 → D、第8小隊 → C", () => {
    const next = (team: string) =>
      slotAssignments(game, 2).find((a) => a.teamA === team || a.teamB === team)?.stationCode;
    expect(next("6")).toBe("D");
    expect(next("8")).toBe("C");
  });
});

describe("大地遊戲：「幹」字串格與日期格都正確解析（第四節）", () => {
  it("日期格（number_format m/d）用顯示文字解析：B2 → 第6小隊 vs 第8小隊，不是 6/7", () => {
    const wb = XLSX.readFile(resolveExcelPaths().land);
    const ws = wb.Sheets["大地新跑關"];
    // 確認這一格在 Excel 裡真的是日期（數值）格，而不是字串
    expect(ws.B2.t).toBe("n");
    expect(sheet.grid[1][1]).toBe("6/8");
    const b2 = game.assignments.find((a) => a.cell === "B2")!;
    expect([b2.teamA, b2.teamB]).toEqual(["6", "8"]);
  });

  it("所有非空、不含「幹」的 PK 格都是日期格，且解析結果與顯示文字一致", () => {
    const wb = XLSX.readFile(resolveExcelPaths().land);
    const ws = wb.Sheets["大地新跑關"];
    let dateCells = 0;
    for (const a of game.assignments) {
      const cell = ws[a.cell];
      const pos = parseCellAddress(a.cell)!;
      const text = cellText(sheet.grid, pos.row, pos.col);
      if (text === "") continue; // 原檔 C5 為空白字元，由 override 補上（不寫死 C5 必為空白）
      if (text.includes("幹")) {
        expect(cell.t, a.cell).toBe("s");
        expect(a.teamB).toBe("S");
      } else {
        expect(cell.t, a.cell).toBe("n");
        dateCells++;
      }
      expect(text).toBe(`${a.teamA}/${a.teamB === "S" ? "幹" : a.teamB}`);
    }
    // 至少 47 格日期格（之後若把 C5 改成 2/4 會變 48 格）
    expect(dateCells).toBeGreaterThanOrEqual(47);
  });

  it("含「幹」的格子每個時段恰一格，全部解析成幹部隊（右邊）", () => {
    for (let s = 1; s <= 8; s++) {
      const staff = slotAssignments(game, s).filter((a) => a.teamB === "S");
      expect(staff).toHaveLength(1);
      expect(staff[0].teamA).not.toBe("S");
    }
    const c2 = game.assignments.find((a) => a.cell === "C2")!;
    expect([c2.teamA, c2.teamB]).toEqual(["7", "S"]);
  });
});

describe("大地遊戲：舊工作表「各隊跑關情況」不影響匯入", () => {
  it("第3時段第11隊、第4時段幹部隊、第6時段第8隊與「大地新跑關」一致", () => {
    const find = (slot: number, team: string) =>
      slotAssignments(game, slot).find((a) => a.teamA === team || a.teamB === team);
    expect(find(3, "11")?.stationCode).toBe("I");
    expect(find(3, "11")?.teamA).toBe("10");
    expect(find(4, "S")?.stationCode).toBe("I");
    expect(find(4, "S")?.teamA).toBe("12");
    expect(find(6, "8")?.stationCode).toBe("I");
    expect(find(6, "8")?.teamA).toBe("2");
  });

  it("在記憶體把舊工作表整張改掉，匯入結果完全相同", () => {
    const wb = XLSX.readFile(resolveExcelPaths().land);
    expect(wb.SheetNames).toContain("各隊跑關情況");
    const baseline = processSheet(officialSheetFromWorkbook(wb, "land").sheet!);

    const old = wb.Sheets["各隊跑關情況"];
    const range = XLSX.utils.decode_range(old["!ref"] ?? "A1:Z30");
    const garbage = Array.from({ length: range.e.r + 1 }, (_, r) =>
      Array.from({ length: range.e.c + 1 }, (_, c) => ((r + c) % 2 === 0 ? "1/1" : "幹/幹")),
    );
    XLSX.utils.sheet_add_aoa(old, garbage, { origin: "A1" });

    const after = processSheet(officialSheetFromWorkbook(wb, "land").sheet!);
    expect(after.issues).toEqual([]);
    expect(after.game).toEqual(baseline.game);
    expect(after.game).toEqual(game);
  });
});
