import type { DeliveryMode } from './scenarios.js';

export interface ScenarioRow {
  delivery_mode: DeliveryMode;
}

export interface StepRow {
  delay_minutes: number;
  offset_days: number | null;
  offset_minutes: number | null;
  delivery_time: string | null;
}

export interface ScheduleContext {
  /** friend_scenarios.started_at (JST) を Date に変換したもの */
  enrolledAt: Date;
  /** 前ステップ配信完了時刻 (relative mode で使用)。初回は enrolledAt と同じ */
  previousDeliveredAt: Date;
  /** 現在時刻 (JST)。absolute_time mode の過去時刻 clamp に使用 */
  now: Date;
}

function addMinutes(date: Date, minutes: number): Date {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * 次配信時刻を計算する。delivery_mode に応じて 3 通りの計算を切り替える。
 *
 * - relative: previousDeliveredAt + delay_minutes
 * - elapsed: enrolledAt + (offset_days*1440 + offset_minutes) 分
 * - absolute_time: enrolledAt + offset_days 日後の delivery_time。過去なら now に丸める。
 */
export function computeNextDeliveryAt(
  scenario: ScenarioRow,
  step: StepRow,
  context: ScheduleContext,
): Date {
  switch (scenario.delivery_mode) {
    case 'relative':
      return addMinutes(context.previousDeliveredAt, step.delay_minutes ?? 0);

    case 'elapsed':
      return addMinutes(
        context.enrolledAt,
        (step.offset_days ?? 0) * 1440 + (step.offset_minutes ?? 0),
      );

    case 'absolute_time': {
      const target = addDays(context.enrolledAt, step.offset_days ?? 0);
      const [h, m] = (step.delivery_time ?? '00:00').split(':').map(Number);
      target.setHours(h, m, 0, 0);
      return target < context.now ? context.now : target;
    }
  }
}
