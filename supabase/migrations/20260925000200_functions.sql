-- =====================================================================
-- 宿營跑關即時管理系統 — 寫入用 RPC（全部只給 service_role 執行，見 20260925000300_security_realtime.sql）
-- 規格：docs/SPEC.md 第六、八、九、十五、十八、二十一、二十二、二十四、二十四之二、二十五、二十六、三十一節
-- 介面：docs/ARCHITECTURE.md 第 4 節
--
-- 共通規則：
-- - 規則拒絕一律 RETURN jsonb {status:'rejected', code}（不 raise，讓 audit log 能 commit）；只有程式錯誤才 raise。
-- - 回傳的打卡紀錄一律是 v_check_records 的一列（to_jsonb）。
-- - 「現在」一律用 app_now_for_event(該遊戲的 event_id)；現場撤銷 75 秒與登入鎖用真實時間 now()。
-- - 免死結的鎖定順序（所有 function 共用）：
--     games（FOR NO KEY UPDATE，只有排程調整／reset 用）
--     → assignments（一個 statement、ORDER BY id FOR UPDATE）
--     → teams（一個 statement、ORDER BY id FOR UPDATE）
--   任何 function 取得 teams 鎖之後都不會再鎖 assignments；取得 assignments 鎖之後不會再鎖 games。
--   games 用 FOR NO KEY UPDATE 而不是 FOR UPDATE：新增 notifications 時 FK 檢查會對 games 取 FOR KEY SHARE，
--   FOR UPDATE 會與它互斥而造成死結。
-- - 時間格式化一律 Asia/Taipei。
-- =====================================================================

-- =====================================================================
-- 內部輔助 function（不對外；security migration 一樣只給 service_role）
-- =====================================================================

-- 'HH:MM'（Asia/Taipei）
create or replace function public._fmt_hm(p_ts timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_ts at time zone 'Asia/Taipei', 'HH24:MI');
$$;

-- 'HH:MM:SS'（Asia/Taipei）
create or replace function public._fmt_hms(p_ts timestamptz)
returns text
language sql
stable
set search_path = public
as $$
  select to_char(p_ts at time zone 'Asia/Taipei', 'HH24:MI:SS');
$$;

