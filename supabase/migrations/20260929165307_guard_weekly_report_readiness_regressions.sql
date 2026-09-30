create or replace function reporting.keep_best_active_weekly_report()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  better_report_id uuid;
  new_readiness integer;
begin
  if not new.is_active then
    return new;
  end if;

  new_readiness := case new.status
    when 'ready' then 3
    when 'ready_with_limits' then 2
    else 1
  end;

  select existing.id
  into better_report_id
  from reporting.weekly_report_revisions existing
  where existing.iso_year = new.iso_year
    and existing.iso_week = new.iso_week
    and existing.id <> new.id
    and case existing.status
      when 'ready' then 3
      when 'ready_with_limits' then 2
      else 1
    end > new_readiness
  order by
    case existing.status
      when 'ready' then 3
      when 'ready_with_limits' then 2
      else 1
    end desc,
    existing.revision_number desc
  limit 1
  for update;

  if better_report_id is not null then
    update reporting.weekly_report_revisions
    set
      is_active = false,
      approval_note = concat_ws(
        ' ',
        nullif(approval_note, ''),
        'Not activated automatically because an existing revision has higher readiness.'
      )
    where id = new.id;

    update reporting.weekly_report_revisions
    set is_active = true
    where id = better_report_id;
  end if;

  return new;
end;
$$;

revoke all on function reporting.keep_best_active_weekly_report()
from public, anon, authenticated;

create trigger keep_best_active_weekly_report
after insert on reporting.weekly_report_revisions
for each row
execute function reporting.keep_best_active_weekly_report();

comment on function reporting.keep_best_active_weekly_report() is
  'Keeps a lower-readiness weekly revision for audit without allowing it to replace a better active revision.';
