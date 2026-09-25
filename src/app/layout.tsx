import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

const APP_NAME = "宿營跑關";
const THEME_COLOR = "#1d4ed8";

// 第二節 PWA：manifest（app/manifest.ts）＋ icons ＋ apple-touch-icon ＋ iOS 主畫面 meta；不使用 next-pwa、不註冊 service worker
export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s｜${APP_NAME}` },
  description: "宿營跑關即時管理系統：抵達確認、進出關打卡、關卡與跑關計時、全場即時 Dashboard。",
  applicationName: APP_NAME,
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // 活動內部工具，不需要被搜尋引擎收錄
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
  colorScheme: "light",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-dvh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
