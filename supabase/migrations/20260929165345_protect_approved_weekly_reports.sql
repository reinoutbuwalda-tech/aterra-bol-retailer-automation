create or replace function reporting.keep_best_active_weekly_report()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  protected_report_id uuid;
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
  into protected_report_id
  from reporting.weekly_report_revisions existing
  where existing.iso_year = new.iso_year
    and existing.iso_week = new.iso_week
    and existing.id <> new.id
    and (
      (existing.accounting_status = 'approved' and new.accounting_status <> 'approved')
      or case existing.status
        when 'ready' then 3
        when 'ready_with_limits' then 2
        else 1
      end > new_readiness
    )
  order by
    case when existing.accounting_status = 'approved' then 1 else 0 end desc,
    case existing.status
      when 'ready' then 3
      when 'ready_with_limits' then 2
      else 1
    end desc,
    existing.revision_number desc
  limit 1
  for update;

  if protected_report_id is not null then
    update reporting.weekly_report_revisions
    set
      is_active = false,
      approval_note = concat_ws(
        ' ',
        nullif(approval_note, ''),
        'Not activated automatically because an existing revision has higher readiness or approved accounting status.'
      )
    where id = new.id;

    update reporting.weekly_report_revisions
    set is_active = true
    where id = protected_report_id;
  end if;

  return new;
end;
$$;

comment on function reporting.keep_best_active_weekly_report() is
  'Prevents a lower-readiness or provisional automated weekly revision from replacing a better or accounting-approved revision.';
