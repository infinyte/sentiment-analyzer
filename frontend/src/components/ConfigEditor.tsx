import { useMemo, useState, type CSSProperties } from 'react';

type ConfigRow = {
  key: string;
  value: string | null;
  category: string;
  description: string;
  isSecret: boolean;
  updatedAt: string;
};

type ConfigResponse = {
  config: ConfigRow[];
};

function sortByCategoryThenKey(a: ConfigRow, b: ConfigRow): number {
  const byCategory = a.category.localeCompare(b.category);
  if (byCategory !== 0) return byCategory;
  return a.key.localeCompare(b.key);
}

export function ConfigEditor(): JSX.Element {
  const [password, setPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const groupedRows = useMemo(() => {
    const sorted = [...rows].sort(sortByCategoryThenKey);
    const groups = new Map<string, ConfigRow[]>();
    for (const row of sorted) {
      const group = groups.get(row.category) ?? [];
      group.push(row);
      groups.set(row.category, group);
    }
    return Array.from(groups.entries());
  }, [rows]);

  async function fetchConfig(secret: string): Promise<void> {
    setLoading(true);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch('/api/admin/config', {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${secret}`,
        },
      });

      if (!response.ok) {
        const message = response.status === 401
          ? 'Authentication failed. Check CONFIG_ADMIN_PASSWORD.'
          : `Failed to load config (${response.status}).`;
        throw new Error(message);
      }

      const data = (await response.json()) as ConfigResponse;
      const nextRows = (data.config ?? []).sort(sortByCategoryThenKey);
      setRows(nextRows);

      const nextDrafts: Record<string, string> = {};
      for (const row of nextRows) {
        if (!row.isSecret) {
          nextDrafts[row.key] = row.value ?? '';
        }
      }
      setDrafts(nextDrafts);
      setAuthenticated(true);
      setStatusMessage('Config loaded.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setAuthenticated(false);
    } finally {
      setLoading(false);
    }
  }

  async function saveRow(row: ConfigRow): Promise<void> {
    const draftValue = drafts[row.key] ?? '';
    if (row.isSecret && draftValue.trim() === '') {
      setStatusMessage(`Enter a value for ${row.key} before saving.`);
      return;
    }

    setSavingKey(row.key);
    setError(null);
    setStatusMessage(null);

    try {
      const response = await fetch(`/api/admin/config/${encodeURIComponent(row.key)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${password}`,
        },
        body: JSON.stringify({ value: draftValue }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save ${row.key} (${response.status}).`);
      }

      await fetchConfig(password);
      if (row.isSecret) {
        setDrafts(prev => ({ ...prev, [row.key]: '' }));
      }
      setStatusMessage(`Saved ${row.key}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingKey(null);
    }
  }

  const cardStyle: CSSProperties = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '0.75rem',
    padding: '1rem',
  };

  if (!authenticated) {
    return (
      <section style={{ maxWidth: '780px', margin: '2rem auto', padding: '0 1rem' }}>
        <div style={cardStyle}>
          <h2 style={{ margin: '0 0 0.75rem 0' }}>Admin Config</h2>
          <p style={{ margin: '0 0 1rem 0', color: 'var(--text-muted)' }}>
            Enter CONFIG_ADMIN_PASSWORD to access runtime configuration.
          </p>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void fetchConfig(password);
            }}
            style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}
          >
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Admin password"
              style={{
                flex: '1 1 280px',
                minWidth: '240px',
                padding: '0.6rem 0.75rem',
                border: '1px solid var(--border-input)',
                borderRadius: '0.5rem',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
              }}
            />
            <button
              type="submit"
              disabled={loading || password.trim().length === 0}
              style={{
                padding: '0.6rem 0.9rem',
                border: 'none',
                borderRadius: '0.5rem',
                backgroundColor: '#2563eb',
                color: '#fff',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? 'Loading...' : 'Unlock'}
            </button>
          </form>

          {error && (
            <p style={{ marginTop: '0.75rem', color: '#dc2626' }}>{error}</p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section style={{ maxWidth: '1180px', margin: '1.5rem auto', padding: '0 1rem 2rem' }}>
      <div style={{ ...cardStyle, marginBottom: '0.75rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ margin: 0 }}>Runtime Config</h2>
            <p style={{ margin: '0.35rem 0 0 0', color: 'var(--text-muted)' }}>
              Update settings without restarting the server.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchConfig(password)}
            disabled={loading}
            style={{
              alignSelf: 'center',
              padding: '0.5rem 0.8rem',
              borderRadius: '0.5rem',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--surface-2)',
              color: 'var(--text)',
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>

        {statusMessage && (
          <p style={{ margin: '0.75rem 0 0 0', color: '#2563eb' }}>{statusMessage}</p>
        )}
        {error && (
          <p style={{ margin: '0.75rem 0 0 0', color: '#dc2626' }}>{error}</p>
        )}
      </div>

      {groupedRows.map(([category, group]) => (
        <div key={category} style={{ ...cardStyle, marginBottom: '0.75rem' }}>
          <h3 style={{ marginTop: 0, marginBottom: '0.6rem' }}>{category}</h3>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {group.map((row) => {
              const isSaving = savingKey === row.key;
              const value = drafts[row.key] ?? '';

              return (
                <div key={row.key} style={{ border: '1px solid var(--border)', borderRadius: '0.5rem', padding: '0.75rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <strong>{row.key}</strong>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      Updated: {new Date(row.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <p style={{ margin: '0.4rem 0 0.6rem 0', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {row.description}
                  </p>

                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <input
                      type={row.isSecret ? 'password' : 'text'}
                      placeholder={row.isSecret ? 'Enter new secret value' : 'Value'}
                      value={value}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setDrafts(prev => ({ ...prev, [row.key]: nextValue }));
                      }}
                      style={{
                        flex: '1 1 360px',
                        minWidth: '240px',
                        padding: '0.55rem 0.7rem',
                        border: '1px solid var(--border-input)',
                        borderRadius: '0.45rem',
                        backgroundColor: 'var(--surface)',
                        color: 'var(--text)',
                      }}
                    />
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void saveRow(row)}
                      style={{
                        padding: '0.55rem 0.8rem',
                        border: 'none',
                        borderRadius: '0.45rem',
                        backgroundColor: '#2563eb',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: isSaving ? 'not-allowed' : 'pointer',
                        opacity: isSaving ? 0.7 : 1,
                      }}
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>

                  {row.isSecret && (
                    <p style={{ margin: '0.5rem 0 0 0', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                      Secret values are masked. Enter a value to replace it.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
