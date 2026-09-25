"use client";

import * as React from "react";
import { armSoundFromPreference } from "@/lib/client/sound";
import { ToastStack } from "@/components/toast-stack";

/**
 * 根 layout 的 client providers：
 * - 全域 ToastStack（通知 Toast 只有一個出口）
 * - 曾經開啟過聲音的裝置：第一次觸控時自動重新解鎖聲音（仍需使用者手勢）
 */
export function Providers({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    armSoundFromPreference();
  }, []);

  return (
    <>
      {children}
      <ToastStack />
    </>
  );
}
