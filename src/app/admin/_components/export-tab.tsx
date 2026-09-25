"use client";

/**
 * [admin-b] 匯出 CSV（第二十五節）。
 * 直接以 <a href download> 下載 GET /api/admin/export?type=…&game=…（server 回 text/csv，UTF-8 BOM，Excel 可直接開）。
 */

import { Download } from "lucide-react";
import type { AdminExportType } from "@/lib/api/contract";
import { GAME_NAMES } from "@/lib/constants";
import type { GameCode } from "@/lib/types";
import { buttonVariants } from "@/components/ui/button";
import type { AdminTabProps } from "./types";
import { TabHeader } from "./b-shared";

interface ExportDef {
  type: AdminExportType;
  title: string;
  description: string;
}

const EXPORTS: readonly ExportDef[] = [
  {
    type: "records",
    title: "打卡紀錄",
    description: "所有打卡（含已撤銷，「狀態」欄標示）：時段、關卡、隊伍、動作、時間、來源、操作者、原因、撤銷資訊。",
  },
  {
    type: "schedule",
    title: "排程",
    description: "每個時段、關卡、隊伍的原定與有效（含延後）時間，以及取消與延長。",
  },
  {
    type: "notifications",
    title: "通知",
    description: "超時、跑關逾期、漏按出關、排程調整、現場撤銷等通知與是否已失效。",
  },
  {
    type: "audit",
    title: "Audit log",
    description: "修改、撤銷、被拒絕與重複的打卡、登入失敗、PIN 修改、排程調整、Reset 等紀錄。",
  },
];

function exportHref(type: AdminExportType, game: GameCode | "all"): string {
  const sp = new URLSearchParams({ type, game });
  return `/api/admin/export?${sp.toString()}`;
}

export function ExportTab({ gameCode }: AdminTabProps) {
  const other: GameCode = gameCode === "gold" ? "land" : "gold";
  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        title="匯出 CSV"
        description="檔案為 UTF-8（Excel 可直接開啟），時間一律為台北時間 YYYY-MM-DD HH:mm:ss。按下即下載，不會修改任何資料。"
      />
      <ul className="grid gap-4 md:grid-cols-2">
        {EXPORTS.map((ex) => (
          <li key={ex.type} className="flex flex-col gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4 shadow-sm">
            <h3 className="text-xl font-black text-slate-950">{ex.title}</h3>
            <p className="text-base text-slate-700">{ex.description}</p>
            <div className="mt-auto flex flex-col gap-2">
              <a href={exportHref(ex.type, gameCode)} download className={buttonVariants({ variant: "primary", size: "md", block: true })}>
                <Download className="size-5" aria-hidden />
                下載{GAME_NAMES[gameCode]}
              </a>
              <div className="grid grid-cols-2 gap-2">
                <a href={exportHref(ex.type, other)} download className={buttonVariants({ variant: "secondary", size: "sm", block: true })}>
                  {GAME_NAMES[other]}
                </a>
                <a href={exportHref(ex.type, "all")} download className={buttonVariants({ variant: "secondary", size: "sm", block: true })}>
                  {ex.type === "audit" ? "全部（含非遊戲）" : "兩個遊戲"}
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-base text-slate-600">
        下載失敗（例如登入已失效）時，檔案內容會是錯誤訊息；請重新登入後再下載。
      </p>
    </div>
  );
}
