import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/client/cn";

/**
 * 按鈕（第二十九節：主要按鈕至少 56px 高、高對比、單手可按）。
 *
 * - size：`md`（預設，h-14 = 56px 以上）、`lg`（h-16）、`xl`（h-20，頁面主要動作：確認進關／確認出關）、
 *   `sm`（h-11，只用在次要的小控制項）、`icon`（方形圖示按鈕）。
 * - variant：`primary` 藍、`success` 綠、`danger` 紅（危險動作）、`warning` 黃、`secondary` 白底框線、`ghost` 透明。
 * - `loading`：顯示轉圈並 disabled（送出中）。
 */
export const buttonVariants = cva(
  [
    "inline-flex select-none items-center justify-center gap-2 rounded-xl font-bold leading-tight",
    "transition-[background-color,box-shadow,transform] active:scale-[0.98]",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-400/60",
    "disabled:pointer-events-none disabled:opacity-45 disabled:saturate-50",
    "touch-manipulation",
  ],
  {
    variants: {
      variant: {
        primary: "bg-blue-700 text-white shadow-sm hover:bg-blue-800",
        success: "bg-emerald-600 text-white shadow-sm hover:bg-emerald-700",
        danger: "bg-red-600 text-white shadow-sm hover:bg-red-700",
        warning: "bg-yellow-400 text-black shadow-sm hover:bg-yellow-500",
        secondary: "border-2 border-slate-400 bg-white text-slate-900 hover:bg-slate-100",
        ghost: "bg-transparent text-slate-900 hover:bg-slate-200/70",
      },
      size: {
        sm: "h-11 min-w-11 px-3 text-base",
        md: "h-14 min-w-14 px-5 text-lg",
        lg: "h-16 px-6 text-xl",
        xl: "h-20 px-6 text-2xl",
        icon: "h-12 w-12 p-0 text-lg",
      },
      block: {
        true: "w-full",
        false: "",
      },
    },
    defaultVariants: { variant: "primary", size: "md", block: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** 送出中：顯示轉圈並 disabled */
  loading?: boolean;
  /** loading 時取代文字（例如「送出中…」） */
  loadingText?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading = false, loadingText, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="size-[1.2em] shrink-0 animate-spin" aria-hidden />
          {loadingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
});
