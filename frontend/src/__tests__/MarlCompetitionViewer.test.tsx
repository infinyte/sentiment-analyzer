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
import { useTournamentScheduler } from '../hooks/useTournamentScheduler';

vi.mock('../hooks/useMarlCompetition');
vi.mock('../hooks/useTournamentScheduler');
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
  liveEquitySnapshots: [],
  liveTradeFeed: [],
  isStreamConnected: false,
  transport: 'polling' as const,
  startCompetition: vi.fn(),
  compareAgents: vi.fn(),
  loadList: vi.fn(),
  loadResults: vi.fn(),
  reset: vi.fn(),
};

const mockUseMarl = vi.mocked(useMarlCompetition);
const mockUseScheduler = vi.mocked(useTournamentScheduler);
let mockFetch: ReturnType<typeof vi.fn>;
let emergencyStopCalled = false;

// ── Default scheduler hook return (no schedules) ──────────────────────────────

const defaultSchedulerHook = {
  schedules: [],
  loading: false,
  error: null,
  actionLoading: null,
  loadSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  runNow: vi.fn(),
  toggleEnabled: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMarl.mockReturnValue(defaultHook);
  mockUseScheduler.mockReturnValue(defaultSchedulerHook);
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

  it('renders live monitor trade feed from stream-backed hook data', () => {
    mockUseMarl.mockReturnValue({
      ...defaultHook,
      loading: true,
      competitionId: 'cid-live',
      status: {
        competitionId: 'cid-live',
        status: 'RUNNING',
        progress: 41,
        mode: 'SINGLE',
        agentCount: 2,
        symbols: ['BTC'],
        startedAt: new Date().toISOString(),
        topPerformer: null,
      },
      isStreamConnected: true,
      transport: 'stream',
      liveEquitySnapshots: [
        {
          timestamp: '2026-03-23T10:00:00.000Z',
          agentEquities: [
            { agentId: 'alpha', equity: 10100 },
            { agentId: 'beta', equity: 9950 },
          ],
        },
      ],
      liveTradeFeed: [
        {
          type: 'trade_executed',
          competitionId: 'cid-live',
          agentId: 'alpha',
          symbol: 'BTC',
          side: 'BUY',
          quantity: 0.25,
          price: 64000,
          timestamp: '2026-03-23T10:00:02.000Z',
        },
      ],
    });

    render(<MarlCompetitionViewer />);

    expect(screen.getByText('Live Tournament Monitor')).toBeInTheDocument();
    expect(screen.getByText('Stream connected')).toBeInTheDocument();
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('BTC')).toBeInTheDocument();
    expect(screen.getByText('BUY')).toBeInTheDocument();
  });

  it('hides manual equity reload controls while live monitor is active', () => {
    mockUseMarl.mockReturnValue({
      ...defaultHook,
      loading: true,
      competitionId: 'cid-live',
      status: {
        competitionId: 'cid-live',
        status: 'RUNNING',
        progress: 41,
        mode: 'SINGLE',
        agentCount: 2,
        symbols: ['BTC'],
        startedAt: new Date().toISOString(),
        topPerformer: null,
      },
      isStreamConnected: true,
      transport: 'stream',
      results: {
        competitionId: 'cid-live',
        mode: 'SINGLE',
        duration: 100,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        finalRankings: [
          { rank: 1, agentId: 'alpha', finalCapital: 11000, totalReturn: 10, sharpeRatio: 1.5, maxDrawdown: 5, tradesExecuted: 10, winRate: 60 },
        ],
        headToHeadMetrics: [],
        equityEvolution: [],
        competitorImpact: [],
      },
    });

    render(<MarlCompetitionViewer />);

    expect(screen.queryByRole('button', { name: /reload curves/i })).not.toBeInTheDocument();
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

// ── Tournament Scheduler Tab ──────────────────────────────────────────────────

const SAMPLE_SCHEDULE = {
  id: 'sched-1',
  name: 'Daily MARL',
  cronExpression: '0 9 * * 1',
  runAt: null,
  config: {
    mode: 'SINGLE' as const,
    agents: [
      { id: 'bull', riskProfile: 'AGGRESSIVE' as const, initialCapital: 10000 },
      { id: 'bear', riskProfile: 'CONSERVATIVE' as const, initialCapital: 10000 },
    ],
    symbols: ['BTC', 'ETH'],
    symbolSelectionMode: 'MANUAL' as const,
    duration: 200,
    refreshInterval: 1000,
    learningEnabled: true,
  },
  enabled: true,
  lastRunAt: null,
  nextRunAt: null,
  createdAt: '2026-03-28T00:00:00.000Z',
  updatedAt: '2026-03-28T00:00:00.000Z',
};

describe('MarlCompetitionViewer — Scheduled tab', () => {
  it('renders the Scheduled tab button', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.getByRole('button', { name: 'Scheduled' })).toBeInTheDocument();
  });

  it('shows scheduler panel when Scheduled tab is clicked', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByText('Tournament Schedules')).toBeInTheDocument();
  });

  it('shows empty state message when no schedules exist', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByText(/No schedules yet/i)).toBeInTheDocument();
  });

  it('shows loading state while fetching schedules', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, loading: true });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByText(/Loading schedules/i)).toBeInTheDocument();
  });

  it('renders schedule list with name and schedule expression', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByText('Daily MARL')).toBeInTheDocument();
    expect(screen.getByText('0 9 * * 1')).toBeInTheDocument();
  });

  it('shows Enabled badge for an enabled schedule', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows Disabled badge for a disabled schedule', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [{ ...SAMPLE_SCHEDULE, enabled: false }] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('shows create form when + New Schedule is clicked', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new schedule' }));
    expect(screen.getByRole('form', { name: 'Create schedule form' })).toBeInTheDocument();
    expect(screen.getByLabelText('Schedule name')).toBeInTheDocument();
    expect(screen.getByLabelText('Cron expression')).toBeInTheDocument();
  });

  it('calls createSchedule on form submit with correct fields', async () => {
    const createSchedule = vi.fn().mockResolvedValue(SAMPLE_SCHEDULE);
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, createSchedule });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new schedule' }));

    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'My Weekly Run' } });
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '0 9 * * 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => {
      expect(createSchedule).toHaveBeenCalledOnce();
      const [arg] = createSchedule.mock.calls[0];
      expect(arg.name).toBe('My Weekly Run');
      expect(arg.cronExpression).toBe('0 9 * * 1');
    });
  });

  it('hides form and shows list after successful create', async () => {
    const createSchedule = vi.fn().mockResolvedValue(SAMPLE_SCHEDULE);
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, createSchedule, schedules: [SAMPLE_SCHEDULE] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new schedule' }));
    fireEvent.change(screen.getByLabelText('Schedule name'), { target: { value: 'Test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    await waitFor(() => expect(createSchedule).toHaveBeenCalled());
    expect(screen.queryByRole('form', { name: 'Create schedule form' })).not.toBeInTheDocument();
    expect(screen.getByText('Daily MARL')).toBeInTheDocument();
  });

  it('calls cancel and hides form when Cancel is clicked', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create new schedule' }));
    expect(screen.getByRole('form', { name: 'Create schedule form' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel schedule form' }));
    expect(screen.queryByRole('form', { name: 'Create schedule form' })).not.toBeInTheDocument();
  });

  it('calls toggleEnabled when Disable/Enable is clicked', () => {
    const toggleEnabled = vi.fn();
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE], toggleEnabled });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: `Disable schedule ${SAMPLE_SCHEDULE.name}` }));
    expect(toggleEnabled).toHaveBeenCalledWith(SAMPLE_SCHEDULE);
  });

  it('shows delete confirmation when Delete is clicked', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: `Delete schedule ${SAMPLE_SCHEDULE.name}` }));
    expect(screen.getByRole('button', { name: 'Confirm delete schedule' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel delete' })).toBeInTheDocument();
  });

  it('calls deleteSchedule when delete is confirmed', async () => {
    const deleteSchedule = vi.fn().mockResolvedValue(true);
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE], deleteSchedule });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: `Delete schedule ${SAMPLE_SCHEDULE.name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete schedule' }));

    await waitFor(() => expect(deleteSchedule).toHaveBeenCalledWith(SAMPLE_SCHEDULE.id));
  });

  it('dismisses delete confirmation when Cancel delete is clicked', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: `Delete schedule ${SAMPLE_SCHEDULE.name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel delete' }));
    expect(screen.queryByRole('button', { name: 'Confirm delete schedule' })).not.toBeInTheDocument();
  });

  it('calls runNow and displays launched competition id', async () => {
    const runNow = vi.fn().mockResolvedValue('comp_sched_123');
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE], runNow });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: `Run now ${SAMPLE_SCHEDULE.name}` }));

    await waitFor(() => expect(runNow).toHaveBeenCalledWith(SAMPLE_SCHEDULE.id));
    expect(await screen.findByText(/Launched: comp_sched_123/)).toBeInTheDocument();
  });

  it('shows error from hook', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, error: 'Network error' });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Network error');
  });

  it('opens edit form pre-filled with schedule values', () => {
    mockUseScheduler.mockReturnValue({ ...defaultSchedulerHook, schedules: [SAMPLE_SCHEDULE] });
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Scheduled' }));
    fireEvent.click(screen.getByRole('button', { name: `Edit schedule ${SAMPLE_SCHEDULE.name}` }));
    expect(screen.getByRole('form', { name: 'Edit schedule form' })).toBeInTheDocument();
    expect(screen.getByLabelText('Schedule name')).toHaveValue('Daily MARL');
  });
});

