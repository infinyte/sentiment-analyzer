
## TODO List

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




