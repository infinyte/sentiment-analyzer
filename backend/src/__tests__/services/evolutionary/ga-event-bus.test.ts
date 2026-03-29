import { GAEventBus, gaEventBus } from '../../../services/evolutionary/ga-event-bus.js';
import type { GAEvents } from '../../../services/evolutionary/ga-event-bus.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSummary() {
  return {
    generation: 1,
    competitionId: 'comp_1',
    population: ['a1', 'a2'],
    survivors: ['a1'],
    offspring: ['a3'],
    retired: ['a2'],
    topAgentId: 'a1',
    topFitness: 72.5,
    avgFitness: 55.0,
    completedAt: new Date().toISOString(),
  };
}

// ── GAEventBus unit tests ────────────────────────────────────────────────────

describe('GAEventBus', () => {
  let bus: GAEventBus;

  beforeEach(() => {
    bus = new GAEventBus();
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  // ── on / emit ────────────────────────────────────────────────────────────

  it('delivers task:queued payload to a registered listener', () => {
    const received: GAEvents['task:queued'][] = [];
    bus.on('task:queued', p => received.push(p));

    bus.emit('task:queued', {
      tournamentId: 'evo_1',
      name: 'Test Run',
      populationSize: 6,
      maxGenerations: 3,
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ tournamentId: 'evo_1', name: 'Test Run' });
  });

  it('delivers task:started payload', () => {
    const received: GAEvents['task:started'][] = [];
    bus.on('task:started', p => received.push(p));

    bus.emit('task:started', {
      tournamentId: 'evo_1',
      generation: 2,
      populationSize: 6,
      competitionId: 'comp_2',
    });

    expect(received[0]).toMatchObject({ generation: 2, competitionId: 'comp_2' });
  });

  it('delivers task:progress payload', () => {
    const progresses: number[] = [];
    bus.on('task:progress', p => progresses.push(p.progress));

    bus.emit('task:progress', { tournamentId: 'evo_1', generation: 1, competitionId: 'c1', progress: 50 });
    bus.emit('task:progress', { tournamentId: 'evo_1', generation: 1, competitionId: 'c1', progress: 100 });

    expect(progresses).toEqual([50, 100]);
  });

  it('delivers task:completed payload', () => {
    const received: GAEvents['task:completed'][] = [];
    bus.on('task:completed', p => received.push(p));

    bus.emit('task:completed', {
      tournamentId: 'evo_1',
      generation: 1,
      competitionId: 'c1',
      topFitness: 70,
      avgFitness: 52,
    });

    expect(received[0]?.topFitness).toBe(70);
    expect(received[0]?.avgFitness).toBe(52);
  });

  it('delivers generation:complete payload with full summary', () => {
    const summaries: GAEvents['generation:complete'][] = [];
    bus.on('generation:complete', p => summaries.push(p));

    const summary = makeSummary();
    bus.emit('generation:complete', { tournamentId: 'evo_1', generation: 1, summary });

    expect(summaries[0]?.summary.topFitness).toBe(72.5);
    expect(summaries[0]?.summary.avgFitness).toBe(55.0);
  });

  it('delivers convergence:detected payload', () => {
    const events: GAEvents['convergence:detected'][] = [];
    bus.on('convergence:detected', p => events.push(p));

    bus.emit('convergence:detected', {
      tournamentId: 'evo_1',
      generation: 4,
      topFitness: 88,
      threshold: 85,
    });

    expect(events[0]).toMatchObject({ generation: 4, topFitness: 88, threshold: 85 });
  });

  // ── Multiple listeners ────────────────────────────────────────────────────

  it('delivers to multiple listeners on the same event', () => {
    const counts = [0, 0];
    bus.on('task:queued', () => { counts[0]!++; });
    bus.on('task:queued', () => { counts[1]!++; });

    bus.emit('task:queued', { tournamentId: 'x', name: 'y', populationSize: 4, maxGenerations: 1 });

    expect(counts).toEqual([1, 1]);
  });

  // ── off ───────────────────────────────────────────────────────────────────

  it('stops delivering after off() is called', () => {
    const received: string[] = [];
    const listener = (p: GAEvents['task:queued']) => received.push(p.tournamentId);

    bus.on('task:queued', listener);
    bus.emit('task:queued', { tournamentId: 'first', name: 'n', populationSize: 4, maxGenerations: 1 });

    bus.off('task:queued', listener);
    bus.emit('task:queued', { tournamentId: 'second', name: 'n', populationSize: 4, maxGenerations: 1 });

    expect(received).toEqual(['first']);
  });

  // ── on() unsubscribe function ────────────────────────────────────────────

  it('on() returns an unsubscribe function that removes the listener', () => {
    const received: string[] = [];
    const unsub = bus.on('task:queued', p => received.push(p.tournamentId));

    bus.emit('task:queued', { tournamentId: 'before', name: 'n', populationSize: 4, maxGenerations: 1 });
    unsub();
    bus.emit('task:queued', { tournamentId: 'after', name: 'n', populationSize: 4, maxGenerations: 1 });

    expect(received).toEqual(['before']);
  });

  // ── once ──────────────────────────────────────────────────────────────────

  it('once() delivers exactly one event then stops', () => {
    const received: number[] = [];
    bus.once('task:progress', p => received.push(p.progress));

    bus.emit('task:progress', { tournamentId: 'x', generation: 1, competitionId: 'c', progress: 25 });
    bus.emit('task:progress', { tournamentId: 'x', generation: 1, competitionId: 'c', progress: 75 });

    expect(received).toEqual([25]);
  });

  // ── removeAllListeners ────────────────────────────────────────────────────

  it('removeAllListeners(event) removes only that event', () => {
    const queuedCount    = { n: 0 };
    const completedCount = { n: 0 };

    bus.on('task:queued',    () => { queuedCount.n++; });
    bus.on('task:completed', () => { completedCount.n++; });

    bus.removeAllListeners('task:queued');

    bus.emit('task:queued',    { tournamentId: 'x', name: 'y', populationSize: 4, maxGenerations: 1 });
    bus.emit('task:completed', { tournamentId: 'x', generation: 1, competitionId: 'c', topFitness: 50, avgFitness: 40 });

    expect(queuedCount.n).toBe(0);
    expect(completedCount.n).toBe(1);
  });

  it('removeAllListeners() with no arg clears all events', () => {
    const counts = { queued: 0, started: 0 };
    bus.on('task:queued',  () => { counts.queued++; });
    bus.on('task:started', () => { counts.started++; });

    bus.removeAllListeners();

    bus.emit('task:queued',  { tournamentId: 'x', name: 'y', populationSize: 4, maxGenerations: 1 });
    bus.emit('task:started', { tournamentId: 'x', generation: 1, populationSize: 4, competitionId: 'c' });

    expect(counts).toEqual({ queued: 0, started: 0 });
  });

  // ── listenerCount ─────────────────────────────────────────────────────────

  it('listenerCount returns accurate count', () => {
    expect(bus.listenerCount('task:queued')).toBe(0);

    const unsub1 = bus.on('task:queued', () => {});
    const unsub2 = bus.on('task:queued', () => {});
    expect(bus.listenerCount('task:queued')).toBe(2);

    unsub1();
    expect(bus.listenerCount('task:queued')).toBe(1);

    unsub2();
    expect(bus.listenerCount('task:queued')).toBe(0);
  });

  // ── Module-level singleton ────────────────────────────────────────────────

  it('module-level gaEventBus is a GAEventBus instance', () => {
    expect(gaEventBus).toBeInstanceOf(GAEventBus);
  });
});
