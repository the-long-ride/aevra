import { useMemo, useState } from 'react';

export interface Column<T> {
  key: string;
  label: string;
  value?(row: T): unknown;
  render?(row: T): React.ReactNode;
  sortable?: boolean;
  search?: boolean;
  priority?: 'low' | 'normal';
}

export interface FilterDefinition<T> {
  key: string;
  label: string;
  value?(row: T): unknown;
  format?(value: unknown): string;
}

export interface DataTableProps<T> {
  id: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  filters?: readonly FilterDefinition<T>[];
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  pageSize?: 10 | 25 | 50 | 100;
  searchPlaceholder?: string;
  emptyText?: string;
  rowKey?(row: T, index: number): string;
}

function rawValue<T>(row: T, column: Column<T>): unknown {
  if (column.value) return column.value(row);
  return (row as Record<string, unknown>)[column.key];
}

function compare(left: unknown, right: unknown) {
  if (left == null && right == null) return 0;
  if (left == null) return -1;
  if (right == null) return 1;
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right;
  }
  return String(left).localeCompare(String(right), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

export function DataTable<T>({
  id,
  rows,
  columns,
  filters = [],
  defaultSort,
  pageSize = 25,
  searchPlaceholder = 'Search…',
  emptyText = 'No data',
  rowKey = (_, index) => String(index),
}: DataTableProps<T>) {
  const [query, setQuery] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState(defaultSort?.key ?? '');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(
    defaultSort?.direction ?? 'asc',
  );
  const [size, setSize] = useState<10 | 25 | 50 | 100>(pageSize);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const searchable = columns.filter((column) => column.search !== false);
    const next = rows.filter((row) => {
      if (
        normalized &&
        !searchable.some((column) =>
          String(rawValue(row, column) ?? '')
            .toLowerCase()
            .includes(normalized),
        )
      ) {
        return false;
      }
      return filters.every((filter) => {
        const selected = selectedFilters[filter.key];
        if (!selected) return true;
        const actual = filter.value
          ? filter.value(row)
          : (row as Record<string, unknown>)[filter.key];
        return String(actual ?? '') === selected;
      });
    });
    const column = columns.find((item) => item.key === sortKey && item.sortable !== false);
    if (column) {
      next.sort((left, right) => {
        const direction = sortDirection === 'asc' ? 1 : -1;
        return compare(rawValue(left, column), rawValue(right, column)) * direction;
      });
    }
    return next;
  }, [columns, filters, query, rows, selectedFilters, sortDirection, sortKey]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const safePage = Math.min(page, pageCount);
  const start = (safePage - 1) * size;
  const pageRows = filtered.slice(start, start + size);
  const end = Math.min(start + size, filtered.length);

  const filterOptions = (filter: FilterDefinition<T>) =>
    [
      ...new Set(
        rows
          .map((row) =>
            String(
              filter.value
                ? (filter.value(row) ?? '')
                : ((row as Record<string, unknown>)[filter.key] ?? ''),
            ),
          )
          .filter(Boolean),
      ),
    ].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  return (
    <div className="data-table-host" data-table-id={id}>
      <div className="dt-toolbar">
        <label className="dt-search">
          <span className="sr-only">Search</span>
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPage(1);
            }}
          />
        </label>
        <div className="dt-filters">
          {filters.map((filter) => (
            <label className="dt-filter" key={filter.key}>
              <span>{filter.label}</span>
              <select
                value={selectedFilters[filter.key] ?? ''}
                onChange={(event) => {
                  setSelectedFilters((current) => ({
                    ...current,
                    [filter.key]: event.currentTarget.value,
                  }));
                  setPage(1);
                }}
              >
                <option value="">All</option>
                {filterOptions(filter).map((value) => (
                  <option key={value} value={value}>
                    {filter.format?.(value) ?? value}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label className="dt-size">
          <span>Rows</span>
          <select
            value={size}
            onChange={(event) => {
              setSize(Number(event.currentTarget.value) as 10 | 25 | 50 | 100);
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="dt-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} data-priority={column.priority ?? 'normal'}>
                  {column.sortable === false ? (
                    column.label
                  ) : (
                    <button
                      type="button"
                      className="dt-sort"
                      onClick={() => {
                        if (sortKey === column.key) {
                          setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
                        } else {
                          setSortKey(column.key);
                          setSortDirection('asc');
                        }
                        setPage(1);
                      }}
                    >
                      {column.label}{' '}
                      {sortKey === column.key ? (sortDirection === 'asc' ? '↑' : '↓') : ''}
                    </button>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length ? (
              pageRows.map((row, index) => (
                <tr key={rowKey(row, start + index)}>
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-label={column.label}
                      data-priority={column.priority ?? 'normal'}
                    >
                      {column.render?.(row) ?? String(rawValue(row, column) ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="dt-empty" colSpan={Math.max(1, columns.length)}>
                  {emptyText}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="dt-footer">
        <span>{filtered.length ? `${start + 1}–${end} of ${filtered.length}` : '0 rows'}</span>
        <div className="dt-pages">
          <button type="button" disabled={safePage <= 1} onClick={() => setPage(1)}>
            «
          </button>
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage(Math.max(1, safePage - 1))}
          >
            ‹
          </button>
          <span>
            Page {safePage} / {pageCount}
          </span>
          <button
            type="button"
            disabled={safePage >= pageCount}
            onClick={() => setPage(Math.min(pageCount, safePage + 1))}
          >
            ›
          </button>
          <button type="button" disabled={safePage >= pageCount} onClick={() => setPage(pageCount)}>
            »
          </button>
        </div>
      </div>
    </div>
  );
}
