/**
 * 建立 PIN 身分（第二十、二十六節）：14 組 TEAM、23 組 STATION、1 組 VIEWER（隨機 6 位數），
 * ADMIN 用 INITIAL_ADMIN_PIN。已存在的身分一律不覆蓋 PIN。DB 只存 bcrypt hash（bcryptjs，cost 10）。
 * 明碼只印在 terminal 並寫進本機 CSV（/pins*.csv 已在 .gitignore）。
 */
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GAME_NAMES, PIN_LENGTH, TIMEZONE } from "@/lib/constants";
import type { GameCode, IdentityRow, Role, StationRow, TeamRow } from "@/lib/types";
import { displayWidth, padDisplay } from "./format";
import { GAME_ORDER } from "./pipeline";

export const ADMIN_LABEL = "總召";
export const VIEWER_LABEL = "唯讀";
export const BCRYPT_COST = 10;

const ROLE_LABEL: Record<Role, string> = { ADMIN: "總召", STATION: "關主", TEAM: "隊輔", VIEWER: "唯讀" };

export interface IdentitySeedRow {
  role: Role;
  gameCode: GameCode | null;
  /** 關卡代號或隊伍 code */
  code: string | null;
  label: string;
  stationId: string | null;
  teamId: string | null;
  /** 新建立的才有明碼；已存在為 null */
  pin: string | null;
  status: "created" | "existing";
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

/** 隨機 6 位數 PIN（crypto.randomInt，均勻分布） */
export function randomPin(): string {
  return String(randomInt(0, 10 ** PIN_LENGTH)).padStart(PIN_LENGTH, "0");
}

/** 關主身分的 label，例如「黃金傳奇－九九乘法」 */
export function stationIdentityLabel(game: GameCode, stationName: string): string {
  return `${GAME_NAMES[game]}－${stationName}`;
}

type ExistingIdentity = Pick<IdentityRow, "id" | "role" | "station_id" | "team_id" | "label">;

async function loadIdentities(client: SupabaseClient): Promise<ExistingIdentity[]> {
  const { data, error } = await client.from("identities").select("id, role, station_id, team_id, label");
  if (error) throw new Error(`讀取身分（identities）失敗：${error.message}`);
  return (data ?? []) as ExistingIdentity[];
}

/** ADMIN（總召）是否已存在：決定 INITIAL_ADMIN_PIN 是否必填 */
export async function adminIdentityExists(client: SupabaseClient): Promise<boolean> {
  const all = await loadIdentities(client);
  return all.some((i) => i.role === "ADMIN" && i.label === ADMIN_LABEL);
}

/** 建立缺少的身分，回傳完整清單（依 ADMIN、VIEWER、TEAM、STATION 排序） */
export async function seedIdentities(
  client: SupabaseClient,
  input: {
    teams: Map<string, TeamRow>;
    stations: Record<GameCode, Map<string, StationRow>>;
    /** INITIAL_ADMIN_PIN；ADMIN 已存在時可為 null */
    adminPin: string | null;
  },
): Promise<IdentitySeedRow[]> {
  const existing = await loadIdentities(client);
  const rows: IdentitySeedRow[] = [];

  const base = (partial: Omit<IdentitySeedRow, "pin" | "status">, exists: boolean): IdentitySeedRow => ({
    ...partial,
    pin: null,
    status: exists ? "existing" : "created",
  });

  rows.push(
    base(
      { role: "ADMIN", gameCode: null, code: null, label: ADMIN_LABEL, stationId: null, teamId: null },
      existing.some((i) => i.role === "ADMIN" && i.label === ADMIN_LABEL),
    ),
  );
  rows.push(
    base(
      { role: "VIEWER", gameCode: null, code: null, label: VIEWER_LABEL, stationId: null, teamId: null },
      existing.some((i) => i.role === "VIEWER" && i.label === VIEWER_LABEL),
    ),
  );
  const teams = [...input.teams.values()].sort((a, b) => a.sort_order - b.sort_order);
  for (const t of teams) {
    rows.push(
      base(
        { role: "TEAM", gameCode: null, code: t.code, label: t.name, stationId: null, teamId: t.id },
        existing.some((i) => i.role === "TEAM" && i.team_id === t.id),
      ),
    );
  }
  for (const game of GAME_ORDER) {
    const stations = [...input.stations[game].values()].sort((a, b) => a.sort_order - b.sort_order);
    for (const s of stations) {
      rows.push(
        base(
          {
            role: "STATION",
            gameCode: game,
            code: s.code,
            label: stationIdentityLabel(game, s.name),
            stationId: s.id,
            teamId: null,
          },
          existing.some((i) => i.role === "STATION" && i.station_id === s.id),
        ),
      );
    }
  }

  // 產生 PIN：ADMIN 用 INITIAL_ADMIN_PIN；其他隨機，並避免新 PIN 彼此重複或等於總召 PIN（方便發放、不易混淆）
  const used = new Set<string>();
  for (const r of rows) {
    if (r.status !== "created" || r.role !== "ADMIN") continue;
    if (!input.adminPin || !isValidPin(input.adminPin)) {
      throw new Error(`尚未建立總召身分，INITIAL_ADMIN_PIN 必須是 ${PIN_LENGTH} 位數字`);
    }
    r.pin = input.adminPin;
    used.add(input.adminPin);
  }
  if (input.adminPin) used.add(input.adminPin);
  for (const r of rows) {
    if (r.status !== "created" || r.role === "ADMIN") continue;
    let pin = randomPin();
    while (used.has(pin)) pin = randomPin();
    used.add(pin);
    r.pin = pin;
  }

  const toCreate = rows.filter((r) => r.status === "created");
  if (toCreate.length > 0) {
    const inserts = await Promise.all(
      toCreate.map(async (r) => ({
        role: r.role,
        station_id: r.stationId,
        team_id: r.teamId,
        label: r.label,
        pin_hash: await bcrypt.hash(r.pin as string, BCRYPT_COST),
        pin_version: 1,
        is_active: true,
      })),
    );
    const { error } = await client.from("identities").insert(inserts);
    if (error) throw new Error(`建立身分（identities）失敗：${error.message}`);
  }
  return rows;
}

function roleGameText(r: IdentitySeedRow): string {
  return r.gameCode ? GAME_NAMES[r.gameCode] : "";
}

/** terminal 用 PIN 清單 */
export function formatPinTable(rows: readonly IdentitySeedRow[]): string {
  const labelWidth = Math.max(...rows.map((r) => displayWidth(r.label)), 4) + 2;
  return rows
    .map((r) => {
      const pin = r.status === "created" ? `PIN ${r.pin}` : "已存在，未變更";
      return `  ${padDisplay(ROLE_LABEL[r.role], 6)}${padDisplay(r.label, labelWidth)}${pin}`;
    })
    .join("\n");
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 本機 PIN CSV（UTF-8 BOM，Excel 可直接開） */
export function buildPinCsv(rows: readonly IdentitySeedRow[]): string {
  const header = ["角色", "遊戲", "代號", "名稱", "PIN", "狀態"];
  const lines = [header, ...rows.map((r) => [
    ROLE_LABEL[r.role],
    roleGameText(r),
    r.code ?? "",
    r.label,
    r.status === "created" ? (r.pin ?? "") : "",
    r.status === "created" ? "新建立" : "已存在，未變更",
  ])];
  return "﻿" + lines.map((cols) => cols.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** CSV 檔名 pins-YYYYMMDD-HHmmss.csv（Asia/Taipei） */
export function pinCsvFileName(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `pins-${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}.csv`;
}
