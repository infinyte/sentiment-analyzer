
## TODO List

### Issue 4
- Issue Number: 4
- Title: Backend Model Architecture Types System
- Priority: Medium
- Status: Not started
- Depends On: Issue 3
- Description: Add architecture-specific parameter spaces to agent genomes enabling different signal-processing strategies (LSTM, GAN, Transformer, Hybrid) that change how agents process market signals and structure policy weights.
- Acceptance Criteria:
  1. Add modelArchitecture ('LSTM' | 'GAN' | 'TRANSFORMER' | 'HYBRID') field to AgentGenome.
  2. Create architecture-specific parameter interfaces: LSTMParams (sequenceLength, hiddenUnits, dropout), GANParams (adversarialPressure, discriminatorWeight, generatorLR), TransformerParams (attentionHeads, embeddingDim, feedforwardDim).
  3. Add architectureParams union type to AgentGenome supporting all architecture-specific parameter blocks.
  4. Extend mutation-engine.ts with architecture-specific mutation rules (e.g., integer vs. float mutations per type).
  5. Modify genetic-crossover.ts to implement architecture compatibility checks (same architecture crossover or BLENDED for HYBRID offspring).
  6. Update marl-competition-engine.ts to dispatch different signal-processing logic per architecture type.
  7. Ensure architecture parameters affect how agent policy weights are structured and action selection is computed.
  8. Backend type-check and unit tests pass.

### Issue 5
- Issue Number: 5
- Title: Backend MCP Servers for GA Operations
- Priority: Medium
- Status: Not started
- Depends On: Issue 3
- Description: Expose genetic algorithm services as MCP tool servers enabling Claude and MCP-compatible clients to invoke mutation, crossover, fitness evaluation, and agent pool management as structured tools.
- Acceptance Criteria:
  1. Create mcp-genetic-ops.ts MCP server with tools: mutate_agent, crossover_agents, evaluate_fitness, select_population, get_generation_summary.
  2. Create mcp-agent-manager.ts MCP server with tools: register_agent, get_agent_health, assign_task, collect_results, get_pool_status.
  3. Implement each tool to call corresponding existing service methods (MutationEngine, GeneticCrossover, FitnessCalculator, SelectionAlgorithm, GenomeManager, etc.).
  4. Define tool schemas with proper input/output types for each MCP endpoint.
  5. Add MCP server startup instructions to CLAUDE.md documentation.
  6. Test MCP server endpoints with Claude Code client to verify tool invocation works end-to-end.
  7. Backend type-check and unit tests pass.

### Issue 6
- Issue Number: 6
- Title: Frontend Evolutionary Tournament Detail View Enhancements
- Priority: Medium
- Status: Not started
- Depends On: Issue 3
- Description: Update frontend evolutionary tournament detail view to visualize adversary agents, model architectures, Claude directives, and generation result stores with clear labeling and status indicators.
- Acceptance Criteria:
  1. Add visual distinction for adversary agents (red/warning styling) in agent list view.
  2. Display model architecture labels (LSTM, GAN, Transformer, Hybrid) alongside agent entries.
  3. Show adversary vs. sentiment match results in dedicated results section.
  4. Display Claude Generation Directives with reasoning text per generation.
  5. Show fitness metrics per generation (mean, stdDev, max, min, trend) in graph or tabular format.
  6. Add checkpoint restore UI allowing users to rewind to prior generation states.
  7. Update history/results view to show which trading mode, architecture, and orchestration method was used.
  8. Frontend type-check and tests pass.

### Issue 7
- Issue Number: 7
- Title: GA Flow Skill for Guided Tournament Execution
- Priority: Low
- Status: Not started
- Depends On: Issue 1, Issue 2, Issue 3
- Description: Create a skill (.claude/skills/ga-flow.md) that provides guided genetic algorithm run interface allowing users to specify tournament parameters and monitor progress through generation completion.
- Acceptance Criteria:
  1. Create .claude/skills/ga-flow.md with skill interface documentation.
  2. Implement interactive parameter prompts for: symbols, generation count, population size, Claude orchestration toggle, adversarial training toggle, model architectures to include.
  3. Assemble configuration and invoke POST /api/evolutionary/tournament with complete parameter set.
  4. Implement Server-Sent Events (SSE) stream to display real-time generation progress.
  5. At convergence, display best genome with complete genome parameters and Claude reasoning per generation.
  6. Show fitness trajectory graph and convergence detection explanation.
  7. Provide option to export or save tournament results.
  8. Skill discovery and invocation works correctly in Claude Code environment.

