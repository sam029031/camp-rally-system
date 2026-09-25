import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/client/cn";
import { TONE_CLASSES, type Tone } from "@/lib/client/state-colors";

export const badgeVariants = cva(
  "inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-lg border-2 font-bold leading-none",
  {
    variants: {
      size: {
        sm: "px-2 py-1 text-sm",
        md: "px-2.5 py-1.5 text-base",
        lg: "px-3 py-2 text-lg",
      },
      solid: { true: "border-transparent", false: "" },
      dashed: { true: "border-dashed", false: "" },
    },
    defaultVariants: { size: "md", solid: false, dashed: false },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  /** 顏色（第十四節）；預設灰 */
  tone?: Tone;
}

/** 小標籤：狀態文字、次要標籤、角色標示。一定要有文字，不能只靠顏色。 */
export function Badge({ className, tone = "gray", size, solid, dashed, ...props }: BadgeProps) {
  const t = TONE_CLASSES[tone];
  return <span className={cn(badgeVariants({ size, solid, dashed }), solid ? t.solid : t.soft, className)} {...props} />;
}
