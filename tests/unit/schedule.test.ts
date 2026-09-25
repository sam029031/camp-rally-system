import { describe, expect, it } from "vitest";
import { dashboardGameForNow, defaultAdjustFromSlot, previewAdjustment } from "@/lib/schedule";
import { gold, t } from "./fixtures/game";

describe("previewAdjustment（第二十四節）", () => {
  it("第3時段起延後 10 分鐘：1、2 不變，3~8 +10", () => {
    const slots = gold().build().slots;
    const p = previewAdjustment(slots, 3, 600_000);
    expect(p.rows).toHaveLength(8);
    expect(p.rows[0]).toMatchObject({ slotNumber: 1, affected: false, newStart: t("09:10"), newEnd: t("09:25") });
    expect(p.rows[1]).toMatchObject({ slotNumber: 2, affected: false, newStart: t("09:32") });
    expect(p.rows[2]).toMatchObject({ slotNumber: 3, affected: true, oldStart: t("09:54"), newStart: t("10:04"), newEnd: t("10:19") });
    expect(p.newLastEnd).toBe(t("12:09"));
    expect(p.overlapWarning).toBe(false);
  });

  it("第1時段從 09:20 開始 = 全部平移 +10 分鐘", () => {
    const slots = gold().build().slots;
    const offset = t("09:20") - slots[0].scheduledStart;
    const p = previewAdjustment(slots, 1, offset);
    expect(p.rows.every((r) => r.affected && r.newStart - r.oldStart === 600_000)).toBe(true);
  });

  it("提前導致與前一時段重疊 → overlapWarning", () => {
    const slots = gold().build().slots;
    expect(previewAdjustment(slots, 3, -10 * 60_000).overlapWarning).toBe(true); // 09:44 < 09:47
    expect(previewAdjustment(slots, 3, -7 * 60_000).overlapWarning).toBe(false); // 09:47 = 09:47 不算重疊
    expect(previewAdjustment(slots, 1, -30 * 60_000).overlapWarning).toBe(false); // 整場提前不會和前一時段重疊
  });

  it("依已經生效的延後計算（輸入的是有效時間）", () => {
    const b = gold();
    b.adjust(3, 10);
    const p = previewAdjustment(b.build().slots, 5, 5 * 60_000);
    expect(p.rows[4]).toMatchObject({ oldStart: t("10:48"), newStart: t("10:53") });
  });
});

describe("defaultAdjustFromSlot", () => {
  it("還沒開始 → 第1時段", () => {
    expect(defaultAdjustFromSlot(gold().build(), t("09:05"))).toBe(1);
  });

  it("第1時段進行中 → 第2時段", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    expect(defaultAdjustFromSlot(b.build(), t("09:20"))).toBe(2);
  });

  it("第2時段已有提早進關 → 第3時段", () => {
    const b = gold();
    b.stationIn(1, "A", "09:10");
    b.stationOut(1, "A", "09:25");
    b.stationIn(2, "A", "09:30");
    expect(defaultAdjustFromSlot(b.build(), t("09:31"))).toBe(3);
  });

  it("撤銷的進關不算", () => {
    const b = gold();
    const id = b.stationIn(1, "A", "09:08");
    b.voidRecord(id, "09:08:30");
    expect(defaultAdjustFromSlot(b.build(), t("09:09"))).toBe(1);
  });

  it("全部時段都已開始 → null", () => {
    expect(defaultAdjustFromSlot(gold().build(), t("11:50"))).toBeNull();
  });
});

describe("dashboardGameForNow（第十一節）", () => {
  it("黃金最後時段結束前 → gold，其後 → land", () => {
    const slots = gold().build().slots;
    expect(dashboardGameForNow(slots, t("07:00"))).toBe("gold");
    expect(dashboardGameForNow(slots, t("11:58:59"))).toBe("gold");
    expect(dashboardGameForNow(slots, t("11:59"))).toBe("land");
    expect(dashboardGameForNow([], t("09:00"))).toBe("land");
  });

  it("延後後以有效時間判斷", () => {
    const b = gold();
    b.adjust(3, 10);
    expect(dashboardGameForNow(b.build().slots, t("12:05"))).toBe("gold");
    expect(dashboardGameForNow(b.build().slots, t("12:09"))).toBe("land");
  });
});
