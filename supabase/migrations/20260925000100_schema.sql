-- =====================================================================
-- 宿營跑關即時管理系統 — Schema（tables / constraints / indexes / views / clock）
-- 規格：docs/SPEC.md 第六節；架構合約：docs/ARCHITECTURE.md
-- 寫入用 RPC 在 20260925000200_functions.sql；RLS / 權限 / Realtime 在 20260925000300_security_realtime.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- events：一筆活動（全系統只有一筆 is_active = true）
-- ---------------------------------------------------------------------
create table public.events (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  event_date           date not null,
  timezone             text not null default 'Asia/Taipei',
  is_active            boolean not null default false,
  -- Demo 時鐘（第三十一節）
  sim_enabled          boolean not null default false,
  sim_speed            double precision not null default 1 check (sim_speed > 0 and sim_speed <= 100),
  sim_anchor_real      timestamptz,
  sim_anchor_virtual   timestamptz,
  -- 撤銷提醒用的名稱（第二十二節）
  team_group_label     text not null default '隊輔群',
  station_group_label  text not null default '活動組群',
  lead_title           text not null default '活動長',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint events_sim_anchor_chk check (
    not sim_enabled or (sim_anchor_real is not null and sim_anchor_virtual is not null)
  )
);
-- 只能有一筆 active event
create unique index events_one_active on public.events ((true)) where is_active;

-- ---------------------------------------------------------------------
-- games
-- ---------------------------------------------------------------------
create table public.games (
  id                           uuid primary key default gen_random_uuid(),
  event_id                     uuid not null references public.events(id) on delete cascade,
  code                         text not null check (code in ('gold', 'land')),
  name                         text not null,
  station_duration_seconds     integer not null check (station_duration_seconds > 0),
  transition_duration_seconds  integer not null default 420 check (transition_duration_seconds >= 0),
  teams_per_station            integer not null check (teams_per_station in (1, 2)),
  end_policy                   text not null check (end_policy in ('FULL_DURATION', 'FIXED_END')),
  min_play_seconds             integer not null default 600 check (min_play_seconds >= 0),
  sort_order                   integer not null default 0,
  created_at                   timestamptz not null default now(),
  -- reset / 設定變更時更新，讓所有裝置透過 Realtime 重抓
  updated_at                   timestamptz not null default now(),
  unique (event_id, code),
  unique (id, event_id)
);

-- ---------------------------------------------------------------------
-- time_slots：原定時間（import 後不因延後而改）
-- ---------------------------------------------------------------------
create table public.time_slots (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  slot_number  integer not null check (slot_number >= 1),
  start_local  time not null,
  end_local    time not null,
  unique (game_id, slot_number),
  unique (id, game_id),
  constraint time_slots_order_chk check (end_local > start_local)
);

-- ---------------------------------------------------------------------
-- stations
-- ---------------------------------------------------------------------
create table public.stations (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  code         text not null,
  name         text not null,           -- 顯示名稱
  source_name  text not null,           -- Excel 原文
  sort_order   integer not null default 0,
  unique (game_id, code),
  unique (id, game_id)
);

-- ---------------------------------------------------------------------
-- teams（不綁 game；參與哪個遊戲由 assignments 決定）
-- ---------------------------------------------------------------------
create table public.teams (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,   -- '1'..'13', 'S'
  name           text not null,          -- 第N小隊 / 幹部隊
  is_staff_team  boolean not null default false,
  sort_order     integer not null default 0
);

-- ---------------------------------------------------------------------
-- assignments：黃金 slot+station+team；大地 slot+station+team_a+team_b
-- 不得有任何狀態欄位（狀態一律推導）
-- ---------------------------------------------------------------------
create table public.assignments (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  slot_id     uuid not null,
  station_id  uuid not null,
  team_a_id   uuid not null references public.teams(id),
  team_b_id   uuid references public.teams(id),
  unique (slot_id, station_id),
  -- slot 與 station 必須屬於同一個 game
  foreign key (slot_id, game_id) references public.time_slots(id, game_id) on delete cascade,
  foreign key (station_id, game_id) references public.stations(id, game_id) on delete cascade,
  constraint assignments_distinct_teams_chk check (team_b_id is null or team_b_id <> team_a_id)
);
create index assignments_game_idx on public.assignments (game_id);
create index assignments_team_a_idx on public.assignments (team_a_id);
create index assignments_team_b_idx on public.assignments (team_b_id);

