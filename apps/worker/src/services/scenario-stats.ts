export interface ScenarioStats {
  enrolledTotal: number;
  activeNow: number;
  completed: number;
  paused: number;
  steps: Array<{
    stepOrder: number;
    reachedCount: number;
    /** 0..1 */
    reachRate: number;
  }>;
}

interface EnrollmentRow {
  total: number;
  active_count: number;
  completed_count: number;
  paused_count: number;
}

interface StepReachRow {
  step_order: number;
  reached_count: number;
}

/**
 * シナリオの到達率ダッシュボード集計。
 * 「到達」= messages_log に scenario_step_id 付きで outgoing scenario レコードが書かれた、と定義。
 * ブロック中の友だち (push 失敗 → messages_log なし) や condition_type=false で skip した step は
 * 自然と除外される。
 */
export async function computeScenarioStats(
  db: D1Database,
  scenarioId: string,
): Promise<ScenarioStats> {
  // 1) enrollment 数。enrolledTotal は DISTINCT friend_id でカウントする。
  // friend_scenarios の同じ friend × scenario はリエンロール時に複数行になり得るため、
  // 「ユニーク参加人数」を分母にしないと到達率計算 (reached_count も DISTINCT friend_id) と
  // 整合しない。status カウントも同様に DISTINCT friend_id でユニーク化する。
  // ただし「1人が active と completed の両方に該当する」ケースは仕様上発生し得る
  // (古い completed 行が残ったまま再 enroll で active 行ができる) → ヘッダー表示では
  // 「該当 status を持つユニーク friend 数」として扱う。enrolledTotal とは数が一致しない可能性あり。
  const enrollRow = await db
    .prepare(
      `SELECT COUNT(DISTINCT friend_id) AS total,
              COUNT(DISTINCT CASE WHEN status='active'    THEN friend_id END) AS active_count,
              COUNT(DISTINCT CASE WHEN status='completed' THEN friend_id END) AS completed_count,
              COUNT(DISTINCT CASE WHEN status='paused'    THEN friend_id END) AS paused_count
       FROM friend_scenarios WHERE scenario_id = ?`,
    )
    .bind(scenarioId)
    .first<EnrollmentRow>();

  const enrolledTotal = enrollRow?.total ?? 0;

  // 2) 各 step の到達ユニーク人数
  const stepsResult = await db
    .prepare(
      `SELECT ss.step_order, COUNT(DISTINCT ml.friend_id) AS reached_count
       FROM scenario_steps ss
       LEFT JOIN messages_log ml
         ON ml.scenario_step_id = ss.id
        AND ml.direction = 'outgoing'
        AND ml.source = 'scenario'
       WHERE ss.scenario_id = ?
       GROUP BY ss.step_order
       ORDER BY ss.step_order ASC`,
    )
    .bind(scenarioId)
    .all<StepReachRow>();

  const steps = stepsResult.results.map((row) => ({
    stepOrder: row.step_order,
    reachedCount: row.reached_count,
    reachRate: enrolledTotal > 0 ? row.reached_count / enrolledTotal : 0,
  }));

  return {
    enrolledTotal,
    activeNow: enrollRow?.active_count ?? 0,
    completed: enrollRow?.completed_count ?? 0,
    paused: enrollRow?.paused_count ?? 0,
    steps,
  };
}
