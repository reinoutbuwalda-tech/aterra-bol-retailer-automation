do $migration$
declare
  target record;
  new_report_id uuid;
begin
  for target in
    select
      report.id as report_id,
      report.iso_year,
      report.iso_week,
      report.status,
      report.accounting_status,
      visits_revision.transform_run_id as visits_transform_run_id,
      transform.period_start
    from reporting.weekly_report_revisions report
    join reporting.data_product_revisions visits_revision
      on visits_revision.iso_year = report.iso_year
     and visits_revision.iso_week = report.iso_week
     and visits_revision.data_product = 'product_visits'
     and visits_revision.is_active
     and visits_revision.status = 'ready'
    join pipeline.transform_runs transform
      on transform.id = visits_revision.transform_run_id
    where report.is_active
      and exists (
        select 1
        from pipeline.fact_sightings sighting
        join bol_retailer.offer_insight_daily fact
          on fact.id = sighting.fact_id
        where sighting.transform_run_id = visits_revision.transform_run_id
          and sighting.fact_table = 'offer_insight_daily'
          and fact.metric = 'PRODUCT_VISITS'
          and fact.is_total
          and not exists (
            select 1
            from reporting.weekly_product_metrics metric
            where metric.weekly_report_revision_id = report.id
              and metric.ean = fact.ean
          )
      )
    order by report.iso_year, report.iso_week
  loop
    update reporting.weekly_report_revisions
    set is_active = false
    where id = target.report_id;

    insert into reporting.weekly_report_revisions (
      iso_year, iso_week, revision_number, status, accounting_status, is_active
    )
    select
      target.iso_year,
      target.iso_week,
      coalesce(max(revision_number), 0) + 1,
      target.status,
      target.accounting_status,
      true
    from reporting.weekly_report_revisions
    where iso_year = target.iso_year
      and iso_week = target.iso_week
    returning id into new_report_id;

    insert into reporting.weekly_revision_sources (
      weekly_report_revision_id, data_product_revision_id
    )
    select new_report_id, data_product_revision_id
    from reporting.weekly_revision_sources
    where weekly_report_revision_id = target.report_id;

    insert into reporting.weekly_product_metrics (
      weekly_report_revision_id, product_id, ean,
      gross_shipped_units, gross_shipped_gms, gross_commission,
      registered_return_units, linked_return_units, unlinked_return_units,
      linked_return_gms, linked_return_commission,
      provisional_net_gms, provisional_revenue_after_commission,
      gross_shipped_asp, product_visits, trading_units_per_visit,
      commercial_status, visits_status, returns_status,
      limitations, calculation_trace
    )
    select
      new_report_id, product_id, ean,
      gross_shipped_units, gross_shipped_gms, gross_commission,
      registered_return_units, linked_return_units, unlinked_return_units,
      linked_return_gms, linked_return_commission,
      provisional_net_gms, provisional_revenue_after_commission,
      gross_shipped_asp, product_visits, trading_units_per_visit,
      commercial_status, visits_status, returns_status,
      limitations, calculation_trace
    from reporting.weekly_product_metrics
    where weekly_report_revision_id = target.report_id;

    insert into reporting.weekly_product_metrics (
      weekly_report_revision_id, product_id, ean,
      gross_shipped_units, gross_shipped_gms, gross_commission,
      registered_return_units, linked_return_units, unlinked_return_units,
      linked_return_gms, linked_return_commission,
      provisional_net_gms, provisional_revenue_after_commission,
      gross_shipped_asp, product_visits, trading_units_per_visit,
      commercial_status, visits_status, returns_status,
      limitations, calculation_trace
    )
    select
      new_report_id,
      assignment.product_id,
      visits.ean,
      0, 0, 0,
      0, 0, 0,
      0, 0,
      0, 0,
      null,
      visits.product_visits,
      0,
      'ready',
      'ready',
      'ready',
      array['This is a same-week trading proxy, not order-cohort conversion.'],
      jsonb_build_object(
        'grossShippedGms', 'No outbound shipment items for this EAN in the reporting week',
        'linkedReturnGms', 'No registered return events for this EAN in the reporting week',
        'productVisits', format(
          '%s visits from seven aligned dates in transform run %s',
          visits.product_visits,
          target.visits_transform_run_id
        ),
        'tradingUnitsPerVisit', '0 shipped units divided by same-week product visits; not cohort conversion'
      )
    from (
      select fact.ean, sum(fact.value)::integer as product_visits
      from pipeline.fact_sightings sighting
      join bol_retailer.offer_insight_daily fact
        on fact.id = sighting.fact_id
      where sighting.transform_run_id = target.visits_transform_run_id
        and sighting.fact_table = 'offer_insight_daily'
        and fact.metric = 'PRODUCT_VISITS'
        and fact.is_total
      group by fact.ean
    ) visits
    join lateral (
      select mapping.product_id
      from bol_retailer.ean_product_assignments mapping
      where mapping.ean = visits.ean
        and mapping.valid_from <= target.period_start
        and (mapping.valid_to is null or mapping.valid_to >= target.period_start)
      order by mapping.valid_from desc
      limit 1
    ) assignment on true
    where not exists (
      select 1
      from reporting.weekly_product_metrics existing
      where existing.weekly_report_revision_id = target.report_id
        and existing.ean = visits.ean
    );
  end loop;
end
$migration$;
