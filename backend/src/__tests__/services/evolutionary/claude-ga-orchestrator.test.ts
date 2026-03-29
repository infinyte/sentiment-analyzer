import { ClaudeGAOrchestrator, buildDefaultDirective } from '../../../services/evolutionary/claude-ga-orchestrator.js';
import type { PopulationReport } from '../../../services/evolutionary/ga-directive-types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReport(overrides: Partial<PopulationReport> = {}): PopulationReport {
  return {
    generation: 2,
    totalGenerations: 5,
    agents: [
      { agentId: 'a1', fitness: 60, winRate: 65, sharpe: 1.2, pnl: 500 },
      { agentId: 'a2', fitness: 45, winRate: 50, sharpe: 0.8, pnl: 200 },
      { agentId: 'a3', fitness: 30, winRate: 40, sharpe: 0.4, pnl: -100 },
    ],
    fitnessStats: {
      mean: 45,
      stdDev: 12.3,
      max: 60,
      min: 30,
      trend: 5,
    },
    ...overrides,
  };
}

function makeClaudeJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    mutationSeverity: 'MEDIUM',
    survivalPercent: 35,
    crossoverStrategy: 'UNIFORM',
    targetPopulationSize: null,
    earlyStopIfFitnessAbove: null,
    diversityBoost: false,
    reasoning: 'Population is improving steadily.',
    ...overrides,
  });
}

// ── buildDefaultDirective ─────────────────────────────────────────────────────

describe('buildDefaultDirective', () => {
  it('returns LIGHT mutation when top fitness > 75', () => {
    const report = makeReport({ fitnessStats: { mean: 80, stdDev: 10, max: 85, min: 70, trend: 3 } });
    const directive = buildDefaultDirective(3, report);
    expect(directive.mutationSeverity).toBe('LIGHT');
    expect(directive.diversityBoost).toBe(false);
  });

  it('returns HEAVY mutation + diversityBoost when trend is strongly negative', () => {
    const report = makeReport({ fitnessStats: { mean: 40, stdDev: 10, max: 55, min: 25, trend: -8 } });
    const directive = buildDefaultDirective(3, report);
    expect(directive.mutationSeverity).toBe('HEAVY');
    expect(directive.diversityBoost).toBe(true);
  });

  it('returns HEAVY mutation + diversityBoost when stdDev is very low (stagnation) after gen 1', () => {
    const report = makeReport({ fitnessStats: { mean: 45, stdDev: 2, max: 50, min: 40, trend: 0 } });
    const directive = buildDefaultDirective(3, report);
    expect(directive.mutationSeverity).toBe('HEAVY');
    expect(directive.diversityBoost).toBe(true);
  });

  it('returns MEDIUM mutation in the normal case', () => {
    const directive = buildDefaultDirective(2, makeReport());
    expect(directive.mutationSeverity).toBe('MEDIUM');
    expect(directive.diversityBoost).toBe(false);
  });

  it('returns fixed defaults for survivalPercent and crossoverStrategy', () => {
    const directive = buildDefaultDirective(1, makeReport());
    expect(directive.survivalPercent).toBe(30);
    expect(directive.crossoverStrategy).toBe('UNIFORM');
  });

  it('sets generation number on the directive', () => {
    const directive = buildDefaultDirective(4, makeReport());
    expect(directive.generation).toBe(4);
  });

  it('includes a fallback reasoning string', () => {
    const directive = buildDefaultDirective(1, makeReport());
    expect(directive.reasoning).toMatch(/fallback/i);
  });

  it('does NOT trigger stagnation detection on generation 1', () => {
    // stdDev < 5 but gen === 1 → should NOT trigger HEAVY
    const report = makeReport({ fitnessStats: { mean: 45, stdDev: 2, max: 50, min: 40, trend: 0 } });
    const directive = buildDefaultDirective(1, report);
    expect(directive.mutationSeverity).toBe('MEDIUM');
  });
});

// ── ClaudeGAOrchestrator.decideNextGeneration ─────────────────────────────────

