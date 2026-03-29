/**
 * ClaudeGAOrchestrator
 *
 * Calls the Claude API after each generation completes to receive a
 * GenerationDirective that adaptively controls the evolutionary algorithm's
 * parameters for the next generation.
 *
 * Always resolves — never rejects.  Returns a heuristic fallback directive if
 * the Claude API is unavailable, the API key is missing, or the response
 * cannot be parsed.
 */

import logger from '../../logger.js';
import { appConfigService } from '../app-config-service.js';
import type { GenerationDirective, PopulationReport } from './ga-directive-types.js';

// ── Internal fetch-response shape ─────────────────────────────────────────────

interface ClaudeMessageResponse {
  content?: Array<{ text?: string }>;
}

// ── Fallback ──────────────────────────────────────────────────────────────────

/**
 * Produce a heuristic GenerationDirective without calling Claude.
 * Exported so tests and error paths can reference it directly.
 */
export function buildDefaultDirective(
  generation: number,
  report: PopulationReport,
): GenerationDirective {
  const { fitnessStats } = report;

  // Heuristic rules:
  //   top fitness high  → preserve good genes (LIGHT)
  //   stagnating / low diversity → explore aggressively (HEAVY + diversityBoost)
  //   otherwise → balanced (MEDIUM)
  let mutationSeverity: GenerationDirective['mutationSeverity'] = 'MEDIUM';
  let diversityBoost = false;

  if (fitnessStats.max > 75) {
    mutationSeverity = 'LIGHT';
  } else if (fitnessStats.trend < -5 || (fitnessStats.stdDev < 5 && generation > 1)) {
    mutationSeverity = 'HEAVY';
    diversityBoost = true;
  }

  return {
    generation,
    mutationSeverity,
    survivalPercent: 30,
    crossoverStrategy: 'UNIFORM',
    diversityBoost,
    reasoning:
      'Fallback directive — Claude API unavailable. Applied heuristic defaults based on population fitness statistics.',
  };
}

// ── ClaudeGAOrchestrator ──────────────────────────────────────────────────────

export class ClaudeGAOrchestrator {
  private readonly apiUrl = 'https://api.anthropic.com/v1/messages';

  private get apiKey(): string {
    return appConfigService.get('CLAUDE_API_KEY') ?? '';
  }

  private get model(): string {
    return appConfigService.get('CLAUDE_MODEL') ?? 'claude-sonnet-4-6';
  }

