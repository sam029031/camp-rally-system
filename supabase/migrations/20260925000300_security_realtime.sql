-- =====================================================================
-- 宿營跑關即時管理系統 — RLS / 權限 / Realtime
-- 規格：docs/SPEC.md 第二十節（登入與資料存取方式）、第二十二節、第二十七節；架構：docs/ARCHITECTURE.md 第 4 節
--
-- 原則：
-- - 前端只用 anon key 讀取與訂閱 Realtime；所有寫入走 Next.js server（service_role）呼叫 RPC。
-- - 排程與打卡類 table 對 anon / authenticated 只開 SELECT policy；identities、audit_logs、login_attempts 沒有 policy。
-- - 每個寫入用 function 都 REVOKE EXECUTE FROM PUBLIC, anon, authenticated（Postgres 預設把 EXECUTE 給 PUBLIC）。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. 所有 table enable RLS
-- ---------------------------------------------------------------------
alter table public.events                   enable row level security;
alter table public.games                    enable row level security;
alter table public.time_slots               enable row level security;
alter table public.stations                 enable row level security;
alter table public.teams                    enable row level security;
alter table public.assignments              enable row level security;
alter table public.identities               enable row level security;
alter table public.schedule_adjustments     enable row level security;
alter table public.assignment_cancellations enable row level security;
alter table public.assignment_end_overrides enable row level security;
alter table public.check_records            enable row level security;
alter table public.notifications            enable row level security;
alter table public.audit_logs               enable row level security;
alter table public.login_attempts           enable row level security;

-- ---------------------------------------------------------------------
-- 2. 公開 table：anon / authenticated 只有 SELECT policy（前端推導狀態與 Realtime 都需要）
--    identities（PIN hash）、audit_logs、login_attempts 不建立任何 policy
-- ---------------------------------------------------------------------
create policy events_public_read                   on public.events                   for select to anon, authenticated using (true);
create policy games_public_read                    on public.games                    for select to anon, authenticated using (true);
create policy time_slots_public_read               on public.time_slots               for select to anon, authenticated using (true);
create policy stations_public_read                 on public.stations                 for select to anon, authenticated using (true);
create policy teams_public_read                    on public.teams                    for select to anon, authenticated using (true);
create policy assignments_public_read              on public.assignments              for select to anon, authenticated using (true);
create policy check_records_public_read            on public.check_records            for select to anon, authenticated using (true);
create policy notifications_public_read            on public.notifications            for select to anon, authenticated using (true);
create policy schedule_adjustments_public_read     on public.schedule_adjustments     for select to anon, authenticated using (true);
create policy assignment_cancellations_public_read on public.assignment_cancellations for select to anon, authenticated using (true);
create policy assignment_end_overrides_public_read on public.assignment_end_overrides for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------
-- 3. Table 權限：anon / authenticated 不能寫任何 table（「不得 DELETE」也靠這個，reset 走 RPC）
-- ---------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke usage, select, update on all sequences in schema public from anon, authenticated;

-- 公開 table：明確給 SELECT（RLS policy 仍會套用）
grant select on
  public.events, public.games, public.time_slots, public.stations, public.teams, public.assignments,
  public.check_records, public.notifications, public.schedule_adjustments,
  public.assignment_cancellations, public.assignment_end_overrides
  to anon, authenticated;

-- 機密 table：連 SELECT 權限都不給（RLS 沒有 policy 之外再加一層）
revoke all on public.identities, public.audit_logs, public.login_attempts from anon, authenticated;

-- Views（security_invoker：仍套用底層 table 的 RLS；資料非機密）
grant select on public.v_slot_times, public.v_check_records,
                public.v_assignment_cancellations, public.v_assignment_end_overrides
  to anon, authenticated;

