import { describe, expect, test } from 'vitest';
import {
  getSlotsWithRemaining,
  getActiveBookingCountsBySlot,
  getFriendActiveBookingCount,
} from './event-availability.js';

interface SlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  deleted_at: string | null;
}

interface BookingRow {
  id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  status: string;
}

function memDB(state: { slots: SlotRow[]; bookings: BookingRow[] }): D1Database {
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes("FROM event_bookings") && sql.includes("COUNT(*) AS cnt")) {
            const [event_id, friend_id, ...statuses] = bound as string[];
            const cnt = state.bookings.filter(
              (b) => b.event_id === event_id && b.friend_id === friend_id && statuses.includes(b.status),
            ).length;
            return { cnt } as T;
          }
          return null;
        },
        async run() {
          return { success: true, meta: {} };
        },
        async all<T>() {
          if (sql.includes('FROM event_slots')) {
            const event_id = bound[0] as string;
            const onlyActive = sql.includes('is_active = 1');
            const onlyFuture = sql.includes('starts_at >');
            const nowIso = new Date().toISOString();
            const filtered = state.slots
              .filter((s) => s.event_id === event_id && s.deleted_at == null)
              .filter((s) => (onlyActive ? s.is_active === 1 : true))
              .filter((s) => (onlyFuture ? s.starts_at > nowIso : true))
              .sort((a, b) =>
                a.sort_order !== b.sort_order
                  ? a.sort_order - b.sort_order
                  : a.starts_at.localeCompare(b.starts_at),
              );
            return { results: filtered } as { results: T[] };
          }
          if (sql.includes('FROM event_bookings') && sql.includes('GROUP BY slot_id')) {
            const all = bound as string[];
            // first N are slot_ids, then 2 statuses
            const statusCount = 2;
            const slotIds = all.slice(0, all.length - statusCount);
            const statuses = all.slice(all.length - statusCount);
            const counts = new Map<string, number>();
            for (const b of state.bookings) {
              if (slotIds.includes(b.slot_id) && statuses.includes(b.status)) {
                counts.set(b.slot_id, (counts.get(b.slot_id) ?? 0) + 1);
              }
            }
            const results = Array.from(counts.entries()).map(([slot_id, active_count]) => ({
              slot_id,
              active_count,
            }));
            return { results: results as T[] };
          }
          return { results: [] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

function slot(over: Partial<SlotRow> = {}): SlotRow {
  return {
    id: 's1',
    event_id: 'e1',
    starts_at: '2099-06-01T10:00:00Z',
    ends_at: '2099-06-01T12:00:00Z',
    capacity: 2,
    is_active: 1,
    sort_order: 0,
    deleted_at: null,
    ...over,
  };
}

function booking(over: Partial<BookingRow> = {}): BookingRow {
  return {
    id: 'b1',
    event_id: 'e1',
    slot_id: 's1',
    friend_id: 'f1',
    status: 'confirmed',
    ...over,
  };
}

describe('getSlotsWithRemaining', () => {
  test('capacity=null → remaining=null', async () => {
    const db = memDB({ slots: [slot({ id: 's1', capacity: null })], bookings: [] });
    const out = await getSlotsWithRemaining(db, 'e1');
    expect(out[0].remaining).toBeNull();
  });

  test('subtracts active bookings (confirmed)', async () => {
    const db = memDB({
      slots: [slot({ id: 's1', capacity: 2 })],
      bookings: [booking({ id: 'b1', slot_id: 's1', status: 'confirmed' })],
    });
    const out = await getSlotsWithRemaining(db, 'e1');
    expect(out[0].remaining).toBe(1);
    expect(out[0].active_count).toBe(1);
  });

  test('subtracts requested as well as confirmed', async () => {
    const db = memDB({
      slots: [slot({ id: 's1', capacity: 2 })],
      bookings: [
        booking({ id: 'b1', slot_id: 's1', status: 'requested' }),
        booking({ id: 'b2', slot_id: 's1', status: 'confirmed' }),
      ],
    });
    const out = await getSlotsWithRemaining(db, 'e1');
    expect(out[0].remaining).toBe(0);
  });

  test('ignores cancelled / rejected / expired in count', async () => {
    const db = memDB({
      slots: [slot({ id: 's1', capacity: 2 })],
      bookings: [
        booking({ id: 'b1', slot_id: 's1', status: 'cancelled' }),
        booking({ id: 'b2', slot_id: 's1', status: 'rejected' }),
        booking({ id: 'b3', slot_id: 's1', status: 'expired' }),
        booking({ id: 'b4', slot_id: 's1', status: 'no_show' }),
        booking({ id: 'b5', slot_id: 's1', status: 'attended' }),
      ],
    });
    const out = await getSlotsWithRemaining(db, 'e1');
    expect(out[0].remaining).toBe(2);
    expect(out[0].active_count).toBe(0);
  });

  test('hides deleted slots', async () => {
    const db = memDB({
      slots: [slot({ id: 's1', deleted_at: '2099-01-01T00:00:00Z' })],
      bookings: [],
    });
    const out = await getSlotsWithRemaining(db, 'e1');
    expect(out).toEqual([]);
  });

  test('only_active filters out is_active=0', async () => {
    const db = memDB({
      slots: [slot({ id: 's1', is_active: 0 }), slot({ id: 's2', is_active: 1 })],
      bookings: [],
    });
    const out = await getSlotsWithRemaining(db, 'e1', { only_active: true });
    expect(out.map((s) => s.id)).toEqual(['s2']);
  });

  test('only_future filters out past slots', async () => {
    const db = memDB({
      slots: [
        slot({ id: 'past', starts_at: '2000-01-01T00:00:00Z' }),
        slot({ id: 'future', starts_at: '2099-12-31T00:00:00Z' }),
      ],
      bookings: [],
    });
    const out = await getSlotsWithRemaining(db, 'e1', { only_future: true });
    expect(out.map((s) => s.id)).toEqual(['future']);
  });

  test('returns slots sorted by sort_order then starts_at', async () => {
    const db = memDB({
      slots: [
        slot({ id: 'b', sort_order: 1, starts_at: '2099-06-01T09:00:00Z' }),
        slot({ id: 'a', sort_order: 0, starts_at: '2099-06-01T11:00:00Z' }),
        slot({ id: 'c', sort_order: 0, starts_at: '2099-06-01T10:00:00Z' }),
      ],
      bookings: [],
    });
    const out = await getSlotsWithRemaining(db, 'e1');
    expect(out.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  test('empty slot list returns empty', async () => {
    const db = memDB({ slots: [], bookings: [] });
    expect(await getSlotsWithRemaining(db, 'e1')).toEqual([]);
  });
});

describe('getActiveBookingCountsBySlot', () => {
  test('returns map of slot_id → active count', async () => {
    const db = memDB({
      slots: [],
      bookings: [
        booking({ id: 'b1', slot_id: 's1', status: 'confirmed' }),
        booking({ id: 'b2', slot_id: 's1', status: 'requested' }),
        booking({ id: 'b3', slot_id: 's2', status: 'confirmed' }),
        booking({ id: 'b4', slot_id: 's2', status: 'cancelled' }),
      ],
    });
    const counts = await getActiveBookingCountsBySlot(db, ['s1', 's2', 's3']);
    expect(counts.get('s1')).toBe(2);
    expect(counts.get('s2')).toBe(1);
    expect(counts.get('s3')).toBeUndefined();
  });

  test('empty input returns empty map', async () => {
    const db = memDB({ slots: [], bookings: [] });
    expect((await getActiveBookingCountsBySlot(db, [])).size).toBe(0);
  });
});

describe('getFriendActiveBookingCount', () => {
  test('counts requested + confirmed only for given event/friend', async () => {
    const db = memDB({
      slots: [],
      bookings: [
        booking({ id: 'b1', event_id: 'e1', friend_id: 'f1', status: 'confirmed' }),
        booking({ id: 'b2', event_id: 'e1', friend_id: 'f1', status: 'requested' }),
        booking({ id: 'b3', event_id: 'e1', friend_id: 'f1', status: 'cancelled' }),
        booking({ id: 'b4', event_id: 'e1', friend_id: 'f2', status: 'confirmed' }),
        booking({ id: 'b5', event_id: 'e2', friend_id: 'f1', status: 'confirmed' }),
      ],
    });
    expect(await getFriendActiveBookingCount(db, 'e1', 'f1')).toBe(2);
    expect(await getFriendActiveBookingCount(db, 'e1', 'f2')).toBe(1);
    expect(await getFriendActiveBookingCount(db, 'e2', 'f1')).toBe(1);
  });
});
