import type { MetadataRoute } from "next";

/** 第二節 PWA：只為了讓幹部加入手機主畫面（不做 service worker 快取、Background Sync、Web Push）。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "宿營跑關",
    short_name: "宿營跑關",
    description: "宿營跑關即時管理系統",
    lang: "zh-Hant",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#eef2f7",
    theme_color: "#1d4ed8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
