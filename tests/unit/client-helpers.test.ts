import { describe, expect, it } from "vitest";
import { ENDING_SOON_MS, STALE_AFTER_MS } from "@/lib/constants";
import { createCrossingDetector } from "@/lib/client/threshold";
import { mergeToast, MAX_TOAST_LINES, type ToastSource } from "@/lib/client/toast-merge";
import { undoButtonLabel, undoRemainingMs, undoRemainingSeconds, toEpochMs } from "@/lib/client/undo-window";
import { connectionLevel, isDataStale } from "@/lib/client/live-status";
import { stationStateTone, teamStateTone } from "@/lib/client/state-colors";

const S = 1000;

describe("門檻跨越偵測（第十七節：剩 2:00 與 0:00 各提醒一次）", () => {
  it("第一次觀察（載入／refresh）不觸發，即使已經低於門檻", () => {
    const d = createCrossingDetector([ENDING_SOON_MS, 0]);
    expect(d.observe(-30 * S, "a1")).toEqual([]);
    expect(d.observe(-31 * S, "a1")).toEqual([]);
  });

  it("由上往下跨過 2:00 與 0:00 各觸發一次", () => {
    const d = createCrossingDetector([ENDING_SOON_MS, 0]);
    expect(d.observe(121 * S, "a1")).toEqual([]);
    expect(d.observe(120 * S, "a1")).toEqual([ENDING_SOON_MS]); // 剩餘 <= 2:00 即 ENDING_SOON
    expect(d.observe(119 * S, "a1")).toEqual([]);
    expect(d.observe(1 * S, "a1")).toEqual([]);
    expect(d.observe(0, "a1")).toEqual([0]); // 剩餘 <= 0 即 OVERTIME
    expect(d.observe(-1 * S, "a1")).toEqual([]);
  });

  it("一個 tick 同時跨過兩個門檻時兩個都回報（由大到小）", () => {
    const d = createCrossingDetector([0, ENDING_SOON_MS]);
    d.observe(150 * S, "a1");
    expect(d.observe(-5 * S, "a1")).toEqual([ENDING_SOON_MS, 0]);
  });

  it("換 assignment 時重新開始，不算跨越", () => {
    const d = createCrossingDetector([ENDING_SOON_MS, 0]);
    d.observe(200 * S, "a1");
    expect(d.observe(60 * S, "a2")).toEqual([]);
    expect(d.observe(59 * S, "a2")).toEqual([]);
  });

  it("倒數消失（null）後重新出現，不補觸發", () => {
    const d = createCrossingDetector([ENDING_SOON_MS, 0]);
    d.observe(200 * S, "a1");
    expect(d.observe(null, "a1")).toEqual([]);
    expect(d.observe(100 * S, "a1")).toEqual([]);
    expect(d.observe(-1, "a1")).toEqual([0]);
  });

  it("往上（延長時間）不觸發；之後再往下又會觸發", () => {
    const d = createCrossingDetector([ENDING_SOON_MS, 0]);
    d.observe(-10 * S, "a1");
    expect(d.observe(300 * S, "a1")).toEqual([]);
    expect(d.observe(120 * S, "a1")).toEqual([ENDING_SOON_MS]);
  });
});

describe("Toast 合併（第十五節：同時多筆合併成一則）", () => {
  const n = (id: string, kind: ToastSource["kind"], message: string, subkind: string | null = null): ToastSource => ({ id, kind, subkind, message });

  it("沒有通知回傳 null", () => {
    expect(mergeToast([])).toBeNull();
  });

  it("單筆：標題為種類名稱、內容為訊息", () => {
    const t = mergeToast([n("1", "STATION_OVERTIME", "九九乘法 第2小隊 關卡超時")]);
    expect(t).toMatchObject({ title: "關卡超時", body: "九九乘法 第2小隊 關卡超時", lines: [], tone: "danger", sound: "overtime", ids: ["1"] });
  });

  it("三關超時合併成「3 關超時」", () => {
    const t = mergeToast([
      n("1", "STATION_OVERTIME", "九九乘法 第2小隊 關卡超時"),
      n("2", "STATION_OVERTIME", "3的倍數 第5小隊 關卡超時"),
      n("3", "STATION_OVERTIME", "鐵頭功 第9小隊 關卡超時"),
    ]);
    expect(t?.title).toBe("3 關超時");
    expect(t?.body).toBeNull();
    expect(t?.lines).toHaveLength(3);
  });

  it("不同種類依嚴重度排序並以「、」串接", () => {
    const t = mergeToast([
      n("a", "SCHEDULE_ADJUSTED", "黃金傳奇 第3時段起延後 10 分鐘"),
      n("b", "TRANSITION_OVERDUE", "第8小隊 未到第一關（ㄇㄉㄈㄎ）"),
      n("c", "STATION_OVERTIME", "九九乘法 第2小隊 關卡超時"),
      n("d", "TRANSITION_OVERDUE", "第3小隊 跑關逾期（前往 3的倍數）"),
    ]);
    expect(t?.title).toBe("1 關超時、2 隊跑關逾期、1 則排程調整");
    expect(t?.ids).toEqual(["c", "b", "d", "a"]);
    expect(t?.tone).toBe("danger");
    expect(t?.sound).toBe("overtime");
  });

  it("TEAM_OUT_STATION_NOT_OUT 與其他 RECORD_MISMATCH 分開計算", () => {
    const t = mergeToast([
      n("x", "RECORD_MISMATCH", "第2小隊隊輔已於 09:25:10 回報出關，請確認出關", "TEAM_OUT_STATION_NOT_OUT"),
      n("y", "RECORD_MISMATCH", "第2小隊 紀錄不一致", "CHECKOUT_TIME_DIFF"),
    ]);
    expect(t?.title).toBe("1 隊隊輔已出關、關主未出關、1 則紀錄不一致");
    expect(t?.sound).toBe("notification");
  });

  it("只有排程調整：藍色資訊、一般提示音", () => {
    const t = mergeToast([n("a", "SCHEDULE_ADJUSTED", "黃金傳奇 第3時段起延後 10 分鐘")]);
    expect(t).toMatchObject({ tone: "info", sound: "notification", title: "排程調整" });
  });

  it("超過上限時列出前幾則並提示看通知中心", () => {
    const items = Array.from({ length: MAX_TOAST_LINES + 3 }, (_, i) => n(String(i), "TRANSITION_OVERDUE", `第${i + 1}小隊 未到第一關`));
    const t = mergeToast(items);
    expect(t?.title).toBe(`${MAX_TOAST_LINES + 3} 隊跑關逾期`);
    expect(t?.lines).toHaveLength(MAX_TOAST_LINES + 1);
    expect(t?.lines.at(-1)).toContain("另有 3 則");
  });
});

