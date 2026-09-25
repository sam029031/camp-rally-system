import { describe, expect, it } from "vitest";
import { ApiHttpError } from "@/lib/server/errors";
import {
  clampIntParam,
  parseAdminAdjust,
  parseAdminCancel,
  parseAdminClock,
  parseAdminCorrectRecord,
  parseAdminEndOverride,
  parseAdminEventSettings,
  parseAdminGameSettings,
  parseAdminReset,
  parseAdminResetPins,
  parseAdminVoidRecord,
  parseCheckRequest,
  parseLoginRequest,
  parseNotificationCheckRequest,
  parseUndoRequest,
  sanitizeClientInfo,
} from "@/lib/server/validate";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const U3 = "33333333-3333-4333-8333-333333333333";

/** 執行 fn，回傳丟出的 ApiHttpError（沒丟錯就讓測試失敗） */
function errOf(fn: () => unknown): ApiHttpError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ApiHttpError) return e;
    throw e;
  }
  throw new Error("預期要丟出 ApiHttpError");
}

describe("parseLoginRequest", () => {
  it("6 位數字 PIN", () => {
    expect(parseLoginRequest({ identityId: U1, pin: "012345" })).toEqual({ identityId: U1, pin: "012345" });
  });
  it("PIN 格式錯誤 → 400", () => {
    for (const pin of ["12345", "1234567", "12a456", 123456, ""]) {
      const e = errOf(() => parseLoginRequest({ identityId: U1, pin }));
      expect(e.status).toBe(400);
      expect(e.code).toBe("INVALID_REQUEST");
    }
  });
  it("identityId 不是 uuid → 400", () => {
    expect(errOf(() => parseLoginRequest({ identityId: "abc", pin: "123456" })).status).toBe(400);
  });
  it("body 不是物件 → 400", () => {
    expect(errOf(() => parseLoginRequest(null)).status).toBe(400);
    expect(errOf(() => parseLoginRequest([1, 2])).status).toBe(400);
  });
});

describe("parseCheckRequest（第二十一節）", () => {
  const base = { clientRequestId: U1, assignmentId: U2 };

  it("關主進關：teamId 必須為 null", () => {
    const r = parseCheckRequest({ ...base, action: "station_check_in", teamId: null });
    expect(r.action).toBe("station_check_in");
    expect(r.teamId).toBeNull();
    expect(r.noShow).toBe(false);
    expect(r.singleTeamOverride).toBe(false);
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_in", teamId: U3 })).status).toBe(400);
  });

  it("隊輔側：teamId 必填", () => {
    expect(parseCheckRequest({ ...base, action: "team_check_in", teamId: U3 }).teamId).toBe(U3);
    expect(errOf(() => parseCheckRequest({ ...base, action: "team_check_out", teamId: null })).status).toBe(400);
  });

  it("uuid 大寫會正規化成小寫", () => {
    const r = parseCheckRequest({ ...base, action: "team_check_in", teamId: U3.toUpperCase() });
    expect(r.teamId).toBe(U3);
  });

  it("未知 action / 壞掉的 clientRequestId → 400", () => {
    expect(errOf(() => parseCheckRequest({ ...base, action: "delete_all", teamId: null })).status).toBe(400);
    expect(errOf(() => parseCheckRequest({ ...base, clientRequestId: "x", action: "station_check_in" })).status).toBe(400);
  });

  it("本隊未到只能用在 station_check_out", () => {
    expect(parseCheckRequest({ ...base, action: "station_check_out", teamId: null, noShow: true }).noShow).toBe(true);
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_in", teamId: null, noShow: true })).status).toBe(400);
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_out", teamId: null, noShow: "yes" })).status).toBe(400);
  });

  it("confirmedTeamIds：只在 station_check_in、最多兩隊、不重複", () => {
    expect(
      parseCheckRequest({ ...base, action: "station_check_in", teamId: null, confirmedTeamIds: [U2, U3] }).confirmedTeamIds,
    ).toEqual([U2, U3]);
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_in", teamId: null, confirmedTeamIds: [U2, U2] })).status).toBe(400);
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_in", teamId: null, confirmedTeamIds: [U1, U2, U3] })).status).toBe(400);
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_out", teamId: null, confirmedTeamIds: [U2] })).status).toBe(400);
  });

  it("單隊開始：必須填原因（REASON_REQUIRED），且只能用在進關", () => {
    const e = errOf(() => parseCheckRequest({ ...base, action: "station_check_in", teamId: null, singleTeamOverride: true, reason: "  " }));
    expect(e.status).toBe(400);
    expect(e.code).toBe("REASON_REQUIRED");
    const ok = parseCheckRequest({ ...base, action: "station_check_in", teamId: null, singleTeamOverride: true, reason: " 受傷 " });
    expect(ok.reason).toBe("受傷");
    expect(errOf(() => parseCheckRequest({ ...base, action: "station_check_out", teamId: null, singleTeamOverride: true, reason: "x" })).status).toBe(400);
  });

  it("clientInfo 只保留合約欄位", () => {
    const r = parseCheckRequest({
      ...base,
      action: "station_check_in",
      teamId: null,
      clientInfo: { ua: "iPhone", ip: "1.2.3.4", screen: "390x844", deviceTime: 123 },
    });
    expect(r.clientInfo).toEqual({ ua: "iPhone", screen: "390x844" });
  });
});

