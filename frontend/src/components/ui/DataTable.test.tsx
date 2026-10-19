import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, Pagination, type Column, type SortState } from './DataTable';

interface Row {
  id: number;
  reference: string;
  owner: string;
}

const ROWS: Row[] = [
  { id: 1, reference: 'RSK-0001', owner: 'A. Analyst' },
  { id: 2, reference: 'RSK-0002', owner: 'R. Manager' },
];

const COLUMNS: Array<Column<Row>> = [
  { key: 'reference', header: 'Reference', cell: (row) => row.reference, sortKey: 'reference' },
  { key: 'owner', header: 'Owner', cell: (row) => row.owner },
];

function renderTable(overrides: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      rowKey={(row) => row.id}
      caption="Risk register"
      {...overrides}
    />,
  );
}

describe('DataTable', () => {
  it('renders one row per record through the cell renderers', () => {
    renderTable();
    expect(screen.getByText('RSK-0001')).toBeInTheDocument();
    expect(screen.getByText('RSK-0002')).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + two rows
  });

  it('keeps the table caption available to assistive technology only', () => {
    renderTable();
    expect(screen.getByText('Risk register')).toBeInTheDocument();
  });

  it('shows a skeleton while the page is loading', () => {
    renderTable({ rows: [], loading: true });
    expect(screen.getByLabelText('Loading records')).toBeInTheDocument();
  });

  it('surfaces the backend error message verbatim and offers a retry', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderTable({ rows: [], error: new Error('You do not have permission to view this.'), onRetry });

    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to view this.');
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('distinguishes an empty result set from an empty filter match', () => {
    const { unmount } = renderTable({ rows: [], emptyTitle: 'No risks yet' });
    expect(screen.getByText('No risks yet')).toBeInTheDocument();
    unmount();

    renderTable({ rows: [], filtered: true, emptyTitle: 'No risks yet' });
    expect(screen.getByText('No records match these filters')).toBeInTheDocument();
    expect(screen.queryByText('No risks yet')).not.toBeInTheDocument();
  });

  it('requests a descending sort first, then toggles to ascending', async () => {
    const user = userEvent.setup();

    // Sorting is server-side, so the parent owns the state; mirror that here.
    function SortableTable() {
      const [sort, setSort] = useState<SortState | undefined>(undefined);
      return (
        <DataTable<Row>
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(row) => row.id}
          sort={sort}
          onSortChange={setSort}
        />
      );
    }

    render(<SortableTable />);
    const header = () => screen.getByRole('columnheader', { name: /reference/i });

    await user.click(screen.getByRole('button', { name: /reference/i }));
    expect(header()).toHaveAttribute('aria-sort', 'descending');

    await user.click(screen.getByRole('button', { name: /reference/i }));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
  });

  it('does not offer a sort control on an unsortable column', () => {
    renderTable({ onSortChange: vi.fn() });
    expect(screen.queryByRole('button', { name: /owner/i })).not.toBeInTheDocument();
  });

  it('exposes the current sort direction on the column header', () => {
    renderTable({ sort: { sort: 'reference', order: 'asc' }, onSortChange: vi.fn() });
    expect(screen.getByRole('columnheader', { name: /reference/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('calls the row handler on click and on keyboard activation', async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    renderTable({ onRowClick });

    await user.click(screen.getByText('RSK-0001'));
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);

    const row = screen.getByText('RSK-0002').closest('tr');
    row?.focus();
    await user.keyboard('{Enter}');
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[1]);
  });

  it('renders a footer slot below the table', () => {
    renderTable({ footer: <p>Footer content</p> });
    expect(screen.getByText('Footer content')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  const base = { page: 1, pageSize: 25, total: 60, pages: 3 };

  it('reports the visible window and the total honestly', () => {
    render(<Pagination {...base} onPageChange={vi.fn()} />);
    expect(screen.getByLabelText('Pagination').textContent).toContain('Showing 1–25 of 60 records');
  });

  it('disables Previous on the first page', () => {
    render(<Pagination {...base} onPageChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('disables Next on the last page and moves forward otherwise', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const { unmount } = render(<Pagination {...base} onPageChange={onPageChange} />);

    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    unmount();

    render(<Pagination {...base} page={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('reports a zero-length window without inventing rows', () => {
    render(<Pagination page={1} pageSize={25} total={0} pages={0} onPageChange={vi.fn()} />);
    expect(screen.getByLabelText('Pagination').textContent).toContain('Showing 0–0 of 0 records');
  });

  it('offers a page-size control when the caller supports it', async () => {
    const user = userEvent.setup();
    const onPageSizeChange = vi.fn();
    render(<Pagination {...base} onPageChange={vi.fn()} onPageSizeChange={onPageSizeChange} />);

    await user.selectOptions(screen.getByRole('combobox'), '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});
