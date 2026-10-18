import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import {
  ApiError,
  api,
  setCsrfToken,
  type PreflightResponse,
  type RunSummary,
  type SessionResponse,
  type SuiteSummary,
  type TargetProfile,
} from './api';

type View = 'login' | 'configure' | 'run';

interface RunDetail {
  runId: string;
  status: string;
  executions: Array<{
    executionId: string;
    suiteId: string;
    status: string;
    failureReason: string | null;
    result: { passed: number; failed: number; skipped: number; evidenceComplete: boolean } | null;
    load: { requestedCandidates: number | null; configuredCandidates: number | null; achievedCandidates: number | null };
    fixtures: Array<{ kind: string; status: string }>;
    artifacts: Array<{ artifactId: string; fileName: string; url: string; sizeBytes: number }>;
  }>;
  holdReason: string | null;
  reconciliationNotes: string[];
}

const TERMINAL = new Set(['passed', 'failed', 'cancelled', 'interrupted', 'blocked']);

export function App(): JSX.Element {
  const [view, setView] = useState<View>('login');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api
      .session()
      .then((current) => {
        setCsrfToken(current.csrfToken);
        setSession(current);
        setView('configure');
      })
      .catch(() => setView('login'));
  }, []);

  const signOut = async (): Promise<void> => {
    try {
      await api.logout();
    } catch {
      // Signing out locally is enough; the cookie is cleared on the next login.
    }
    setSession(null);
    setView('login');
  };

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Production test portal</h1>
          <p className="muted">Durable controller for every supported application test family.</p>
        </div>
        {session ? (
          <div className="header-actions">
            <span className="chip">{session.operator.id}</span>
            <button type="button" className="secondary" onClick={() => void signOut()}>
              Sign out
            </button>
          </div>
        ) : null}
      </header>
      {error ? (
        <div className="banner error" role="alert">
          {error}
          <button type="button" className="link" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="banner" role="status">
          {notice}
          <button type="button" className="link" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {view === 'login' ? (
        <LoginView
          onError={setError}
          onSignedIn={(current) => {
            setCsrfToken(current.csrfToken);
            setSession(current);
            setView('configure');
          }}
        />
      ) : (
        <ControllerView
          view={view}
          setView={setView}
          onError={setError}
          onNotice={setNotice}
          session={session}
        />
      )}
    </div>
  );
}

