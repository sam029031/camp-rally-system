import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { GAME_NAMES } from "@/lib/constants";
import { getSessionInfo } from "@/lib/server/auth";
import type { GameCode } from "@/lib/types";
import { DashboardClient } from "@/app/dashboard/_components/dashboard-client";

interface DashboardGamePageProps {
  params: Promise<{ game: string }>;
}

function parseGame(value: string): GameCode | null {
  return value === "gold" || value === "land" ? value : null;
}

export async function generateMetadata({ params }: DashboardGamePageProps): Promise<Metadata> {
  const game = parseGame((await params).game);
  return { title: game ? `${GAME_NAMES[game]} Dashboard` : "Dashboard" };
}

/** 第十一～十五、十九節：總 Dashboard（/dashboard/gold、/dashboard/land）。資料在 client 端即時讀取。 */
export default async function DashboardGamePage({ params }: DashboardGamePageProps) {
  const session = await getSessionInfo();
  if (!session) redirect("/login");
  const game = parseGame((await params).game);
  if (!game) notFound();

  return <DashboardClient key={game} game={game} isAdmin={session.role === "ADMIN"} roleLabel={session.label} />;
}
