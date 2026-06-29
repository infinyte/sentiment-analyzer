# Contributing to Sentiment Analyzer

Thank you for your interest in contributing to Sentiment Analyzer! This is an educational open-source project, and we welcome contributions from developers of all skill levels.

---

## 🎯 Code of Conduct

We are committed to providing a welcoming and inclusive environment for all contributors. Please treat all community members with respect and professionalism.

**We will not tolerate:**
- Harassment, discrimination, or abuse
- Spam or low-quality contributions
- Intentional disruption

---

## 🚀 Getting Started

### 1. Fork the Repository

```bash
# Click "Fork" button on GitHub
git clone https://github.com/yourusername/sentiment-analyzer.git
cd sentiment-analyzer
```

### 2. Create a Feature Branch

```bash
git checkout -b feature/your-feature-name
# OR
git checkout -b fix/your-bug-name
```

Use descriptive names:
- ✅ `feature/add-trading-alerts`
- ✅ `fix/cors-error-production`
- ❌ `feature/stuff`
- ❌ `fix/thing`

### 3. Set Up Local Environment

```bash
# Backend
cd backend
npm install
cp backend.env.template .env
# Edit .env with your API keys

# Frontend
cd frontend
npm install
npm run dev
```

---

## 💻 Development Guidelines

### Code Style

We use **TypeScript** with strict mode for type safety.

**Requirements:**
- Use TypeScript for all new code
- Enable strict mode: `"strict": true` in tsconfig.json
- Use meaningful variable/function names
- Add comments for complex logic
- Keep functions small and focused
- Follow existing code patterns

**Example:**
```typescript
// ✅ Good
async function fetchCoinsData(limit: number): Promise<Coin[]> {
  // Fetch with error handling
  const response = await fetch(url);
  if (!response.ok) throw new Error('API error');
  return response.json();
}

// ❌ Bad
async function fetchData(n) {
  const r = await fetch(url);
  return r.json();
}
```

### Frontend Guidelines

**React Components:**
- Use functional components with hooks
- Keep components small and reusable
- Use TypeScript interfaces for props
- Add JSDoc comments for public components
- Don't use default exports unless necessary

```typescript
// ✅ Good
interface CoinCardProps {
  coin: Coin;
  onSelect: (symbol: string) => void;
}

function CoinCard({ coin, onSelect }: CoinCardProps) {
  return (
    // component code
  );
}

export { CoinCard };

// ❌ Bad
export default function CoinCard(props) {
  return (
    // component code
  );
}
```

**Styling:**
- Use inline styles or CSS modules
- No CSS frameworks unless discussed
- Mobile-responsive by default
- Test on different screen sizes

### Backend Guidelines

**REST API:**
- Use RESTful conventions
- Return consistent JSON responses
- Include proper HTTP status codes
- Document all endpoints
- Validate all inputs

```typescript
// ✅ Good
app.get('/api/coins/:symbol', async (req, res) => {
  const { symbol } = req.params;
  
  if (!symbol || typeof symbol !== 'string') {
    return res.status(400).json({ error: 'Invalid symbol' });
  }
  
  try {
    const coin = await fetchCoin(symbol.toUpperCase());
    if (!coin) return res.status(404).json({ error: 'Not found' });
    return res.json(coin);
  } catch (error) {
    return res.status(500).json({ error: 'Server error' });
  }
});

// ❌ Bad
app.get('/api/coins/:symbol', (req, res) => {
  const coin = fetchCoin(req.params.symbol);
  res.send(coin);
});
```

**Services:**
- Create service classes for external APIs
- Implement proper error handling
- Add rate limiting awareness
- Include logging for debugging

### Documentation

- Document all new functions with JSDoc
- Add examples in comments for complex logic
- Update README if adding major features
- Add inline comments for "why", not "what"

```typescript
// ✅ Good - explains WHY
// Rate limit CoinGecko to 1 request per second to avoid 429 errors
await delay(1000);

// ❌ Bad - explains WHAT (code already shows this)
// Wait 1 second
await delay(1000);
```

---

## 🔄 Submission Process

### Step 1: Make Your Changes

```bash
# Make code changes
git add .
git commit -m "feature: add trading alerts"
# OR
git commit -m "fix: resolve CORS error in production"
```

**Commit Message Format:**
```
<type>: <short description>

<optional longer description>
<optional footer>
```

Types: `feature`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- ✅ `feature: add price alert notifications`
- ✅ `fix: resolve API timeout on slow connections`
- ✅ `docs: update deployment guide for Azure`
- ✅ `refactor: extract sentiment service logic`