### Issue 8
- Issue Number: 8
- Title: Integration Testing for Multi-Phase GA System
- Priority: Medium
- Status: Not started
- Depends On: Issue 1, Issue 2, Issue 3, Issue 4, Issue 5
- Description: Comprehensive integration testing of all GA orchestration phases working together: Claude directives driving generation strategy, adversarial training stress-testing sentiment agents, multiple architecture types competing, and MCP operations orchestrating everything.
- Acceptance Criteria:
  1. Create integration test suite for Phase 1-5 end-to-end workflow.
  2. Test Claude directive adaptive strategy over 5+ generations with fitness improvement validation.
  3. Test adversarial training with adversary success rates and sentiment agent robustness metrics.
  4. Test model architecture diversity with architecture-specific mutation and crossover behavior.
  5. Test MCP tool invocation chain: register agents, assign tasks, evaluate fitness, select population, get summaries.
  6. Test event bus emission sequence and event order correctness.
  7. Test checkpoint creation and rollback to prior generation states.
  8. Test tournament performance metrics under all configuration combinations.
  9. Backend integration tests pass with >80% code coverage for GA services.

### Issue 9
- Issue Number: 9
- Title: Documentation and Claude Code Integration Guide
- Priority: Low
- Status: Not started
- Depends On: Issue 5
- Description: Create comprehensive documentation for GA system architecture, MCP tool schemas, deployment instructions, and examples for using GA operations via Claude Code.
- Acceptance Criteria:
  1. Update CLAUDE.md with MCP server startup commands and complete tool schema documentation.
  2. Create architecture documentation explaining Phase 1-6 design decisions and data flow.
  3. Document GenerationDirective format and examples of Claude's strategic decisions per generation.
  4. Create examples of using MCP tools via Claude Code for manual population management.
  5. Document checkpoint/rollback workflow and lineage tracking capabilities.
  6. Create troubleshooting guide for common GA orchestration issues.
  7. Add inline code comments to all new GA orchestration files following Microsoft C# naming conventions and style.



### Issue 10
- Issue Number: 10
- Title: Backend Realistic Paper Exchange
- Priority: Medium
- Status: Not started
- Description: Implement realistic paper trading with live pricing fallback, fees, and slippage.
- Acceptance Criteria:
  1. Add RealisticPaperExchange implementing exchange interface.
  2. Use live quote source with fallback behavior.
  3. Support provider fee presets.
  4. Apply slippage by side.
  5. Deduct fees and return commission details in orders.
  6. Add backend unit tests for fee and slippage behavior and fallback.
  7. Backend type-check and tests pass.

### Issue 11
- Issue Number: 11
- Title: Backend REALISTIC_PAPER Mode Wiring
- Priority: Medium
- Status: Not started
- Depends On: Issue 10
- Description: Add realistic paper mode to trading mode enum, factory routing, and config catalog.
- Acceptance Criteria:
  1. Add REALISTIC_PAPER mode value.
  2. Route factory to realistic paper exchange in this mode.
  3. Add config keys for fee preset and slippage.
  4. Keep existing paper mode behavior unchanged.
  5. Accept REALISTIC_PAPER in tournament start validation.
  6. Backend type-check and tests pass.

### Issue 12
- Issue Number: 12
- Title: Frontend Realistic Paper Mode UI
- Priority: Medium
- Status: Not started
- Depends On: Issue 11
- Description: Add realistic paper option to MARL mode selector and update display labeling.
- Acceptance Criteria:
  1. Extend frontend exchange mode type with REALISTIC_PAPER.
  2. Add mode selector button in correct order.
  3. Show explanatory note for fees/slippage config and hide broker credentials in this mode.
  4. Send REALISTIC_PAPER in start payload.
  5. Show friendly mode label in history/results.
  6. Add frontend tests for mode selection and UI behavior.
  7. Frontend type-check and tests pass.