-- 秒數 → 'MM:SS'（>= 1 小時 'H:MM:SS'；負數視為 0）
create or replace function public._fmt_duration(p_seconds integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when s >= 3600 then
             format('%s:%s:%s', s / 3600, lpad(((s % 3600) / 60)::text, 2, '0'), lpad((s % 60)::text, 2, '0'))
           else
             format('%s:%s', lpad((s / 60)::text, 2, '0'), lpad((s % 60)::text, 2, '0'))
         end
    from (select greatest(coalesce(p_seconds, 0), 0) as s) x;
$$;

-- 調整量（秒，取絕對值）→ '10 分鐘' / '1 分 30 秒'
create or replace function public._fmt_offset(p_seconds integer)
returns text
language sql
immutable
set search_path = public
as $$
  select case
           when s % 60 = 0 then format('%s 分鐘', s / 60)
           when s < 60 then format('%s 秒', s)
           else format('%s 分 %s 秒', s / 60, s % 60)
         end
    from (select abs(coalesce(p_seconds, 0)) as s) x;
$$;

create or replace function public._rejected(p_code text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select jsonb_build_object('status', 'rejected', 'code', p_code);
$$;

-- v_check_records 形狀的一筆紀錄
create or replace function public._record_json(p_record_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(v) from public.v_check_records v where v.id = p_record_id;
$$;

-- assignment 是否有有效取消（第二十四之二節）
create or replace function public._is_cancelled(p_assignment_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.assignment_cancellations c
     where c.assignment_id = p_assignment_id and c.voided_at is null
  );
$$;

-- 動作的中文（撤銷通知用）
create or replace function public._action_label(p_action text, p_no_show boolean)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_action
           when 'station_check_in'  then '確認進關'
           when 'station_check_out' then case when coalesce(p_no_show, false) then '本隊未到' else '確認出關' end
           when 'team_check_in'     then '確認進關'
           when 'team_check_out'    then '確認出關'
           else p_action
         end;
$$;

-- assignment 的隊伍文字：黃金「第2小隊」、大地「第2小隊 vs 第4小隊」
create or replace function public._assignment_teams_label(p_assignment_id uuid)
returns text
language sql
stable
set search_path = public
as $$
  select case
           when tb.id is null then ta.name
           else ta.name || ' vs ' || tb.name
         end
    from public.assignments a
    join public.teams ta on ta.id = a.team_a_id
    left join public.teams tb on tb.id = a.team_b_id
   where a.id = p_assignment_id;
$$;

-- 同一關卡「上一個／下一個」assignment：依時段，跳過休息（沒有 assignment）與被取消的（第二十一節）
create or replace function public._station_neighbor(p_assignment_id uuid, p_direction integer)
returns uuid
language sql
stable
set search_path = public
as $$
  select a2.id
    from public.assignments a
    join public.time_slots s  on s.id = a.slot_id
    join public.assignments a2 on a2.station_id = a.station_id and a2.id <> a.id
    join public.time_slots s2 on s2.id = a2.slot_id
   where a.id = p_assignment_id
     and ((p_direction < 0 and s2.slot_number < s.slot_number)
       or (p_direction > 0 and s2.slot_number > s.slot_number))
     and not public._is_cancelled(a2.id)
   order by case when p_direction < 0 then -s2.slot_number else s2.slot_number end
   limit 1;
$$;

-- 一次鎖定 assignments（單一 statement、依 id 排序）
create or replace function public._lock_assignments(p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.assignments where id = any(coalesce(p_ids, '{}'::uuid[])) order by id for update;
end;
$$;

-- 一次鎖定 teams（單一 statement、依 id 排序；一律在 assignments 之後）
create or replace function public._lock_teams(p_ids uuid[])
returns void
language plpgsql
set search_path = public
as $$
begin
  perform 1 from public.teams where id = any(coalesce(p_ids, '{}'::uuid[])) order by id for update;
end;
$$;

-- 撤銷／修正紀錄時要鎖的 assignments：本關所有場次 ∪ 相關隊伍在本遊戲的所有場次
-- （涵蓋「本關下一場」與「隊伍的下一關」，也不怕同時有人取消／撤銷取消改變「下一個」是誰）
create or replace function public._record_lock_set(p_assignment_id uuid)
returns uuid[]
language sql
stable
set search_path = public
as $$
  select coalesce(array_agg(distinct a2.id), '{}'::uuid[])
    from public.assignments a
    join public.assignments a2
      on a2.station_id = a.station_id
      or (a2.game_id = a.game_id and (
            a2.team_a_id in (a.team_a_id, a.team_b_id)
         or a2.team_b_id in (a.team_a_id, a.team_b_id)))
   where a.id = p_assignment_id;
$$;

-- =====================================================================
-- write_audit（第六節 audit_logs）
-- =====================================================================
create or replace function public.write_audit(
  p_actor uuid,
  p_game_id uuid,
  p_action text,
  p_target_table text,
  p_target_id text,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_client_info jsonb
)
returns void
language plpgsql
set search_path = public
as $$
begin
  insert into public.audit_logs
    (actor_identity_id, game_id, action, target_table, target_id, before, after, reason, client_info)
  values
    (p_actor, p_game_id, p_action, p_target_table, p_target_id, p_before, p_after, p_reason, p_client_info);
end;
$$;

-- record_check 被拒絕時：寫 audit REJECTED_CHECK 並回傳 rejected（第二十一節：不寫入，但寫 audit log）
create or replace function public._reject_check(
  p_code text,
  p_identity_id uuid,
  p_game_id uuid,
  p_assignment_id uuid,
  p_request jsonb,
  p_reason text,
  p_client_info jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  perform public.write_audit(
    -- identity 不存在時不能填（FK）
    (select id from public.identities where id = p_identity_id),
    p_game_id,
    'REJECTED_CHECK',
    'assignments',
    p_assignment_id::text,
    null,
    coalesce(p_request, '{}'::jsonb) || jsonb_build_object('code', p_code),
    p_reason,
    p_client_info
  );
  return public._rejected(p_code);
end;
$$;

-- =====================================================================
-- record_check：所有打卡的唯一入口（第二十一節）
-- 固定順序：(1) client_request_id → existing；(2) 鎖；(3) 驗規則；(4) INSERT … ON CONFLICT DO NOTHING
-- =====================================================================
create or replace function public.record_check(
  p_client_request_id uuid,
  p_assignment_id uuid,
  p_action text,
  p_team_id uuid,
  p_identity_id uuid,
  p_source text default 'ui',
  p_recorded_at timestamptz default null,
  p_no_show boolean default false,
  p_confirmed_team_ids uuid[] default null,
  p_single_team_override boolean default false,
  p_reason text default null,
  p_client_info jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_source      text    := coalesce(p_source, 'ui');
  v_no_show     boolean := coalesce(p_no_show, false);
  v_single      boolean := coalesce(p_single_team_override, false);
  v_reason      text    := nullif(btrim(coalesce(p_reason, '')), '');
  v_request     jsonb;
  v_existing    public.check_records;
  v_a           public.assignments;
  v_game        public.games;
  v_station     public.stations;
  v_ident       public.identities;
  v_slot_no     integer;
  v_slot_start  timestamptz;
  v_slot_end    timestamptz;
  v_station_side boolean;
  v_now         timestamptz;
  v_recorded_at timestamptz;
  v_lock_ids    uuid[];
  v_team_ids    uuid[];
  v_allowed     uuid[];
  v_confirmed   uuid[];
  v_prev_id     uuid;
  v_ci          public.check_records;
  v_co          public.check_records;
  v_tci         public.check_records;
  v_tco         public.check_records;
  v_has_ci      boolean := false;
  v_has_co      boolean := false;
  v_has_tci     boolean := false;
  v_has_tco     boolean := false;
  v_override_end timestamptz;
  v_started     timestamptz;
  v_official_end timestamptz;
  v_playable    integer;
  v_new_id      uuid;
  v_record      jsonb;
begin
  v_request := jsonb_build_object(
    'client_request_id',    p_client_request_id,
    'assignment_id',        p_assignment_id,
    'action',               p_action,
    'team_id',              p_team_id,
    'source',               v_source,
    'recorded_at',          p_recorded_at,
    'no_show',              v_no_show,
    'confirmed_team_ids',   to_jsonb(p_confirmed_team_ids),
    'single_team_override', v_single
  );

  if p_client_request_id is null then
    return public._reject_check('INVALID_REQUEST', p_identity_id, null, p_assignment_id, v_request, v_reason, p_client_info);
  end if;

  -- (1) 冪等：同一個 client_request_id 已存在 → 直接回傳那一筆（已撤銷也回傳並標示），不驗規則
  select * into v_existing from public.check_records where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object(
      'status', 'existing',
      'record', public._record_json(v_existing.id),
      'voided', v_existing.voided_at is not null
    );
  end if;

  -- 參數形狀
  if p_action is null or p_action not in ('station_check_in', 'station_check_out', 'team_check_in', 'team_check_out') then
    return public._reject_check('INVALID_ACTION', p_identity_id, null, p_assignment_id, v_request, v_reason, p_client_info);
  end if;
  if v_source not in ('ui', 'admin_correction', 'admin_force') then
    return public._reject_check('INVALID_REQUEST', p_identity_id, null, p_assignment_id, v_request, v_reason, p_client_info);
  end if;

  select * into v_a from public.assignments where id = p_assignment_id;
  if not found then
    return public._reject_check('ASSIGNMENT_NOT_FOUND', p_identity_id, null, p_assignment_id, v_request, v_reason, p_client_info);
  end if;
  select * into v_game from public.games where id = v_a.game_id;
  select * into v_station from public.stations where id = v_a.station_id;
  select st.slot_number, st.scheduled_start, st.scheduled_end
    into v_slot_no, v_slot_start, v_slot_end
    from public.v_slot_times st where st.slot_id = v_a.slot_id;

  v_station_side := p_action in ('station_check_in', 'station_check_out');

  -- 身分（第二十節；RPC 內再檢查一次）
  select * into v_ident from public.identities where id = p_identity_id;
  if not found then
    return public._reject_check('FORBIDDEN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;
  if not v_ident.is_active then
    return public._reject_check('IDENTITY_INACTIVE', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;
  if v_ident.role = 'VIEWER' then
    return public._reject_check('FORBIDDEN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;

  -- 兩側的 team_id 規則（第七節）
  if v_station_side then
    if p_team_id is not null then
      return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
  else
    if p_team_id is null then
      return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
    if p_team_id is distinct from v_a.team_a_id and p_team_id is distinct from v_a.team_b_id then
      return public._reject_check('TEAM_NOT_IN_ASSIGNMENT', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
  end if;

  -- 角色權限：STATION 只能自己關卡的關主側；TEAM 只能自己隊的隊輔側；ADMIN 全部
  if v_ident.role = 'STATION' then
    if not v_station_side or v_ident.station_id is distinct from v_a.station_id then
      return public._reject_check('FORBIDDEN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
  elsif v_ident.role = 'TEAM' then
    if v_station_side or v_ident.team_id is distinct from p_team_id then
      return public._reject_check('FORBIDDEN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
  end if;
  if v_source <> 'ui' and v_ident.role <> 'ADMIN' then
    return public._reject_check('FORBIDDEN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;

  -- 旗標與來源的組合
  if v_no_show and p_action <> 'station_check_out' then
    return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;
  if v_single then
    if p_action <> 'station_check_in' or v_game.teams_per_station <> 2 then
      return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
    if v_ident.role <> 'ADMIN' then
      return public._reject_check('FORBIDDEN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
    if v_reason is null then
      return public._reject_check('REASON_REQUIRED', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
  end if;
  if v_source = 'admin_force' and (p_action <> 'station_check_out' or v_no_show) then
    return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;
  if v_source = 'admin_correction' then
    if p_recorded_at is null then
      return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
  elsif p_recorded_at is not null then
    -- ui / admin_force 的時間一律由 DB 產生，不接受傳入（第七節）
    return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;
  if v_source <> 'ui' and v_reason is null then
    return public._reject_check('REASON_REQUIRED', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;

  -- (2) 鎖定（免死結順序：assignments 一次鎖完 → teams 一次鎖完）
  if v_station_side then
    -- 關主側：本關所有場次（包含上一場／下一場，配合撤銷出關的順序保護）
    select array_agg(id) into v_lock_ids from public.assignments where station_id = v_a.station_id;
    v_team_ids := array_remove(array[v_a.team_a_id, v_a.team_b_id], null);
  else
    v_lock_ids := array[v_a.id];
    v_team_ids := array[p_team_id];
  end if;
  perform public._lock_assignments(v_lock_ids);
  perform public._lock_teams(v_team_ids);

  -- 取得鎖之後重新檢查：同一個 client_request_id 的並行請求可能已經 commit
  select * into v_existing from public.check_records where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object(
      'status', 'existing',
      'record', public._record_json(v_existing.id),
      'voided', v_existing.voided_at is not null
    );
  end if;

  -- 重新檢查：同 assignment / action / team 已有有效紀錄（別支手機先按）→ already_recorded
  select * into v_existing
    from public.check_records
   where assignment_id = v_a.id and action = p_action
     and team_id is not distinct from p_team_id and voided_at is null;
  if found then
    perform public.write_audit(v_ident.id, v_game.id, 'DUPLICATE_ATTEMPT', 'check_records', v_existing.id::text,
                               null, v_request, v_reason, p_client_info);
    return jsonb_build_object('status', 'already_recorded', 'record', public._record_json(v_existing.id));
  end if;

  -- (3) 驗規則
  v_now := public.app_now_for_event(v_game.event_id);
  v_recorded_at := case when v_source = 'admin_correction' then p_recorded_at else v_now end;

  if v_source = 'admin_correction' and p_recorded_at > v_now then
    -- 補登不能是未來時間
    return public._reject_check('INVALID_REQUEST', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;

  if public._is_cancelled(v_a.id) then
    return public._reject_check('ASSIGNMENT_CANCELLED', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
  end if;

  select * into v_ci from public.check_records
   where assignment_id = v_a.id and action = 'station_check_in' and voided_at is null;
  v_has_ci := found;
  select * into v_co from public.check_records
   where assignment_id = v_a.id and action = 'station_check_out' and voided_at is null;
  v_has_co := found;
  if not v_station_side then
    select * into v_tci from public.check_records
     where assignment_id = v_a.id and action = 'team_check_in' and team_id = p_team_id and voided_at is null;
    v_has_tci := found;
    select * into v_tco from public.check_records
     where assignment_id = v_a.id and action = 'team_check_out' and team_id = p_team_id and voided_at is null;
    v_has_tco := found;
  end if;

  if p_action = 'station_check_in' then
    -- 同側「出關 >= 進關」（本隊未到之後不能再進關）
    if v_has_co and (v_co.no_show or v_co.recorded_at < v_recorded_at) then
      return public._reject_check('CHECKOUT_BEFORE_CHECKIN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
    -- 「下一關尚未到就誤按」用順序擋：本關上一場（跳過休息與取消）必須已出關；管理員補登不受此限
    if v_source <> 'admin_correction' then
      v_prev_id := public._station_neighbor(v_a.id, -1);
      if v_prev_id is not null and not exists (
        select 1 from public.check_records
         where assignment_id = v_prev_id and action = 'station_check_out' and voided_at is null
      ) then
        return public._reject_check('PREV_ASSIGNMENT_NOT_CHECKED_OUT', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
    end if;
    -- FIXED_END：時段已結束且沒有「未來的有效 override」→ SLOT_ALREADY_ENDED（第八節）
    select official_end into v_override_end
      from public.assignment_end_overrides where assignment_id = v_a.id and voided_at is null;
    if v_game.end_policy = 'FIXED_END' and v_source in ('ui', 'admin_force')
       and v_now >= v_slot_end and not coalesce(v_override_end > v_now, false) then
      return public._reject_check('SLOT_ALREADY_ENDED', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
    -- 勾選的隊伍（第十八節）
    v_allowed := array_remove(array[v_a.team_a_id, v_a.team_b_id], null);
    if p_confirmed_team_ids is not null and not (p_confirmed_team_ids <@ v_allowed) then
      return public._reject_check('TEAM_NOT_IN_ASSIGNMENT', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;
    if v_game.teams_per_station = 2 then
      if p_confirmed_team_ids is not null and p_confirmed_team_ids @> v_allowed then
        v_confirmed := p_confirmed_team_ids;
        v_single := false;             -- 兩隊都勾了就不是單隊開始
      elsif v_source = 'admin_correction' and not v_single then
        v_confirmed := coalesce(p_confirmed_team_ids, v_allowed);
      elsif v_single then
        v_confirmed := coalesce(p_confirmed_team_ids, '{}'::uuid[]);
      else
        return public._reject_check('BOTH_TEAMS_REQUIRED', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
    else
      v_confirmed := p_confirmed_team_ids;
    end if;

  elsif p_action = 'station_check_out' then
    if v_no_show then
      -- 本隊未到：必須沒有有效關主進關，且時段預定結束後才能按（第二十一節）
      if v_has_ci then
        return public._reject_check('NO_SHOW_HAS_CHECK_IN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
      if v_recorded_at < v_slot_end then
        return public._reject_check('NO_SHOW_TOO_EARLY', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
      if v_source <> 'admin_correction' then
        v_prev_id := public._station_neighbor(v_a.id, -1);
        if v_prev_id is not null and not exists (
          select 1 from public.check_records
           where assignment_id = v_prev_id and action = 'station_check_out' and voided_at is null
        ) then
          return public._reject_check('PREV_ASSIGNMENT_NOT_CHECKED_OUT', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
        end if;
      end if;
    else
      if not v_has_ci then
        return public._reject_check('NO_STATION_CHECK_IN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
      if v_recorded_at < v_ci.recorded_at then
        return public._reject_check('CHECKOUT_BEFORE_CHECKIN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
    end if;

  else
    -- 隊輔側：不能對「比自己已有紀錄的 assignment 更早」的 assignment 打卡（管理員修正不受此限）
    if v_source <> 'admin_correction' and exists (
      select 1
        from public.check_records r
        join public.assignments a2 on a2.id = r.assignment_id
        join public.time_slots s2 on s2.id = a2.slot_id
       where r.team_id = p_team_id
         and r.voided_at is null
         and r.action in ('team_check_in', 'team_check_out')
         and a2.game_id = v_a.game_id
         and s2.slot_number > v_slot_no
         and not public._is_cancelled(a2.id)
    ) then
      return public._reject_check('TEAM_OUT_OF_ORDER', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
    end if;

    if p_action = 'team_check_in' then
      if v_has_tco and v_tco.recorded_at < v_recorded_at then
        return public._reject_check('CHECKOUT_BEFORE_CHECKIN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
    else
      -- team_check_out：需該隊已確認進關，或關主已進關（隊輔漏按進關仍可出關，異常清單另外標示）
      if not v_has_tci and not v_has_ci then
        return public._reject_check('TEAM_NOT_CHECKED_IN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
      if v_has_tci and v_recorded_at < v_tci.recorded_at then
        return public._reject_check('CHECKOUT_BEFORE_CHECKIN', p_identity_id, v_game.id, v_a.id, v_request, v_reason, p_client_info);
      end if;
    end if;
  end if;

  -- (4) INSERT；ON CONFLICT 的條件與 check_records_one_valid 相同才推得到它
  begin
    insert into public.check_records (
      client_request_id, assignment_id, action, team_id, no_show, single_team_override, confirmed_team_ids,
      recorded_at, identity_id, source, reason, client_info
    ) values (
      p_client_request_id, v_a.id, p_action, p_team_id, v_no_show,
      v_single, case when p_action = 'station_check_in' then v_confirmed else null end,
      v_recorded_at, v_ident.id, v_source,
      case when v_source <> 'ui' or v_single then v_reason else null end,
      p_client_info
    )
    on conflict (assignment_id, action, team_id) where voided_at is null do nothing
    returning id into v_new_id;
  exception when unique_violation then
    -- 只可能是 client_request_id 撞到（同一個 id 的並行請求用在不同 assignment）
    select * into v_existing from public.check_records where client_request_id = p_client_request_id;
    if found then
      return jsonb_build_object(
        'status', 'existing',
        'record', public._record_json(v_existing.id),
        'voided', v_existing.voided_at is not null
      );
    end if;
    raise;
  end;

  if v_new_id is null then
    select * into v_existing
      from public.check_records
     where assignment_id = v_a.id and action = p_action
       and team_id is not distinct from p_team_id and voided_at is null;
    perform public.write_audit(v_ident.id, v_game.id, 'DUPLICATE_ATTEMPT', 'check_records', v_existing.id::text,
                               null, v_request, v_reason, p_client_info);
    return jsonb_build_object('status', 'already_recorded', 'record', public._record_json(v_existing.id));
  end if;

  v_record := public._record_json(v_new_id);

  -- audit（第六節要記錄的項目）
  if v_source = 'admin_correction' then
    perform public.write_audit(v_ident.id, v_game.id, 'ADMIN_ADD', 'check_records', v_new_id::text,
                               null, v_record, v_reason, p_client_info);
  elsif v_source = 'admin_force' then
    perform public.write_audit(v_ident.id, v_game.id, 'ADMIN_FORCE_END', 'check_records', v_new_id::text,
                               null, v_record, v_reason, p_client_info);
  end if;
  if v_no_show then
    perform public.write_audit(v_ident.id, v_game.id, 'NO_SHOW', 'check_records', v_new_id::text,
                               null, v_record, v_reason, p_client_info);
  end if;
  if v_single then
    perform public.write_audit(v_ident.id, v_game.id, 'SINGLE_TEAM_START', 'check_records', v_new_id::text,
                               null, v_record, v_reason, p_client_info);
  end if;

  -- STATION_SHORTENED（第八、十五節）：FIXED_END 關主開始時可玩時間 < min_play_seconds，同一 transaction 建立
  if p_action = 'station_check_in' and v_source = 'ui' and v_game.end_policy = 'FIXED_END' then
    v_started := greatest(v_recorded_at, v_slot_start);
    v_official_end := coalesce(v_override_end,
                               least(v_started + make_interval(secs => v_game.station_duration_seconds), v_slot_end));
    -- 顯示用秒數無條件進位（同前端倒數），比較用精確的 interval
    v_playable := ceil(extract(epoch from (v_official_end - v_started)))::integer;
    if v_official_end - v_started < make_interval(secs => v_game.min_play_seconds) then
      insert into public.notifications (kind, game_id, assignment_id, trigger_record_id, message, created_at)
      values (
        'STATION_SHORTENED', v_game.id, v_a.id, v_new_id,
        format('%s 第%s時段 本場只剩 %s（至 %s 結束）',
               v_station.name, v_slot_no, public._fmt_duration(v_playable), public._fmt_hm(v_official_end)),
        v_now
      )
      on conflict do nothing;
    end if;
  end if;

  return jsonb_build_object('status', 'created', 'record', v_record);
end;
$$;

-- =====================================================================
-- 撤銷（第二十二節）：現場撤銷與 ADMIN 撤銷共用
-- p_mode = 'self'：同 identity、真實時間 75 秒內、含「隊伍已到下一關」保護
-- p_mode = 'admin'：ADMIN、原因必填、不檢查「隊伍已到下一關」
-- =====================================================================
create or replace function public._void_record(
  p_record_id uuid,
  p_identity_id uuid,
  p_mode text,
  p_reason text,
  p_client_info jsonb
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_r        public.check_records;
  v_a        public.assignments;
  v_game     public.games;
  v_station  public.stations;
  v_ident    public.identities;
  v_slot_no  integer;
  v_teams    uuid[];
  v_next_id  uuid;
  v_now      timestamptz;
  v_before   jsonb;
  v_after    jsonb;
  v_actor    text;
  v_target   text;
begin
  select * into v_r from public.check_records where id = p_record_id;
  if not found then
    return public._rejected('RECORD_NOT_FOUND');
  end if;
  select * into v_a from public.assignments where id = v_r.assignment_id;
  select * into v_game from public.games where id = v_a.game_id;
  select * into v_station from public.stations where id = v_a.station_id;
  select slot_number into v_slot_no from public.time_slots where id = v_a.slot_id;

  select * into v_ident from public.identities where id = p_identity_id;
  if not found then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if p_mode = 'admin' then
    if v_ident.role <> 'ADMIN' then
      return public._rejected('FORBIDDEN');
    end if;
    if v_reason is null then
      return public._rejected('REASON_REQUIRED');
    end if;
  else
    if v_ident.role = 'VIEWER' then
      return public._rejected('FORBIDDEN');
    end if;
    if v_r.identity_id is distinct from v_ident.id then
      return public._rejected('UNDO_NOT_OWNER');
    end if;
  end if;

  -- 鎖：本關所有場次 ∪ 相關隊伍的所有場次 → 相關隊伍
  -- （撤銷出關與下一關進關同時送出時，兩邊都鎖到同一批列，只會有一個成功）
  v_teams := array_remove(array[v_a.team_a_id, v_a.team_b_id], null);
  perform public._lock_assignments(public._record_lock_set(v_a.id));
  perform public._lock_teams(v_teams);

  -- 取得鎖之後重讀
  select * into v_r from public.check_records where id = p_record_id;
  if v_r.voided_at is not null then
    return public._rejected('ALREADY_VOIDED');
  end if;

  -- 現場撤銷：真實時間 75 秒（不受 Demo 倍速影響）
  if p_mode = 'self' and now() - v_r.real_created_at > interval '75 seconds' then
    return public._rejected('UNDO_WINDOW_EXPIRED');
  end if;

  -- 順序保護
  if v_r.action = 'station_check_out' then
    v_next_id := public._station_neighbor(v_a.id, 1);
    if v_next_id is not null and exists (
      select 1 from public.check_records
       where assignment_id = v_next_id and action = 'station_check_in' and voided_at is null
    ) then
      return public._rejected('UNDO_NEXT_CHECKED_IN');
    end if;
    if p_mode = 'self' and exists (
      select 1
        from public.check_records r
        join public.assignments a2 on a2.id = r.assignment_id
        join public.time_slots s2 on s2.id = a2.slot_id
       where a2.game_id = v_a.game_id
         and s2.slot_number > v_slot_no
         and r.voided_at is null
         and not public._is_cancelled(a2.id)
         and (
              (r.action = 'team_check_in' and r.team_id = any(v_teams))
           or (r.action = 'station_check_in' and (a2.team_a_id = any(v_teams) or a2.team_b_id = any(v_teams)))
         )
    ) then
      return public._rejected('UNDO_TEAM_ARRIVED_NEXT');
    end if;
  elsif v_r.action = 'station_check_in' then
    if exists (
      select 1 from public.check_records
       where assignment_id = v_a.id and action = 'station_check_out' and voided_at is null
    ) then
      return public._rejected('UNDO_CHECKIN_HAS_CHECKOUT');
    end if;
  elsif v_r.action = 'team_check_in' then
    if exists (
      select 1 from public.check_records
       where assignment_id = v_a.id and action = 'team_check_out' and team_id = v_r.team_id and voided_at is null
    ) then
      return public._rejected('UNDO_CHECKIN_HAS_CHECKOUT');
    end if;
  end if;

  v_now := public.app_now_for_event(v_game.event_id);
  v_before := public._record_json(v_r.id);

  update public.check_records
     set voided_at   = v_now,
         voided_by   = v_ident.id,
         void_reason = case when p_mode = 'self' then 'SELF_UNDO' else v_reason end
   where id = v_r.id;

  -- 以這筆為 trigger 的通知一律標記已解除
  update public.notifications
     set invalidated_at = v_now
   where trigger_record_id = v_r.id and invalidated_at is null;

  v_after := public._record_json(v_r.id);

  if p_mode = 'self' then
    -- SELF_UNDO 通知（B 類，只進通知中心）
    v_actor := case v_ident.role
                 when 'STATION' then coalesce((select name from public.stations where id = v_ident.station_id), v_ident.label) || '關主'
                 when 'TEAM'    then coalesce((select name from public.teams where id = v_ident.team_id), v_ident.label) || '隊輔'
                 else v_ident.label
               end;
    if v_r.team_id is not null then
      v_target := (select name from public.teams where id = v_r.team_id) || ' ' || v_station.name;
    elsif v_ident.role = 'STATION' and v_ident.station_id = v_a.station_id then
      v_target := public._assignment_teams_label(v_a.id);
    else
      v_target := v_station.name || ' ' || public._assignment_teams_label(v_a.id);
    end if;

    insert into public.notifications (kind, game_id, assignment_id, team_id, trigger_record_id, message, created_at)
    values (
      'SELF_UNDO', v_game.id, v_a.id, v_r.team_id, v_r.id,
      format('%s 撤銷【%s %s】', v_actor, v_target, public._action_label(v_r.action, v_r.no_show)),
      v_now
    )
    on conflict do nothing;

    perform public.write_audit(v_ident.id, v_game.id, 'SELF_UNDO', 'check_records', v_r.id::text,
                               v_before, v_after, null, p_client_info);
  else
    perform public.write_audit(v_ident.id, v_game.id, 'ADMIN_VOID', 'check_records', v_r.id::text,
                               v_before, v_after, v_reason, p_client_info);
  end if;

  return jsonb_build_object('status', 'voided', 'record', v_after);
end;
$$;

create or replace function public.undo_check(
  p_record_id uuid,
  p_identity_id uuid,
  p_client_info jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  return public._void_record(p_record_id, p_identity_id, 'self', null, p_client_info);
end;
$$;

create or replace function public.admin_void_record(
  p_record_id uuid,
  p_identity_id uuid,
  p_reason text,
  p_client_info jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  return public._void_record(p_record_id, p_identity_id, 'admin', p_reason, p_client_info);
end;
$$;

-- =====================================================================
-- admin_correct_record：修正時間（第二十二節）
-- 同一 transaction：撤銷原紀錄 + 新增 source='admin_correction'（replaces_record_id = 原紀錄）
-- 寫入前先驗同側「出關 >= 進關」
-- =====================================================================
create or replace function public.admin_correct_record(
  p_record_id uuid,
  p_new_recorded_at timestamptz,
  p_identity_id uuid,
  p_reason text,
  p_client_request_id uuid,
  p_client_info jsonb default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_r       public.check_records;
  v_a       public.assignments;
  v_game    public.games;
  v_ident   public.identities;
  v_other   public.check_records;
  v_existing public.check_records;
  v_now     timestamptz;
  v_before  jsonb;
  v_new_id  uuid;
  v_record  jsonb;
begin
  if p_client_request_id is null or p_new_recorded_at is null then
    return public._rejected('INVALID_REQUEST');
  end if;

  -- 冪等
  select * into v_existing from public.check_records where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('status', 'existing', 'record', public._record_json(v_existing.id),
                              'voided', v_existing.voided_at is not null);
  end if;

  select * into v_r from public.check_records where id = p_record_id;
  if not found then
    return public._rejected('RECORD_NOT_FOUND');
  end if;
  select * into v_a from public.assignments where id = v_r.assignment_id;
  select * into v_game from public.games where id = v_a.game_id;

  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  perform public._lock_assignments(public._record_lock_set(v_a.id));
  perform public._lock_teams(array_remove(array[v_a.team_a_id, v_a.team_b_id], null));

  select * into v_existing from public.check_records where client_request_id = p_client_request_id;
  if found then
    return jsonb_build_object('status', 'existing', 'record', public._record_json(v_existing.id),
                              'voided', v_existing.voided_at is not null);
  end if;

  select * into v_r from public.check_records where id = p_record_id;
  if v_r.voided_at is not null then
    return public._rejected('ALREADY_VOIDED');
  end if;

  v_now := public.app_now_for_event(v_game.event_id);
  if p_new_recorded_at > v_now then
    return public._rejected('INVALID_REQUEST');
  end if;

  -- 同側「出關 >= 進關」（先驗，不符合就不寫入）
  if v_r.action = 'station_check_in' then
    select * into v_other from public.check_records
     where assignment_id = v_a.id and action = 'station_check_out' and voided_at is null;
    if found and v_other.recorded_at < p_new_recorded_at then
      return public._rejected('CHECKOUT_BEFORE_CHECKIN');
    end if;
  elsif v_r.action = 'station_check_out' then
    select * into v_other from public.check_records
     where assignment_id = v_a.id and action = 'station_check_in' and voided_at is null;
    if found and p_new_recorded_at < v_other.recorded_at then
      return public._rejected('CHECKOUT_BEFORE_CHECKIN');
    end if;
  elsif v_r.action = 'team_check_in' then
    select * into v_other from public.check_records
     where assignment_id = v_a.id and action = 'team_check_out' and team_id = v_r.team_id and voided_at is null;
    if found and v_other.recorded_at < p_new_recorded_at then
      return public._rejected('CHECKOUT_BEFORE_CHECKIN');
    end if;
  else
    select * into v_other from public.check_records
     where assignment_id = v_a.id and action = 'team_check_in' and team_id = v_r.team_id and voided_at is null;
    if found and p_new_recorded_at < v_other.recorded_at then
      return public._rejected('CHECKOUT_BEFORE_CHECKIN');
    end if;
  end if;

  v_before := public._record_json(v_r.id);

  update public.check_records
     set voided_at   = v_now,
         voided_by   = v_ident.id,
         void_reason = '修正時間：' || v_reason
   where id = v_r.id;

  insert into public.check_records (
    client_request_id, assignment_id, action, team_id, no_show, single_team_override, confirmed_team_ids,
    recorded_at, identity_id, source, reason, client_info, replaces_record_id
  ) values (
    p_client_request_id, v_r.assignment_id, v_r.action, v_r.team_id, v_r.no_show, v_r.single_team_override,
    v_r.confirmed_team_ids, p_new_recorded_at, v_ident.id, 'admin_correction', v_reason, p_client_info, v_r.id
  )
  returning id into v_new_id;

  -- 修正時間不是撤銷：以原紀錄為 trigger 的有效通知改指向新紀錄（第十五、二十二節），
  -- 由 server 的 reconcile 步驟以修正後的時間重新判斷條件是否仍成立；不在這裡直接解除。
  -- （新紀錄剛建立，不會與既有通知的唯一 key 衝突）
  update public.notifications
     set trigger_record_id = v_new_id
   where trigger_record_id = v_r.id and invalidated_at is null;

  v_record := public._record_json(v_new_id);
  perform public.write_audit(v_ident.id, v_game.id, 'ADMIN_CORRECT', 'check_records', v_new_id::text,
                             v_before, v_record, v_reason, p_client_info);

  return jsonb_build_object('status', 'created', 'record', v_record);
end;
$$;

-- =====================================================================
-- 整場延後／提前（第二十四節）
-- =====================================================================
create or replace function public.adjust_schedule(
  p_game_id uuid,
  p_from_slot_number integer,
  p_input_mode text,
  p_offset_seconds integer,
  p_start_at timestamptz,
  p_reason text,
  p_identity_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident    public.identities;
  v_game     public.games;
  v_start    timestamptz;
  v_offset   integer;
  v_now      timestamptz;
  v_adj      public.schedule_adjustments;
  v_new_start timestamptz;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  -- 同一遊戲的調整互相排隊（NO KEY UPDATE：不擋 notifications 的 FK KEY SHARE）
  select * into v_game from public.games where id = p_game_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  select scheduled_start into v_start
    from public.v_slot_times where game_id = p_game_id and slot_number = p_from_slot_number;
  if not found then
    return public._rejected('ADJUST_INVALID');
  end if;

  if p_input_mode = 'DELAY' then
    v_offset := p_offset_seconds;
  elsif p_input_mode = 'START_AT' then
    if p_start_at is null then
      return public._rejected('ADJUST_INVALID');
    end if;
    v_offset := round(extract(epoch from (p_start_at - v_start)))::integer;
  else
    return public._rejected('ADJUST_INVALID');
  end if;
  if v_offset is null or v_offset = 0 or abs(v_offset) > 43200 then
    return public._rejected('ADJUST_INVALID');
  end if;

  -- 鎖住受影響時段的所有場次，和 record_check 的進關互斥
  perform 1
     from public.assignments a
     join public.time_slots s on s.id = a.slot_id
    where a.game_id = p_game_id and s.slot_number >= p_from_slot_number
    order by a.id
      for update of a;

  v_now := public.app_now_for_event(v_game.event_id);

  if v_start <= v_now then
    return public._rejected('ADJUST_SLOT_STARTED');
  end if;
  if exists (
    select 1
      from public.check_records r
      join public.assignments a on a.id = r.assignment_id
      join public.time_slots s on s.id = a.slot_id
     where a.game_id = p_game_id and s.slot_number >= p_from_slot_number
       and r.action = 'station_check_in' and r.voided_at is null
  ) then
    return public._rejected('ADJUST_SLOT_HAS_CHECKINS');
  end if;
  v_new_start := v_start + make_interval(secs => v_offset);
  if v_new_start <= v_now then
    return public._rejected('ADJUST_RESULT_IN_PAST');
  end if;

  insert into public.schedule_adjustments (game_id, from_slot_number, offset_seconds, input_mode, reason, identity_id)
  values (p_game_id, p_from_slot_number, v_offset, p_input_mode, v_reason, v_ident.id)
  returning * into v_adj;

  insert into public.notifications (kind, game_id, trigger_adjustment_id, trigger_phase, message, created_at)
  values (
    'SCHEDULE_ADJUSTED', p_game_id, v_adj.id, 'CREATE',
    format('%s 第%s時段起%s %s，第%s時段改為 %s 開始',
           v_game.name, p_from_slot_number,
           case when v_offset > 0 then '延後' else '提前' end, public._fmt_offset(v_offset),
           p_from_slot_number, public._fmt_hm(v_new_start)),
    v_now
  );

  perform public.write_audit(v_ident.id, p_game_id, 'SCHEDULE_ADJUSTED', 'schedule_adjustments', v_adj.id::text,
                             jsonb_build_object('scheduled_start', v_start),
                             to_jsonb(v_adj) || jsonb_build_object('scheduled_start', v_new_start),
                             v_reason, null);

  return jsonb_build_object(
    'status', 'ok',
    'adjustment_id', v_adj.id,
    'from_slot_number', p_from_slot_number,
    'offset_seconds', v_offset,
    'new_start', v_new_start
  );
end;
$$;

create or replace function public.void_last_adjustment(
  p_game_id uuid,
  p_identity_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident   public.identities;
  v_game    public.games;
  v_adj     public.schedule_adjustments;
  v_now     timestamptz;
  v_start   timestamptz;
  v_min_start timestamptz;
  v_new_start timestamptz;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  select * into v_game from public.games where id = p_game_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  select * into v_adj
    from public.schedule_adjustments
   where game_id = p_game_id and voided_at is null
   order by created_at desc, id desc
   limit 1;
  if not found then
    return public._rejected('ADJUST_NOTHING_TO_VOID');
  end if;

  perform 1
     from public.assignments a
     join public.time_slots s on s.id = a.slot_id
    where a.game_id = p_game_id and s.slot_number >= v_adj.from_slot_number
    order by a.id
      for update of a;

  v_now := public.app_now_for_event(v_game.event_id);

  -- 受影響時段（目前有效開始）都必須還沒開始
  select min(scheduled_start) into v_min_start
    from public.v_slot_times where game_id = p_game_id and slot_number >= v_adj.from_slot_number;
  if v_min_start is null or v_min_start <= v_now then
    return public._rejected('ADJUST_SLOT_STARTED');
  end if;
  if exists (
    select 1
      from public.check_records r
      join public.assignments a on a.id = r.assignment_id
      join public.time_slots s on s.id = a.slot_id
     where a.game_id = p_game_id and s.slot_number >= v_adj.from_slot_number
       and r.action = 'station_check_in' and r.voided_at is null
  ) then
    return public._rejected('ADJUST_SLOT_HAS_CHECKINS');
  end if;
  -- 撤銷後的開始時間也必須在未來
  if v_min_start - make_interval(secs => v_adj.offset_seconds) <= v_now then
    return public._rejected('ADJUST_RESULT_IN_PAST');
  end if;

  select scheduled_start into v_start
    from public.v_slot_times where game_id = p_game_id and slot_number = v_adj.from_slot_number;

  update public.schedule_adjustments
     set voided_at = now(), voided_by = v_ident.id, void_reason = v_reason
   where id = v_adj.id;

  select scheduled_start into v_new_start
    from public.v_slot_times where game_id = p_game_id and slot_number = v_adj.from_slot_number;

  insert into public.notifications (kind, game_id, trigger_adjustment_id, trigger_phase, message, created_at)
  values (
    'SCHEDULE_ADJUSTED', p_game_id, v_adj.id, 'VOID',
    format('%s 已撤銷「第%s時段起%s %s」，第%s時段改回 %s 開始',
           v_game.name, v_adj.from_slot_number,
           case when v_adj.offset_seconds > 0 then '延後' else '提前' end, public._fmt_offset(v_adj.offset_seconds),
           v_adj.from_slot_number, public._fmt_hm(v_new_start)),
    v_now
  );

  perform public.write_audit(v_ident.id, p_game_id, 'SCHEDULE_ADJUSTMENT_VOIDED', 'schedule_adjustments', v_adj.id::text,
                             to_jsonb(v_adj) || jsonb_build_object('scheduled_start', v_start),
                             (select to_jsonb(x) from public.schedule_adjustments x where x.id = v_adj.id)
                               || jsonb_build_object('scheduled_start', v_new_start),
                             v_reason, null);

  return jsonb_build_object('status', 'ok', 'adjustment_id', v_adj.id, 'new_start', v_new_start);
end;
$$;

-- =====================================================================
-- 關卡取消（第二十四之二節）：全部成功或全部失敗
-- =====================================================================
create or replace function public.cancel_assignments(
  p_assignment_ids uuid[],
  p_reason text,
  p_identity_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident    public.identities;
  v_ids      uuid[];
  v_game_ids uuid[];
  v_game     public.games;
  v_now      timestamptz;
  v_row      record;
  v_cid      uuid;
  v_cids     uuid[] := '{}';
  v_parts    text[] := '{}';
  v_slots    integer[];
  v_all_after integer[];
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_assignment_ids) x where x is not null;
  if cardinality(v_ids) = 0 then
    return public._rejected('INVALID_REQUEST');
  end if;
  if (select count(*) from public.assignments where id = any(v_ids)) <> cardinality(v_ids) then
    return public._rejected('ASSIGNMENT_NOT_FOUND');
  end if;
  select array_agg(distinct game_id) into v_game_ids from public.assignments where id = any(v_ids);
  if cardinality(v_game_ids) <> 1 then
    return public._rejected('INVALID_REQUEST');
  end if;
  select * into v_game from public.games where id = v_game_ids[1];

  perform public._lock_assignments(v_ids);

  -- 先全部驗過，任何一筆不符合就整批拒絕
  if exists (select 1 from unnest(v_ids) x where public._is_cancelled(x)) then
    return public._rejected('CANCEL_ALREADY_CANCELLED');
  end if;
  if exists (
    select 1 from unnest(v_ids) x
     where exists (select 1 from public.check_records r
                    where r.assignment_id = x and r.action = 'station_check_in' and r.voided_at is null)
       and not exists (select 1 from public.check_records r
                        where r.assignment_id = x and r.action = 'station_check_out' and r.voided_at is null)
  ) then
    return public._rejected('CANCEL_IN_PROGRESS');
  end if;

  v_now := public.app_now_for_event(v_game.event_id);

  -- 依關卡、時段順序建立
  for v_row in
    select a.id, a.station_id, s.slot_number
      from public.assignments a
      join public.time_slots s on s.id = a.slot_id
      join public.stations st on st.id = a.station_id
     where a.id = any(v_ids)
     order by s.slot_number, st.sort_order, st.code
  loop
    insert into public.assignment_cancellations (assignment_id, reason, identity_id)
    values (v_row.id, v_reason, v_ident.id)
    returning id into v_cid;
    v_cids := v_cids || v_cid;
    perform public.write_audit(v_ident.id, v_game.id, 'ASSIGNMENT_CANCELLED', 'assignment_cancellations', v_cid::text,
                               null,
                               (select to_jsonb(c) from public.assignment_cancellations c where c.id = v_cid)
                                 || jsonb_build_object('slot_number', v_row.slot_number),
                               v_reason, null);
  end loop;

  -- 通知文字：每個關卡一段；「該關接下來的所有時段」寫成「第3時段起取消」
  for v_row in
    select st.id, st.name, array_agg(s.slot_number order by s.slot_number) as slots
      from public.assignments a
      join public.time_slots s on s.id = a.slot_id
      join public.stations st on st.id = a.station_id
     where a.id = any(v_ids)
     group by st.id, st.name, st.sort_order, st.code
     order by min(s.slot_number), st.sort_order, st.code
  loop
    v_slots := v_row.slots;
    select array_agg(s.slot_number order by s.slot_number) into v_all_after
      from public.assignments a
      join public.time_slots s on s.id = a.slot_id
     where a.station_id = v_row.id and s.slot_number >= v_slots[1];
    if cardinality(v_slots) = 1 then
      v_parts := v_parts || format('%s 第%s時段取消', v_row.name, v_slots[1]);
    elsif v_slots = v_all_after then
      v_parts := v_parts || format('%s 第%s時段起取消', v_row.name, v_slots[1]);
    else
      v_parts := v_parts || format('%s 第%s時段取消', v_row.name, array_to_string(v_slots, '、'));
    end if;
  end loop;

  insert into public.notifications (kind, game_id, trigger_cancellation_id, trigger_phase, message, created_at)
  values (
    'SCHEDULE_ADJUSTED', v_game.id, v_cids[1], 'CREATE',
    format('%s（%s）', array_to_string(v_parts, '；'), v_reason),
    v_now
  );

  return jsonb_build_object('status', 'ok', 'cancellation_ids', to_jsonb(v_cids));
end;
$$;

create or replace function public.void_cancellation(
  p_cancellation_id uuid,
  p_identity_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident   public.identities;
  v_c       public.assignment_cancellations;
  v_a       public.assignments;
  v_game    public.games;
  v_now     timestamptz;
  v_before  jsonb;
  v_teams   uuid[];
  v_slot_no integer;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  select * into v_c from public.assignment_cancellations where id = p_cancellation_id;
  if not found then
    return public._rejected('CANCELLATION_NOT_FOUND');
  end if;
  select * into v_a from public.assignments where id = v_c.assignment_id;
  select * into v_game from public.games where id = v_a.game_id;
  select slot_number into v_slot_no from public.time_slots where id = v_a.slot_id;
  v_teams := array_remove(array[v_a.team_a_id, v_a.team_b_id], null);

  -- 鎖：本關所有場次 ∪ 相關隊伍的所有場次 → 相關隊伍（與打卡／撤銷／修正相同的順序，
  -- 撤銷取消會改變「上一組／下一關」是誰，必須和這些寫入互斥）
  perform public._lock_assignments(public._record_lock_set(v_a.id));
  perform public._lock_teams(v_teams);

  -- 取得鎖之後重讀
  select * into v_c from public.assignment_cancellations where id = p_cancellation_id;
  if v_c.voided_at is not null then
    return public._rejected('CANCELLATION_NOT_FOUND');
  end if;

  -- 順序保護（第二十一、二十四之二節）：恢復這一場不能讓已經往後走的紀錄變成「跳關／上一組未出關」
  -- (a) 本關後面時段（未取消）的場次已有有效的關主紀錄
  if exists (
    select 1
      from public.assignments a2
      join public.time_slots s2 on s2.id = a2.slot_id
      join public.check_records r on r.assignment_id = a2.id
     where a2.station_id = v_a.station_id
       and a2.id <> v_a.id
       and s2.slot_number > v_slot_no
       and r.voided_at is null
       and r.action in ('station_check_in', 'station_check_out')
       and not public._is_cancelled(a2.id)
  ) then
    return public._rejected('CANCEL_VOID_ORDER_CONFLICT');
  end if;
  -- (b) 本場任一隊伍在本遊戲後面時段已有有效紀錄（隊輔側：該隊；關主側：含該隊的場次）
  if exists (
    select 1
      from public.check_records r
      join public.assignments a2 on a2.id = r.assignment_id
      join public.time_slots s2 on s2.id = a2.slot_id
     where a2.game_id = v_a.game_id
       and s2.slot_number > v_slot_no
       and r.voided_at is null
       and (
            (r.action in ('team_check_in', 'team_check_out') and r.team_id = any(v_teams))
         or (r.action in ('station_check_in', 'station_check_out')
             and (a2.team_a_id = any(v_teams) or a2.team_b_id = any(v_teams)))
       )
  ) then
    return public._rejected('CANCEL_VOID_ORDER_CONFLICT');
  end if;

  v_now := public.app_now_for_event(v_game.event_id);
  v_before := to_jsonb(v_c);

  update public.assignment_cancellations
     set voided_at = now(), voided_by = v_ident.id, void_reason = v_reason
   where id = v_c.id;

  insert into public.notifications (kind, game_id, trigger_cancellation_id, trigger_phase, message, created_at)
  values (
    'SCHEDULE_ADJUSTED', v_game.id, v_c.id, 'VOID',
    format('%s 第%s時段 已撤銷取消，恢復進行（%s）',
           (select name from public.stations where id = v_a.station_id),
           (select slot_number from public.time_slots where id = v_a.slot_id),
           v_reason),
    v_now
  );

  perform public.write_audit(v_ident.id, v_game.id, 'CANCELLATION_VOIDED', 'assignment_cancellations', v_c.id::text,
                             v_before,
                             (select to_jsonb(c) from public.assignment_cancellations c where c.id = v_c.id),
                             v_reason, null);

  return jsonb_build_object('status', 'ok', 'cancellation_id', v_c.id);
end;
$$;

-- =====================================================================
-- 延長／改結束時間（end override，第八節）
-- =====================================================================
create or replace function public.set_end_override(
  p_assignment_id uuid,
  p_official_end timestamptz,
  p_reason text,
  p_identity_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident   public.identities;
  v_a       public.assignments;
  v_game    public.games;
  v_slot_start timestamptz;
  v_ci      public.check_records;
  v_old     public.assignment_end_overrides;
  v_has_old boolean;
  v_new     public.assignment_end_overrides;
  v_lower   timestamptz;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;
  if p_official_end is null then
    return public._rejected('OVERRIDE_INVALID_TIME');
  end if;

  select * into v_a from public.assignments where id = p_assignment_id;
  if not found then
    return public._rejected('ASSIGNMENT_NOT_FOUND');
  end if;
  select * into v_game from public.games where id = v_a.game_id;

  perform public._lock_assignments(array[v_a.id]);

  if public._is_cancelled(v_a.id) then
    return public._rejected('ASSIGNMENT_CANCELLED');
  end if;

  select scheduled_start into v_slot_start from public.v_slot_times where slot_id = v_a.slot_id;
  -- 已進關：必須晚於 started_at；尚未進關：必須晚於時段開始
  select * into v_ci from public.check_records
   where assignment_id = v_a.id and action = 'station_check_in' and voided_at is null;
  if found then
    v_lower := greatest(v_ci.recorded_at, v_slot_start);
  else
    v_lower := v_slot_start;
  end if;
  if p_official_end <= v_lower then
    return public._rejected('OVERRIDE_INVALID_TIME');
  end if;

  select * into v_old from public.assignment_end_overrides where assignment_id = v_a.id and voided_at is null;
  v_has_old := found;
  if v_has_old then
    update public.assignment_end_overrides
       set voided_at = now(), voided_by = v_ident.id, void_reason = '由新的延長取代：' || v_reason
     where id = v_old.id;
  end if;

  insert into public.assignment_end_overrides (assignment_id, official_end, reason, identity_id)
  values (v_a.id, p_official_end, v_reason, v_ident.id)
  returning * into v_new;

  perform public.write_audit(v_ident.id, v_game.id, 'END_OVERRIDE_SET', 'assignment_end_overrides', v_new.id::text,
                             case when v_has_old then to_jsonb(v_old) else null end,
                             to_jsonb(v_new), v_reason, null);

  return jsonb_build_object('status', 'ok', 'override_id', v_new.id,
                            'replaced_override_id', case when v_has_old then v_old.id else null end);
end;
$$;

create or replace function public.void_end_override(
  p_override_id uuid,
  p_identity_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident   public.identities;
  v_o       public.assignment_end_overrides;
  v_a       public.assignments;
  v_before  jsonb;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  select * into v_o from public.assignment_end_overrides where id = p_override_id;
  if not found then
    return public._rejected('OVERRIDE_NOT_FOUND');
  end if;
  select * into v_a from public.assignments where id = v_o.assignment_id;

  perform public._lock_assignments(array[v_a.id]);

  select * into v_o from public.assignment_end_overrides where id = p_override_id;
  if v_o.voided_at is not null then
    return public._rejected('OVERRIDE_NOT_FOUND');
  end if;
  v_before := to_jsonb(v_o);

  update public.assignment_end_overrides
     set voided_at = now(), voided_by = v_ident.id, void_reason = v_reason
   where id = v_o.id;

  perform public.write_audit(v_ident.id, v_a.game_id, 'END_OVERRIDE_VOIDED', 'assignment_end_overrides', v_o.id::text,
                             v_before,
                             (select to_jsonb(o) from public.assignment_end_overrides o where o.id = v_o.id),
                             v_reason, null);

  return jsonb_build_object('status', 'ok', 'override_id', v_o.id);
end;
$$;

-- =====================================================================
-- 設定（第二十五節）
-- =====================================================================
create or replace function public.update_game_settings(
  p_game_id uuid,
  p_end_policy text,
  p_min_play_seconds integer,
  p_identity_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ident  public.identities;
  v_before public.games;
  v_after  public.games;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if p_end_policy is null or p_end_policy not in ('FULL_DURATION', 'FIXED_END')
     or p_min_play_seconds is null or p_min_play_seconds < 0 then
    return public._rejected('INVALID_REQUEST');
  end if;

  select * into v_before from public.games where id = p_game_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  update public.games
     set end_policy = p_end_policy, min_play_seconds = p_min_play_seconds, updated_at = now()
   where id = p_game_id
  returning * into v_after;

  perform public.write_audit(v_ident.id, p_game_id, 'GAME_SETTINGS', 'games', p_game_id::text,
                             jsonb_build_object('end_policy', v_before.end_policy, 'min_play_seconds', v_before.min_play_seconds),
                             jsonb_build_object('end_policy', v_after.end_policy, 'min_play_seconds', v_after.min_play_seconds),
                             null, null);

  return jsonb_build_object('status', 'ok', 'game', to_jsonb(v_after));
end;
$$;

-- null 參數 = 不改
create or replace function public.update_event_settings(
  p_event_id uuid,
  p_event_date date,
  p_team_group_label text,
  p_station_group_label text,
  p_lead_title text,
  p_identity_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ident  public.identities;
  v_before public.events;
  v_after  public.events;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if (p_team_group_label is not null and btrim(p_team_group_label) = '')
     or (p_station_group_label is not null and btrim(p_station_group_label) = '')
     or (p_lead_title is not null and btrim(p_lead_title) = '') then
    return public._rejected('INVALID_REQUEST');
  end if;

  select * into v_before from public.events where id = p_event_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  update public.events
     set event_date          = coalesce(p_event_date, event_date),
         team_group_label    = coalesce(btrim(p_team_group_label), team_group_label),
         station_group_label = coalesce(btrim(p_station_group_label), station_group_label),
         lead_title          = coalesce(btrim(p_lead_title), lead_title),
         updated_at          = now()
   where id = p_event_id
  returning * into v_after;

  perform public.write_audit(v_ident.id, null, 'EVENT_SETTINGS', 'events', p_event_id::text,
                             jsonb_build_object('event_date', v_before.event_date,
                                                'team_group_label', v_before.team_group_label,
                                                'station_group_label', v_before.station_group_label,
                                                'lead_title', v_before.lead_title),
                             jsonb_build_object('event_date', v_after.event_date,
                                                'team_group_label', v_after.team_group_label,
                                                'station_group_label', v_after.station_group_label,
                                                'lead_title', v_after.lead_title),
                             null, null);

  return jsonb_build_object('status', 'ok', 'event', to_jsonb(v_after));
end;
$$;

-- =====================================================================
-- Demo 時鐘（第三十一節）
-- 改任何設定都重設 anchor：anchor_real = now()、anchor_virtual = coalesce(p_jump_to, 改動當下的 app_now)
-- APP_ENV 限制在 Route Handler 檢查（DB 不知道 APP_ENV）
-- =====================================================================
create or replace function public.set_clock(
  p_event_id uuid,
  p_enabled boolean,
  p_speed double precision,
  p_jump_to timestamptz,
  p_identity_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_ident  public.identities;
  v_before public.events;
  v_after  public.events;
  v_now    timestamptz;
  v_new_now timestamptz;
  v_speed  double precision;
  v_future_notifications integer := 0;
begin
  select * into v_ident from public.identities where id = p_identity_id;
  if not found or v_ident.role <> 'ADMIN' then
    return public._rejected('FORBIDDEN');
  end if;
  if not v_ident.is_active then
    return public._rejected('IDENTITY_INACTIVE');
  end if;
  if p_enabled is null then
    return public._rejected('INVALID_REQUEST');
  end if;

  select * into v_before from public.events where id = p_event_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  v_speed := coalesce(p_speed, v_before.sim_speed);
  if v_speed is null or v_speed <= 0 or v_speed > 100 then
    return public._rejected('INVALID_REQUEST');
  end if;

  -- 改動當下的 app 時間（新的 anchor_virtual 預設值，也是 audit 的 before）
  v_now := public.app_now_for_event(p_event_id);

  if p_enabled then
    -- 「跳到指定時刻」不能早於本活動任何有效紀錄
    if p_jump_to is not null and exists (
      select 1
        from public.check_records r
        join public.assignments a on a.id = r.assignment_id
        join public.games g on g.id = a.game_id
       where g.event_id = p_event_id and r.voided_at is null and r.recorded_at > p_jump_to
    ) then
      return public._rejected('CLOCK_JUMP_BEFORE_RECORDS');
    end if;
    update public.events
       set sim_enabled        = true,
           sim_speed          = v_speed,
           sim_anchor_real    = now(),
           sim_anchor_virtual = coalesce(p_jump_to, v_now),
           updated_at         = now()
     where id = p_event_id
    returning * into v_after;
  else
    -- 關閉 Demo 一律允許（回到真實時間）；關閉時不能同時跳時間
    if p_jump_to is not null then
      return public._rejected('INVALID_REQUEST');
    end if;
    update public.events
       set sim_enabled        = false,
           sim_speed          = v_speed,
           sim_anchor_real    = now(),
           sim_anchor_virtual = now(),
           updated_at         = now()
     where id = p_event_id
    returning * into v_after;
  end if;

  -- 時間往回調（跳到較早時刻、或關閉 Demo 回到較早的真實時間）時，
  -- 刪除 created_at 在新 app 時間之後的通知：它們描述的事件在新時間軸上「還沒發生」；
  -- 不刪的話通知 key 已被佔用，彩排重跑同一段時同一事件不會再通知（自訂決策，見 README）。
  -- 打卡紀錄不受影響：有效紀錄晚於跳躍目標時上面已經拒絕。
  v_new_now := public.app_now_for_event(p_event_id);
  delete from public.notifications n
   using public.games g
   where g.id = n.game_id
     and g.event_id = p_event_id
     and n.created_at > v_new_now;
  get diagnostics v_future_notifications = row_count;

  perform public.write_audit(v_ident.id, null, 'DEMO_SETTINGS', 'events', p_event_id::text,
                             jsonb_build_object('sim_enabled', v_before.sim_enabled, 'sim_speed', v_before.sim_speed,
                                                'sim_anchor_real', v_before.sim_anchor_real,
                                                'sim_anchor_virtual', v_before.sim_anchor_virtual,
                                                'app_now', v_now),
                             jsonb_build_object('sim_enabled', v_after.sim_enabled, 'sim_speed', v_after.sim_speed,
                                                'sim_anchor_real', v_after.sim_anchor_real,
                                                'sim_anchor_virtual', v_after.sim_anchor_virtual,
                                                'jump_to', p_jump_to,
                                                'app_now', v_new_now,
                                                'deleted_future_notifications', v_future_notifications),
                             null, null);

  return jsonb_build_object('status', 'ok', 'clock', public.get_clock(p_event_id));
end;
$$;

-- =====================================================================
-- Reset（第二十二、二十五、二十六節）：單一 transaction 依序 DELETE（不用 TRUNCATE，才會送 Realtime 事件）
-- p_identity_id 可為 NULL（import --reset 由本機 script 呼叫）；不為 NULL 時必須是 ADMIN
-- =====================================================================
create or replace function public.reset_game_records(
  p_game_id uuid,
  p_identity_id uuid,
  p_reason text,
  p_disable_sim boolean default false
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_ident   public.identities;
  v_game    public.games;
  v_ids     uuid[];
  v_n_notifications integer;
  v_n_records integer;
  v_n_overrides integer;
  v_n_cancellations integer;
  v_n_adjustments integer;
begin
  if p_identity_id is not null then
    select * into v_ident from public.identities where id = p_identity_id;
    if not found or v_ident.role <> 'ADMIN' then
      return public._rejected('FORBIDDEN');
    end if;
    if not v_ident.is_active then
      return public._rejected('IDENTITY_INACTIVE');
    end if;
  end if;
  if v_reason is null then
    return public._rejected('REASON_REQUIRED');
  end if;

  select * into v_game from public.games where id = p_game_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  -- 與所有打卡／撤銷互斥
  select array_agg(id) into v_ids from public.assignments where game_id = p_game_id;
  perform public._lock_assignments(v_ids);

  delete from public.notifications where game_id = p_game_id;
  get diagnostics v_n_notifications = row_count;

  delete from public.check_records where assignment_id = any(coalesce(v_ids, '{}'::uuid[]));
  get diagnostics v_n_records = row_count;

  delete from public.assignment_end_overrides where assignment_id = any(coalesce(v_ids, '{}'::uuid[]));
  get diagnostics v_n_overrides = row_count;

  delete from public.assignment_cancellations where assignment_id = any(coalesce(v_ids, '{}'::uuid[]));
  get diagnostics v_n_cancellations = row_count;

  delete from public.schedule_adjustments where game_id = p_game_id;
  get diagnostics v_n_adjustments = row_count;

  -- 讓所有裝置透過 Realtime 重抓
  update public.games set updated_at = now() where id = p_game_id;

  if coalesce(p_disable_sim, false) then
    update public.events set sim_enabled = false, updated_at = now() where id = v_game.event_id;
  end if;

  perform public.write_audit(
    (select id from public.identities where id = p_identity_id), p_game_id, 'RESET', 'games', p_game_id::text,
    null,
    jsonb_build_object(
      'notifications', v_n_notifications,
      'check_records', v_n_records,
      'assignment_end_overrides', v_n_overrides,
      'assignment_cancellations', v_n_cancellations,
      'schedule_adjustments', v_n_adjustments,
      'disable_sim', coalesce(p_disable_sim, false)
    ),
    v_reason, null);

  return jsonb_build_object(
    'status', 'ok',
    'deleted', jsonb_build_object(
      'notifications', v_n_notifications,
      'check_records', v_n_records,
      'assignment_end_overrides', v_n_overrides,
      'assignment_cancellations', v_n_cancellations,
      'schedule_adjustments', v_n_adjustments
    )
  );
end;
$$;

-- =====================================================================
-- 通知（第十五節）
-- =====================================================================

-- 推導型通知：server 驗證條件成立後呼叫；同一 key 只會有一筆
create or replace function public.create_notification(
  p_kind text,
  p_subkind text,
  p_game_id uuid,
  p_assignment_id uuid,
  p_team_id uuid,
  p_trigger_record_id uuid,
  p_trigger_override_id uuid,
  p_message text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_event_id uuid;
  v_id uuid;
  v_n public.notifications;
begin
  select event_id into v_event_id from public.games where id = p_game_id;
  if not found then
    raise exception 'create_notification: game % not found', p_game_id;
  end if;

  -- 觸發來源必須仍然有效（第十五節：撤銷後通知解除）。server 推導與這裡之間可能剛好有人撤銷／修正，
  -- 所以在同一 transaction 內以 FOR SHARE 鎖住來源列再檢查：撤銷若已 commit 就回 not_yet；
  -- 若撤銷在我們之後，它會等到本通知 commit，再把它標記解除／改指向。
  -- 先依全域順序（assignments → teams）對 FK 目標取 KEY SHARE，再鎖來源列，
  -- 避免「持有紀錄 SHARE 等 assignment，撤銷方持有 assignment 等紀錄」的死結。
  if p_assignment_id is not null then
    perform 1 from public.assignments where id = p_assignment_id for key share;
  end if;
  if p_team_id is not null then
    perform 1 from public.teams where id = p_team_id for key share;
  end if;
  if p_trigger_override_id is not null then
    perform 1 from public.assignment_end_overrides
     where id = p_trigger_override_id and voided_at is null
       for share;
    if not found then
      return jsonb_build_object('result', 'not_yet', 'notification', null);
    end if;
  end if;
  if p_trigger_record_id is not null then
    perform 1 from public.check_records
     where id = p_trigger_record_id and voided_at is null
       for share;
    if not found then
      return jsonb_build_object('result', 'not_yet', 'notification', null);
    end if;
  end if;

  insert into public.notifications
    (kind, subkind, game_id, assignment_id, team_id, trigger_record_id, trigger_override_id, trigger_phase, message, created_at)
  values
    (p_kind, p_subkind, p_game_id, p_assignment_id, p_team_id, p_trigger_record_id, p_trigger_override_id, 'CREATE',
     p_message, public.app_now_for_event(v_event_id))
  on conflict do nothing
  returning id into v_id;

  if v_id is not null then
    select * into v_n from public.notifications where id = v_id;
    return jsonb_build_object('result', 'created', 'notification', to_jsonb(v_n));
  end if;

  select * into v_n
    from public.notifications
   where kind = p_kind
     and subkind is not distinct from p_subkind
     and assignment_id is not distinct from p_assignment_id
     and team_id is not distinct from p_team_id
     and trigger_record_id is not distinct from p_trigger_record_id
     and trigger_adjustment_id is null
     and trigger_cancellation_id is null
     and trigger_override_id is not distinct from p_trigger_override_id
     and trigger_phase = 'CREATE';
  return jsonb_build_object('result', 'exists', 'notification', to_jsonb(v_n));
end;
$$;

-- 只更新尚未解除的；回傳實際更新筆數
create or replace function public.invalidate_notifications(p_ids uuid[])
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.notifications n
     set invalidated_at = public.app_now_for_event(g.event_id)
    from public.games g
   where g.id = n.game_id
     and n.id = any(coalesce(p_ids, '{}'::uuid[]))
     and n.invalidated_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =====================================================================
-- 登入鎖定與 PIN（第二十節）：一律用真實時間
-- =====================================================================

-- 任一 device 或 identity 最近 60 秒失敗 >= 5 次 → locked；retry_after = 第 5 新的失敗滿 60 秒還要幾秒
create or replace function public.login_lock_status(p_device_id text, p_identity_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_device_fifth   timestamptz;
  v_identity_fifth timestamptz;
  v_until          timestamptz;
  v_retry          integer;
begin
  if p_device_id is not null then
    select created_at into v_device_fifth
      from public.login_attempts
     where device_id = p_device_id and not success and created_at > now() - interval '60 seconds'
     order by created_at desc
     offset 4 limit 1;
  end if;
  if p_identity_id is not null then
    select created_at into v_identity_fifth
      from public.login_attempts
     where identity_id = p_identity_id and not success and created_at > now() - interval '60 seconds'
     order by created_at desc
     offset 4 limit 1;
  end if;

  v_until := greatest(v_device_fifth, v_identity_fifth) + interval '60 seconds';
  if v_until is null or v_until <= now() then
    return jsonb_build_object('locked', false, 'retry_after_seconds', 0);
  end if;
  v_retry := greatest(1, ceil(extract(epoch from (v_until - now())))::integer);
  return jsonb_build_object('locked', true, 'retry_after_seconds', v_retry);
end;
$$;

-- 記錄一次登入嘗試；失敗時同時寫 audit LOGIN_FAILED（server 不需要另外寫）
create or replace function public.record_login_attempt(p_device_id text, p_identity_id uuid, p_success boolean)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_identity uuid;
begin
  select id into v_identity from public.identities where id = p_identity_id;
  insert into public.login_attempts (device_id, identity_id, success)
  values (coalesce(p_device_id, 'unknown'), v_identity, coalesce(p_success, false));
  if not coalesce(p_success, false) then
    perform public.write_audit(null, null, 'LOGIN_FAILED', 'identities', p_identity_id::text,
                               null, jsonb_build_object('device_id', p_device_id), null, null);
  end if;
end;
$$;

-- 改 PIN：pin_version + 1（該身分所有裝置的 session 失效）；p_actor 可為 NULL（本機 script）
create or replace function public.set_identity_pin(p_identity_id uuid, p_pin_hash text, p_actor uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_actor public.identities;
  v_before public.identities;
  v_after  public.identities;
begin
  if p_actor is not null then
    select * into v_actor from public.identities where id = p_actor;
    if not found or v_actor.role <> 'ADMIN' then
      return public._rejected('FORBIDDEN');
    end if;
    if not v_actor.is_active then
      return public._rejected('IDENTITY_INACTIVE');
    end if;
  end if;
  if p_pin_hash is null or btrim(p_pin_hash) = '' then
    return public._rejected('INVALID_REQUEST');
  end if;

  select * into v_before from public.identities where id = p_identity_id for no key update;
  if not found then
    return public._rejected('NOT_FOUND');
  end if;

  update public.identities
     set pin_hash = p_pin_hash, pin_version = pin_version + 1, updated_at = now()
   where id = p_identity_id
  returning * into v_after;

  -- 不把 hash 寫進 audit
  perform public.write_audit(p_actor, null, 'PIN_CHANGED', 'identities', p_identity_id::text,
                             jsonb_build_object('pin_version', v_before.pin_version, 'label', v_before.label),
                             jsonb_build_object('pin_version', v_after.pin_version, 'label', v_after.label),
                             null, null);

  return jsonb_build_object('status', 'ok', 'identity_id', v_after.id, 'pin_version', v_after.pin_version);
end;
$$;

-- 通知 reconcile（第十五節）：條件在修正後又成立 → 取消解除（只動已解除的；回傳實際更新筆數）
create or replace function public.revalidate_notifications(p_ids uuid[])
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.notifications
     set invalidated_at = null
   where id = any(coalesce(p_ids, '{}'::uuid[]))
     and invalidated_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =====================================================================
-- 登入嘗試：原子化的「檢查鎖定 + 佔位」（第二十節：60 秒內失敗 >= 5 次鎖 1 分鐘，真實時間）
-- 先 begin_login_attempt 佔一筆 success = false（pending，也算失敗），驗完 PIN 再 finish_login_attempt。
-- 同一 device／identity 的並行登入以 advisory lock 串行化（固定順序：identity → device），
-- 因此 10 個同時送出的錯誤 PIN 最多只有 5 個能進到驗證 PIN 的步驟。
-- =====================================================================
create or replace function public.begin_login_attempt(p_device_id text, p_identity_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_status   jsonb;
  v_identity uuid;
  v_id       bigint;
begin
  if p_identity_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('login_attempts:identity:' || p_identity_id::text, 0));
  end if;
  if p_device_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('login_attempts:device:' || p_device_id, 0));
  end if;

  -- 取得鎖之後的新 statement 會看到先前持鎖者已 commit 的佔位
  v_status := public.login_lock_status(p_device_id, p_identity_id);
  if coalesce((v_status ->> 'locked')::boolean, false) then
    return jsonb_build_object('locked', true,
                              'retry_after_seconds', (v_status ->> 'retry_after_seconds')::integer,
                              'attempt_id', null);
  end if;

  -- identity 不存在時不能填（FK）
  select id into v_identity from public.identities where id = p_identity_id;
  insert into public.login_attempts (device_id, identity_id, success)
  values (coalesce(p_device_id, 'unknown'), v_identity, false)
  returning id into v_id;

  return jsonb_build_object('locked', false, 'retry_after_seconds', 0, 'attempt_id', v_id);
end;
$$;

-- 完成一次登入嘗試：寫入結果；失敗時寫 audit LOGIN_FAILED（與 record_login_attempt 相同）
create or replace function public.finish_login_attempt(p_attempt_id bigint, p_success boolean)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_row public.login_attempts;
begin
  update public.login_attempts
     set success = coalesce(p_success, false)
   where id = p_attempt_id
  returning * into v_row;
  if not found then
    return;
  end if;
  if not coalesce(p_success, false) then
    perform public.write_audit(null, null, 'LOGIN_FAILED', 'identities', v_row.identity_id::text,
                               null, jsonb_build_object('device_id', v_row.device_id), null, null);
  end if;
end;
$$;

-- 批次改 PIN（第二十節）：全部成功或全部不變；每個身分 pin_version + 1 並各寫一筆 PIN_CHANGED
-- p_actor 可為 NULL（本機 script），規則同 set_identity_pin
create or replace function public.set_identity_pins(p_ids uuid[], p_hashes text[], p_actor uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_actor public.identities;
  v_n     integer;
  v_row   record;
begin
  if p_actor is not null then
    select * into v_actor from public.identities where id = p_actor;
    if not found or v_actor.role <> 'ADMIN' then
      return public._rejected('FORBIDDEN');
    end if;
    if not v_actor.is_active then
      return public._rejected('IDENTITY_INACTIVE');
    end if;
  end if;

  if p_ids is null or p_hashes is null
     or coalesce(array_length(p_ids, 1), 0) <> coalesce(array_length(p_hashes, 1), 0) then
    return public._rejected('INVALID_REQUEST');
  end if;
  v_n := coalesce(array_length(p_ids, 1), 0);
  if v_n = 0 then
    return jsonb_build_object('status', 'ok', 'count', 0);
  end if;
  if exists (select 1 from unnest(p_hashes) h where h is null or btrim(h) = '') then
    return public._rejected('INVALID_REQUEST');
  end if;
  -- 同一身分出現兩次（兩個不同 PIN）無法判斷要用哪個
  if (select count(distinct x) from unnest(p_ids) x) <> v_n then
    if exists (select 1 from unnest(p_ids) x where x is null) then
      return public._rejected('NOT_FOUND');
    end if;
    return public._rejected('INVALID_REQUEST');
  end if;

  -- 一次鎖定（依 id 排序）；任何一個不存在就整批拒絕，什麼都不改
  perform 1 from public.identities where id = any(p_ids) order by id for no key update;
  if (select count(*) from public.identities where id = any(p_ids)) <> v_n then
    return public._rejected('NOT_FOUND');
  end if;

  for v_row in
    with inp as (
      select u.id, u.hash from unnest(p_ids, p_hashes) as u(id, hash)
    ),
    prev as (
      select i.id, i.pin_version, i.label from public.identities i join inp on inp.id = i.id
    ),
    upd as (
      update public.identities i
         set pin_hash = inp.hash, pin_version = i.pin_version + 1, updated_at = now()
        from inp
       where i.id = inp.id
      returning i.id, i.pin_version, i.label
    )
    select upd.id, prev.pin_version as before_version, prev.label as before_label,
           upd.pin_version as after_version, upd.label as after_label
      from upd join prev on prev.id = upd.id
     order by upd.id
  loop
    -- 不把 hash 寫進 audit
    perform public.write_audit(p_actor, null, 'PIN_CHANGED', 'identities', v_row.id::text,
                               jsonb_build_object('pin_version', v_row.before_version, 'label', v_row.before_label),
                               jsonb_build_object('pin_version', v_row.after_version, 'label', v_row.after_label),
                               null, null);
  end loop;

  return jsonb_build_object('status', 'ok', 'count', v_n);
end;
$$;
