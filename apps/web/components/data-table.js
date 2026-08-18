import { escapeHtml } from '../core/dom.js';
import { deriveTableRows } from './data-table-state.js';

const states = new Map();

function valueOf(row, column) {
  return column.value ? column.value(row) : row?.[column.key];
}

function stateFor(id, options) {
  if (states.has(id)) return states.get(id);
  const state = {
    query: '',
    sortKey: options.defaultSort?.key ?? '',
    sortDir: options.defaultSort?.dir ?? 'asc',
    page: 1,
    pageSize: options.pageSize ?? 25,
    filters: {},
  };
  states.set(id, state);
  return state;
}

function filterOptions(rows, filter) {
  if (filter.options) return filter.options;
  return [
    ...new Set(
      rows
        .map((row) => (filter.value ? filter.value(row) : row?.[filter.key]))
        .filter(
          (value) => value !== undefined && value !== null && value !== '',
        ),
    ),
  ].sort((left, right) =>
    String(left).localeCompare(String(right), undefined, { numeric: true }),
  );
}

function renderFilters(rows, filters, state) {
  return filters
    .map((filter) => {
      const values = filterOptions(rows, filter);
      return `<label class="dt-filter">
        <span>${escapeHtml(filter.label ?? filter.key)}</span>
        <select data-dt-filter="${escapeHtml(filter.key)}">
          <option value="">All</option>
          ${values
            .map(
              (value) => `<option value="${escapeHtml(value)}" ${
                String(value) === String(state.filters[filter.key] ?? '')
                  ? 'selected'
                  : ''
              }>${escapeHtml(filter.format ? filter.format(value) : value)}</option>`,
            )
            .join('')}
        </select>
      </label>`;
    })
    .join('');
}

function renderHead(columns, state) {
  return columns
    .map((column) => {
      const sortable = column.sortable !== false;
      const active = state.sortKey === column.key;
      const arrow = active ? (state.sortDir === 'asc' ? '↑' : '↓') : '';
      const label = escapeHtml(column.label ?? column.key);
      return `<th data-priority="${escapeHtml(column.priority ?? 'normal')}">${
        sortable
          ? `<button type="button" class="dt-sort" data-dt-sort="${escapeHtml(column.key)}">${label} <span>${arrow}</span></button>`
          : label
      }</th>`;
    })
    .join('');
}

function renderBody(rows, columns, options, rowKey) {
  if (rows.length === 0) {
    return `<tr><td class="dt-empty" colspan="${Math.max(1, columns.length)}">${escapeHtml(options.emptyText ?? 'No data')}</td></tr>`;
  }
  return rows
    .map((row, index) => {
      const key = String(rowKey(row, index));
      const cells = columns
        .map(
          (column) => `<td data-label="${escapeHtml(
            column.label ?? column.key,
          )}" data-priority="${escapeHtml(column.priority ?? 'normal')}">${
            column.render
              ? column.render(row, index)
              : escapeHtml(valueOf(row, column))
          }</td>`,
        )
        .join('');
      return `<tr data-dt-row="${escapeHtml(key)}">${cells}</tr>`;
    })
    .join('');
}

function bind(container, options, state, result, rowKey) {
  const remount = () => mountDataTable(container, options);
  container.querySelector('[data-dt-search]')?.addEventListener('input', (event) => {
    state.query = event.target.value;
    state.page = 1;
    remount();
  });
  for (const select of container.querySelectorAll('[data-dt-filter]')) {
    select.addEventListener('change', () => {
      state.filters[select.dataset.dtFilter] = select.value;
      state.page = 1;
      remount();
    });
  }
  container.querySelector('[data-dt-size]')?.addEventListener('change', (event) => {
    state.pageSize = Math.max(1, Number(event.target.value) || 25);
    state.page = 1;
    remount();
  });
  for (const button of container.querySelectorAll('[data-dt-sort]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.dtSort;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortKey = key;
        state.sortDir = 'asc';
      }
      state.page = 1;
      remount();
    });
  }
  for (const button of container.querySelectorAll('[data-dt-page]')) {
    button.addEventListener('click', () => {
      const action = button.dataset.dtPage;
      if (action === 'first') state.page = 1;
      if (action === 'prev') state.page = Math.max(1, result.page - 1);
      if (action === 'next') state.page = Math.min(result.pageCount, result.page + 1);
      if (action === 'last') state.page = result.pageCount;
      remount();
    });
  }
  if (options.onAction) {
    container.onclick = (event) => {
      const action = event.target.closest('[data-table-action]');
      if (!action) return;
      const rowElement = action.closest('[data-dt-row]');
      const row = options.rows.find(
        (candidate, index) =>
          String(rowKey(candidate, index)) === rowElement?.dataset.dtRow,
      );
      if (row) {
        options.onAction(
          action.dataset.tableAction,
          row,
          event,
          action,
        );
      }
    };
  }
}

export function mountDataTable(container, options) {
  if (!container) throw new Error('DataTable container required');
  const id = options.id ?? container.id ?? `table-${crypto.randomUUID()}`;
  const state = stateFor(id, options);
  const columns = options.columns ?? [];
  const filters = options.filters ?? [];
  const rows = Array.isArray(options.rows) ? options.rows : [];
  const result = deriveTableRows(rows, state, columns, filters);
  state.page = result.page;
  const rowKey = options.rowKey ?? ((row, index) => row?.id ?? index);
  const pageSizes = options.pageSizes ?? [10, 25, 50, 100];
  const end = Math.min(
    result.start + state.pageSize,
    result.filtered.length,
  );

  container.classList.add('data-table-host');
  container.innerHTML = `
    <div class="dt-toolbar">
      <label class="dt-search">
        <span class="sr-only">Search</span>
        <input type="search" data-dt-search placeholder="${escapeHtml(
          options.searchPlaceholder ?? 'Search…',
        )}" value="${escapeHtml(state.query)}">
      </label>
      <div class="dt-filters">${renderFilters(rows, filters, state)}</div>
      ${options.toolbarHtml ?? ''}
      <label class="dt-size"><span>Rows</span><select data-dt-size>
        ${pageSizes
          .map(
            (size) => `<option value="${size}" ${
              Number(size) === Number(state.pageSize) ? 'selected' : ''
            }>${size}</option>`,
          )
          .join('')}
      </select></label>
    </div>
    <div class="dt-scroll">
      <table class="data-table">
        <thead><tr>${renderHead(columns, state)}</tr></thead>
        <tbody>${renderBody(result.pageRows, columns, options, rowKey)}</tbody>
      </table>
    </div>
    <div class="dt-footer">
      <span>${
        result.filtered.length
          ? `${result.start + 1}–${end} of ${result.filtered.length}`
          : '0 rows'
      }</span>
      <div class="dt-pages">
        <button type="button" data-dt-page="first" ${result.page <= 1 ? 'disabled' : ''}>«</button>
        <button type="button" data-dt-page="prev" ${result.page <= 1 ? 'disabled' : ''}>‹</button>
        <span>Page ${result.page} / ${result.pageCount}</span>
        <button type="button" data-dt-page="next" ${result.page >= result.pageCount ? 'disabled' : ''}>›</button>
        <button type="button" data-dt-page="last" ${result.page >= result.pageCount ? 'disabled' : ''}>»</button>
      </div>
    </div>`;

  bind(container, options, state, result, rowKey);
  return {
    state,
    filtered: result.filtered,
    pageRows: result.pageRows,
    refresh: () => mountDataTable(container, options),
  };
}

export function resetDataTable(id) {
  states.delete(id);
}
