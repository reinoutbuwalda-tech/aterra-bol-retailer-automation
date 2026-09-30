update reporting.weekly_product_metrics as m
set
  product_visits = null,
  trading_units_per_visit = null,
  visits_status = 'not_ready',
  limitations = case
    when 'Product visits are unavailable because the source does not cover all seven reporting dates.' = any(m.limitations)
      then m.limitations
    else array_append(m.limitations, 'Product visits are unavailable because the source does not cover all seven reporting dates.')
  end
where exists (
  select 1
  from reporting.weekly_revision_sources as s
  join reporting.data_product_revisions as d
    on d.id = s.data_product_revision_id
  where s.weekly_report_revision_id = m.weekly_report_revision_id
    and d.data_product = 'product_visits'
    and d.status = 'not_ready'
);
