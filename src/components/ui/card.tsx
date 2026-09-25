import * as React from "react";
import { cn } from "@/lib/client/cn";
import { TONE_CLASSES, type Tone } from "@/lib/client/state-colors";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 依狀態上色：淺色底 + 粗邊框（第十四節主色）；不給 = 白底灰框 */
  tone?: Tone;
  /** 次要標籤的橘色外框（第十四節：不蓋掉主色） */
  flagged?: boolean;
  /** 「已到（隊輔回報）」等需要虛線框的情況 */
  dashed?: boolean;
}

/** 卡片容器。 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, tone, flagged = false, dashed = false, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "rounded-2xl border-2 bg-white text-slate-900 shadow-sm",
        tone ? TONE_CLASSES[tone].soft : "border-slate-300",
        dashed && "border-dashed",
        flagged && "outline outline-4 outline-offset-2 outline-orange-500",
        className,
      )}
      {...props}
    />
  );
});

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-xl font-bold leading-snug", className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-base text-slate-700", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-3 p-4 pt-0", className)} {...props} />;
}
