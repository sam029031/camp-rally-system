"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Delete, Eye, EyeOff } from "lucide-react";
import { PIN_LENGTH } from "@/lib/constants";
import { cn } from "@/lib/client/cn";

export interface PinPadProps {
  value: string;
  /** 新的 PIN（只含數字、最多 6 位）；呼叫端負責在滿 6 位時送出 */
  onChange: (next: string) => void;
  disabled: boolean;
  /** 是否顯示數字（預設遮成圓點） */
  reveal: boolean;
  onToggleReveal: () => void;
  /** 有錯誤時框線變紅 */
  invalid: boolean;
  /** 顯示在 PIN 格子與數字鍵盤之間（登入中、錯誤訊息），手機不用捲動就看得到 */
  status?: ReactNode;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

/**
 * 6 位數 PIN 輸入：
 * - 畫面上的大數字鍵盤（手機單手按）。
 * - 也可以點上方的 6 格叫出系統數字鍵盤（inputMode="numeric"），桌機可直接打字。
 * - 不使用 one-time-code 自動填入（autoComplete="off"），避免密碼管理器干擾。
 */
export function PinPad({ value, onChange, disabled, reveal, onToggleReveal, invalid, status }: PinPadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 有實體鍵盤／滑鼠的裝置（桌機、平板接鍵盤）直接把焦點放在輸入框；觸控手機不自動叫出系統鍵盤，改用畫面鍵盤
  useEffect(() => {
    if (disabled) return;
    try {
      if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus({ preventScroll: true });
    } catch {
      // 舊瀏覽器沒有 matchMedia：不自動聚焦
    }
  }, [disabled]);

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    onChange(value + digit);
  };
  const backspace = () => {
    if (disabled || value.length === 0) return;
    onChange(value.slice(0, -1));
  };
  const clear = () => {
    if (disabled || value.length === 0) return;
    onChange("");
  };

  const keyClass =
    "flex h-16 select-none items-center justify-center rounded-2xl border-2 text-3xl font-black touch-manipulation sm:h-20 " +
    "transition-[background-color,transform] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60 " +
    "disabled:pointer-events-none disabled:opacity-45";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <div className="grid grid-cols-6 gap-1.5 sm:gap-2" aria-hidden>
            {Array.from({ length: PIN_LENGTH }, (_, i) => {
              const ch = value[i];
              const isNext = i === value.length && !disabled;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex h-16 items-center justify-center rounded-xl border-2 bg-white text-3xl font-black text-slate-900 timer-digits sm:h-[4.5rem] sm:text-4xl",
                    invalid ? "border-red-500" : ch ? "border-slate-700" : "border-slate-300",
                    isNext && !invalid && "border-blue-600 ring-4 ring-blue-200",
                  )}
                >
                  {ch ? (reveal ? ch : "●") : ""}
                </div>
              );
            })}
          </div>
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            name="camp-pin"
            aria-label="輸入 6 位數 PIN"
            maxLength={PIN_LENGTH}
            value={value}
            disabled={disabled}
            aria-invalid={invalid || undefined}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
              if (next !== value) onChange(next);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                clear();
              }
            }}
            className="absolute inset-0 h-full w-full cursor-text text-base opacity-0 caret-transparent"
          />
        </div>
        <button
          type="button"
          onClick={onToggleReveal}
          className="flex h-16 w-14 shrink-0 items-center justify-center rounded-xl border-2 border-slate-300 bg-white text-slate-700 touch-manipulation hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60 sm:h-[4.5rem]"
          aria-label={reveal ? "隱藏 PIN" : "顯示 PIN"}
          aria-pressed={reveal}
        >
          {reveal ? <EyeOff className="size-7" aria-hidden /> : <Eye className="size-7" aria-hidden />}
        </button>
      </div>

      {status}

      <div className="grid grid-cols-3 gap-3" role="group" aria-label="數字鍵盤">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => press(k)}
            className={cn(keyClass, "border-slate-300 bg-white text-slate-900 hover:bg-slate-100 active:bg-slate-200")}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={clear}
          className={cn(keyClass, "border-slate-300 bg-slate-100 text-xl text-slate-800 hover:bg-slate-200")}
        >
          清除
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => press("0")}
          className={cn(keyClass, "border-slate-300 bg-white text-slate-900 hover:bg-slate-100 active:bg-slate-200")}
        >
          0
        </button>
        <button
          type="button"
          disabled={disabled || value.length === 0}
          onClick={backspace}
          className={cn(keyClass, "border-slate-300 bg-slate-100 text-slate-800 hover:bg-slate-200")}
          aria-label="刪除一位"
        >
          <Delete className="size-8" aria-hidden />
        </button>
      </div>
    </div>
  );
}
