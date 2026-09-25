import type { Metadata } from "next";
import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "找不到頁面" };

/** 404：網址打錯、關卡代號不存在等。 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <SearchX className="size-16 text-slate-500" aria-hidden />
        <h1 className="text-3xl font-black text-slate-900">找不到這個頁面</h1>
        <p className="text-lg text-slate-700">網址可能打錯了，或這個關卡／隊伍不存在。請回到首頁，系統會帶你到自己的頁面。</p>
      </div>
      <div className="flex flex-col gap-3">
        <Link href="/" className={buttonVariants({ variant: "primary", size: "lg", block: true })}>
          回到我的頁面
        </Link>
        <Link href="/dashboard" className={buttonVariants({ variant: "secondary", size: "md", block: true })}>
          查看全場 Dashboard
        </Link>
      </div>
    </main>
  );
}
