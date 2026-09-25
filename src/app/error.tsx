"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * 全站錯誤畫面（Next.js error boundary）。
 * 現場最常見的原因是網路不穩：提供「重新載入」（retry 會重新向 server 取得這一段頁面），
 * 以及回到首頁的出口。打卡紀錄存在 server，重新載入不會遺失。
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <TriangleAlert className="size-16 text-red-600" aria-hidden />
        <h1 className="text-3xl font-black text-slate-900">頁面發生錯誤</h1>
        <p className="text-lg text-slate-700">
          可能是網路不穩或系統暫時出錯。已經送出的打卡紀錄都存在系統裡，不會因此遺失。請按「重新載入」再試一次。
        </p>
        <p className="text-base text-slate-600">如果一直出現，請截圖並聯絡總召。</p>
        {error.digest ? <p className="font-mono text-sm text-slate-500">錯誤代碼：{error.digest}</p> : null}
      </div>
      <div className="flex flex-col gap-3">
        <Button variant="primary" size="lg" block onClick={() => retry()}>
          <RotateCw className="size-6" aria-hidden />
          重新載入
        </Button>
        <Link href="/" className={buttonVariants({ variant: "secondary", size: "md", block: true })}>
          回到我的頁面
        </Link>
      </div>
    </main>
  );
}
