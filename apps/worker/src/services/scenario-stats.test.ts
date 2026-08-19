import { describe, it, expect } from 'vitest';
import { computeScenarioStats } from './scenario-stats.js';

// total はユニーク friend_id 数を返す（COUNT(DISTINCT friend_id)）。
function mockDb(handlers: {
  enrollment: { total: number; active_count: number; completed_count: number; paused_count: number };
  steps: Array<{ step_order: number; reached_count: number }>;
}): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => {
          if (sql.includes('FROM friend_scenarios')) return handlers.enrollment;
          return null;
        },
        all: async () => {
          if (sql.includes('FROM scenario_steps ss')) return { results: handlers.steps };
          return { results: [] };
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('computeScenarioStats', () => {
  it('enrollment ゼロなら全 0', async () => {
    const stats = await computeScenarioStats(
      mockDb({
        enrollment: { total: 0, active_count: 0, completed_count: 0, paused_count: 0 },
        steps: [],
      }),
      'scenario-1',
    );
    expect(stats).toEqual({
      enrolledTotal: 0,
      activeNow: 0,
      completed: 0,
      paused: 0,
      steps: [],
    });
  });

  it('部分到達: step 1 が 80人、step 2 が 60人、step 3 が 30人', async () => {
    const stats = await computeScenarioStats(
      mockDb({
        enrollment: { total: 100, active_count: 30, completed_count: 65, paused_count: 5 },
        steps: [
          { step_order: 1, reached_count: 80 },
          { step_order: 2, reached_count: 60 },
          { step_order: 3, reached_count: 30 },
        ],
      }),
      'scenario-1',
    );
    expect(stats.enrolledTotal).toBe(100);
    expect(stats.activeNow).toBe(30);
    expect(stats.completed).toBe(65);
    expect(stats.paused).toBe(5);
    expect(stats.steps).toEqual([
      { stepOrder: 1, reachedCount: 80, reachRate: 0.8 },
      { stepOrder: 2, reachedCount: 60, reachRate: 0.6 },
      { stepOrder: 3, reachedCount: 30, reachRate: 0.3 },
    ]);
  });

  it('enrollment が 1 件で step が 1 件、到達数 0 → reachRate=0', async () => {
    const stats = await computeScenarioStats(
      mockDb({
        enrollment: { total: 1, active_count: 1, completed_count: 0, paused_count: 0 },
        steps: [{ step_order: 1, reached_count: 0 }],
      }),
      'scenario-1',
    );
    expect(stats.steps).toEqual([{ stepOrder: 1, reachedCount: 0, reachRate: 0 }]);
  });
});
