import { useMemo, useState } from 'react';
import { useMcpActivityEntries, type McpActivityEntry } from '../../hooks/use-mcp-activity';
import type { DashboardData } from './dashboard-service';
import {
  activeEntriesAt,
  BASE_WIDTH,
  BOTTOM,
  buildRequestHistory,
  HEIGHT,
  LEFT,
  RIGHT,
  roundedStepPath,
  toStepPoints,
  TOP,
  type RequestPoint,
} from './request-activity-geometry';
import { useRequestActivityViewport } from './use-request-activity-viewport';

interface TooltipState {
  x: number;
  y: number;
  timestamp: number;
  active: number;
  activeEntries: McpActivityEntry[];
}

const TOOLTIP_ENTRY_LIMIT = 5;

export function RequestActivityChart({ data }: { data: DashboardData }) {
  const entries = useMcpActivityEntries();
  const snapshot = data.snapshot as typeof data.snapshot & {
    startedAt?: string;
    generatedAt?: string;
  };
  const generatedAt = snapshot.generatedAt ?? new Date().toISOString();
  const points = useMemo(() => buildRequestHistory(entries, generatedAt), [entries, generatedAt]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const historyStart = points[0]?.timestamp ?? Date.now();
  const historyEnd = Math.max(
    points[points.length - 1]?.timestamp ?? historyStart,
    historyStart + 1,
  );
  const {
    sectionRef,
    viewportRef,
    following,
    visibleWindowMs,
    pauseFollow,
    handleScroll,
    handleKeyDown,
  } = useRequestActivityViewport(historyStart, historyEnd);

  const historyDuration = Math.max(1, historyEnd - historyStart);
  const widthScale = Math.max(1, historyDuration / visibleWindowMs);
  const width = BASE_WIDTH * widthScale;
  const maxActive = Math.max(1, ...points.map((point) => point.active));
  const x = (timestamp: number) =>
    LEFT + ((timestamp - historyStart) / historyDuration) * (width - LEFT - RIGHT);
  const y = (active: number) => TOP + ((maxActive - active) / maxActive) * (HEIGHT - TOP - BOTTOM);
  const path = roundedStepPath(toStepPoints(points, x, y));
  const current = points[points.length - 1]?.active ?? 0;

  const showTooltip = (point: RequestPoint, clientX: number, clientY: number) => {
    setTooltip({
      x: clientX,
      y: clientY,
      timestamp: point.timestamp,
      active: point.active,
      activeEntries: activeEntriesAt(entries, point.timestamp),
    });
  };

  const moveTooltip = (clientX: number, clientY: number) => {
    setTooltip((prev) => (prev ? { ...prev, x: clientX, y: clientY } : null));
  };

  return (
    <section
      ref={sectionRef}
      className="runtime-request-chart"
      aria-label="Active requests over runtime"
    >
      <div className="runtime-request-chart-head">
        <div>
          <span>Request activity</span>
          <strong>{current} active now</strong>
        </div>
        <small>
          Recent activity · {following ? 'following present' : 'browsing history'}
          {' · '}Alt + wheel to zoom
        </small>
      </div>
      <div
        ref={viewportRef}
        className="runtime-request-chart-viewport"
        role="region"
        aria-label="Request activity timeline"
        tabIndex={0}
        data-following={following}
        data-window-ms={visibleWindowMs}
        onScroll={handleScroll}
        onPointerDown={pauseFollow}
        onKeyDown={handleKeyDown}
      >
        <div className="runtime-request-chart-canvas" style={{ width: `${widthScale * 100}%` }}>
          <svg
            viewBox={`0 0 ${width} ${HEIGHT}`}
            role="img"
            aria-label="Active requests by timestamp"
          >
            <line
              x1={LEFT}
              y1={TOP}
              x2={LEFT}
              y2={HEIGHT - BOTTOM}
              className="runtime-chart-axis"
            />
            <line
              x1={LEFT}
              y1={HEIGHT - BOTTOM}
              x2={width - RIGHT}
              y2={HEIGHT - BOTTOM}
              className="runtime-chart-axis"
            />
            <line x1={LEFT} y1={TOP} x2={width - RIGHT} y2={TOP} className="runtime-chart-grid" />
            <path d={path} className="runtime-chart-line" fill="none" />
            {points.map((point, index) => (
              <circle
                key={index}
                cx={x(point.timestamp)}
                cy={y(point.active)}
                r={5}
                className="runtime-chart-point"
                onMouseEnter={(e) => showTooltip(point, e.clientX, e.clientY)}
                onMouseMove={(e) => moveTooltip(e.clientX, e.clientY)}
                onMouseLeave={() => setTooltip(null)}
              />
            ))}
            <text x={LEFT} y={HEIGHT - 8} className="runtime-chart-label">
              {new Date(historyStart).toLocaleTimeString()}
            </text>
            <text x={width - RIGHT} y={HEIGHT - 8} textAnchor="end" className="runtime-chart-label">
              {new Date(historyEnd).toLocaleTimeString()}
            </text>
            <text x={LEFT + 5} y={TOP + 12} className="runtime-chart-label">
              {maxActive}
            </text>
            <text x={LEFT + 5} y={HEIGHT - BOTTOM - 5} className="runtime-chart-label">
              0
            </text>
          </svg>
        </div>
      </div>
      {tooltip !== null && (
        <div
          className="runtime-chart-tooltip"
          style={{ left: tooltip.x, top: tooltip.y }}
          aria-hidden="true"
        >
          <div className="runtime-chart-tooltip-time">
            {new Date(tooltip.timestamp).toLocaleTimeString()}
          </div>
          <div className="runtime-chart-tooltip-count">{tooltip.active} active</div>
          {tooltip.activeEntries.length > 0 && (
            <div className="runtime-chart-tooltip-entries">
              {tooltip.activeEntries.slice(0, TOOLTIP_ENTRY_LIMIT).map((entry) => (
                <code key={entry.id} className="runtime-chart-tooltip-entry">
                  {entry.action}
                </code>
              ))}
              {tooltip.activeEntries.length > TOOLTIP_ENTRY_LIMIT && (
                <span className="runtime-chart-tooltip-more">
                  +{tooltip.activeEntries.length - TOOLTIP_ENTRY_LIMIT} more
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