describe('ClaudeGAOrchestrator', () => {
  let orchestrator: ClaudeGAOrchestrator;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    orchestrator = new ClaudeGAOrchestrator();
    mockFetch = jest.fn();
    global.fetch = mockFetch;

    // Provide an API key so the "missing key" branch is not taken by default
    jest.spyOn(
      orchestrator as unknown as { apiKey: string },
      'apiKey',
      'get',
    ).mockReturnValue('test-api-key');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Fallback: no API key ────────────────────────────────────────────────────

  it('returns fallback directive when API key is not configured', async () => {
    jest.spyOn(
      orchestrator as unknown as { apiKey: string },
      'apiKey',
      'get',
    ).mockReturnValue('');

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(directive.generation).toBe(3);
    expect(directive.reasoning).toMatch(/fallback/i);
  });

  // ── Fallback: network error ─────────────────────────────────────────────────

  it('returns fallback directive on fetch network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  // ── Fallback: non-OK HTTP response ─────────────────────────────────────────

  it('returns fallback directive on non-OK HTTP response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      json: jest.fn(),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  // ── Fallback: empty content ─────────────────────────────────────────────────

  it('returns fallback directive when API returns no content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({ content: [] }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  // ── Successful parse ────────────────────────────────────────────────────────

  it('parses a valid Claude response into a GenerationDirective', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ mutationSeverity: 'LIGHT', survivalPercent: 40, diversityBoost: true }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.generation).toBe(3);
    expect(directive.mutationSeverity).toBe('LIGHT');
    expect(directive.survivalPercent).toBe(40);
    expect(directive.crossoverStrategy).toBe('UNIFORM');
    expect(directive.diversityBoost).toBe(true);
    expect(directive.reasoning).toBe('Population is improving steadily.');
  });

  it('parses earlyStopIfFitnessAbove when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ earlyStopIfFitnessAbove: 80 }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.earlyStopIfFitnessAbove).toBe(80);
  });

  it('sets earlyStopIfFitnessAbove to undefined when null in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ earlyStopIfFitnessAbove: null }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.earlyStopIfFitnessAbove).toBeUndefined();
  });

  it('parses targetPopulationSize when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ targetPopulationSize: 8 }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.targetPopulationSize).toBe(8);
  });

  it('sets targetPopulationSize to undefined when null in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ targetPopulationSize: null }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.targetPopulationSize).toBeUndefined();
  });

  // ── Markdown fence stripping ────────────────────────────────────────────────

  it('strips markdown code fences from the response', async () => {
    const fenced = `\`\`\`json\n${makeClaudeJson()}\n\`\`\``;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: fenced }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.mutationSeverity).toBe('MEDIUM');
  });

  // ── Fallback: invalid JSON ─────────────────────────────────────────────────

  it('returns fallback directive when response is not valid JSON', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: 'Here is my recommendation: use MEDIUM mutation.' }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  // ── Fallback: invalid field values ────────────────────────────────────────

  it('returns fallback when mutationSeverity is invalid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ mutationSeverity: 'EXTREME' }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  it('returns fallback when crossoverStrategy is invalid', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ crossoverStrategy: 'RANDOM' }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  it('returns fallback when survivalPercent is out of range', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson({ survivalPercent: 150 }) }],
      }),
    });

    const directive = await orchestrator.decideNextGeneration(makeReport(), 3);

    expect(directive.reasoning).toMatch(/fallback/i);
  });

  // ── Request structure ─────────────────────────────────────────────────────

  it('sends the correct anthropic-version header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson() }],
      }),
    });

    await orchestrator.decideNextGeneration(makeReport(), 3);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('sends population data in the prompt body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: jest.fn().mockResolvedValueOnce({
        content: [{ text: makeClaudeJson() }],
      }),
    });

    const report = makeReport();
    await orchestrator.decideNextGeneration(report, 3);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string) as { messages: Array<{ content: string }> };
    const promptText = body.messages[0]!.content;

    expect(promptText).toContain(`Generation ${report.generation}`);
    expect(promptText).toContain(`max: ${report.fitnessStats.max.toFixed(1)}`);
  });
});