describe("sanitizeClientInfo", () => {
  it("沒有 ua 時用 header 補", () => {
    expect(sanitizeClientInfo(null, "Mozilla/5.0")).toEqual({ ua: "Mozilla/5.0" });
    expect(sanitizeClientInfo({ ua: "x".repeat(1000) }).ua?.length).toBe(300);
  });
});

describe("parseUndoRequest / parseNotificationCheckRequest", () => {
  it("undo", () => {
    expect(parseUndoRequest({ recordId: U1 }).recordId).toBe(U1);
    expect(errOf(() => parseUndoRequest({})).status).toBe(400);
  });

  it("通知 check：只接受推導型 kind，assignmentId 必填", () => {
    expect(parseNotificationCheckRequest({ kind: "STATION_OVERTIME", subkind: null, assignmentId: U1, teamId: null })).toEqual({
      kind: "STATION_OVERTIME",
      subkind: null,
      assignmentId: U1,
      teamId: null,
    });
    expect(
      parseNotificationCheckRequest({ kind: "RECORD_MISMATCH", subkind: "TEAM_OUT_STATION_NOT_OUT", assignmentId: U1, teamId: U2 })
        .subkind,
    ).toBe("TEAM_OUT_STATION_NOT_OUT");
    expect(errOf(() => parseNotificationCheckRequest({ kind: "SELF_UNDO", subkind: null, assignmentId: U1, teamId: null })).status).toBe(400);
    expect(errOf(() => parseNotificationCheckRequest({ kind: "SCHEDULE_ADJUSTED", subkind: null, assignmentId: U1, teamId: null })).status).toBe(400);
    expect(errOf(() => parseNotificationCheckRequest({ kind: "STATION_OVERTIME", subkind: null, assignmentId: null, teamId: null })).status).toBe(400);
  });
});

describe("Admin：原因必填（REASON_REQUIRED）", () => {
  it("空白原因", () => {
    for (const reason of [undefined, "", "   ", null]) {
      const e = errOf(() => parseAdminVoidRecord({ recordId: U1, reason }));
      expect(e.code).toBe("REASON_REQUIRED");
      expect(e.status).toBe(400);
    }
    expect(parseAdminVoidRecord({ recordId: U1, reason: " 按錯隊 " }).reason).toBe("按錯隊");
  });

  it("原因型別不對 → INVALID_REQUEST", () => {
    expect(errOf(() => parseAdminVoidRecord({ recordId: U1, reason: 123 })).code).toBe("INVALID_REQUEST");
  });
});

