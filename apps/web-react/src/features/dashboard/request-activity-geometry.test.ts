import { describe, expect, it } from 'vitest';
import type { McpActivityEntry } from '../../hooks/use-mcp-activity';
import {
  activeEntriesAt,
  buildRequestHistory,
  clamp,
  roundedStepPath,
  toStepPoints,
} from './request-activity-geometry';

describe('request-activity-geometry', () => {
  it('clamps numbers within range', () => {
    expect(clamp(5, 10, 20)).toBe(10);
    expect(clamp(25, 10, 20)).toBe(20);
    expect(clamp(15, 10, 20)).toBe(15);
  });

  it('builds request history with running, completed, and session entries', () => {
    const now = Date.parse('2026-01-01T12:00:00Z');
    const entries: McpActivityEntry[] = [
      {
        id: 'sess-1',
        sessionId: 'sess-1',
        action: 'session',
        kind: 'session',
        actor: 'user',
        state: 'running',
        startedAt: new Date(now - 60_000).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'req-1',
        sessionId: 'sess-1',
        action: 'call',
        kind: 'tool',
        actor: 'ai',
        state: 'success',
        startedAt: new Date(now - 50_000).toISOString(),
        updatedAt: new Date(now - 20_000).toISOString(),
      },
      {
        id: 'req-2',
        sessionId: 'sess-1',
        action: 'call',
        kind: 'tool',
        actor: 'ai',
        state: 'running',
        startedAt: new Date(now - 40_000).toISOString(),
        updatedAt: new Date(now).toISOString(),
      },
      {
        id: 'req-invalid',
        sessionId: 'sess-1',
        action: 'call',
        kind: 'tool',
        actor: 'ai',
        state: 'success',
        startedAt: 'invalid-date',
        updatedAt: 'invalid-date',
      },
      {
        id: 'req-future',
        sessionId: 'sess-1',
        action: 'call',
        kind: 'tool',
        actor: 'ai',
        state: 'success',
        startedAt: new Date(now + 100_000).toISOString(),
        updatedAt: new Date(now + 120_000).toISOString(),
      },
    ];

    const history = buildRequestHistory(entries, new Date(now).toISOString());
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history[0].active).toBe(0);

    // Fallback for invalid generatedAt
    const fallback = buildRequestHistory([], 'invalid');
    expect(fallback).toHaveLength(1);

    // Completed only - tests idle trailing padding
    const completedOnly: McpActivityEntry[] = [
      {
        id: 'req-c',
        sessionId: 'sess-1',
        action: 'call',
        kind: 'tool',
        actor: 'ai',
        state: 'success',
        startedAt: new Date(now - 100_000).toISOString(),
        updatedAt: new Date(now - 90_000).toISOString(),
      },
    ];
    const idleHistory = buildRequestHistory(completedOnly, new Date(now).toISOString());
    expect(idleHistory.length).toBeGreaterThan(1);
    expect(idleHistory.at(-1)?.active).toBe(0);
  });

  it('renders rounded step paths and handles edge cases', () => {
    expect(roundedStepPath([])).toBe('');
    expect(roundedStepPath([[10, 20]])).toBe('M 10.00 20.00');

    // Normal path with corner radius
    const path = roundedStepPath([
      [0, 0],
      [10, 0],
      [10, 10],
      [20, 10],
    ]);
    expect(path).toContain('Q');
    expect(path).toContain('L');

    // Very close points (radius <= 0.01)
    const tightPath = roundedStepPath([
      [0, 0],
      [0.005, 0],
      [0.01, 0.01],
      [1, 1],
    ]);
    expect(tightPath).toContain('L');
  });

  it('converts request points to step points', () => {
    const points = [
      { timestamp: 1000, active: 0 },
      { timestamp: 2000, active: 2 },
    ];
    const stepPoints = toStepPoints(
      points,
      (t) => t / 10,
      (a) => a * 10,
    );
    expect(stepPoints).toEqual([
      [100, 0],
      [200, 0],
      [200, 20],
    ]);
  });

  it('filters active entries at a given timestamp', () => {
    const t = 1000;
    const entries: McpActivityEntry[] = [
      {
        id: '1',
        sessionId: 's',
        action: 'act',
        kind: 'session',
        actor: '',
        state: 'running',
        startedAt: '1970-01-01T00:00:00Z',
        updatedAt: '',
      },
      {
        id: '2',
        sessionId: 's',
        action: 'act',
        kind: 'tool',
        actor: '',
        state: 'running',
        startedAt: 'invalid',
        updatedAt: '',
      },
      {
        id: '3',
        sessionId: 's',
        action: 'act',
        kind: 'tool',
        actor: '',
        state: 'running',
        startedAt: '1970-01-01T00:00:02Z',
        updatedAt: '',
      },
      {
        id: '4',
        sessionId: 's',
        action: 'act',
        kind: 'tool',
        actor: '',
        state: 'running',
        startedAt: '1970-01-01T00:00:00Z',
        updatedAt: '',
      },
      {
        id: '5',
        sessionId: 's',
        action: 'act',
        kind: 'tool',
        actor: '',
        state: 'success',
        startedAt: '1970-01-01T00:00:00Z',
        updatedAt: '1970-01-01T00:00:02Z',
      },
      {
        id: '6',
        sessionId: 's',
        action: 'act',
        kind: 'tool',
        actor: '',
        state: 'success',
        startedAt: '1970-01-01T00:00:00Z',
        updatedAt: '1970-01-01T00:00:00.500Z',
      },
      {
        id: '7',
        sessionId: 's',
        action: 'act',
        kind: 'tool',
        actor: '',
        state: 'success',
        startedAt: '1970-01-01T00:00:00Z',
        updatedAt: 'invalid',
      },
    ];
    const active = activeEntriesAt(entries, t);
    expect(active.map((e) => e.id)).toEqual(['4', '5', '7']);
  });
});