function LoginView({
  onSignedIn,
  onError,
}: {
  onSignedIn: (session: SessionResponse) => void;
  onError: (message: string) => void;
}): JSX.Element {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.login(username, password);
      const current = await api.session();
      setCsrfToken(current.csrfToken);
      onSignedIn(current);
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card login" onSubmit={(event) => void submit(event)}>
      <h2>Operator sign-in</h2>
      <label htmlFor="username">Operator username</label>
      <input
        id="username"
        autoComplete="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      <button type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

interface ControllerProps {
  view: View;
  setView: (view: View) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  session: SessionResponse | null;
}

function ControllerView({ view, setView, onError, onNotice, session }: ControllerProps): JSX.Element {
  const [suites, setSuites] = useState<SuiteSummary[]>([]);
  const [targets, setTargets] = useState<TargetProfile[]>([]);
  const [productionEnabled, setProductionEnabled] = useState(false);
  const [runAll, setRunAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [parameters, setParameters] = useState({ apiCandidates: 400, browserCandidates: 10, browserConcurrency: 10 });
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [confirmFixtures, setConfirmFixtures] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        const [catalog, targetResponse] = await Promise.all([api.suites(), api.targets()]);
        setSuites(catalog.suites.filter((suite) => !suite.legacy));
        setTargets(targetResponse.targets);
        setProductionEnabled(targetResponse.productionEnabled);
        const defaults: Record<string, string> = {};
        for (const target of targetResponse.targets) {
          if (target.ready && !defaults[target.environment]) defaults[target.environment] = target.id;
        }
        setBindings(defaults);
      } catch (caught) {
        onError(caught instanceof ApiError ? caught.message : 'Could not load the catalog.');
      }
    })();
  }, [onError]);

  const refreshHistory = useCallback(async () => {
    try {
      const page = await api.runs();
      setHistory(page.runs);
    } catch {
      // History is non-critical; the next poll retries.
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
    const timer = setInterval(() => void refreshHistory(), 5_000);
    return () => clearInterval(timer);
  }, [refreshHistory]);

  const toggleSuite = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setPreflight(null);
  };

  const buildPayload = useCallback(() => {
    const suiteIds = runAll ? [] : [...selected];
    return {
      selection: { mode: runAll ? ('all' as const) : ('selected' as const), suiteIds },
      targetBindings: bindings,
      parameters: {
        apiCandidates: parameters.apiCandidates,
        browserCandidates: parameters.browserCandidates,
        browserConcurrency: parameters.browserConcurrency,
      },
    };
  }, [runAll, selected, bindings, parameters]);

  const runPreflight = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.preflight(buildPayload());
      setPreflight(result);
      setConfirmProduction(false);
      setConfirmFixtures(false);
      onNotice(
        result.blockers.length === 0
          ? `Preflight ready: ${result.suites.length} suite(s), approval valid until ${new Date(result.expiresAt).toLocaleTimeString()}.`
          : `Preflight found ${result.blockers.length} blocker(s); nothing was created.`,
      );
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Preflight failed.');
    } finally {
      setBusy(false);
    }
  };

  const submitRun = async (): Promise<void> => {
    if (!preflight) return;
    setBusy(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const response = await api.createRun(
        {
          ...buildPayload(),
          parameters: {
            apiCandidates: parameters.apiCandidates,
            browserCandidates: parameters.browserCandidates,
            browserConcurrency: parameters.browserConcurrency,
          },
          approval: {
            preflightDigest: preflight.digest,
            confirmProduction,
            confirmSyntheticFixtures: confirmFixtures,
          },
        },
        idempotencyKey,
      );
      setActiveRunId(response.run.runId);
      setView('run');
      onNotice(response.created ? 'Run accepted and durably recorded.' : 'Existing run returned for this key.');
      await refreshHistory();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Run creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const releaseQueue = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await api.releaseQueue();
      onNotice(`Released ${result.released.length} held run(s).`);
      await refreshHistory();
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Queue release failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="layout">
      <nav className="tabs" aria-label="Portal views">
        <button
          type="button"
          className={view === 'configure' ? 'active' : ''}
          onClick={() => setView('configure')}
        >
          Configure
        </button>
        <button type="button" className={view === 'run' ? 'active' : ''} onClick={() => setView('run')}>
          Run monitor
        </button>
      </nav>

      {view === 'configure' ? (
        <section className="grid">
          <div className="card span-2">
            <h2>1. Select suites</h2>
            <label className="inline">
              <input type="checkbox" checked={runAll} onChange={(event) => setRunAll(event.target.checked)} />
              Run all canonical suites (excludes legacy helpers)
            </label>
            <ul className="suite-list">
              {suites.map((suite) => (
                <li key={suite.id}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={runAll}
                      checked={selected.has(suite.id)}
                      onChange={() => toggleSuite(suite.id)}
                    />
                    <span className="suite-title">{suite.title}</span>
                    <span className="chip">{suite.family}</span>
                    <span className="chip">{suite.environments.join('/')}</span>
                    {suite.capacity.nativeProof ? <span className="chip warn">native proof</span> : null}
                  </label>
                  <p className="muted small">{suite.description}</p>
                </li>
              ))}
            </ul>
          </div>

          <div className="card">
            <h2>2. Parameters</h2>
            <label htmlFor="apiCandidates">API candidates (k6)</label>
            <input
              id="apiCandidates"
              type="number"
              min={1}
              max={400}
              value={parameters.apiCandidates}
              onChange={(event) => {
                setParameters((current) => ({ ...current, apiCandidates: Number(event.target.value) }));
                setPreflight(null);
              }}
            />
            <label htmlFor="browserCandidates">Browser candidates</label>
            <input
              id="browserCandidates"
              type="number"
              min={0}
              max={20}
              value={parameters.browserCandidates}
              onChange={(event) => {
                setParameters((current) => ({ ...current, browserCandidates: Number(event.target.value) }));
                setPreflight(null);
              }}
            />
            <label htmlFor="browserConcurrency">Browser concurrency</label>
            <input
              id="browserConcurrency"
              type="number"
              min={1}
              max={20}
              value={parameters.browserConcurrency}
              onChange={(event) => {
                setParameters((current) => ({ ...current, browserConcurrency: Number(event.target.value) }));
                setPreflight(null);
              }}
            />

            <h2>3. Targets</h2>
            {productionEnabled ? <p className="muted small">Production execution is enabled.</p> : null}
            {(['isolated', 'staging', 'production'] as const).map((environment) => (
              <div key={environment}>
                <label htmlFor={`target-${environment}`}>{environment} profile</label>
                <select
                  id={`target-${environment}`}
                  value={bindings[environment] ?? ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setBindings((current) => {
                      const next = { ...current };
                      if (value) next[environment] = value;
                      else delete next[environment];
                      return next;
                    });
                    setPreflight(null);
                  }}
                >
                  <option value="">Not bound</option>
                  {targets
                    .filter((target) => target.environment === environment)
                    .map((target) => (
                      <option key={target.id} value={target.id} disabled={!target.ready}>
                        {target.label} {target.ready ? '' : `(${target.detail})`}
                      </option>
                    ))}
                </select>
              </div>
            ))}

            <button type="button" onClick={() => void runPreflight()} disabled={busy}>
              {busy ? 'Validating…' : 'Preflight selection'}
            </button>
            {session?.controller.queueHeld.count ? (
              <button type="button" className="secondary" onClick={() => void releaseQueue()} disabled={busy}>
                Release {session.controller.queueHeld.count} held run(s)
              </button>
            ) : null}
          </div>

          {preflight ? (
            <div className="card span-2">
              <h2>4. Review and confirm</h2>
              <p className="muted small">
                Catalog {preflight.catalogRevision} · approval expires {new Date(preflight.expiresAt).toLocaleTimeString()} ·
                maximum deadline {preflight.estimatedMaximumMinutes} minutes
              </p>
              <h3>Planned suites</h3>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Suite</th>
                    <th scope="col">Environment</th>
                    <th scope="col">Controller</th>
                    <th scope="col">API</th>
                    <th scope="col">Browsers</th>
                  </tr>
                </thead>
                <tbody>
                  {preflight.suites.map((suite) => (
                    <tr key={suite.suiteId}>
                      <td>{suite.title}</td>
                      <td>{suite.environment}</td>
                      <td>{suite.controlOwner}</td>
                      <td>{suite.requestedApiCandidates ?? '—'}</td>
                      <td>{suite.requestedBrowserCandidates ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {preflight.blockers.length > 0 ? (
                <div className="banner error" role="alert">
                  <strong>Blockers — nothing has been created or started:</strong>
                  <ul>
                    {preflight.blockers.map((blocker) => (
                      <li key={blocker.requirement}>
                        {blocker.requirement}: {blocker.detail}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {preflight.effects.length > 0 ? (
                <>
                  <h3>Effects</h3>
                  <ul>
                    {preflight.effects.map((effect) => (
                      <li key={effect}>{effect}</li>
                    ))}
                  </ul>
                </>
              ) : null}

              {preflight.confirmation.production ? (
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={confirmProduction}
                    onChange={(event) => setConfirmProduction(event.target.checked)}
                  />
                  I confirm production execution against the bound profile.
                </label>
              ) : null}
              {preflight.confirmation.syntheticFixtures ? (
                <label className="inline">
                  <input
                    type="checkbox"
                    checked={confirmFixtures}
                    onChange={(event) => setConfirmFixtures(event.target.checked)}
                  />
                  I confirm fresh synthetic fixtures will be created through application APIs.
                </label>
              ) : null}

              <button
                type="button"
                disabled={
                  busy ||
                  preflight.blockers.length > 0 ||
                  (preflight.confirmation.production && !confirmProduction) ||
                  (preflight.confirmation.syntheticFixtures && !confirmFixtures)
                }
                onClick={() => void submitRun()}
              >
                Create run
              </button>
            </div>
          ) : null}

          <div className="card span-2">
            <h2>Run history</h2>
            {history.length === 0 ? <p className="muted">No runs recorded yet.</p> : null}
            <ul className="history">
              {history.map((run) => (
                <li key={run.runId}>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setActiveRunId(run.runId);
                      setView('run');
                    }}
                  >
                    #{run.admissionSequence} {run.runId.slice(0, 8)}
                  </button>
                  <span className={`status status-${run.status}`}>{run.status}</span>
                  <span className="muted small">{new Date(run.createdAt).toLocaleString()}</span>
                  {run.holdReason ? <span className="chip warn">held</span> : null}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : (
        <RunMonitor runId={activeRunId} onError={onError} />
      )}
    </div>
  );
}

function RunMonitor({
  runId,
  onError,
}: {
  runId: string | null;
  onError: (message: string) => void;
}): JSX.Element {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    if (!runId) return;
    let source: EventSource | null = null;
    const load = async (): Promise<void> => {
      try {
        const snapshot = (await api.run(runId)) as unknown as RunDetail;
        setDetail(snapshot);
        if (!TERMINAL.has(snapshot.status)) {
          source = new EventSource(`/api/v1/runs/${runId}/events`);
          source.addEventListener('state', (event) => {
            const payload = JSON.parse((event as MessageEvent).data) as {
              data: { summary: RunDetail };
            };
            void api.run(runId).then((next) => setDetail(next as unknown as RunDetail));
            void payload;
          });
          source.addEventListener('log', (event) => {
            const payload = JSON.parse((event as MessageEvent).data) as {
              data: { line: string };
            };
            setLogs((current) => [...current.slice(-800), payload.data.line]);
          });
          source.addEventListener('snapshot', (event) => {
            const payload = JSON.parse((event as MessageEvent).data) as { logTail: string[] };
            setLogs(payload.logTail.slice(-800));
          });
        }
      } catch (caught) {
        onError(caught instanceof ApiError ? caught.message : 'Could not load the run.');
      }
    };
    void load();
    return () => source?.close();
  }, [runId, onError]);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [logs]);

  const cancel = async (): Promise<void> => {
    if (!runId) return;
    setBusy(true);
    try {
      await api.cancel(runId, 'operator cancelled from portal');
    } catch (caught) {
      onError(caught instanceof ApiError ? caught.message : 'Cancellation failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!runId) {
    return (
      <div className="card">
        <h2>No run selected</h2>
        <p className="muted">Create a run or pick one from the history list.</p>
      </div>
    );
  }

  return (
    <section className="grid">
      <div className="card span-2">
        <div className="run-header">
          <h2>
            Run {runId.slice(0, 8)} <span className={`status status-${detail?.status ?? 'queued'}`}>{detail?.status ?? '…'}</span>
          </h2>
          <button
            type="button"
            className="danger"
            onClick={() => void cancel()}
            disabled={busy || !detail || TERMINAL.has(detail.status)}
          >
            Cancel run
          </button>
        </div>
        {detail?.holdReason ? <p className="banner warn">Held: {detail.holdReason}</p> : null}
        <table>
          <thead>
            <tr>
              <th scope="col">Suite</th>
              <th scope="col">Status</th>
              <th scope="col">Passed/Failed/Skipped</th>
              <th scope="col">Candidates requested/configured/achieved</th>
              <th scope="col">Failure</th>
            </tr>
          </thead>
          <tbody>
            {(detail?.executions ?? []).map((execution) => (
              <tr key={execution.executionId}>
                <td>{execution.suiteId}</td>
                <td>{execution.status}</td>
                <td>
                  {execution.result
                    ? `${execution.result.passed}/${execution.result.failed}/${execution.result.skipped}`
                    : '—'}
                </td>
                <td>
                  {execution.load.requestedCandidates ?? '—'}/{execution.load.configuredCandidates ?? '—'}/
                  {execution.load.achievedCandidates ?? '—'}
                </td>
                <td className="muted small">{execution.failureReason ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(detail?.executions ?? []).flatMap((execution) =>
          execution.artifacts.map((artifact) => (
            <p key={artifact.artifactId}>
              <a href={artifact.url} download>
                {artifact.fileName}
              </a>{' '}
              <span className="muted small">{Math.round(artifact.sizeBytes / 1024)} KiB</span>
            </p>
          )),
        )}
        {detail?.reconciliationNotes.length ? (
          <>
            <h3>Reconciliation notes</h3>
            <ul>
              {detail.reconciliationNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </>
        ) : null}
      </div>
      <div className="card span-2">
        <h2>Live log</h2>
        <pre ref={logRef} className="logs" aria-live="polite">
          {logs.join('\n')}
        </pre>
      </div>
    </section>
  );
}
