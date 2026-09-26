import type { Experiment } from './activity.js';

export function applyWinner(experiments: Experiment[], targetId: string, raceId: string, winner: boolean): void {
  if (winner) {
    for (const member of experiments) if (member.raceId === raceId) member.winner = member.id === targetId;
  } else {
    const target = experiments.find(e => e.id === targetId);
    if (target) target.winner = false;
  }
}
