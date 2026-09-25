import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合併 Tailwind class（shadcn 慣例）：後面的 class 會覆蓋前面衝突的 class。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