-- 黃金 team_b 一律 NULL；大地一律 NOT NULL（依 games.teams_per_station）
create or replace function public.assignments_shape_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_tps integer;
begin
  select teams_per_station into v_tps from public.games where id = new.game_id;
  if v_tps = 1 and new.team_b_id is not null then
    raise exception 'assignment % : 單隊遊戲 team_b_id 必須為 NULL', new.id;
  end if;
  if v_tps = 2 and new.team_b_id is null then
    raise exception 'assignment % : PK 遊戲 team_b_id 不可為 NULL', new.id;
  end if;
  return new;
end;
$$;
create trigger assignments_shape_guard
  before insert or update on public.assignments
  for each row execute function public.assignments_shape_guard();

-- ---------------------------------------------------------------------
-- identities（PIN 身分；不使用 Supabase Auth）
-- ---------------------------------------------------------------------
create table public.identities (
  id           uuid primary key default gen_random_uuid(),
  role         text not null check (role in ('ADMIN', 'STATION', 'TEAM', 'VIEWER')),
  station_id   uuid references public.stations(id) on delete cascade,
  team_id      uuid references public.teams(id) on delete cascade,
  label        text not null,
  pin_hash     text not null,
  pin_version  integer not null default 1,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint identities_shape_chk check (
    (role = 'STATION' and station_id is not null and team_id is null) or
    (role = 'TEAM' and team_id is not null and station_id is null) or
    (role in ('ADMIN', 'VIEWER') and station_id is null and team_id is null)
  )
);
create unique index identities_station_uniq on public.identities (station_id) where role = 'STATION';
create unique index identities_team_uniq on public.identities (team_id) where role = 'TEAM';
create unique index identities_label_uniq on public.identities (role, label) where role in ('ADMIN', 'VIEWER');

-- ---------------------------------------------------------------------
-- schedule_adjustments（整場延後／提前；append-only）
-- ---------------------------------------------------------------------
create table public.schedule_adjustments (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games(id) on delete cascade,
  from_slot_number  integer not null check (from_slot_number >= 1),
  offset_seconds    integer not null check (offset_seconds <> 0),
  input_mode        text not null check (input_mode in ('DELAY', 'START_AT')),
  reason            text not null,
  identity_id       uuid references public.identities(id) on delete set null,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         uuid references public.identities(id) on delete set null,
  void_reason       text
);
create index schedule_adjustments_game_idx on public.schedule_adjustments (game_id, created_at);

