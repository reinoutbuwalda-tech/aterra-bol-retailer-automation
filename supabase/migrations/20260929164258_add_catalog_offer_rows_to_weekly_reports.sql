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
      catalog_revision.transform_run_id as catalog_transform_run_id,
      transform.period_start
    from reporting.weekly_report_revisions report
    join reporting.data_product_revisions catalog_revision
      on catalog_revision.iso_year = report.iso_year
     and catalog_revision.iso_week = report.iso_week
     and catalog_revision.data_product = 'shipment_facts'
     and catalog_revision.is_active
    join pipeline.transform_runs transform
      on transform.id = catalog_revision.transform_run_id
    where report.is_active
      and exists (
        select 1
        from pipeline.fact_sightings sighting
        join bol_retailer.offer_observations offer
          on offer.id = sighting.fact_id
        where sighting.transform_run_id = catalog_revision.transform_run_id
          and sighting.fact_table = 'offer_observations'
          and not exists (
            select 1
            from reporting.weekly_product_metrics metric
            where metric.weekly_report_revision_id = report.id
              and metric.ean = offer.ean
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
      missing.ean,
      0, 0, 0,
      0, 0, 0,
      0, 0,
      0, 0,
      null,
      null,
      null,
      'ready',
      'not_ready',
      'ready',
      array[
        'Product visits are unavailable because the source does not cover all seven reporting dates.',
        'Trading units per visit is not order-cohort conversion.'
      ],
      jsonb_build_object(
        'grossShippedGms', 'No outbound shipment items for this EAN in the reporting week',
        'linkedReturnGms', 'No registered return events for this EAN in the reporting week',
        'productVisits', 'Not published because the source lacks seven aligned dates',
        'tradingUnitsPerVisit', 'Not available without a complete weekly visit total'
      )
    from (
      select distinct offer.ean
      from pipeline.fact_sightings sighting
      join bol_retailer.offer_observations offer
        on offer.id = sighting.fact_id
      where sighting.transform_run_id = target.catalog_transform_run_id
        and sighting.fact_table = 'offer_observations'
    ) missing
    join lateral (
      select mapping.product_id
      from bol_retailer.ean_product_assignments mapping
      where mapping.ean = missing.ean
        and mapping.valid_from <= target.period_start
        and (mapping.valid_to is null or mapping.valid_to >= target.period_start)
      order by mapping.valid_from desc
      limit 1
    ) assignment on true
    where not exists (
      select 1
      from reporting.weekly_product_metrics existing
      where existing.weekly_report_revision_id = target.report_id
        and existing.ean = missing.ean
    );
  end loop;
end
$migration$;