### Step 2: Push and Open Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a PR on GitHub with:
- **Title:** Clear description of changes
- **Description:** Why this change? What does it do?
- **Related Issues:** Link to any related issues (#123)
- **Screenshots:** For UI changes
- **Testing:** How to test the changes

**PR Template Example:**
```markdown
## Description
Adds email notifications for price alerts

## Type of Change
- [x] New feature
- [ ] Bug fix
- [ ] Breaking change
- [ ] Documentation update

## How to Test
1. Set up a price alert in dashboard
2. Wait for price movement
3. Check email for notification

## Screenshots
[Add screenshots here]

## Related Issues
Closes #123

## Checklist
- [x] Code follows style guidelines
- [x] Tests added/updated
- [x] Documentation updated
- [x] No breaking changes
```

### Step 3: Code Review

- Maintainers will review your code
- Respond to feedback and make changes
- Be open to suggestions
- Ask questions if anything is unclear
- All feedback is about the code, not you personally

```bash
# Make requested changes
git add .
git commit -m "Address review feedback"
git push origin feature/your-feature-name
# PR will automatically update
```

### Step 4: Merge

Once approved, a maintainer will merge your PR!

---

## 📋 Areas for Contribution

### High Priority
- [ ] Advanced charting (TradingView integration)
- [ ] User accounts and authentication
- [ ] Price alerts and notifications
- [ ] Persist MARL competition history to SQLite

### Medium Priority
- [ ] Mobile responsiveness improvements
- [ ] Performance optimization
- [ ] Additional data sources (CoinMarketCap, Messari)
- [ ] Error handling edge cases

### Low Priority
- [ ] UI/UX improvements
- [ ] Documentation enhancements
- [ ] Example notebooks / Jupyter tutorials

---

## 🧪 Testing

### Running Tests

```bash
# Backend (Jest + supertest integration tests)
cd backend
npm test

# Frontend (Vitest + React Testing Library)
cd frontend
npm test           # run once
npm run test:watch # watch mode
```

### Writing Tests

```typescript
// Example: Service test
describe('CoinGeckoService', () => {
  it('should fetch top coins', async () => {
    const service = new CoinGeckoService();
    const coins = await service.getTopCoins(10);
    
    expect(coins).toBeDefined();
    expect(coins.length).toBeLessThanOrEqual(10);
    expect(coins[0]).toHaveProperty('symbol');
    expect(coins[0]).toHaveProperty('price_usd');
  });

  it('should handle API errors', async () => {
    // Mock API failure
    expect(async () => {
      await service.getTopCoins(-1);
    }).rejects.toThrow();
  });
});
```

### Manual Testing

- Test locally before submitting
- Verify on multiple devices/browsers
- Test error scenarios
- Check API rate limits

---

## 📚 Documentation

### README Updates

If your feature affects user-facing functionality:

```markdown
## New Feature: Price Alerts

Set up automatic notifications when prices hit target levels.

### Usage
1. Go to Dashboard
2. Click "Set Alert"
3. Enter target price
4. Click "Confirm"
```

### Code Comments

```typescript
/**
 * Analyzes sentiment for a given cryptocurrency
 * 
 * @param symbol - The coin symbol (e.g., "BTC")
 * @param headlines - Array of news headlines
 * @returns Sentiment analysis result
 * @throws {Error} If Claude API fails
 * 
 * @example
 * const sentiment = await analyzeSentiment('BTC', headlines);
 * console.log(sentiment.score); // 'BULL'
 */
async function analyzeSentiment(
  symbol: string,
  headlines: string[]
): Promise<Sentiment> {
  // implementation
}
```

---

## 🔍 Review Checklist

Before submitting, verify:

- [ ] Code runs locally without errors
- [ ] No console errors or warnings
- [ ] TypeScript strict mode passes
- [ ] Follows existing code style
- [ ] Has meaningful commit messages
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No hardcoded secrets or API keys
- [ ] No large dependencies added without justification
- [ ] Works on multiple browsers/devices

---

## 🐛 Reporting Bugs

**Before reporting:**
1. Check existing issues (might be already reported)
2. Try to reproduce the issue
3. Check if it's environment-specific

**When reporting:**
1. Use the Bug Report template
2. Include clear reproduction steps
3. Provide error messages and logs
4. Mention your environment (OS, Node version, etc.)

**Example:**
```
Component: Backend API
Description: /api/coins endpoint times out
Steps:
1. Start backend: npm run dev
2. Call: curl http://localhost:3000/api/coins
3. Wait for timeout

Expected: Should return list of coins
Actual: Times out after 30 seconds

Logs:
TypeError: Cannot read property 'symbol' of undefined
  at CoinGeckoService.getTopCoins
```

---

## 🎓 Getting Help

- **Questions:** Open a [Discussion](https://github.com/yourusername/sentiment-analyzer/discussions)
- **Issues:** Check [existing issues](https://github.com/yourusername/sentiment-analyzer/issues)
- **Documentation:** See README and architecture docs
- **Slack/Discord:** [Add community link if available]

---

## 📖 Useful Resources

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [React Documentation](https://react.dev)
- [Express.js Guide](https://expressjs.com)
- [Azure Documentation](https://docs.microsoft.com/azure)
- [Claude API Documentation](https://docs.anthropic.com)

---

---

## 🧠 Phase 1-3 Development Notes

### Adding a New Sentiment Analysis Mode

`SentimentAnalyzerEngine` (`backend/src/services/sentiment-analyzer.ts`) has a fixed set of modes. To add a new one:

1. Add the mode name to the `AnalysisMode` type
2. Add a method following the existing pattern — return a typed result object, no `any`
3. Handle it in the `POST /api/sentiment/analyze` route in `index.ts`
4. Update `GET /api/info/modes` to document it

Mode methods must be **pure** (no external API calls) — all Claude API interaction stays in `SentimentService`.

### Adding a New Agent Type

`TradingAgent` (`backend/src/services/trading-agent.ts`) is an abstract class. To add a type:

1. Extend `TradingAgent`
2. Implement `makeDecision(context: DecisionContext): 'BUY' | 'SELL' | 'HOLD'`
3. Do not override `executeOrder`, `closePosition`, or `recordDailyEquity` — these handle position sizing, P&L, and metrics universally
4. Register the type in `AgentFactory.create()` and add it to the `AgentType` union
5. Add a `riskProfile` entry in `RISK_PARAMS` if the new type needs different parameters

### Extending the BacktestingEngine

`BacktestingEngine` (`backend/src/services/backtesting-engine.ts`) uses CoinGecko OHLCV as a price source. Key extension points:

- `barToMarketData()` — maps a single OHLCV bar to `MarketData`; add fields here if you have richer data
- `syntheticNews()` — currently derived from price action; replace with real news if you cache it per-bar
- `applySlippage()` — add new `SlippageModel` variants here

### SQLite Storage

`StorageService` (`backend/src/storage.ts`) persists backtest results and sentiment. It is **non-fatal** — if the `.db` file is unavailable the server falls back to in-memory. Treat all `storage.*` calls as optional and wrap them in try/catch.

## 🧠 Phase 2 MARL Development

### Working on MARL Competition Endpoints

Phase 2 MARL HTTP routes live in `backend/src/routes/marl-competition.ts`.

When contributing to these endpoints:

1. Keep request validation explicit in the route layer
2. Preserve sanitized agent IDs before handing data to the engine
3. Treat `POST /api/marl/competition/start` and `POST /api/marl/agents/compare` as expensive endpoints
4. Preserve or update rate limiting when adding new expensive MARL routes
5. Keep response shapes stable, then update Postman and tests in the same PR if the contract changes

### Working on the MARL Engine

`MarlCompetitionEngine` is intentionally isolated from Express routing concerns.

Keep these boundaries intact:

1. Routing concerns stay in `marl-competition.ts`
2. Competition orchestration and record updates stay in the engine
3. Formatting for API responses should happen in the route, not inside the engine
4. Tests for API contracts belong in `backend/src/__tests__/api/marl.test.ts`

### Testing MARL Changes

If you change MARL endpoints or response contracts:

1. Update `backend/src/__tests__/api/marl.test.ts`
2. Re-run `cd backend && npm test`
3. Re-run `cd backend && npm run build`
4. Update `postman/sentiment-analyzer.postman_collection.json` if request or response shapes changed

## 🧠 Frontend Contributions

### Frontend Changes

Keep the React app type-safe and aligned with backend contracts.

When changing frontend code:

1. Update shared API-facing types first (`frontend/src/types/`)
2. Keep dashboard and MARL views aligned with actual backend payloads
3. Run `cd frontend && npm test` — add or update tests for changed components/hooks
4. Verify with `cd frontend && npm run type-check`
5. Run `cd frontend && npm run build` before opening a PR

### Writing Frontend Tests

Frontend tests use **Vitest** + **React Testing Library** (`frontend/src/__tests__/`).

- Mock `useMarlCompetition` (or other hooks) with `vi.mock` when testing components that use them
- Mock `react-chartjs-2` with `vi.mock('react-chartjs-2', () => ({ Line: () => null }))` if the component renders charts
- Call `cleanup()` in `afterEach` (imported from `@testing-library/react`) — required because vitest globals are disabled
- Use `vi.stubGlobal('fetch', vi.fn())` to mock network calls in hook tests

### Documentation and API Tooling

Update supporting artifacts together with code changes:

1. `README.md` for user-facing API or feature changes
2. `CONTRIBUTING.md` when the contribution workflow changes
3. `TESTING_STRATEGY.md` when the test surface changes
4. `postman/sentiment-analyzer.postman_collection.json` when API endpoints are added or modified

## 🙏 Thank You!

Your contributions help make Sentiment Analyzer better for everyone. We truly appreciate your time and effort!

---

## 📝 License

By contributing, you agree that your contributions will be licensed under the MIT License.

**Happy coding! 🚀**
