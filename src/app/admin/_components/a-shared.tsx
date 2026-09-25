"use client";
/** /admin 分頁共用的小元件（[admin-a] 私有）。 */
import * as React from "react";
import { ChevronRight } from "lucide-react";
import type { DerivedGame } from "@/lib/derive/types";
import type { GameSnapshot } from "@/lib/types";
import { cn } from "@/lib/client/cn";
import type { AdminTabProps } from "@/app/admin/_components/types";

/** 已載入快照的分頁 props（shell 在快照與推導都就緒後才渲染 [admin-a] 的分頁） */
export interface ReadyTabProps extends AdminTabProps {
  snapshot: GameSnapshot;
  derived: DerivedGame;
}

export interface SectionProps {
  title: React.ReactNode;
  /** 標題下方小字說明 */
  description?: React.ReactNode;
  /** 標題右側（例如按鈕、徽章） */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** 醒目外框（例如需要處理的項目） */
  tone?: "default" | "warning" | "danger";
}

/** 分頁內的一個區塊（白底卡片、粗標題） */
export function Section({ title, description, aside, children, className, tone = "default" }: SectionProps) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-2xl border-2 bg-white p-4 shadow-sm",
        tone === "warning" ? "border-orange-500" : tone === "danger" ? "border-red-600" : "border-slate-300",
        className,
      )}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-black leading-snug text-slate-950">{title}</h2>
          {description && <p className="mt-1 text-base text-slate-700">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** 可收合的唯讀區塊（清單、矩陣：預設收合，手機上不會太長） */
export function Collapsible({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-2xl border-2 border-slate-300 bg-white shadow-sm" open={defaultOpen}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-6 shrink-0 text-slate-700 transition-transform group-open:rotate-90" aria-hidden />
        <span className="min-w-0 flex-1 text-xl font-black text-slate-950">{title}</span>
        {summary && <span className="shrink-0 text-base font-bold text-slate-600">{summary}</span>}
      </summary>
      <div className="border-t-2 border-slate-200 p-4">{children}</div>
    </details>
  );
}

/** 表格外框：窄螢幕可左右捲動（不讓整頁橫向捲動） */
export function TableScroll({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("-mx-1 overflow-x-auto px-1", className)}>{children}</div>;
}

export const thClass = "border-b-2 border-slate-300 bg-slate-100 px-3 py-2 text-left text-base font-black text-slate-800 whitespace-nowrap";
export const tdClass = "border-b border-slate-200 px-3 py-2 align-top text-base text-slate-900";

/** 狀態小標籤（有效／已撤銷） */
export function StatusPill({ active, activeText = "有效", voidText = "已撤銷" }: { active: boolean; activeText?: string; voidText?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-lg border-2 px-2 py-0.5 text-sm font-black whitespace-nowrap",
        active ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-400 bg-slate-100 text-slate-600 line-through",
      )}
    >
      {active ? activeText : voidText}
    </span>
  );
}
