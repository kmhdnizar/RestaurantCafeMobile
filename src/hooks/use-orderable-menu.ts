import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchConfig, fetchMenuItems, fetchServingPeriods, fetchTables } from '@/api/menu';
import { currencyToLocale, formatCurrency } from '@/lib/format';
import { getActiveServingPeriodIds, isItemVisible } from '@/lib/serving-period';

/** The menu items a waiter can order right now (available, and inside their
 * serving period), plus tables and price formatting for this restaurant. */
export function useOrderableMenu() {
  const menuQuery = useQuery({ queryKey: ['menu-items'], queryFn: fetchMenuItems });
  const tablesQuery = useQuery({ queryKey: ['tables'], queryFn: fetchTables });
  const servingPeriodsQuery = useQuery({ queryKey: ['serving-periods'], queryFn: fetchServingPeriods });
  const configQuery = useQuery({ queryKey: ['config'], queryFn: fetchConfig });

  const currencyCode = configQuery.data?.currencyCode ?? 'MYR';
  const currencyLocale = currencyToLocale(currencyCode);
  const timezone = configQuery.data?.timezone ?? 'UTC';
  const fmt = (v: number) => formatCurrency(v, currencyCode, currencyLocale);

  const servingPeriods = servingPeriodsQuery.data;
  const activeServingPeriodIds = useMemo(() => getActiveServingPeriodIds(servingPeriods ?? [], timezone), [servingPeriods, timezone]);

  const items = useMemo(
    () =>
      (menuQuery.data ?? []).filter(
        (item) => item.available && isItemVisible(item.servingPeriods.map((sp) => sp.servingPeriod.id), servingPeriods ?? [], activeServingPeriodIds, false)
      ),
    [menuQuery.data, servingPeriods, activeServingPeriodIds]
  );

  const tables = useMemo(() => (tablesQuery.data ?? []).filter((t) => t.active), [tablesQuery.data]);
  const loading = menuQuery.isLoading || tablesQuery.isLoading || servingPeriodsQuery.isLoading || configQuery.isLoading;
  const refreshing = menuQuery.isFetching || tablesQuery.isFetching || servingPeriodsQuery.isFetching || configQuery.isFetching;

  // Manual pull — nothing here refetches on its own (a 60s staleTime, no
  // focus/foreground trigger wired up), so a menu edit on the web dashboard
  // otherwise only shows up after the app is fully restarted.
  async function refetch() {
    await Promise.all([menuQuery.refetch(), tablesQuery.refetch(), servingPeriodsQuery.refetch(), configQuery.refetch()]);
  }

  return { items, tables, fmt, loading, refreshing, refetch };
}
