import * as React from "react";
import { cn } from "@/lib/client/cn";
import { fieldClass } from "@/components/ui/input";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/** 多行輸入（原因、可複製訊息）。 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ className, rows = 3, ...props }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(fieldClass, "min-h-24 py-3 leading-relaxed", className)} {...props} />;
});
