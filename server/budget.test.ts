import { describe, expect, it } from 'vitest';
import { createDailyBudget } from './budget';

const at = (iso: string) => Date.parse(iso);

describe('createDailyBudget', () => {
  it('allows spending up to the limit and refuses the request that would pass it', () => {
    const budget = createDailyBudget(100, () => at('2026-11-14T10:00:00Z'));
    expect(budget.tryUse(60)).toBe(true);
    expect(budget.tryUse(40)).toBe(true);
    expect(budget.tryUse(1)).toBe(false);
    expect(budget.used()).toBe(100);
  });

  it('refuses without spending anything when a request does not fit', () => {
    const budget = createDailyBudget(100, () => at('2026-11-14T10:00:00Z'));
    budget.tryUse(90);
    expect(budget.tryUse(20)).toBe(false);
    expect(budget.used()).toBe(90);
    expect(budget.tryUse(10)).toBe(true);
  });

  it('starts fresh after midnight UTC', () => {
    let now = at('2026-11-14T23:59:00Z');
    const budget = createDailyBudget(10, () => now);
    expect(budget.tryUse(10)).toBe(true);
    expect(budget.tryUse(1)).toBe(false);
    now = at('2026-11-15T00:01:00Z');
    expect(budget.used()).toBe(0);
    expect(budget.tryUse(10)).toBe(true);
  });

  it('treats 0 as unlimited but still counts usage', () => {
    const budget = createDailyBudget(0, () => at('2026-11-14T10:00:00Z'));
    expect(budget.tryUse(5_000_000)).toBe(true);
    expect(budget.used()).toBe(5_000_000);
  });
});
