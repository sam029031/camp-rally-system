import * as React from "react";
import { AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/client/cn";

export interface ErrorTextProps {
  /** 要顯示的訊息；null / 空字串時不渲染 */
  message?: React.ReactNode;
  children?: React.ReactNode;
  /** error = 紅字（預設，顯示在按鈕下方的錯誤）；notice = 藍字提示（例如「已由另一裝置於 09:10:18 記錄」） */
  tone?: "error" | "notice";
  className?: string;
}

/** 按鈕下方的錯誤／提示文字（第二十一節：每個 error code 的中文提示直接顯示在按鈕下方）。 */
export function ErrorText({ message, children, tone = "error", className }: ErrorTextProps) {
  const content = message ?? children;
  if (content === null || content === undefined || content === "" || content === false) return null;
  const Icon = tone === "error" ? AlertCircle : Info;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 text-lg font-bold leading-snug",
        tone === "error" ? "text-red-700" : "text-blue-800",
        className,
      )}
    >
      <Icon className="mt-0.5 size-6 shrink-0" aria-hidden />
      <span className="min-w-0">{content}</span>
    </p>
  );
}