describe("parseAdminCorrectRecord", () => {
  it("recordedAt 必須是帶時區的 ISO，正規化成 UTC", () => {
    expect(parseAdminCorrectRecord({ recordId: U1, recordedAt: "2026-10-17T09:10:18+08:00", reason: "修正" }).recordedAt).toBe(
      "2026-10-17T01:10:18.000Z",
    );
    expect(errOf(() => parseAdminCorrectRecord({ recordId: U1, recordedAt: "2026-10-17T09:10:18", reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminCorrectRecord({ recordId: U1, recordedAt: "09:10:18", reason: "x" })).status).toBe(400);
  });
});

describe("parseAdminAdjust（第二十四節）", () => {
  it("DELAY：整數分鐘，0 → ADJUST_INVALID", () => {
    expect(parseAdminAdjust({ gameId: U1, fromSlotNumber: 3, mode: "DELAY", offsetMinutes: 10, reason: "延誤" })).toMatchObject({
      mode: "DELAY",
      offsetMinutes: 10,
    });
    expect(parseAdminAdjust({ gameId: U1, fromSlotNumber: 3, mode: "DELAY", offsetMinutes: -5, reason: "提前" }).offsetMinutes).toBe(-5);
    expect(errOf(() => parseAdminAdjust({ gameId: U1, fromSlotNumber: 3, mode: "DELAY", offsetMinutes: 0, reason: "x" })).code).toBe(
      "ADJUST_INVALID",
    );
    expect(errOf(() => parseAdminAdjust({ gameId: U1, fromSlotNumber: 3, mode: "DELAY", offsetMinutes: 2.5, reason: "x" })).status).toBe(400);
  });

  it("START_AT：HH:mm", () => {
    expect(parseAdminAdjust({ gameId: U1, fromSlotNumber: 1, mode: "START_AT", startAt: "09:20", reason: "晚開始" }).startAt).toBe("09:20");
    expect(errOf(() => parseAdminAdjust({ gameId: U1, fromSlotNumber: 1, mode: "START_AT", startAt: "9點20", reason: "x" })).status).toBe(400);
  });

  it("原因必填、時段必須 >= 1、mode 必須合法", () => {
    expect(errOf(() => parseAdminAdjust({ gameId: U1, fromSlotNumber: 1, mode: "DELAY", offsetMinutes: 5, reason: "" })).code).toBe(
      "REASON_REQUIRED",
    );
    expect(errOf(() => parseAdminAdjust({ gameId: U1, fromSlotNumber: 0, mode: "DELAY", offsetMinutes: 5, reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminAdjust({ gameId: U1, fromSlotNumber: 1, mode: "PAUSE", reason: "x" })).status).toBe(400);
  });
});

describe("parseAdminCancel（第二十四之二節）", () => {
  it("assignmentIds 或 stationId + fromSlotNumber 擇一", () => {
    expect(parseAdminCancel({ assignmentIds: [U1, U1, U2], reason: "下雨" }).assignmentIds).toEqual([U1, U2]);
    expect(parseAdminCancel({ stationId: U1, fromSlotNumber: 3, reason: "下雨" })).toEqual({
      stationId: U1,
      fromSlotNumber: 3,
      reason: "下雨",
    });
    expect(errOf(() => parseAdminCancel({ assignmentIds: [U1], stationId: U2, reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminCancel({ assignmentIds: [], reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminCancel({ stationId: U1, reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminCancel({ assignmentIds: [U1] })).code).toBe("REASON_REQUIRED");
  });
});

describe("parseAdminEndOverride", () => {
  it("三種方式恰選一種", () => {
    expect(parseAdminEndOverride({ assignmentId: U1, extendMinutes: 5, reason: "等人" }).modeParsed).toEqual({
      kind: "extend",
      extendMinutes: 5,
    });
    expect(parseAdminEndOverride({ assignmentId: U1, fullDuration: true, reason: "補足" }).modeParsed).toEqual({ kind: "full_duration" });
    expect(
      parseAdminEndOverride({ assignmentId: U1, officialEnd: "2026-10-17T14:50:00+08:00", reason: "x" }).modeParsed,
    ).toEqual({ kind: "official_end", officialEnd: "2026-10-17T06:50:00.000Z" });
    expect(errOf(() => parseAdminEndOverride({ assignmentId: U1, reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminEndOverride({ assignmentId: U1, extendMinutes: 5, fullDuration: true, reason: "x" })).status).toBe(400);
    expect(errOf(() => parseAdminEndOverride({ assignmentId: U1, extendMinutes: 0, reason: "x" })).status).toBe(400);
  });
});

describe("設定 / Demo / Reset / PIN", () => {
  it("game-settings", () => {
    expect(parseAdminGameSettings({ gameId: U1, endPolicy: "FIXED_END", minPlaySeconds: 600 })).toEqual({
      gameId: U1,
      endPolicy: "FIXED_END",
      minPlaySeconds: 600,
    });
    expect(errOf(() => parseAdminGameSettings({ gameId: U1, endPolicy: "PAUSE", minPlaySeconds: 600 })).status).toBe(400);
    expect(errOf(() => parseAdminGameSettings({ gameId: U1, endPolicy: "FIXED_END", minPlaySeconds: -1 })).status).toBe(400);
  });

  it("event-settings：至少一個欄位、日期要合法、名稱不可空白", () => {
    expect(parseAdminEventSettings({ leadTitle: " 總召 " })).toEqual({
      eventDate: undefined,
      teamGroupLabel: undefined,
      stationGroupLabel: undefined,
      leadTitle: "總召",
    });
    expect(errOf(() => parseAdminEventSettings({})).status).toBe(400);
    expect(errOf(() => parseAdminEventSettings({ eventDate: "2026-02-30" })).status).toBe(400);
    expect(errOf(() => parseAdminEventSettings({ teamGroupLabel: "  " })).status).toBe(400);
  });

  it("clock：speed 範圍與 jumpTo 格式", () => {
    expect(parseAdminClock({ enabled: true, speed: 10, jumpTo: "09:08" })).toEqual({ enabled: true, speed: 10, jumpTo: "09:08" });
    expect(parseAdminClock({ enabled: false, speed: 1 })).toEqual({ enabled: false, speed: 1, jumpTo: null });
    expect(parseAdminClock({ enabled: true, speed: 5, jumpTo: "2026-10-17T13:03:00+08:00" }).jumpTo).toBe("2026-10-17T13:03:00+08:00");
    expect(errOf(() => parseAdminClock({ enabled: true, speed: 0 })).status).toBe(400);
    expect(errOf(() => parseAdminClock({ enabled: true, speed: 500 })).status).toBe(400);
    expect(errOf(() => parseAdminClock({ enabled: "yes", speed: 1 })).status).toBe(400);
    expect(errOf(() => parseAdminClock({ enabled: true, speed: 10, jumpTo: "明天" })).status).toBe(400);
  });

  it("reset：確認字必須完全是 RESET", () => {
    expect(parseAdminReset({ gameCode: "all", confirmText: "RESET" })).toEqual({ gameCode: "all", confirmText: "RESET" });
    expect(parseAdminReset({ gameCode: "gold", confirmText: "RESET" }).gameCode).toBe("gold");
    for (const confirmText of ["reset", "RESET ", "", undefined]) {
      expect(errOf(() => parseAdminReset({ gameCode: "gold", confirmText })).code).toBe("RESET_CONFIRM_MISMATCH");
    }
    expect(errOf(() => parseAdminReset({ gameCode: "both", confirmText: "RESET" })).code).toBe("INVALID_REQUEST");
  });

  it("pins/reset：identityId 或 all 擇一；指定 PIN 只能單一身分", () => {
    expect(parseAdminResetPins({ identityId: U1 })).toEqual({ identityId: U1, pin: undefined });
    expect(parseAdminResetPins({ identityId: U1, pin: "000123" })).toEqual({ identityId: U1, pin: "000123" });
    expect(parseAdminResetPins({ all: true })).toEqual({ all: true });
    expect(errOf(() => parseAdminResetPins({})).status).toBe(400);
    expect(errOf(() => parseAdminResetPins({ identityId: U1, all: true })).status).toBe(400);
    expect(errOf(() => parseAdminResetPins({ all: true, pin: "123456" })).status).toBe(400);
    expect(errOf(() => parseAdminResetPins({ identityId: U1, pin: "12345" })).status).toBe(400);
  });

  it("clampIntParam", () => {
    expect(clampIntParam(null, 100, 1, 500)).toBe(100);
    expect(clampIntParam("9999", 100, 1, 500)).toBe(500);
    expect(clampIntParam("0", 100, 1, 500)).toBe(1);
    expect(clampIntParam("abc", 100, 1, 500)).toBe(100);
  });
});