  /**
   * Ask Claude to produce a GenerationDirective given the population report
   * for the generation that just completed.
   *
   * @param report  Population statistics for the generation that finished.
   * @param nextGen The generation number that will be bred next.
   * @returns       A validated GenerationDirective (never throws).
   */
  async decideNextGeneration(
    report: PopulationReport,
    nextGen: number,
  ): Promise<GenerationDirective> {
    if (!this.apiKey) {
      logger.warn('[claude-ga] CLAUDE_API_KEY not set — using fallback directive', { generation: nextGen });
      return buildDefaultDirective(nextGen, report);
    }

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 600,
          messages: [{ role: 'user', content: this.buildPrompt(report, nextGen) }],
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude API HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ClaudeMessageResponse;
      const text = data.content?.[0]?.text;
      if (!text) throw new Error('Claude API returned no content');

      const directive = this.parseDirective(text, nextGen);

      logger.info('[claude-ga] directive received', {
        generation: nextGen,
        mutationSeverity:       directive.mutationSeverity,
        survivalPercent:        directive.survivalPercent,
        crossoverStrategy:      directive.crossoverStrategy,
        diversityBoost:         directive.diversityBoost,
        earlyStopIfFitnessAbove: directive.earlyStopIfFitnessAbove,
      });

      return directive;
    } catch (error) {
      logger.warn('[claude-ga] API call failed — using fallback directive', {
        generation: nextGen,
        error: String(error),
      });
      return buildDefaultDirective(nextGen, report);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private buildPrompt(report: PopulationReport, nextGen: number): string {
    const topAgents = report.agents.slice(0, 5);
    const trendSign = report.fitnessStats.trend >= 0 ? '+' : '';

    return `You are controlling a genetic algorithm that trains AI crypto trading agents. Generation ${report.generation} of ${report.totalGenerations} has just completed.

POPULATION REPORT (generation ${report.generation}):
- Population size: ${report.agents.length}
- Fitness — max: ${report.fitnessStats.max.toFixed(1)}, mean: ${report.fitnessStats.mean.toFixed(1)}, min: ${report.fitnessStats.min.toFixed(1)}, stdDev: ${report.fitnessStats.stdDev.toFixed(1)}
- Trend (delta from previous generation mean): ${trendSign}${report.fitnessStats.trend.toFixed(1)}

TOP ${topAgents.length} AGENTS:
${topAgents.map((a, i) =>
  `  ${i + 1}. fitness=${a.fitness.toFixed(1)}, winRate=${a.winRate.toFixed(1)}%, sharpe=${a.sharpe.toFixed(2)}, pnl=${a.pnl.toFixed(0)}`
).join('\n')}

Produce a GenerationDirective for generation ${nextGen}. Choose parameters that maximize long-term fitness improvement while maintaining genetic diversity.

Guidelines:
- mutationSeverity: "LIGHT" to preserve high-fitness genes, "MEDIUM" for balanced exploration, "HEAVY" when the population is stagnating or homogeneous
- survivalPercent: 10–60 (lower = stronger selection pressure; higher = more diversity retained)
- crossoverStrategy: "UNIFORM" for random gene mixing; "BLENDED" to average parent genes (better when parents are close in fitness)
- targetPopulationSize: optional integer to resize the population (omit or null to keep current size)
- earlyStopIfFitnessAbove: optional 0–100 threshold to stop early when any agent exceeds it (omit or null to run all generations)
- diversityBoost: true to inject fresh random agents when diversity is critically low

Respond with ONLY this JSON — no markdown fences, no explanation outside the "reasoning" field:
{
  "mutationSeverity": "MEDIUM",
  "survivalPercent": 30,
  "crossoverStrategy": "UNIFORM",
  "targetPopulationSize": null,
  "earlyStopIfFitnessAbove": null,
  "diversityBoost": false,
  "reasoning": "Concise explanation referencing observed trends and why you chose each parameter"
}`;
  }

  private parseDirective(text: string, generation: number): GenerationDirective {
    // Strip optional markdown code fences
    const clean = text
      .replace(/^```(?:json)?\s*/m, '')
      .replace(/\s*```\s*$/m, '')
      .trim();

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(clean) as Record<string, unknown>;
    } catch {
      throw new Error(`Failed to parse directive JSON from Claude response: ${clean.slice(0, 300)}`);
    }

    // Validate required enum fields
    const severity = raw['mutationSeverity'];
    if (!['LIGHT', 'MEDIUM', 'HEAVY'].includes(severity as string)) {
      throw new Error(`Invalid mutationSeverity: ${String(severity)}`);
    }

    const strategy = raw['crossoverStrategy'];
    if (!['UNIFORM', 'BLENDED'].includes(strategy as string)) {
      throw new Error(`Invalid crossoverStrategy: ${String(strategy)}`);
    }

    const survivalPercent = Number(raw['survivalPercent']);
    if (!isFinite(survivalPercent) || survivalPercent < 1 || survivalPercent > 100) {
      throw new Error(`Invalid survivalPercent: ${String(raw['survivalPercent'])}`);
    }

    // Optional numeric fields — null/undefined/0 treated as "not set"
    const rawTargetSize = raw['targetPopulationSize'];
    const targetPopulationSize =
      typeof rawTargetSize === 'number' && rawTargetSize >= 4
        ? Math.round(rawTargetSize)
        : undefined;

    const rawEarlyStop = raw['earlyStopIfFitnessAbove'];
    const earlyStopIfFitnessAbove =
      typeof rawEarlyStop === 'number' && rawEarlyStop > 0 && rawEarlyStop <= 100
        ? rawEarlyStop
        : undefined;

    return {
      generation,
      mutationSeverity:        severity as GenerationDirective['mutationSeverity'],
      survivalPercent:         Math.round(survivalPercent),
      crossoverStrategy:       strategy as GenerationDirective['crossoverStrategy'],
      targetPopulationSize,
      earlyStopIfFitnessAbove,
      diversityBoost:          Boolean(raw['diversityBoost']),
      reasoning:               typeof raw['reasoning'] === 'string' ? raw['reasoning'] : 'No reasoning provided.',
    };
  }
}

// ── Module-level singleton ────────────────────────────────────────────────────

export const claudeGAOrchestrator = new ClaudeGAOrchestrator();