// ── REALISTIC_PAPER mode selection ────────────────────────────────────────────

describe('MarlCompetitionViewer — REALISTIC_PAPER exchange mode', () => {
  it('renders a Realistic Paper button in the Trading Mode selector', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.getByRole('button', { name: 'Realistic Paper' })).toBeInTheDocument();
  });

  it('renders all four mode buttons in order: Simulated, Realistic Paper, Paper Trading, Live Trading', () => {
    render(<MarlCompetitionViewer />);
    const modeButtons = ['Simulated', 'Realistic Paper', 'Paper Trading', 'Live Trading'];
    for (const label of modeButtons) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('shows fees/slippage explanatory note when Realistic Paper is selected', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Realistic Paper' }));
    expect(screen.getByText(/realistic paper uses live market prices/i)).toBeInTheDocument();
  });

  it('hides broker credentials section when Realistic Paper is selected', () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Realistic Paper' }));
    expect(screen.queryByText('Broker Credential')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add credential/i })).not.toBeInTheDocument();
  });

  it('hides broker credentials section in Simulated mode', () => {
    render(<MarlCompetitionViewer />);
    // Default is SIMULATED — broker section should not be visible
    expect(screen.queryByText('Broker Credential')).not.toBeInTheDocument();
  });

  it('shows broker credentials section when Paper Trading is selected', async () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Paper Trading' }));
    await waitFor(() => expect(screen.getByText('Broker Credential')).toBeInTheDocument());
  });

  it('shows broker credentials section when Live Trading is selected', async () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Live Trading' }));
    await waitFor(() => expect(screen.getByText('Broker Credential')).toBeInTheDocument());
  });

  it('does not show explanatory note in Simulated mode', () => {
    render(<MarlCompetitionViewer />);
    expect(screen.queryByText(/realistic paper uses live market prices/i)).not.toBeInTheDocument();
  });

  it('does not show explanatory note in Paper Trading mode', async () => {
    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Paper Trading' }));
    await waitFor(() => expect(screen.getByText('Broker Credential')).toBeInTheDocument());
    expect(screen.queryByText(/realistic paper uses live market prices/i)).not.toBeInTheDocument();
  });

  it('sends REALISTIC_PAPER in start payload when selected', () => {
    const startCompetition = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, startCompetition });

    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Realistic Paper' }));
    fireEvent.click(screen.getByRole('button', { name: /start tournament/i }));

    expect(startCompetition).toHaveBeenCalledWith(
      expect.objectContaining({ exchangeMode: 'REALISTIC_PAPER' }),
    );
  });

  it('does not include brokerCredentialId when REALISTIC_PAPER is selected', () => {
    const startCompetition = vi.fn();
    mockUseMarl.mockReturnValue({ ...defaultHook, startCompetition });

    render(<MarlCompetitionViewer />);
    fireEvent.click(screen.getByRole('button', { name: 'Realistic Paper' }));
    fireEvent.click(screen.getByRole('button', { name: /start tournament/i }));

    const payload = startCompetition.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(payload.brokerCredentialId).toBeUndefined();
  });
});