-- ---------------------------------------------------------------------
-- assignment_cancellations（關卡取消；append-only）
-- ---------------------------------------------------------------------
create table public.assignment_cancellations (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  reason         text not null,
  identity_id    uuid references public.identities(id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.identities(id) on delete set null,
  void_reason    text
);
create unique index assignment_cancellations_one_valid
  on public.assignment_cancellations (assignment_id) where voided_at is null;

-- ---------------------------------------------------------------------
-- assignment_end_overrides（延長／改結束時間；append-only）
-- ---------------------------------------------------------------------
create table public.assignment_end_overrides (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null references public.assignments(id) on delete cascade,
  official_end   timestamptz not null,
  reason         text not null,
  identity_id    uuid references public.identities(id) on delete set null,
  created_at     timestamptz not null default now(),
  voided_at      timestamptz,
  voided_by      uuid references public.identities(id) on delete set null,
  void_reason    text
);
create unique index assignment_end_overrides_one_valid
  on public.assignment_end_overrides (assignment_id) where voided_at is null;

-- ---------------------------------------------------------------------
-- check_records（append-only 正式打卡紀錄）
-- ---------------------------------------------------------------------
create table public.check_records (
  id                    uuid primary key default gen_random_uuid(),
  client_request_id     uuid not null unique,
  assignment_id         uuid not null references public.assignments(id) on delete cascade,
  action                text not null check (action in (
                          'station_check_in', 'station_check_out', 'team_check_in', 'team_check_out')),
  team_id               uuid references public.teams(id),
  no_show               boolean not null default false,
  -- 大地單隊開始（第十八節）：只會出現在 station_check_in
  single_team_override  boolean not null default false,
  -- 大地開始時關主勾選的隊伍（station_check_in 才有）
  confirmed_team_ids    uuid[],
  -- 正式時間：ui / admin_force = app_now()；admin_correction = 管理員指定
  recorded_at           timestamptz not null,
  real_created_at       timestamptz not null default now(),
  identity_id           uuid references public.identities(id) on delete set null,
  source                text not null check (source in ('ui', 'admin_correction', 'admin_force')),
  -- 管理員修正／補登／強制結束／單隊開始的原因
  reason                text,
  client_info           jsonb,
  voided_at             timestamptz,
  voided_by             uuid references public.identities(id) on delete set null,
  void_reason           text,
  replaces_record_id    uuid references public.check_records(id),
  -- 關主側 team_id 一律 NULL；隊輔側一定要有 team_id
  constraint check_records_side_chk check (
    (action in ('station_check_in', 'station_check_out') and team_id is null) or
    (action in ('team_check_in', 'team_check_out') and team_id is not null)
  ),
  constraint check_records_no_show_chk check (not no_show or action = 'station_check_out'),
  constraint check_records_single_team_chk check (not single_team_override or action = 'station_check_in'),
  constraint check_records_void_chk check ((voided_at is null) = (void_reason is null))
);
-- 有效紀錄唯一（NULLS NOT DISTINCT 讓 team_id NULL 的關主側紀錄也擋得住重複）
create unique index check_records_one_valid
  on public.check_records (assignment_id, action, team_id) nulls not distinct
  where voided_at is null;
create index check_records_assignment_idx on public.check_records (assignment_id);
create index check_records_team_idx on public.check_records (team_id);

-- ---------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------
create table public.notifications (
  id                       uuid primary key default gen_random_uuid(),
  kind                     text not null check (kind in (
                             'STATION_OVERTIME', 'TRANSITION_OVERDUE', 'STATION_NOT_STARTED',
                             'PREV_NOT_CHECKED_OUT', 'STATION_SHORTENED', 'SCHEDULE_ADJUSTED',
                             'SELF_UNDO', 'RECORD_MISMATCH')),
  game_id                  uuid not null references public.games(id) on delete cascade,
  subkind                  text,
  assignment_id            uuid references public.assignments(id) on delete cascade,
  team_id                  uuid references public.teams(id) on delete cascade,
  trigger_record_id        uuid references public.check_records(id) on delete cascade,
  trigger_adjustment_id    uuid references public.schedule_adjustments(id) on delete cascade,
  trigger_cancellation_id  uuid references public.assignment_cancellations(id) on delete cascade,
  -- 自訂決策：延長（end override）後再次超時視為新事件，因此 key 也包含 override
  trigger_override_id      uuid references public.assignment_end_overrides(id) on delete cascade,
  trigger_phase            text not null default 'CREATE' check (trigger_phase in ('CREATE', 'VOID')),
  message                  text not null,
  invalidated_at           timestamptz,
  created_at               timestamptz not null,           -- app_now()
  real_created_at          timestamptz not null default now()
);
create unique index notifications_once
  on public.notifications (kind, subkind, assignment_id, team_id, trigger_record_id,
                           trigger_adjustment_id, trigger_cancellation_id, trigger_override_id,
                           trigger_phase) nulls not distinct;
create index notifications_game_idx on public.notifications (game_id, created_at);

-- ---------------------------------------------------------------------
-- audit_logs
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id                 bigint generated always as identity primary key,
  actor_identity_id  uuid references public.identities(id) on delete set null,
  game_id            uuid references public.games(id) on delete set null,
  action             text not null,
  target_table       text,
  target_id          text,
  before             jsonb,
  after              jsonb,
  reason             text,
  client_info        jsonb,
  created_at         timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_action_idx on public.audit_logs (action);

-- ---------------------------------------------------------------------
-- login_attempts（登入鎖定用；不存在 server 記憶體）
-- ---------------------------------------------------------------------
create table public.login_attempts (
  id           bigint generated always as identity primary key,
  device_id    text not null,
  identity_id  uuid references public.identities(id) on delete cascade,
  success      boolean not null,
  created_at   timestamptz not null default now()
);
create index login_attempts_device_idx on public.login_attempts (device_id, created_at desc);
create index login_attempts_identity_idx on public.login_attempts (identity_id, created_at desc);

-- =====================================================================
-- 統一時鐘（第三十一節）
-- =====================================================================

-- 指定活動的 app 時間。sim 關閉 → now()；開啟 → anchor_virtual + (now() − anchor_real) × speed
create or replace function public.app_now_for_event(p_event_id uuid)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select case
              when e.sim_enabled then
                e.sim_anchor_virtual + (now() - e.sim_anchor_real) * e.sim_speed
              else now()
            end
       from public.events e
      where e.id = p_event_id),
    now()
  );
