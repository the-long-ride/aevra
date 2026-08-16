export function formatLocalDateTime(value: unknown): string {
  if (value == null || value === '') return '';
  const text = String(value);
  const time = Date.parse(text);
  if (Number.isNaN(time)) return text;
  return new Date(time).toLocaleString();
}
