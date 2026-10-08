export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * magnitude;
}

interface Point {
  inputTokens: number;
  outputTokens: number;
  savedTokens: number;
}

export function layoutBars(
  series: ReadonlyArray<Point>,
  plot: { width: number; height: number },
  max: number,
) {
  if (!series.length) return [];
  const slot = plot.width / series.length;
  const width = Math.max(1, slot * 0.7);
  return series.map((point, index) => ({
    x: index * slot + (slot - width) / 2,
    width,
    inputH: (point.inputTokens / max) * plot.height,
    outputH: (point.outputTokens / max) * plot.height,
    savedY: plot.height - (point.savedTokens / max) * plot.height,
  }));
}
