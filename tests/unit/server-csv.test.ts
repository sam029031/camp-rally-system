import { describe, expect, it } from "vitest";
import { CSV_BOM, csvCell, toCsv } from "@/lib/server/csv";

describe("CSV 匯出（第二十五節）", () => {
  it("UTF-8 BOM + CRLF", () => {
    const csv = toCsv(["關卡", "隊伍"], [["九九乘法", "第2小隊"]]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv).toBe(`${CSV_BOM}關卡,隊伍\r\n九九乘法,第2小隊\r\n`);
  });

  it("逗號、雙引號、換行要跳脫", () => {
    expect(csvCell('下雨,"水關"')).toBe('"下雨,""水關"""');
    expect(csvCell("第一行\n第二行")).toBe('"第一行\n第二行"');
  });

  it("null / boolean / number", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("是");
    expect(csvCell(false)).toBe("否");
    expect(csvCell(-10)).toBe("-10");
  });

  it("防止公式注入", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("@a")).toBe("'@a");
    expect(csvCell("-cmd")).toBe("'-cmd");
    expect(csvCell("-01:05")).toBe("-01:05");
    expect(csvCell("-3")).toBe("-3");
  });
});
