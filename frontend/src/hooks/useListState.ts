import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * List state kept in the URL.
 *
 * Filters, sorting, paging and search live in the query string rather than in
 * component state so a filtered view is linkable, survives a reload, and is
 * navigable with the browser's back button. `set` removes a parameter instead of
 * writing an empty value, which keeps the URL clean when a filter is cleared.
 */
export interface ListState {
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
  search: string;
  /** All other query parameters, starting from `filters`. */
  filters: Record<string, string>;
}

export interface UseListStateOptions {
  defaultSort?: string;
  defaultOrder?: 'asc' | 'desc';
  defaultPageSize?: number;
  /** Query parameter names that are treated as filters. */
  filterKeys: readonly string[];
  searchKey?: string;
}

export interface ListStateApi {
  state: ListState;
  /** Every parameter, ready to be handed to a query function. */
  query: Record<string, string | number>;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSort: (sort: string, order: 'asc' | 'desc') => void;
  setSearch: (search: string) => void;
  setFilter: (key: string, value: string) => void;
  setFilters: (values: Record<string, string>) => void;
  clearFilters: () => void;
  hasFilters: boolean;
}

export function useListState({
  defaultSort = 'created_at',
  defaultOrder = 'desc',
  defaultPageSize = 25,
  filterKeys,
  searchKey = 'q',
}: UseListStateOptions): ListStateApi {
  const [params, setParams] = useSearchParams();

  const state = useMemo<ListState>(() => {
    const filters: Record<string, string> = {};
    for (const key of filterKeys) {
      const value = params.get(key);
      if (value) filters[key] = value;
    }
    const order = params.get('order') === 'asc' ? 'asc' : params.get('order') === 'desc' ? 'desc' : defaultOrder;

    return {
      page: Math.max(1, Number(params.get('page') ?? 1) || 1),
      pageSize: Math.max(1, Number(params.get('page_size') ?? defaultPageSize) || defaultPageSize),
      sort: params.get('sort') ?? defaultSort,
      order,
      search: params.get(searchKey) ?? '',
      filters,
    };
  }, [params, filterKeys, defaultOrder, defaultPageSize, defaultSort, searchKey]);

  const update = useCallback(
    (changes: Record<string, string | number | null>, resetPage = true) => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(changes)) {
            if (value === null || value === '') {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          if (resetPage && !('page' in changes)) {
            next.delete('page');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setFilter = useCallback(
    (key: string, value: string) => update({ [key]: value || null }),
    [update],
  );

  const clearFilters = useCallback(() => {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of filterKeys) next.delete(key);
        next.delete(searchKey);
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [filterKeys, searchKey, setParams]);

  const query = useMemo<Record<string, string | number>>(() => {
    const result: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(state.filters)) result[key] = value;
    if (state.search) result[searchKey] = state.search;
    result.page = state.page;
    result.page_size = state.pageSize;
    result.sort = state.sort;
    result.order = state.order;
    return result;
  }, [state, searchKey]);

  return {
    state,
    query,
    setPage: useCallback((page: number) => update({ page }), [update]),
    setPageSize: useCallback((pageSize: number) => update({ page_size: pageSize, page: null }), [update]),
    setSort: useCallback((sort: string, order: 'asc' | 'desc') => update({ sort, order }), [update]),
    setSearch: useCallback((search: string) => update({ [searchKey]: search }), [searchKey, update]),
    setFilter,
    setFilters: useCallback(
      (values: Record<string, string>) =>
        update(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value || null]))),
      [update],
    ),
    clearFilters,
    hasFilters: Object.keys(state.filters).length > 0 || Boolean(state.search),
  };
}

/** Shared sort state adapter for `DataTable`. */
export function sortStateOf(state: ListState) {
  return { sort: state.sort, order: state.order };
}