-- service_role（server 端與 scripts）保留完整權限（service_role 有 BYPASSRLS）
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------
-- 4. 寫入用 function：只給 service_role
-- ---------------------------------------------------------------------
revoke execute on function public.record_check(uuid, uuid, text, uuid, uuid, text, timestamptz, boolean, uuid[], boolean, text, jsonb) from public, anon, authenticated;
grant  execute on function public.record_check(uuid, uuid, text, uuid, uuid, text, timestamptz, boolean, uuid[], boolean, text, jsonb) to service_role;

revoke execute on function public.undo_check(uuid, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.undo_check(uuid, uuid, jsonb) to service_role;

revoke execute on function public.admin_void_record(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.admin_void_record(uuid, uuid, text, jsonb) to service_role;

revoke execute on function public.admin_correct_record(uuid, timestamptz, uuid, text, uuid, jsonb) from public, anon, authenticated;
grant  execute on function public.admin_correct_record(uuid, timestamptz, uuid, text, uuid, jsonb) to service_role;

revoke execute on function public.adjust_schedule(uuid, integer, text, integer, timestamptz, text, uuid) from public, anon, authenticated;
grant  execute on function public.adjust_schedule(uuid, integer, text, integer, timestamptz, text, uuid) to service_role;

revoke execute on function public.void_last_adjustment(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.void_last_adjustment(uuid, uuid, text) to service_role;

revoke execute on function public.cancel_assignments(uuid[], text, uuid) from public, anon, authenticated;
grant  execute on function public.cancel_assignments(uuid[], text, uuid) to service_role;

revoke execute on function public.void_cancellation(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.void_cancellation(uuid, uuid, text) to service_role;

revoke execute on function public.set_end_override(uuid, timestamptz, text, uuid) from public, anon, authenticated;
grant  execute on function public.set_end_override(uuid, timestamptz, text, uuid) to service_role;

revoke execute on function public.void_end_override(uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.void_end_override(uuid, uuid, text) to service_role;

revoke execute on function public.update_game_settings(uuid, text, integer, uuid) from public, anon, authenticated;
grant  execute on function public.update_game_settings(uuid, text, integer, uuid) to service_role;

revoke execute on function public.update_event_settings(uuid, date, text, text, text, uuid) from public, anon, authenticated;
grant  execute on function public.update_event_settings(uuid, date, text, text, text, uuid) to service_role;

revoke execute on function public.set_clock(uuid, boolean, double precision, timestamptz, uuid) from public, anon, authenticated;
grant  execute on function public.set_clock(uuid, boolean, double precision, timestamptz, uuid) to service_role;

revoke execute on function public.reset_game_records(uuid, uuid, text, boolean) from public, anon, authenticated;
grant  execute on function public.reset_game_records(uuid, uuid, text, boolean) to service_role;

revoke execute on function public.create_notification(text, text, uuid, uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function public.create_notification(text, text, uuid, uuid, uuid, uuid, uuid, text) to service_role;

revoke execute on function public.invalidate_notifications(uuid[]) from public, anon, authenticated;
grant  execute on function public.invalidate_notifications(uuid[]) to service_role;

revoke execute on function public.write_audit(uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb) from public, anon, authenticated;
grant  execute on function public.write_audit(uuid, uuid, text, text, text, jsonb, jsonb, text, jsonb) to service_role;

revoke execute on function public.login_lock_status(text, uuid) from public, anon, authenticated;
grant  execute on function public.login_lock_status(text, uuid) to service_role;

revoke execute on function public.record_login_attempt(text, uuid, boolean) from public, anon, authenticated;
grant  execute on function public.record_login_attempt(text, uuid, boolean) to service_role;

revoke execute on function public.set_identity_pin(uuid, text, uuid) from public, anon, authenticated;
grant  execute on function public.set_identity_pin(uuid, text, uuid) to service_role;

revoke execute on function public.begin_login_attempt(text, uuid) from public, anon, authenticated;
grant  execute on function public.begin_login_attempt(text, uuid) to service_role;

revoke execute on function public.finish_login_attempt(bigint, boolean) from public, anon, authenticated;
grant  execute on function public.finish_login_attempt(bigint, boolean) to service_role;

revoke execute on function public.set_identity_pins(uuid[], text[], uuid) from public, anon, authenticated;
grant  execute on function public.set_identity_pins(uuid[], text[], uuid) to service_role;

revoke execute on function public.revalidate_notifications(uuid[]) from public, anon, authenticated;
grant  execute on function public.revalidate_notifications(uuid[]) to service_role;

-- 內部輔助 function（RPC 內部使用，不對外）
revoke execute on function public._fmt_hm(timestamptz) from public, anon, authenticated;
grant  execute on function public._fmt_hm(timestamptz) to service_role;
revoke execute on function public._fmt_hms(timestamptz) from public, anon, authenticated;
grant  execute on function public._fmt_hms(timestamptz) to service_role;
revoke execute on function public._fmt_duration(integer) from public, anon, authenticated;
grant  execute on function public._fmt_duration(integer) to service_role;
revoke execute on function public._fmt_offset(integer) from public, anon, authenticated;
grant  execute on function public._fmt_offset(integer) to service_role;
revoke execute on function public._rejected(text) from public, anon, authenticated;
grant  execute on function public._rejected(text) to service_role;
revoke execute on function public._record_json(uuid) from public, anon, authenticated;
grant  execute on function public._record_json(uuid) to service_role;
revoke execute on function public._is_cancelled(uuid) from public, anon, authenticated;
grant  execute on function public._is_cancelled(uuid) to service_role;
revoke execute on function public._action_label(text, boolean) from public, anon, authenticated;
grant  execute on function public._action_label(text, boolean) to service_role;
revoke execute on function public._assignment_teams_label(uuid) from public, anon, authenticated;
grant  execute on function public._assignment_teams_label(uuid) to service_role;
revoke execute on function public._station_neighbor(uuid, integer) from public, anon, authenticated;
grant  execute on function public._station_neighbor(uuid, integer) to service_role;
revoke execute on function public._lock_assignments(uuid[]) from public, anon, authenticated;
grant  execute on function public._lock_assignments(uuid[]) to service_role;
revoke execute on function public._lock_teams(uuid[]) from public, anon, authenticated;
grant  execute on function public._lock_teams(uuid[]) to service_role;
revoke execute on function public._record_lock_set(uuid) from public, anon, authenticated;
grant  execute on function public._record_lock_set(uuid) to service_role;
revoke execute on function public._reject_check(text, uuid, uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant  execute on function public._reject_check(text, uuid, uuid, uuid, jsonb, text, jsonb) to service_role;
revoke execute on function public._void_record(uuid, uuid, text, text, jsonb) from public, anon, authenticated;
grant  execute on function public._void_record(uuid, uuid, text, text, jsonb) to service_role;

-- trigger function 不需要任何人直接呼叫
revoke execute on function public.assignments_shape_guard() from public, anon, authenticated;

-- 保險：public schema 裡除了下面三個唯讀校時 function 以外，任何 function 都不給 PUBLIC / anon / authenticated
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname not in ('app_now', 'app_now_for_event', 'get_clock')
       -- 只處理本專案 migration 建立的（屬於目前角色，不碰 extension 的 function）
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. 唯讀校時 function：anon 可呼叫（第三十一節前端校時）
-- ---------------------------------------------------------------------
grant execute on function public.app_now() to anon, authenticated, service_role;
grant execute on function public.app_now_for_event(uuid) to anon, authenticated, service_role;
grant execute on function public.get_clock(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Realtime（第二十七節）：漏掉會靜默收不到任何事件
-- ---------------------------------------------------------------------
do $$
begin
  -- 本機純 Postgres（非 Supabase）沒有這個 publication 時先建立；Supabase 一定已經有
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;

alter publication supabase_realtime add table
  public.check_records, public.notifications, public.events, public.games,
  public.schedule_adjustments, public.assignment_cancellations, public.assignment_end_overrides;
