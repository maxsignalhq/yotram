import { describe, it, expect } from 'vitest';
import { applyWinner } from '../src/raceWinner.js';
import type { Experiment } from '../src/activity.js';

function exp(id: string, raceId?: string): Experiment {
  return { id, name: id, path: `/tmp/${id}`, branch: `branch-${id}`, base: 'abc', at: 0, port: 4000, raceId };
}

describe('applyWinner', () => {
  it('marks the target winner and clears siblings when only race members exist', () => {
    const experiments = [exp('a', 'race-1'), exp('b', 'race-1')];
    applyWinner(experiments, 'a', 'race-1', true);
    expect(experiments.find(e => e.id === 'a')!.winner).toBe(true);
    expect(experiments.find(e => e.id === 'b')!.winner).toBe(false);
  });

  it('does not disturb a standalone experiment that appears after the target in the array', () => {
    const experiments = [exp('a', 'race-1'), exp('b', 'race-1'), exp('solo')];
    applyWinner(experiments, 'a', 'race-1', true);
    expect(experiments.find(e => e.id === 'a')!.winner).toBe(true);
    expect(experiments.find(e => e.id === 'b')!.winner).toBe(false);
    expect(experiments.find(e => e.id === 'solo')!.winner).toBeUndefined();
  });

  it('does not disturb members of a second, different race', () => {
    const experiments = [exp('a', 'race-1'), exp('c', 'race-2'), exp('d', 'race-2')];
    applyWinner(experiments, 'a', 'race-1', true);
    expect(experiments.find(e => e.id === 'a')!.winner).toBe(true);
    expect(experiments.find(e => e.id === 'c')!.winner).toBeUndefined();
    expect(experiments.find(e => e.id === 'd')!.winner).toBeUndefined();
  });

  it('does not disturb a standalone experiment that appears before the target in the array', () => {
    const experiments = [exp('solo'), exp('a', 'race-1'), exp('b', 'race-1')];
    applyWinner(experiments, 'a', 'race-1', true);
    expect(experiments.find(e => e.id === 'solo')!.winner).toBeUndefined();
    expect(experiments.find(e => e.id === 'a')!.winner).toBe(true);
    expect(experiments.find(e => e.id === 'b')!.winner).toBe(false);
  });

  it('clears the target winner and leaves other experiments untouched', () => {
    const experiments = [exp('a', 'race-1'), exp('b', 'race-1')];
    experiments[0].winner = true;
    applyWinner(experiments, 'a', 'race-1', false);
    expect(experiments.find(e => e.id === 'a')!.winner).toBe(false);
    expect(experiments.find(e => e.id === 'b')!.winner).toBeUndefined();
  });
});