describe("現場撤銷倒數（第二十二節，真實時間）", () => {
  const created = Date.parse("2026-10-17T01:10:18.000Z");

  it("剛按下剩 60 秒，15 秒後剩 45 秒", () => {
    expect(undoRemainingSeconds(created, created)).toBe(60);
    expect(undoRemainingSeconds(created, created + 15 * S)).toBe(45);
    expect(undoButtonLabel(45)).toBe("撤銷（剩 45 秒）");
  });

  it("不足 1 秒無條件進位；60 秒後為 0", () => {
    expect(undoRemainingSeconds(created, created + 59_001)).toBe(1);
    expect(undoRemainingSeconds(created, created + 60 * S)).toBe(0);
    expect(undoRemainingMs(created, created + 90 * S)).toBe(0);
  });

  it("toEpochMs 接受 ISO 與 ms", () => {
    expect(toEpochMs("2026-10-17T01:10:18.000Z")).toBe(created);
    expect(toEpochMs(created)).toBe(created);
  });
});

describe("連線狀態（第二十八節）", () => {
  const t0 = 1_000_000;

  it("超過 60 秒沒成功抓取 → 資料可能過期", () => {
    expect(isDataStale(t0, t0 + STALE_AFTER_MS, t0)).toBe(false);
    expect(isDataStale(t0, t0 + STALE_AFTER_MS + 1, t0)).toBe(true);
  });

  it("從沒成功過：從開始載入起算", () => {
    expect(isDataStale(null, t0 + 30 * S, t0)).toBe(false);
    expect(isDataStale(null, t0 + 61 * S, t0)).toBe(true);
  });

  it("連線指示分類", () => {
    expect(connectionLevel({ online: false, channel: "subscribed", stale: false })).toBe("offline");
    expect(connectionLevel({ online: true, channel: "subscribed", stale: true })).toBe("stale");
    expect(connectionLevel({ online: true, channel: "subscribed", stale: false })).toBe("live");
    expect(connectionLevel({ online: true, channel: "error", stale: false })).toBe("polling");
    expect(connectionLevel({ online: true, channel: "connecting", stale: false })).toBe("connecting");
  });
});

describe("狀態顏色（第十四節）", () => {
  it("關卡時段狀態", () => {
    expect(stationStateTone("WAITING")).toBe("gray");
    expect(stationStateTone("READY")).toBe("purple");
    expect(stationStateTone("IN_PROGRESS")).toBe("green");
    expect(stationStateTone("ENDING_SOON")).toBe("yellow");
    expect(stationStateTone("OVERTIME")).toBe("red");
    expect(stationStateTone("CHECKED_OUT")).toBe("gray");
    expect(stationStateTone("CHECKED_OUT", true)).toBe("noshow");
    expect(stationStateTone("CANCELLED")).toBe("gray");
    expect(stationStateTone("REST")).toBe("gray");
  });

  it("小隊狀態：跑關藍、剩 2:00 轉黃、逾期紅、AT_STATION 跟隨關卡", () => {
    expect(teamStateTone("TRANSITIONING")).toBe("blue");
    expect(teamStateTone("TRANSITIONING", { transitionWarning: true })).toBe("yellow");
    expect(teamStateTone("TRANSITION_OVERDUE")).toBe("red");
    expect(teamStateTone("ARRIVED")).toBe("purple");
    expect(teamStateTone("AT_STATION", { stationState: "OVERTIME" })).toBe("red");
    expect(teamStateTone("COMPLETED")).toBe("gray");
    expect(teamStateTone("WAITING")).toBe("gray");
  });
});
