/**
 * Component tests — MarlCompetitionViewer
 *
 * The hook is mocked so tests are pure rendering/interaction tests
 * with no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MarlCompetitionViewer } from '../components/MarlCompetitionViewer';
import { useMarlCompetition } from '../hooks/useMarlCompetition';

vi.mock('../hooks/useMarlCompetition');
vi.mock('react-chartjs-2', () => ({ Line: () => null }));
vi.mock('chart.js', () => ({
  Chart: { register: vi.fn() },
  CategoryScale: class {},
  LinearScale: class {},
  PointElement: class {},
  LineElement: class {},
  Tooltip: class {},
}));

// ── Default hook return value (idle state) ────────────────────────────────────

const defaultHook = {
  loading: false,
  competitionId: null,
  status: null,
  results: null,
  compareResult: null,
  list: null,
  error: null,
  startCompetition: vi.fn(),
  compareAgents: vi.fn(),
  loadList: vi.fn(),
  loadResults: vi.fn(),
  reset: vi.fn(),
};

const mockUseMarl = vi.mocked(useMarlCompetition);
let mockFetch: ReturnType<typeof vi.fn>;
let emergencyStopCalled = false;

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMarl.mockReturnValue(defaultHook);
  emergencyStopCalled = false;
  mockFetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);

    if (url.includes('/api/marl/broker/credentials')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          credentials: [
            {
              id: 'cred-paper-1',
              label: 'Paper Credential',
              provider: 'ALPACA',
              mode: 'PAPER',
              createdAt: '2026-03-23T10:00:00.000Z',
              connected: true,
            },
          ],
          count: 1,
        }),
      });
    }

    if (url.includes('/api/marl/broker/connected')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          connected: [{ id: 'cred-paper-1', label: 'Paper Credential', provider: 'ALPACA', mode: 'PAPER' }],
          count: 1,
        }),
      });
    }

    if (url.includes('/api/marl/broker/orders/')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          competitionId: 'comp-123',
          count: 1,
          orders: [
            {
              clientOrderId: 'client-1',
              brokerOrderId: 'broker-1',
              agentId: 'alpha',
              symbol: 'BTC',
              side: 'BUY',
              quantity: 0.25,
              limitPrice: 61000,
              status: emergencyStopCalled ? 'CANCELED' : 'OPEN',
              filledQuantity: 0,
              avgFillPrice: 0,
              submittedAt: '2026-03-23T10:00:00.000Z',
              updatedAt: '2026-03-23T10:05:00.000Z',
            },
          ],
        }),
      });
    }

    if (url.includes('/api/marl/broker/emergency-stop') && init?.method === 'POST') {
      emergencyStopCalled = true;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ emergencyStop: true, competitionId: 'comp-123', cancelled: 2 }),
      });
    }

    if (url.includes('/api/marl/info')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          description: 'MARL Competitive Trading Framework — Phase 2',
          tournamentModes: {
            SINGLE: 'Single mode',
            EVOLUTIONARY: 'Evolutionary mode',
            CONTINUOUS: 'Continuous mode',
          },
          riskProfiles: {
            CONSERVATIVE: { maxRiskPct: '1%' },
            AGGRESSIVE: { maxRiskPct: '5%' },
            SCALPING: { maxRiskPct: '3%' },
          },
          learningAlgorithm: {
            type: 'Q-Learning + Policy Gradient',
            stateSpace: '50 features',
            actionSpace: ['BUY', 'SELL', 'HOLD'],
            policyNetwork: '50→64→32→5',
            explorationStrategy: 'Epsilon-greedy',
            replayBuffer: '1000 experiences',
          },
          endpoints: {
            'GET /api/marl/info': 'This documentation',
            'GET /api/marl/competition/:id/equity-curves': 'Reload equity curves',
          },
        }),
      });
    }

    if (url.includes('/api/marl/competition/done-123/equity-curves')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          competitionId: 'done-123',
          status: 'COMPLETED',
          snapshotCount: 2,
          equityCurves: [
            { timestamp: '2026-03-23T10:00:00.000Z', agentEquities: [{ agentId: 'alpha', equity: 10000 }, { agentId: 'beta', equity: 9800 }] },
            { timestamp: '2026-03-23T10:05:00.000Z', agentEquities: [{ agentId: 'alpha', equity: 11000 }, { agentId: 'beta', equity: 9500 }] },
          ],
        }),
      });
    }

    if (url.includes('/api/marl/competition/running-456/equity-curves')) {
      return Promise.resolve({
        ok: true,
        status: 202,
        json: async () => ({
          competitionId: 'running-456',
          status: 'RUNNING',
          message: 'Equity curves are available after the competition completes.',
          progress: 64,
        }),
      });
    }

    return Promise.reject(new Error(`Unhandled fetch request: ${url}`));
  });
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('MarlCompetitionViewer — initial render', () => {
  it('renders the heading', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.getByText('MARL Competition')).toBeInTheDocument();
  });

  it('renders mode dropdown with SINGLE/EVOLUTIONARY/CONTINUOUS option values', () => {
    render(<MarlCompetitionViewer />);
    // First combobox is the mode select
    const modeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    const values = Array.from(modeSelect.options).map(o => o.value);
    expect(values).toContain('SINGLE');
    expect(values).toContain('EVOLUTIONARY');
    expect(values).toContain('CONTINUOUS');
  });

  it('defaults to SINGLE mode', () => {
    render(<MarlCompetitionViewer />);
    const modeSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    expect(modeSelect.value).toBe('SINGLE');
  });

  it('renders Start Tournament button', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.getByRole('button', { name: /start tournament/i })).toBeInTheDocument();
  });

  it('renders symbols input with default value BTC,ETH', () => {
    render(<MarlCompetitionViewer />);
    const symbolsBox = screen.getByPlaceholderText('BTC,ETH,SOL') as HTMLInputElement;
    expect(symbolsBox.value).toBe('BTC,ETH');
  });

  it('renders two default agent id inputs with values bull and bear', () => {
    render(<MarlCompetitionViewer />);
    const agentInputs = screen.getAllByPlaceholderText('Agent ID') as HTMLInputElement[];
    expect(agentInputs).toHaveLength(2);
    expect(agentInputs[0].value).toBe('bull');
    expect(agentInputs[1].value).toBe('bear');
  });

  it('renders default starting capital inputs for tournament agents', () => {
    render(<MarlCompetitionViewer />);
    const capitalInputs = screen.getAllByPlaceholderText('Starting Capital') as HTMLInputElement[];
    expect(capitalInputs).toHaveLength(2);
    expect(capitalInputs[0].value).toBe('10000');
    expect(capitalInputs[1].value).toBe('10000');
  });

  it('renders + Add Agent button', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.getByRole('button', { name: /add agent/i })).toBeInTheDocument();
  });

  it('renders tab buttons for Tournament and Head-to-Head views', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.getByRole('button', { name: 'Tournament' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Head-to-Head' })).toBeInTheDocument();
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('MarlCompetitionViewer — error state', () => {
  it('shows error message when hook reports an error', () => {
    mockUseMarl.mockReturnValue({ ...defaultHook, error: 'Rate limit exceeded' });
    render(<MarlCompetitionViewer />);
    expect(screen.getByText('Rate limit exceeded')).toBeInTheDocument();
  });

  it('calls reset when Dismiss is clicked', () => {
    const reset = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, error: 'Oops', reset });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('does not render Dismiss button when there is no error', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });
});

// ── Running state ─────────────────────────────────────────────────────────────

describe('MarlCompetitionViewer — running state', () => {
  it('shows running banner when loading with RUNNING status', () => {
    mockUseMarl.mockReturnValue({
      ...defaultHook,
      loading: true,
      competitionId: 'cid-123',
      status: {
        competitionId: 'cid-123',
        status: 'RUNNING',
        progress: 42,
        mode: 'SINGLE',
        agentCount: 2,
        symbols: ['BTC'],
        startedAt: new Date().toISOString(),
        topPerformer: null,
      },
    });
    render(<MarlCompetitionViewer />);
    expect(screen.getByText(/competition running/i)).toBeInTheDocument();
    expect(screen.getByText('cid-123')).toBeInTheDocument();
  });

  it('does not show running banner in idle state', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.queryByText(/competition running/i)).not.toBeInTheDocument();
  });
});

// ── Agent management ──────────────────────────────────────────────────────────

describe('MarlCompetitionViewer — agent management', () => {
  it('adds a third agent row when + Add Agent is clicked', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: /add agent/i }));
    const agentInputs = screen.getAllByPlaceholderText('Agent ID');
    expect(agentInputs).toHaveLength(3);
  });

  it('shows ✕ remove button only for agents beyond the first two', () => {
    render(<MarlCompetitionViewer />);
    // No remove buttons at start
    expect(screen.queryByText('✕')).not.toBeInTheDocument();
    // Add one more — the third agent gets a remove button
    fireEvent.click(screen.getByRole('button', { name: /add agent/i }));
    expect(screen.getAllByText('✕')).toHaveLength(1);
  });

  it('removes an agent when ✕ is clicked', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: /add agent/i }));
    fireEvent.click(screen.getByText('✕'));
    expect(screen.getAllByPlaceholderText('Agent ID')).toHaveLength(2);
  });
});

// ── Form submission ───────────────────────────────────────────────────────────

describe('MarlCompetitionViewer — form submission', () => {
  it('calls startCompetition with SINGLE mode and parsed symbols', () => {
    const startCompetition = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, startCompetition });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: /start tournament/i }));
    expect(startCompetition).toHaveBeenCalledOnce();
    const [config] = startCompetition.mock.calls[0];
    expect(config.mode).toBe('SINGLE');
    expect(config.symbols).toEqual(['BTC', 'ETH']);
    expect(config.agents).toHaveLength(2);
    expect(config.agents[0].initialCapital).toBe(10000);
  });

  it('submits edited starting capital in tournament mode', () => {
    const startCompetition = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, startCompetition });
    render(<MarlCompetitionViewer />);

    const capitalInputs = screen.getAllByPlaceholderText('Starting Capital') as HTMLInputElement[];
    fireEvent.change(capitalInputs[0], { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: /start tournament/i }));

    expect(startCompetition.mock.calls[0][0].agents[0].initialCapital).toBe(25000);
  });

  it('submits starting capital in head-to-head mode', () => {
    const compareAgents = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, compareAgents });
    render(<MarlCompetitionViewer />);

    fireEvent.click(screen.getByRole('button', { name: 'Head-to-Head' }));

    const capitalInputs = screen.getAllByPlaceholderText('Starting Capital') as HTMLInputElement[];
    fireEvent.change(capitalInputs[0], { target: { value: '30000' } });
    fireEvent.change(capitalInputs[1], { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: /compare agents/i }));

    expect(compareAgents).toHaveBeenCalledOnce();
    expect(compareAgents.mock.calls[0][0].initialCapital).toBe(30000);
    expect(compareAgents.mock.calls[0][1].initialCapital).toBe(12000);
  });

  it('uppercases and trims symbols from the input', () => {
    const startCompetition = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, startCompetition });
    render(<MarlCompetitionViewer />);
    const symbolsBox = screen.getByPlaceholderText('BTC,ETH,SOL');
    fireEvent.change(symbolsBox, { target: { value: 'btc, eth, sol' } });
    fireEvent.click(screen.getByRole('button', { name: /start tournament/i }));
    expect(startCompetition.mock.calls[0][0].symbols).toEqual(['BTC', 'ETH', 'SOL']);
  });
});

// ── Results ───────────────────────────────────────────────────────────────────

describe('MarlCompetitionViewer — results', () => {
  const mockResults = {
    competitionId: 'done-123',
    mode: 'SINGLE' as const,
    duration: 100,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    finalRankings: [
      { rank: 1, agentId: 'alpha', finalCapital: 11000, totalReturn: 10, sharpeRatio: 1.5, maxDrawdown: 5, tradesExecuted: 10, winRate: 60 },
      { rank: 2, agentId: 'beta',  finalCapital:  9500, totalReturn: -5, sharpeRatio: 0.8, maxDrawdown: 10, tradesExecuted: 8, winRate: 40 },
    ],
    headToHeadMetrics: [],
    equityEvolution: [],
    competitorImpact: [],
  };

  it('renders agent ids in the rankings table', () => {
    mockUseMarl.mockReturnValue({ ...defaultHook, results: mockResults });
    render(<MarlCompetitionViewer />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('shows rank labels #1 and #2', () => {
    mockUseMarl.mockReturnValue({ ...defaultHook, results: mockResults });
    render(<MarlCompetitionViewer />);
    expect(screen.getByText('#1')).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
  });

  it('loads the MARL info panel on demand', async () => {
    render(<MarlCompetitionViewer />);

    fireEvent.click(screen.getByRole('button', { name: /marl info panel/i }));

    expect(await screen.findByText('Tournament Modes')).toBeInTheDocument();
    expect(screen.getByText('Q-Learning + Policy Gradient')).toBeInTheDocument();

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/marl/info');
    });
  });

  it('reloads equity curves into the existing chart area and shows running fallback state', async () => {
    mockUseMarl.mockReturnValue({ ...defaultHook, results: mockResults });
    render(<MarlCompetitionViewer />);

    fireEvent.click(screen.getByRole('button', { name: /reload curves/i }));

    expect(await screen.findByText('Loaded 2 equity snapshots for done-123.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Competition ID'), { target: { value: 'running-456' } });
    fireEvent.click(screen.getByRole('button', { name: /reload curves/i }));

    expect(await screen.findByText('Equity curves are available after the competition completes.')).toBeInTheDocument();
  });

  it('loads broker order audit with optional agent filter and executes emergency stop with confirmation', async () => {
    render(<MarlCompetitionViewer />);

    fireEvent.click(screen.getByRole('button', { name: /broker admin/i }));

    fireEvent.change(screen.getByPlaceholderText('API_SECRET_KEY value'), {
      target: { value: 'test-secret-key' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Load Broker Admin Data' }));

    await screen.findByText('Order Audit');

    fireEvent.change(screen.getByLabelText('Broker order audit competition id'), {
      target: { value: 'comp-123' },
    });
    fireEvent.change(screen.getByLabelText('Broker order audit agent filter'), {
      target: { value: 'alpha' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Load Orders' }));

    await screen.findByText('client-1');

    fireEvent.change(screen.getByLabelText('Emergency stop competition id'), {
      target: { value: 'comp-123' },
    });
    fireEvent.change(screen.getByLabelText('Emergency stop credential'), {
      target: { value: 'cred-paper-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Emergency Stop' }));

    await screen.findByRole('dialog', { name: 'Emergency stop confirmation' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Emergency Stop' }));

    await screen.findByText('Emergency stop executed for comp-123. Cancelled 2 open order(s).');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/marl/broker/credentials', expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith('/api/marl/broker/connected', expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith('/api/marl/broker/orders/comp-123?agentId=alpha', expect.any(Object));
      expect(mockFetch).toHaveBeenCalledWith('/api/marl/broker/emergency-stop', expect.objectContaining({ method: 'POST' }));
    });
  }, 15000);
});
