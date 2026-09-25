import { describe, expect, it } from "vitest";
import { assignmentTeamsText, buildUndoReminder } from "@/lib/server/undo-reminder";

const labels = { teamGroupLabel: "隊輔群", stationGroupLabel: "活動組群", leadTitle: "活動長" };

describe("撤銷提醒文字（第二十二節）", () => {
  it("關主撤銷：活動組群", () => {
    const r = buildUndoReminder({
      side: "STATION",
      stationName: "九九乘法",
      teamText: "第2小隊",
      actionText: "確認進關",
      recordedAtText: "09:10:18",
      voidedAtText: "09:10:40",
      ...labels,
    });
    expect(r.side).toBe("STATION");
    expect(r.groupLabel).toBe("活動組群");
    expect(r.title).toBe("你已撤銷【九九乘法 第2小隊 確認進關】。請立即到【活動組群】tag【活動長】說明自己按錯。");
    expect(r.copyText).toBe("@活動長 我是九九乘法關主，我在 09:10:18 誤按了【第2小隊 確認進關】，已於 09:10:40 撤銷。");
  });

  it("隊輔撤銷：隊輔群", () => {
    const r = buildUndoReminder({
      side: "TEAM",
      stationName: "九九乘法",
      teamText: "第2小隊",
      actionText: "確認進關",
      recordedAtText: "09:10:23",
      voidedAtText: "09:10:50",
      ...labels,
    });
    expect(r.side).toBe("TEAM");
    expect(r.groupLabel).toBe("隊輔群");
    expect(r.title).toBe("你已撤銷【第2小隊 九九乘法 確認進關】。請立即到【隊輔群】tag【活動長】說明自己按錯。");
    expect(r.copyText).toBe("@活動長 我是第2小隊隊輔，我在 09:10:23 誤按了【九九乘法 確認進關】，已於 09:10:50 撤銷。");
  });

  it("群組名稱與稱呼取自活動設定；大地列出兩隊", () => {
    const r = buildUndoReminder({
      side: "STATION",
      stationName: "歐北共",
      teamText: assignmentTeamsText(["第2小隊", "第4小隊"]),
      actionText: "確認出關",
      recordedAtText: "14:46:02",
      voidedAtText: "14:46:30",
      teamGroupLabel: "輔導群",
      stationGroupLabel: "關主群",
      leadTitle: "總召",
    });
    expect(r.title).toBe("你已撤銷【歐北共 第2小隊 vs 第4小隊 確認出關】。請立即到【關主群】tag【總召】說明自己按錯。");
    expect(r.leadTitle).toBe("總召");
  });
});
