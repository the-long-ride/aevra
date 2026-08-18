function valueOf(row, column) {
  return column.value ? column.value(row) : row?.[column.key];
}

function compare(left, right) {
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

export function deriveTableRows(rows, state, columns, filters = []) {
  const query = String(state.query ?? '').trim().toLowerCase();
  const searchable = columns.filter((column) => column.search !== false);
  const filtered = rows.filter((row) => {
    if (
      query &&
      !searchable.some((column) =>
        String(
          column.searchValue
            ? column.searchValue(row)
            : valueOf(row, column),
        )
          .toLowerCase()
          .includes(query),
      )
    ) {
      return false;
    }
    for (const filter of filters) {
      const selected = state.filters?.[filter.key];
      if (!selected) continue;
      const actual = filter.value ? filter.value(row) : row?.[filter.key];
      if (String(actual ?? '') !== String(selected)) return false;
    }
    return true;
  });

  const sortColumn = columns.find(
    (column) =>
      column.key === state.sortKey && column.sortable !== false,
  );
  if (sortColumn) {
    filtered.sort((left, right) => {
      const direction = state.sortDir === 'desc' ? -1 : 1;
      return (
        compare(valueOf(left, sortColumn), valueOf(right, sortColumn)) *
        direction
      );
    });
  }

  const pageSize = Math.max(1, Number(state.pageSize) || 25);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(
    pageCount,
    Math.max(1, Number(state.page) || 1),
  );
  const start = (page - 1) * pageSize;
  return {
    filtered,
    pageRows: filtered.slice(start, start + pageSize),
    page,
    pageCount,
    start,
  };
}
