import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from './Button';
import { EmptyState, ErrorState, TableSkeleton } from './Feedback';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Cell renderer. Receives the whole row so it can link to the record. */
  cell: (row: T) => ReactNode;
  /** Server-side sort field. Omit to make the column unsortable. */
  sortKey?: string;
  align?: 'left' | 'right' | 'center';
  className?: string;
  /** Hidden below the `md` breakpoint; the primary column always stays visible. */
  hideOnMobile?: boolean;
  headerTitle?: string;
}

export interface SortState {
  sort: string;
  order: 'asc' | 'desc';
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string | number;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  emptyAction?: ReactNode;
  filtered?: boolean;
  /** Rendered under the table, typically a Pagination control. */
  footer?: ReactNode;
  caption?: string;
}

/**
 * Generic data table.
 *
 * Sorting is delegated to the server (`sort`/`order` query parameters) rather
 * than reordering the current page, because the register is paginated and a
 * client-side sort would silently sort only the visible slice.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error,
  onRetry,
  sort,
  onSortChange,
  onRowClick,
  emptyTitle = 'Nothing to show yet',
  emptyDescription,
  emptyAction,
  filtered = false,
  footer,
  caption,
}: DataTableProps<T>) {
  if (error) {
    return <ErrorState error={error} onRetry={onRetry} />;
  }

  const toggleSort = (sortKey: string) => {
    if (!onSortChange) return;
    if (!sort || sort.sort !== sortKey) {
      onSortChange({ sort: sortKey, order: 'desc' });
      return;
    }
    onSortChange({ sort: sortKey, order: sort.order === 'asc' ? 'desc' : 'asc' });
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr className="border-b border-border bg-surface-muted/60">
              {columns.map((column) => {
                const isSorted = sort?.sort === column.sortKey;
                const SortIcon = !isSorted ? ChevronsUpDown : sort?.order === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    title={column.headerTitle}
                    aria-sort={
                      isSorted ? (sort?.order === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                    className={cn(
                      'whitespace-nowrap px-3 py-2 text-2xs font-semibold uppercase tracking-wide text-muted',
                      ALIGN[column.align ?? 'left'],
                      column.hideOnMobile && 'hidden md:table-cell',
                      column.className,
                    )}
                  >
                    {column.sortKey && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.sortKey as string)}
                        className="inline-flex items-center gap-1 rounded px-0.5 transition-colors hover:text-foreground"
                      >
                        {column.header}
                        <SortIcon className="h-3 w-3" aria-hidden />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          {loading ? (
            <tbody>
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <TableSkeleton rows={5} columns={Math.min(columns.length, 5)} />
                </td>
              </tr>
            </tbody>
          ) : rows.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState
                    filtered={filtered}
                    title={filtered ? 'No records match these filters' : emptyTitle}
                    description={
                      filtered
                        ? 'Adjust or clear the filters to widen the search.'
                        : emptyDescription
                    }
                    action={filtered ? undefined : emptyAction}
                  />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(
                    'align-top transition-colors',
                    onRowClick && 'cursor-pointer hover:bg-surface-muted/70',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cn(
                        'px-3 py-2.5 text-foreground',
                        ALIGN[column.align ?? 'left'],
                        column.hideOnMobile && 'hidden md:table-cell',
                        column.className,
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
      {footer}
    </div>
  );
}

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  itemLabel?: string;
}

const PAGE_SIZES = [10, 25, 50, 100];

/** Server-driven pager. Shows both the window and the total so nothing is implied. */
export function Pagination({
  page,
  pageSize,
  total,
  pages,
  onPageChange,
  onPageSizeChange,
  itemLabel = 'records',
}: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const lastPage = Math.max(1, pages);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5"
    >
      <p className="text-2xs text-muted">
        Showing <span className="font-medium text-foreground">{first}</span>–
        <span className="font-medium text-foreground">{last}</span> of{' '}
        <span className="font-medium text-foreground">{total}</span> {itemLabel}
      </p>

      <div className="flex items-center gap-3">
        {onPageSizeChange ? (
          <label className="flex items-center gap-1.5 text-2xs text-muted">
            Rows
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
              className="rounded border border-border bg-surface px-1.5 py-1 text-2xs text-foreground"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            icon={<ChevronLeft className="h-3.5 w-3.5" aria-hidden />}
          />
          <span className="px-1 text-2xs text-muted">
            Page {Math.min(page, lastPage)} of {lastPage}
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next page"
            disabled={page >= lastPage}
            onClick={() => onPageChange(page + 1)}
            icon={<ChevronRight className="h-3.5 w-3.5" aria-hidden />}
          />
        </div>
      </div>
    </nav>
  );
}
