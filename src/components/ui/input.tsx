import * as React from "react";
import { cn } from "@/lib/client/cn";

/** 共用的表單外觀（大字、粗框、高對比） */
export const fieldClass =
  "w-full rounded-xl border-2 border-slate-400 bg-white px-4 text-lg text-slate-950 placeholder:text-slate-500 " +
  "focus-visible:border-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/40 " +
  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:opacity-70 aria-[invalid=true]:border-red-600";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/**
 * 文字輸入（h-14）。PIN 請用 `inputMode="numeric"`、`autoComplete="one-time-code"`。
 */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input({ className, type = "text", ...props }, ref) {
  return <input ref={ref} type={type} className={cn(fieldClass, "h-14", className)} {...props} />;
});

export interface FieldProps {
  /** 欄位名稱 */
  label: React.ReactNode;
  /** 對應 input 的 id */
  htmlFor?: string;
  /** 小字說明 */
  hint?: React.ReactNode;
  /** 錯誤訊息（紅字） */
  error?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

/** 欄位外框：標籤 + 輸入元件 + 說明／錯誤 */
export function Field({ label, htmlFor, hint, error, required, children, className }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-base font-bold text-slate-900">
        {label}
        {required && <span className="ml-1 text-red-600">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-sm text-slate-600">{hint}</p>}
      {error && (
        <p role="alert" className="text-base font-bold text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
