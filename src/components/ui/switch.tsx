"use client";

import * as React from "react";
import { cn } from "@/lib/client/cn";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 顯示在開關旁的文字（整列都可以點） */
  label?: React.ReactNode;
  /** 小字說明 */
  description?: React.ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/** 開關（例如「只看異常」、Demo 模式）。整列至少 56px 高，方便單手點。 */
export function Switch({ checked, onCheckedChange, label, description, disabled, id, className }: SwitchProps) {
  const autoId = React.useId();
  const switchId = id ?? autoId;
  return (
    <label
      htmlFor={switchId}
      className={cn(
        "flex min-h-14 cursor-pointer select-none items-center gap-3 rounded-xl px-1",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <button
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "relative inline-flex h-9 w-16 shrink-0 items-center rounded-full border-2 transition-colors",
          "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
          checked ? "border-blue-800 bg-blue-700" : "border-slate-500 bg-slate-300",
        )}
      >
        <span
          className={cn(
            "inline-block size-7 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-7" : "translate-x-0.5",
          )}
        />
      </button>
      {(label || description) && (
        <span className="flex min-w-0 flex-col">
          {label && <span className="text-lg font-bold text-slate-900">{label}</span>}
          {description && <span className="text-sm text-slate-600">{description}</span>}
        </span>
      )}
    </label>
  );
}
