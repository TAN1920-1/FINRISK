import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { sortStateOf, useListState, type UseListStateOptions } from './useListState';

const FILTER_KEYS = ['severity', 'status'];
const OPTIONS: UseListStateOptions = { filterKeys: FILTER_KEYS };

/** Render the hook inside a router and expose the resulting query string. */
function renderListState(initialEntry = '/', options: UseListStateOptions = OPTIONS) {
  return renderHook(
    () => {
      const api = useListState(options);
      const location = useLocation();
      return { api, search: location.search };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>
      ),
    },
  );
}

describe('useListState', () => {
  it('falls back to sensible defaults when the URL is empty', () => {
    const { result } = renderListState();
    expect(result.current.api.state).toEqual({
      page: 1,
      pageSize: 25,
      sort: 'created_at',
      order: 'desc',
      search: '',
      filters: {},
    });
  });

  it('reads filters, paging, sorting and search back out of the URL', () => {
    const { result } = renderListState('/?page=3&page_size=50&sort=score&order=asc&q=acme&severity=critical');

    expect(result.current.api.state.page).toBe(3);
    expect(result.current.api.state.pageSize).toBe(50);
    expect(result.current.api.state.sort).toBe('score');
    expect(result.current.api.state.order).toBe('asc');
    expect(result.current.api.state.search).toBe('acme');
    expect(result.current.api.state.filters).toEqual({ severity: 'critical' });
  });

  it('ignores an unrecognised sort order instead of trusting the URL', () => {
    const { result } = renderListState('/?order=sideways');
    expect(result.current.api.state.order).toBe('desc');
  });

  it('builds a query object ready to hand to a query function', () => {
    const { result } = renderListState('/?severity=high&q=acme&page=2&page_size=10&sort=title&order=asc');
    expect(result.current.api.query).toEqual({
      severity: 'high',
      q: 'acme',
      page: 2,
      page_size: 10,
      sort: 'title',
      order: 'asc',
    });
  });

  it('omits the search key from the query when the search is empty', () => {
    const { result } = renderListState();
    expect(result.current.api.query).not.toHaveProperty('q');
  });

  it('writes a filter to the URL and resets paging', () => {
    const { result } = renderListState('/?page=3&severity=high');

    act(() => result.current.api.setFilter('status', 'open'));

    expect(result.current.search).toContain('status=open');
    expect(result.current.search).toContain('severity=high');
    expect(result.current.search).not.toContain('page=');
  });

  it('removes a filter when it is cleared rather than storing an empty value', () => {
    const { result } = renderListState('/?severity=high');

    act(() => result.current.api.setFilter('severity', ''));

    expect(result.current.search).not.toContain('severity');
  });

  it('clears every filter and the search term at once', () => {
    const { result } = renderListState('/?severity=high&status=open&q=acme&page=4');

    act(() => result.current.api.clearFilters());

    expect(result.current.search).not.toContain('severity');
    expect(result.current.search).not.toContain('status');
    expect(result.current.search).not.toContain('q=');
    expect(result.current.search).not.toContain('page=');
  });

  it('resets to page one when the page size changes', () => {
    const { result } = renderListState('/?page=4');

    act(() => result.current.api.setPageSize(50));

    expect(result.current.api.state.pageSize).toBe(50);
    expect(result.current.search).not.toContain('page=');
  });

  it('records a new sort field and direction', () => {
    const { result } = renderListState();

    act(() => result.current.api.setSort('severity', 'asc'));

    expect(result.current.search).toContain('sort=severity');
    expect(result.current.search).toContain('order=asc');
    expect(result.current.api.state.sort).toBe('severity');
  });

  it('reports whether any filter is narrowing the view', () => {
    const { result } = renderListState();
    expect(result.current.api.hasFilters).toBe(false);

    act(() => result.current.api.setSearch('acme'));
    expect(result.current.api.hasFilters).toBe(true);
  });

  it('exposes sort state for the data table', () => {
    const { result } = renderListState('/?sort=score&order=asc');
    expect(sortStateOf(result.current.api.state)).toEqual({ sort: 'score', order: 'asc' });
  });
});
