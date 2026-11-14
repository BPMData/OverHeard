// A daily spending guard for paid services. When today's budget is used up, callers skip the
// paid service and fall back to something free instead of running up the bill.

export interface DailyBudget {
  /** Spend `amount` if it fits in today's budget. Returns false (spending nothing) if not. */
  tryUse(amount: number): boolean;
  /** Spent so far today. */
  used(): number;
  /** Daily limit; 0 means unlimited. */
  readonly limit: number;
}

const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The day rolls over at midnight UTC. A limit of 0 means unlimited, but usage is still counted. */
export function createDailyBudget(limit: number, now: () => number = Date.now): DailyBudget {
  let day = dayOf(now());
  let spent = 0;
  const rollOver = () => {
    const today = dayOf(now());
    if (today !== day) {
      day = today;
      spent = 0;
    }
  };
  return {
    limit,
    tryUse(amount) {
      rollOver();
      if (limit > 0 && spent + amount > limit) return false;
      spent += amount;
      return true;
    },
    used() {
      rollOver();
      return spent;
    },
  };
}
