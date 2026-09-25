import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/client/cn";
import { fieldClass } from "@/components/ui/input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "children"> {
  /** 選項；也可以直接傳 children（<option>／<optgroup>） */
  options?: ReadonlyArray<SelectOption>;
  /** 未選擇時顯示的提示選項（value = ""） */
  placeholder?: string;
  children?: React.ReactNode;
}

/** 原生 select（手機會用系統選單，最好按）。 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, placeholder, children, ...props },
  ref,
) {
  return (
    <div className="relative w-full">
      <select ref={ref} className={cn(fieldClass, "h-14 appearance-none pr-12", className)} {...props}>
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-4 top-1/2 size-6 -translate-y-1/2 text-slate-700" aria-hidden />
    </div>
  );
});
