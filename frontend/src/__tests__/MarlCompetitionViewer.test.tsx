/**
 * Component tests — MarlCompetitionViewer
 *
 * The hook is mocked so tests are pure rendering/interaction tests
 * with no network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMarl.mockReturnValue(defaultHook);
});

afterEach(() => {
  cleanup();
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
});