$$;

-- active event 的 app 時間（沒有 active event → now()）
create or replace function public.app_now()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select public.app_now_for_event(e.id) from public.events e where e.is_active limit 1),
    now()
  );
$$;

-- 前端校時用（anon 可呼叫，見 security migration）。
-- server_now 用 clock_timestamp()，前端以 server_now − Date.now() 求 offset。
create or replace function public.get_clock(p_event_id uuid default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'server_now',          clock_timestamp(),
    'event_id',            e.id,
    'app_now',             case
                             when e.sim_enabled then
                               e.sim_anchor_virtual + (clock_timestamp() - e.sim_anchor_real) * e.sim_speed
                             else clock_timestamp()
                           end,
    'sim_enabled',         coalesce(e.sim_enabled, false),
    'sim_speed',           coalesce(e.sim_speed, 1),
    'sim_anchor_real',     e.sim_anchor_real,
    'sim_anchor_virtual',  e.sim_anchor_virtual
  )
  from (select 1) one
  left join public.events e
    on e.id = coalesce(p_event_id, (select id from public.events where is_active limit 1));
$$;

-- =====================================================================
-- Views（security_invoker：anon 讀 view 時仍套用底層 table 的 RLS）
-- =====================================================================

-- 排程完整時間：所有程式一律從這裡取排程時間
create or replace view public.v_slot_times
with (security_invoker = true)
as
select
  ts.id                                                   as slot_id,
  ts.game_id,
  g.event_id,
  g.code                                                  as game_code,
  ts.slot_number,
  ts.start_local,
  ts.end_local,
  ((e.event_date + ts.start_local) at time zone e.timezone)                      as original_start,
  ((e.event_date + ts.end_local)   at time zone e.timezone)                      as original_end,
  coalesce(adj.total_offset_seconds, 0)::integer                                 as total_offset_seconds,
  ((e.event_date + ts.start_local) at time zone e.timezone)
    + make_interval(secs => coalesce(adj.total_offset_seconds, 0))              as scheduled_start,
  ((e.event_date + ts.end_local)   at time zone e.timezone)
    + make_interval(secs => coalesce(adj.total_offset_seconds, 0))              as scheduled_end
from public.time_slots ts
join public.games g  on g.id = ts.game_id
join public.events e on e.id = g.event_id
left join lateral (
  select sum(sa.offset_seconds) as total_offset_seconds
    from public.schedule_adjustments sa
   where sa.game_id = ts.game_id
     and sa.voided_at is null
     and sa.from_slot_number <= ts.slot_number
) adj on true;

-- 打卡紀錄 + 經 assignment join 得到的 game / slot / station（不重複存）
create or replace view public.v_check_records
with (security_invoker = true)
as
select cr.*, a.game_id, a.slot_id, a.station_id
  from public.check_records cr
  join public.assignments a on a.id = cr.assignment_id;

create or replace view public.v_assignment_cancellations
with (security_invoker = true)
as
select c.*, a.game_id
  from public.assignment_cancellations c
  join public.assignments a on a.id = c.assignment_id;

create or replace view public.v_assignment_end_overrides
with (security_invoker = true)
as
select o.*, a.game_id
  from public.assignment_end_overrides o
  join public.assignments a on a.id = o.assignment_id;
