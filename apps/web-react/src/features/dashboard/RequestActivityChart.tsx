import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useOptionalDialog } from '../../components/Dialog';
import { useMcpActivityEntries } from '../../hooks/use-mcp-activity';
import {
  getAnchorCoords,
  groupEntriesByConnector,
  showMcpActivityDetails,
  type TooltipState,
} from './activity-detail';
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

export function RequestActivityChart({ data }: { data: DashboardData }) {
  const entries = useMcpActivityEntries();
  const dialog = useOptionalDialog();
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const snapshot = data.snapshot as typeof data.snapshot & {
    startedAt?: string;
    generatedAt?: string;
  };
  const snapshotGeneratedAt = snapshot.generatedAt ?? new Date().toISOString();
  const generatedAt = useMemo(() => {
    const timestamps = [
      Date.parse(snapshotGeneratedAt),
      ...entries.flatMap((entry) => [Date.parse(entry.startedAt), Date.parse(entry.updatedAt)]),
    ].filter(Number.isFinite);
    return new Date(Math.max(...timestamps)).toISOString();
  }, [entries, snapshotGeneratedAt]);
  const points = useMemo(() => buildRequestHistory(entries, generatedAt), [entries, generatedAt]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const rawStart = points[0]?.timestamp ?? Date.now();
  const rawEnd = points[points.length - 1]?.timestamp ?? rawStart;
  const historyEnd = Math.max(rawEnd, rawStart + 1);
  const minWindow = 5 * 60_000;
  const historyStart = Math.min(rawStart, historyEnd - minWindow);
  const displayPoints = useMemo(() => {
    if (!points.length) {
      return [
        { timestamp: historyStart, active: 0 },
        { timestamp: historyEnd, active: 0 },
      ];
    }
    if (points[0].timestamp > historyStart) {
      return [{ timestamp: historyStart, active: 0 }, ...points];
    }
    return points;
  }, [points, historyStart, historyEnd]);

  const {
    sectionRef,
    viewportRef,
    following,
    visibleWindowMs,
    pauseFollow,
    handleScroll,
    handleKeyDown,
  } = useRequestActivityViewport(historyStart, historyEnd);

  const [viewportWidth, setViewportWidth] = useState(BASE_WIDTH);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const updateWidth = () => {
      if (el.clientWidth > 0) {
        setViewportWidth(el.clientWidth);
      }
    };
    updateWidth();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(el);
      return () => observer.disconnect();
    }
  }, [viewportRef]);

  const baseWidth = Math.max(viewportWidth, 320);
  const historyDuration = Math.max(1, historyEnd - historyStart);
  const widthScale = Math.max(1, historyDuration / visibleWindowMs);
  const width = Math.round(baseWidth * widthScale);
  const maxActive = Math.max(1, ...displayPoints.map((point) => point.active));
  const requestLevels = Array.from({ length: maxActive + 1 }, (_, index) => maxActive - index);
  const x = (timestamp: number) =>
    LEFT + ((timestamp - historyStart) / historyDuration) * (width - LEFT - RIGHT);
  const y = (active: number) => TOP + ((maxActive - active) / maxActive) * (HEIGHT - TOP - BOTTOM);
  const path = roundedStepPath(toStepPoints(displayPoints, x, y));
  const current = displayPoints[displayPoints.length - 1]?.active ?? 0;

  const activeEntries = useMemo(() => {
    if (!tooltip) return [];
    return activeEntriesAt(entries, tooltip.timestamp);
  }, [entries, tooltip?.timestamp]);

  const connectorGroups = useMemo(() => groupEntriesByConnector(activeEntries), [activeEntries]);

  const showTooltip = (
    point: RequestPoint,
    target: SVGElement,
    clientX?: number,
    clientY?: number,
  ) => {
    if (tooltip?.pinned) return;
    const coords = getAnchorCoords(target, clientX, clientY);
    setTooltip({
      x: coords.x,
      y: coords.y,
      timestamp: point.timestamp,
      active: point.active,
      pinned: false,
    });
  };

  const moveTooltip = (target: SVGElement, clientX?: number, clientY?: number) => {
    if (tooltip?.pinned) return;
    const coords = getAnchorCoords(target, clientX, clientY);
    setTooltip((prev) => (prev ? { ...prev, x: coords.x, y: coords.y } : null));
  };

  const hideTooltip = () => {
    if (tooltip?.pinned) return;
    setTooltip(null);
  };

  const togglePin = (
    point: RequestPoint,
    target: SVGElement,
    clientX?: number,
    clientY?: number,
  ) => {
    if (tooltip?.pinned && tooltip.timestamp === point.timestamp) {
      setTooltip(null);
      return;
    }
    const coords = getAnchorCoords(target, clientX, clientY);
    setTooltip({
      x: coords.x,
      y: coords.y,
      timestamp: point.timestamp,
      active: point.active,
      pinned: true,
    });
  };

  const closeTooltip = () => {
    setTooltip(null);
  };

  useEffect(() => {
    if (!tooltip?.pinned) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (tooltipRef.current?.contains(target)) return;
      if (target.closest?.('.runtime-chart-point')) return;
      setTooltip(null);
    };

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTooltip(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleWindowKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleWindowKeyDown);
    };
  }, [tooltip?.pinned]);

  const onViewportScroll = (_event: React.UIEvent<HTMLDivElement>) => {
    handleScroll();
    if (!tooltip) return;
    if (!tooltip.pinned) {
      setTooltip(null);
    } else {
      const pinnedCircle = viewportRef.current?.querySelector(
        `circle[data-timestamp="${tooltip.timestamp}"]`,
      ) as SVGElement | null;
      if (pinnedCircle) {
        const coords = getAnchorCoords(pinnedCircle);
        setTooltip((prev) => (prev ? { ...prev, x: coords.x, y: coords.y } : null));
      }
    }
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
      <div className="runtime-request-chart-body">
        <div
          ref={viewportRef}
          className="runtime-request-chart-viewport"
          role="region"
          aria-label="Request activity timeline"
          tabIndex={0}
          data-following={following}
          data-window-ms={visibleWindowMs}
          onScroll={onViewportScroll}
          onPointerDown={pauseFollow}
          onKeyDown={handleKeyDown}
        >
          <div
            className="runtime-request-chart-canvas"
            style={{ width: `${width}px`, minWidth: '100%' }}
          >
            <svg
              viewBox={`0 0 ${width} ${HEIGHT}`}
              height={HEIGHT}
              preserveAspectRatio="none"
              style={{ height: `${HEIGHT}px`, width: '100%', display: 'block' }}
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
              {requestLevels.map((level) => (
                <line
                  key={level}
                  x1={LEFT}
                  y1={y(level)}
                  x2={width - RIGHT}
                  y2={y(level)}
                  className="runtime-chart-grid"
                  data-request-level={level}
                />
              ))}
              <path d={path} className="runtime-chart-line" fill="none" />
              {displayPoints.map((point, index) => {
                const isPinned = tooltip?.pinned && tooltip.timestamp === point.timestamp;
                return (
                  <circle
                    key={index}
                    data-timestamp={point.timestamp}
                    data-active={point.active}
                    cx={x(point.timestamp)}
                    cy={y(point.active)}
                    r={isPinned ? 7 : 5}
                    className={`runtime-chart-point${isPinned ? ' is-pinned' : ''}`}
                    onMouseEnter={(e) => showTooltip(point, e.currentTarget, e.clientX, e.clientY)}
                    onMouseMove={(e) => moveTooltip(e.currentTarget, e.clientX, e.clientY)}
                    onMouseLeave={hideTooltip}
                    onClick={(e) => {
                      e.stopPropagation();
                      togglePin(point, e.currentTarget, e.clientX, e.clientY);
                    }}
                  />
                );
              })}
              <text x={LEFT} y={HEIGHT - 8} className="runtime-chart-label">
                {new Date(historyStart).toLocaleTimeString()}
              </text>
              <text
                x={width - RIGHT - 4}
                y={HEIGHT - 8}
                textAnchor="end"
                className="runtime-chart-label"
              >
                {new Date(historyEnd).toLocaleTimeString()}
              </text>
            </svg>
          </div>
        </div>
        <div className="runtime-chart-y-axis" aria-label="Request count scale">
          <svg
            viewBox={`0 0 32 ${HEIGHT}`}
            height={HEIGHT}
            style={{ height: `${HEIGHT}px`, width: '32px', display: 'block' }}
            role="img"
            aria-label={`Scale 0 to ${maxActive} requests`}
          >
            <line x1={0} y1={TOP} x2={0} y2={HEIGHT - BOTTOM} className="runtime-chart-axis" />
            {requestLevels.map((level) => (
              <g key={level}>
                <line
                  x1={0}
                  y1={y(level)}
                  x2={4}
                  y2={y(level)}
                  className="runtime-chart-axis"
                  data-request-level={level}
                />
                <text x={8} y={y(level)} dominantBaseline="central" className="runtime-chart-label">
                  {level}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
      {tooltip !== null && (
        <div
          ref={tooltipRef}
          className={`runtime-chart-tooltip${tooltip.pinned ? ' is-pinned' : ''}`}
          style={{ left: tooltip.x, top: tooltip.y }}
          data-pinned={tooltip.pinned ? 'true' : undefined}
          role={tooltip.pinned ? 'dialog' : undefined}
          aria-label={tooltip.pinned ? 'Active requests details' : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="runtime-chart-tooltip-head">
            <span className="runtime-chart-tooltip-time">
              {new Date(tooltip.timestamp).toLocaleTimeString()}
            </span>
            <div className="runtime-chart-tooltip-head-right">
              <span className="runtime-chart-tooltip-count">{tooltip.active}</span>
              {tooltip.pinned ? (
                <button
                  type="button"
                  className="runtime-chart-tooltip-close"
                  onClick={closeTooltip}
                  aria-label="Close activity popup"
                  title="Close (Esc)"
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
          <div className="runtime-chart-tooltip-body">
            {connectorGroups.length > 0 ? (
              connectorGroups.map((group) => (
                <div key={group.connector} className="runtime-chart-tooltip-group">
                  <div className="runtime-chart-tooltip-connector">{group.connector}</div>
                  <div className="runtime-chart-tooltip-entries">
                    {group.entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className="runtime-chart-tooltip-entry-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (dialog) {
                            showMcpActivityDetails(dialog, entry, data.workspaces);
                          }
                        }}
                        title={`View details for ${entry.action}`}
                      >
                        <code className="runtime-chart-tooltip-entry">{entry.action}</code>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <div className="runtime-chart-tooltip-empty">No active tools recorded</div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
