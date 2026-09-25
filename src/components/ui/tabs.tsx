"use client";

import * as React from "react";
import { cn } from "@/lib/client/cn";

export interface TabItem<V extends string = string> {
  value: V;
  label: React.ReactNode;
  /** 右側數字徽章（例如異常數）；0 或 undefined 不顯示 */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<V extends string = string> {
  items: ReadonlyArray<TabItem<V>>;
  value: V;
  onValueChange: (value: V) => void;
  /** 無障礙名稱，例如「Dashboard 檢視」 */
  ariaLabel?: string;
  className?: string;
  /** 每個分頁等寬撐滿（手機上常用）；預設 true */
  stretch?: boolean;
  size?: "md" | "lg";
}

/**
 * 簡單的分段切換（例如 Dashboard「關卡／小隊視角」、admin 分頁）。
 * 內容由呼叫端依 value 自行渲染。支援左右方向鍵切換。
 */
export function Tabs<V extends string = string>({
  items,
  value,
  onValueChange,
  ariaLabel,
  className,
  stretch = true,
  size = "md",
}: TabsProps<V>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  const move = (from: number, dir: 1 | -1) => {
    const n = items.length;
    for (let step = 1; step <= n; step++) {
      const i = (from + dir * step + n) % n;
      if (!items[i].disabled) {
        onValueChange(items[i].value);
        refs.current[i]?.focus();
        return;
      }
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn("flex gap-1 overflow-x-auto rounded-2xl border-2 border-slate-300 bg-slate-100 p-1", className)}
    >
      {items.map((item, i) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 font-bold transition-colors",
              "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60 disabled:opacity-40",
              size === "lg" ? "h-14 text-lg" : "h-12 text-base",
              stretch && "flex-1",
              active ? "bg-white text-slate-950 shadow ring-2 ring-slate-900" : "text-slate-700 hover:bg-white/70",
            )}
          >
            {item.label}
            {item.count ? (
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-sm text-white">
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
