import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleStop,
  Code2,
  Copy,
  Download,
  FileText,
  Fingerprint,
  Gauge,
  Info,
  KeyRound,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Menu,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Terminal,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  CATALOG,
  DEFAULT_TASK,
  createRunSchema,
  formatMoney,
  type AppConfigDTO,
  type PurchaseDTO,
  type RunDTO,
  type ToolName,
} from '../shared/domain';
import { api, downloadJSON, type Session } from './api';
import { createDemo, demoProbe, fixtureStep, reconcileDemo, type DemoScenario } from './demo';
import { rehearsalOnly } from './deployment';
import BrandKit from './BrandKit';

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="Allowance home">
      <img src="/allowance-a.svg" width="33" height="33" alt="" aria-hidden="true" />
      {!compact && (
        <span>
          Allowance<span className="brand-period">.</span>
        </span>
      )}
    </Link>
  );
}
function Header() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Logo />
        <button
          className="icon-button mobile-menu"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          aria-controls="main-navigation"
          onClick={() => setOpen(!open)}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
        <nav
          id="main-navigation"
          aria-label="Main navigation"
          className={open ? 'main-nav is-open' : 'main-nav'}
        >
          <Link className={pathname === '/demo' ? 'nav-link active' : 'nav-link'} to="/demo">
            The example
          </Link>
          <Link
            className={pathname === '/developers' ? 'nav-link active' : 'nav-link'}
            to="/developers"
          >
            For developers
          </Link>
          <Link className={pathname === '/brand' ? 'nav-link active' : 'nav-link'} to="/brand">
            Brand kit
          </Link>
          <Link className="button button-small button-outline mobile-console-link" to="/app">
            {rehearsalOnly ? 'About live runs' : 'Open console'} <ArrowUpRight size={15} />
          </Link>
        </nav>
        <div className="header-context">
          <ShieldCheck size={21} />
          <span>
            {rehearsalOnly || pathname === '/' || pathname === '/demo' || pathname === '/brand'
              ? 'Public rehearsal · Mainnet preview · No real payments'
              : 'Application policies · Devnet payments'}
          </span>
          <Link
            className="header-console-link"
            to="/app"
            aria-label={rehearsalOnly ? 'About live runs' : 'Open console'}
          >
            <ArrowUpRight size={16} />
          </Link>
        </div>
      </div>
    </header>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <Logo />
        <p>A little independence. A clear limit.</p>
      </div>
      <div className="footer-right">
        <nav className="footer-links" aria-label="Footer navigation">
          <Link to="/demo">The example</Link>
          <Link to="/developers">For developers</Link>
          <Link to="/brand">
            Brand kit <ArrowUpRight size={13} />
          </Link>
          <a href="https://github.com/operatoruplift/allowance" target="_blank" rel="noreferrer">
            GitHub <ArrowUpRight size={13} />
          </a>
        </nav>
        <span>Built for Solana agentic payments</span>
        <span className="small muted">
          {rehearsalOnly
            ? 'Public rehearsal · Mainnet preview · Fixture receipts · No onchain payments'
            : 'First-party tools · Devnet payments · Working product name'}
        </span>
      </div>
    </footer>
  );
}
function NetworkPills({
  mode = 'rehearsal',
  data = 'mainnet preview',
}: {
  mode?: 'rehearsal' | 'live';
  data?: string;
}) {
  const paymentLabel = mode === 'rehearsal' ? 'mainnet preview' : 'devnet';
  return (
    <div className="network-pills">
      <span className="pill">
        <span className={mode === 'live' ? 'status-dot' : 'status-dot quiet'} />
        {mode === 'live' ? 'Live execution' : 'Rehearsal'}
      </span>
      <span>Payments: {paymentLabel}</span>
      <span className="pill-divider">/</span>
      <span>Data: {data}</span>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}
function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="notice error" role="alert">
      <XCircle size={18} />
      <div>{children}</div>
    </div>
  );
}
function Loading({ text = 'Loading your workspace…' }: { text?: string }) {
  return (
    <div className="loading-panel" role="status">
      <LoaderCircle className="spin" size={24} />
      <p>{text}</p>
    </div>
  );
}
function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(() => {
    setError('');
    return api<Session>('/api/session')
      .then(setSession)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load session.'));
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { session, error, refresh };
}
function BudgetMeter({
  run,
  compact = false,
}: {
  run: Pick<RunDTO, 'authorized' | 'settled' | 'held' | 'remaining' | 'mode'>;
  compact?: boolean;
}) {
  const total = Number(run.authorized) || 1;
  const settled = (Number(run.settled) / total) * 100;
  const held = (Number(run.held) / total) * 100;
  return (
    <section
      className={compact ? 'budget-meter compact' : 'budget-meter'}
      aria-label="Budget accounting"
    >
      <div className="budget-title">
        <span className="eyebrow">Your allowance</span>
        <span className="currency-label">
          USDC <span>· {run.mode === 'rehearsal' ? 'mainnet preview' : 'devnet'}</span>
        </span>
      </div>
      <div className="budget-total">
        <span>{formatMoney(run.authorized).slice(0, -4)}</span>
        <span className="budget-total-decimals">{formatMoney(run.authorized).slice(-4)}</span>
        <ShieldCheck size={25} />
      </div>
      <div
        className="meter-track"
        role="img"
        aria-label={`${formatMoney(run.settled)} settled, ${formatMoney(run.held)} held, ${formatMoney(run.remaining)} remaining`}
      >
        <div className="meter-settled" style={{ width: `${settled}%` }} />
        <div className="meter-held" style={{ width: `${held}%` }} />
      </div>
      <div className="meter-legend">
        <span>
          <i className="legend-dot green" />
          Settled <b>{formatMoney(run.settled)}</b>
        </span>
        <span>
          <i className="legend-dot amber" />
          Held <b>{formatMoney(run.held)}</b>
        </span>
        <span>
          <i className="legend-dot lime" />
          Remaining <b>{formatMoney(run.remaining)}</b>
        </span>
      </div>
      {!compact && (
        <p className="budget-note">
          <LockKeyhole size={13} />A blocked request never consumes your allowance.
        </p>
      )}
    </section>
  );
}
function LandingReceipt() {
  const [selected, setSelected] = useState(2);
  const descriptions = [
    'A useful first look: SOL balance and recent transaction history. Fixture price: 0.010000 USDC.',
    'A grounded explanation of one transaction. Fixture price: 0.020000 USDC.',
    'Separate policy probe: the proposed 0.020000 request exceeds the 0.010000 left. Denied before signing.',
  ];
  return (
    <div className="hero-receipt-wrap">
      <div className="receipt-floating-note">
        <span className="note-line" />
        <span>Small budget. Full picture.</span>
      </div>
      <div className="hero-receipt">
        <div className="receipt-top">
          <div className="receipt-icon">
            <ReceiptText size={22} />
          </div>
          <div>
            <span className="eyebrow">A receipt, not a mystery</span>
            <h2>Wallet activity brief</h2>
          </div>
          <span className="pill green-pill">Example</span>
        </div>
        <BudgetMeter
          compact
          run={{
            authorized: '40000',
            settled: '30000',
            held: '0',
            remaining: '10000',
            mode: 'rehearsal',
          }}
        />
        <div className="receipt-items">
          {[
            {
              icon: <Wallet size={18} />,
              title: 'Wallet snapshot',
              subtitle: 'A useful starting point',
              cost: '0.010000',
              state: 'Purchased',
            },
            {
              icon: <FileText size={18} />,
              title: 'Transaction explanation',
              subtitle: 'The story behind a transaction',
              cost: '0.020000',
              state: 'Purchased',
            },
            {
              icon: <ShieldCheck size={18} />,
              title: 'One more transaction',
              subtitle: 'Separate policy probe',
              cost: '0.020000',
              state: 'Blocked',
            },
          ].map((item, index) => (
            <button
              key={item.title}
              onClick={() => setSelected(index)}
              className={`preview-row ${selected === index ? 'selected' : ''} ${index === 2 ? 'blocked-row' : ''}`}
              aria-expanded={selected === index}
            >
              <span className="tool-icon">{item.icon}</span>
              <span className="preview-row-text">
                <b>{item.title}</b>
                <small>{item.subtitle}</small>
              </span>
              <span className="preview-row-price">
                <b>{item.cost}</b>
                <small>
                  {index === 2 ? <X size={11} /> : <Check size={11} />}
                  {item.state}
                </small>
              </span>
            </button>
          ))}
        </div>
        <div className="preview-detail" aria-live="polite">
          <Info size={15} />
          <span>{descriptions[selected]}</span>
        </div>
        <div className="receipt-bottom">
          <span>
            <span className="status-dot quiet" />
            Deterministic rehearsal
          </span>
          <span>No real payments</span>
        </div>
      </div>
      <div className="receipt-caption">
        <ArrowDownLeft size={18} />
        <span>
          <strong>Every purchase has a purpose.</strong>
          <br />
          <strong>Every limit has the final say.</strong>
        </span>
      </div>
    </div>
  );
}

function DecorativeFilm({
  src,
  poster,
  label,
  className,
}: {
  src: string;
  poster: string;
  label: string;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().catch(() => undefined);
  }, []);

  return (
    <div className={`decorative-film ${className ?? ''}`} data-film={label}>
      <video
        ref={videoRef}
        className="decorative-film-video"
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        aria-label={label}
        onCanPlay={(event) => void event.currentTarget.play().catch(() => undefined)}
      />
      <div className="film-scrim" aria-hidden="true" />
    </div>
  );
}
function Landing() {
  return (
    <>
      <main className="landing-page">
        <div className="edition-line page-width" aria-hidden="true">
          <span>Useful agents. Clear boundaries.</span>
          <span>Allowance / On Solana</span>
        </div>
        <section className="hero page-width">
          <div className="hero-copy">
            <div className="eyebrow hero-eyebrow">
              <span className="eyebrow-rule" aria-hidden="true" />
              Agent autonomy. With an allowance.
            </div>
            <h1>
              Give your agent a <span>budget.</span>
            </h1>
            <p className="hero-subtext">
              Let it buy the tools it needs. See where every cent went.
            </p>
            <div className="hero-actions">
              <Link to="/demo" className="button button-primary">
                Try the example <ArrowUpRight size={18} />
              </Link>
              <Link to="/developers" className="text-link">
                See how it works <ArrowRight size={16} />
              </Link>
            </div>
            <div className="hero-reassurance">
              <span className="overlap-circles">
                <ShieldCheck size={16} />
              </span>
              <span>
                No account. No wallet. No spending.
                <br />
                <b>
                  {rehearsalOnly ? 'This site is a public rehearsal.' : 'Just a working example.'}
                </b>
              </span>
            </div>
          </div>
          <div className="hero-media-stage">
            <DecorativeFilm
              className="cloud-film"
              src="/media/allowance-cloud.mp4"
              poster="/media/allowance-cloud-poster.png"
              label="Axiom cloud film"
            />
            <LandingReceipt />
          </div>
        </section>
        <section className="run-unfolds page-width" aria-labelledby="run-unfolds-title">
          <div className="run-unfolds-copy">
            <div>
              <div className="eyebrow">How a run unfolds</div>
              <h2 id="run-unfolds-title">From a prompt to a more useful tomorrow.</h2>
            </div>
            <Link className="text-link" to="/demo">
              See the working example <ArrowRight size={16} />
            </Link>
          </div>
          <ol className="run-unfolds-steps">
            <li><span>01</span><b>Set the allowance</b><small>Choose the boundary first.</small></li>
            <li><span>02</span><b>Let the agent request tools</b><small>Only useful, permitted work.</small></li>
            <li><span>03</span><b>Review the receipt</b><small>See every decision and result.</small></li>
          </ol>
          <DecorativeFilm
            className="mountain-film"
            src="/media/allowance-mountains.mp4"
            poster="/media/allowance-mountains-poster.png"
            label="Constellation mountain film"
          />
        </section>
        <section className="principles page-width" aria-label="How Allowance works">
          <div className="section-label">
            <span>Enough freedom to be useful.</span>
            <span>Enough structure to trust the process.</span>
          </div>
          <div className="feature-grid">
            <article className="feature-card">
              <span className="feature-icon">
                <Gauge size={22} />
              </span>
              <div className="feature-number">01 /</div>
              <h2>Set the boundary.</h2>
              <p>
                A total ceiling, a per-request cap, and approved services. Checked in application
                code before a payment is signed.
              </p>
              <span className="feature-tag">You set the boundaries</span>
            </article>
            <article className="feature-card">
              <span className="feature-icon">
                <Layers3 size={22} />
              </span>
              <div className="feature-number">02 /</div>
              <h2>Buy useful tools.</h2>
              <p>
                A wallet snapshot. A transaction explained. Two first-party Solana data tools, paid
                per request through x402.
              </p>
              <span className="feature-tag">Useful work, visible prices</span>
            </article>
            <article className="feature-card">
              <span className="feature-icon">
                <ReceiptText size={22} />
              </span>
              <div className="feature-number">03 /</div>
              <h2>Follow every decision.</h2>
              <p>
                Follow the decisions, read the brief, and take the receipt with you. Settled, held,
                and blocked stay distinct.
              </p>
              <span className="feature-tag">A trail you can understand</span>
            </article>
            <article className="feature-card">
              <span className="feature-icon">
                <ShieldCheck size={22} />
              </span>
              <div className="feature-number">04 /</div>
              <h2>Keep the receipt.</h2>
              <p>
                Export a clear record of the work, the purchases, and the requests your policy
                blocked.
              </p>
              <span className="feature-tag">Every cent, accounted for</span>
            </article>
          </div>
        </section>
        <section className="developer-teaser page-width">
          <div>
            <div className="eyebrow">Made for the builder</div>
            <h2>
              A small agent.
              <br />A clear spending boundary.
            </h2>
            <p>
              One task, two paid tools, and a reusable guarded client.
              <br />
              Start with the example. Inspect how the pieces fit.
            </p>
            <Link className="text-link" to="/developers">
              Read the developer guide <ArrowRight size={17} />
            </Link>
          </div>
          <div className="terminal-card">
            <div className="terminal-heading">
              <span>
                <i />
                <i />
                <i />
              </span>
              <span>an allowance, in plain terms</span>
            </div>
            <pre>
              <code>
                <span className="code-muted">// The model proposes. The policy decides.</span>
                {'\n'}
                <span className="code-green">allowance</span>
                {':   "0.040000"\n'}
                <span className="code-green">perRequest</span>
                {':  "0.020000"\n'}
                <span className="code-green">services</span>
                {':    ["wallet_snapshot",\n              "transaction_explain"]\n'}
                <span className="code-muted">// Mainnet-ready policy. Exact payments. Clear receipts.</span>
              </code>
            </pre>
            <div className="terminal-foot">
              <Terminal size={14} />
              Server-managed signer · Application-enforced limits
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
const terminalStatuses = new Set<RunDTO['status']>([
  'completed',
  'stopped',
  'expired',
  'failed',
  'interrupted',
]);
function Demo() {
  const [run, setRun] = useState<RunDTO>(createDemo);
  const [step, setStep] = useState<number | null>(null);
  const [scenario, setScenario] = useState<DemoScenario>('standard');
  useEffect(() => {
    if (step === null) return;
    const timer = setTimeout(
      () => {
        setRun((old) => fixtureStep(old, step, scenario));
        setStep(step < 5 && !(step === 2 && scenario !== 'standard') ? step + 1 : null);
      },
      step === 0 ? 80 : 650
    );
    return () => clearTimeout(timer);
  }, [step, scenario]);
  const start = () => {
    setRun(createDemo());
    setStep(0);
  };
  const stop = () => {
    setStep(null);
    setRun((old) => ({
      ...old,
      status: 'stopped',
      held: '0',
      remaining: String(Number(old.authorized) - Number(old.settled)),
      purchases: old.purchases.map((p) =>
        p.status === 'reserved'
          ? {
              ...p,
              status: 'released',
              reason: 'Fixture stopped before signing.',
              serviceOutcome: 'unavailable',
            }
          : p
      ),
      events: [
        ...old.events,
        {
          id: old.events.length + 1,
          at: old.createdAt,
          kind: 'stopped',
          title: 'Rehearsal stopped',
          detail:
            'No new fixture requests will start. The unsigned fixture reservation is released.',
          source: 'system',
        },
      ],
    }));
  };
  return (
    <main className="console-page page-width">
      <PageHeading
        eyebrow="The working example"
        title="A little budget. Useful work."
        action={<NetworkPills />}
      >
        Authorize a boundary. Rehearse useful purchases, a separate denial, and an honest recovery.
      </PageHeading>
      <div className="notice rehearsal-notice">
        <Sparkles size={18} />
        <div>
          <b>You’re in rehearsal.</b> These are deterministic fixtures. No signing, model calls, RPC
          calls, or paid requests.
          <span>
            {rehearsalOnly
              ? 'Refreshing resets this example. Actual agent runs require the separate persistent backend.'
              : 'Refreshing resets this local example. Live runs are saved on the server.'}
          </span>
        </div>
      </div>
      <section className="demo-guide" aria-label="How to use the working example">
        <div className="demo-guide-heading">
          <div className="eyebrow">A quick guided tour</div>
          <p>Choose a fixture, watch the budget move, then open the receipt for the exact reason behind each decision.</p>
        </div>
        <ol className="demo-guide-steps">
          <li><span>01</span><b>Choose an outcome</b><small>Try the standard run, a failure, or recovery.</small></li>
          <li><span>02</span><b>Run the fixture</b><small>See useful tool purchases and one separate denial.</small></li>
          <li><span>03</span><b>Read the receipt</b><small>Expand any row to inspect status, cost, and evidence.</small></li>
          <li><span>04</span><b>Reconcile recovery</b><small>Resolve an unknown settlement without making a duplicate charge.</small></li>
        </ol>
      </section>
      <div className="workspace-grid">
        <section className="card composer">
          <div className="card-heading">
            <span className="section-index">01</span>
            <h2>The assignment</h2>
            <span className="pill subtle-pill">Read-only example</span>
          </div>
          <div className="form-content">
            <label className="field-label" htmlFor="demo-wallet">
              Solana wallet<span>Fixture address</span>
            </label>
            <div className="input-with-icon">
              <Wallet size={17} />
              <input id="demo-wallet" value={run.wallet} readOnly />
            </div>
            <label className="field-label" htmlFor="demo-task">
              What should the agent do?
            </label>
            <textarea id="demo-task" value={run.task} readOnly rows={4} />
            <div className="two-fields">
              <div>
                <span className="field-label">Total allowance</span>
                <div className="static-input">
                  0.040000 <span>USDC</span>
                </div>
              </div>
              <div>
                <span className="field-label">Per-request cap</span>
                <div className="static-input">
                  0.020000 <span>USDC</span>
                </div>
              </div>
            </div>
            <div className="field-label">
              Permitted services<span>First-party sample merchants</span>
            </div>
            <ToolList />
            <div className="demo-scenario">
              <label htmlFor="scenario">Choose a fixture<span>Each option demonstrates a different guarded outcome.</span></label>
              <select
                id="scenario"
                aria-describedby="scenario-help"
                value={scenario}
                disabled={step !== null}
                onChange={(e) => {
                  setScenario(e.target.value as DemoScenario);
                  setRun(createDemo());
                }}
              >
                <option value="standard">Two purchases + a budget boundary</option>
                <option value="empty">Wallet with no transaction history</option>
                <option value="failure">Service failure before signing</option>
                <option value="ambiguous">Settlement unknown, then reconcile</option>
              </select>
              <small id="scenario-help">No wallet, model, RPC, signing, or payment request is made from this page.</small>
            </div>
            <button
              className="button button-primary full-width"
              disabled={step !== null}
              onClick={start}
            >
              {step !== null ? (
                <>
                  <LoaderCircle size={17} className="spin" />
                  Running fixture steps…
                </>
              ) : (
                <>
                  {run.status === 'queued' ? 'Run the rehearsal' : 'Run rehearsal again'}
                  <ArrowRight size={17} />
                </>
              )}
            </button>
            <div className="form-footnote">
              <ShieldCheck size={13} />
              No keys or funds needed. Every step stays in your browser.
            </div>
          </div>
        </section>
        <div className="workspace-right">
          <section className="card budget-card">
            <BudgetMeter run={run} />
            <div className="budget-limits">
              <span>
                <Gauge size={14} />
                Per request <b>0.020000 USDC</b>
              </span>
              <span>
                <LockKeyhole size={14} />
                Policy <b>Fixture only</b>
              </span>
            </div>
          </section>
          <ProgressCard run={run} stop={stop} pending={false} />
          <div className="small-note">
            <Info size={16} />
            <p>
              In live mode, USDC tool charges, SOL fees and rent, and OpenAI usage are separate
              costs. This rehearsal incurs none.
            </p>
          </div>
        </div>
      </div>
      <RunDetails
        run={run}
        probe={() => setRun((old) => demoProbe(old))}
        reconcile={() => setRun((old) => reconcileDemo(old))}
        exportReceipt={() => downloadJSON(run, 'allowance-rehearsal-receipt.json')}
        probePending={false}
      />
      <div className="under-console">
        <span>
          {rehearsalOnly
            ? 'Ready to explore actual agent runs?'
            : 'Ready to connect configured tools?'}
        </span>
        <Link to="/app" className="text-link">
          {rehearsalOnly ? 'About live runs' : 'Open the operator console'}{' '}
          <ArrowUpRight size={16} />
        </Link>
      </div>
    </main>
  );
}
function ToolList({
  selected,
  onToggle,
  tools = CATALOG,
}: {
  selected?: ToolName[];
  onToggle?: (tool: ToolName) => void;
  tools?: typeof CATALOG;
}) {
  return (
    <div className="tool-list">
      {tools.map((tool) => (
        <label className="permitted-tool" key={tool.name}>
          <span className="tool-icon">
            {tool.name === 'wallet_snapshot' ? <Wallet size={17} /> : <FileText size={17} />}
          </span>
          <span>
            <b>{tool.title}</b>
            <small>
              {tool.name === 'wallet_snapshot'
                ? 'Balance + recent activity'
                : 'Facts behind one transaction'}
            </small>
          </span>
          <span className="tool-cost">
            {formatMoney(tool.price)}
            <small>USDC / request</small>
          </span>
          {onToggle && selected ? (
            <input
              aria-label={`Permit ${tool.title}`}
              type="checkbox"
              checked={selected.includes(tool.name)}
              onChange={() => onToggle(tool.name)}
            />
          ) : (
            <Check size={15} className="green-text" />
          )}
        </label>
      ))}
    </div>
  );
}
function ProgressCard({ run, stop, pending }: { run: RunDTO; stop: () => void; pending: boolean }) {
  const finished = terminalStatuses.has(run.status);
  const count = run.purchases.filter(
    (p) => p.source === 'agent' && p.serviceOutcome === 'delivered'
  ).length;
  return (
    <section className="card progress-card">
      <div className="card-heading">
        <span className="section-index">02</span>
        <h2>Run progress</h2>
        <span
          className={`pill ${
            run.status === 'completed'
              ? 'green-pill'
              : run.status === 'failed'
                ? 'red-pill'
                : run.status === 'interrupted'
                  ? 'amber-pill'
                  : finished
                    ? 'green-pill'
                    : 'subtle-pill'
          }`}
        >
          {run.status === 'running' && <LoaderCircle size={12} className="spin" />}
          {run.status}
        </span>
      </div>
      <div className="progress-steps">
        <div className={run.status !== 'queued' ? 'done' : ''}>
          <span>{run.status !== 'queued' ? <Check size={13} /> : '1'}</span>
          <b>Understand the task</b>
          <small>Work inside the approved policy</small>
        </div>
        <div className={count > 0 ? 'done' : ''}>
          <span>{count > 0 ? <Check size={13} /> : '2'}</span>
          <b>Buy useful information</b>
          <small>
            {count
              ? `${count} response${count === 1 ? '' : 's'} delivered`
              : 'Only from permitted services'}
          </small>
        </div>
        <div className={run.report ? 'done' : ''}>
          <span>{run.report ? <Check size={13} /> : '3'}</span>
          <b>Leave an understandable brief</b>
          <small>
            {run.report
              ? 'Report and receipt ready below'
              : 'Cite facts. Explain what was skipped.'}
          </small>
        </div>
      </div>
      {run.status === 'running' || (run.status === 'queued' && run.mode === 'live') ? (
        <div className="stop-area">
          <button className="button button-outline full-width" disabled={pending} onClick={stop}>
            <CircleStop size={16} />
            {pending ? 'Stopping…' : 'Stop run'}
          </button>
          <small>Stops new payments. Submitted payments can still settle.</small>
        </div>
      ) : (
        finished && (
          <div className="progress-finished">
            {run.status === 'completed' ? <CircleCheck size={16} /> : <CircleStop size={16} />}
            <span>
              {run.status === 'completed'
                ? 'Task finished within its allowance.'
                : `Run ${run.status}. Start a new run to authorize more work.`}
            </span>
          </div>
        )
      )}
    </section>
  );
}
function statusLabel(purchase: PurchaseDTO) {
  if (purchase.status === 'delivered') return 'Settled · delivered';
  if (purchase.status === 'settlement-unknown') return 'Settlement unknown · held';
  if (purchase.status === 'settled-but-result-unavailable') return 'Settled · result unavailable';
  return purchase.status.replaceAll('-', ' ');
}
function PurchaseRow({ purchase, demo }: { purchase: PurchaseDTO; demo: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const blocked = purchase.status === 'denied';
  const held = ['reserved', 'submitted', 'settlement-unknown'].includes(purchase.status);
  const deliveryUnavailable = purchase.status === 'settled-but-result-unavailable';
  return (
    <div className={`purchase-entry ${blocked ? 'denied-entry' : ''}`}>
      <button
        className="purchase-row"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span
          className={`purchase-status-icon ${
            blocked ? 'red-text' : held || deliveryUnavailable ? 'amber-text' : 'green-text'
          }`}
        >
          {blocked ? (
            <ShieldCheck size={19} />
          ) : held ? (
            <CircleDashed size={19} />
          ) : deliveryUnavailable ? (
            <CircleDashed size={19} />
          ) : (
            <CheckCheck size={19} />
          )}
        </span>
        <span className="purchase-title">
          <b>{CATALOG.find((t) => t.name === purchase.tool)?.title ?? purchase.tool}</b>
          <small>
            {purchase.source === 'policy-probe' ? 'Separate policy probe' : 'Agent request'} ·{' '}
            {demo ? 'Fixture' : 'First-party merchant'}
          </small>
        </span>
        <span className="purchase-amount">
          <b>{formatMoney(purchase.amount)}</b>
          <small className={blocked ? 'red-text' : held || deliveryUnavailable ? 'amber-text' : ''}>
            {statusLabel(purchase)}
          </small>
        </span>
        <ChevronDown size={16} className={expanded ? 'rotated' : ''} />
      </button>
      {expanded && (
        <div className="purchase-expanded">
          <dl>
            <div>
              <dt>Payment state</dt>
              <dd>
                {statusLabel(purchase)}
                {demo ? ' (simulated)' : ''}
              </dd>
            </div>
            <div>
              <dt>Service outcome</dt>
              <dd>{purchase.serviceOutcome}</dd>
            </div>
            <div>
              <dt>Chain evidence</dt>
              <dd>
                {demo
                  ? 'None — deterministic rehearsal'
                  : purchase.chainVerified
                    ? 'Token movement verified using RPC'
                    : 'Not chain-verified'}
              </dd>
            </div>
            <div>
              <dt>Request ID</dt>
              <dd className="mono">{purchase.id}</dd>
            </div>
            {purchase.payer && (
              <div>
                <dt>Token-owning payer</dt>
                <dd className="mono">{purchase.payer}</dd>
              </div>
            )}
            {purchase.recipient && (
              <div>
                <dt>Merchant recipient</dt>
                <dd className="mono">{purchase.recipient}</dd>
              </div>
            )}
            {purchase.feeSponsor && (
              <div>
                <dt>SOL fee sponsor</dt>
                <dd className="mono">{purchase.feeSponsor}</dd>
              </div>
            )}
            {purchase.feeLamports && (
              <div>
                <dt>Network fee (separate)</dt>
                <dd>{purchase.feeLamports} lamports, paid by the fee sponsor</dd>
              </div>
            )}
          </dl>
          {purchase.reason && <p>{purchase.reason}</p>}
          {!demo && purchase.signature && (
            <a
              className="text-link"
              href={`https://explorer.solana.com/tx/${encodeURIComponent(purchase.signature)}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              View actual devnet transaction <ArrowUpRight size={14} />
            </a>
          )}
          {purchase.result !== undefined && (
            <details className="data-details">
              <summary>Inspect returned data</summary>
              <pre>{JSON.stringify(purchase.result, null, 2)}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
function RunDetails({
  run,
  probe,
  reconcile,
  exportReceipt,
  probePending,
}: {
  run: RunDTO;
  probe: () => void;
  reconcile?: () => void;
  exportReceipt: () => void;
  probePending: boolean;
}) {
  const [tab, setTab] = useState<'timeline' | 'receipt'>('timeline');
  const probed = run.purchases.some((p) => p.source === 'policy-probe');
  const probeReady =
    run.status === 'completed' && run.settled === '30000' && run.remaining === '10000' && !probed;
  const unresolved = run.purchases.some((purchase) => purchase.status === 'settlement-unknown');
  return (
    <div className="run-details">
      {run.error && <ErrorBox>{run.error}</ErrorBox>}
      <div className="details-heading">
        <div className="tabs" aria-label="Run information">
          {(['timeline', 'receipt'] as const).map((value) => (
            <button
              className={tab === value ? 'active' : ''}
              key={value}
              onClick={() => setTab(value)}
              aria-pressed={tab === value}
            >
              {value === 'timeline' ? <Layers3 size={16} /> : <ReceiptText size={16} />}
              {value === 'timeline' ? 'Activity' : 'Receipt'}
              <span>{value === 'timeline' ? run.events.length : run.purchases.length}</span>
            </button>
          ))}
        </div>
        <div className="export-actions">
          <button className="button button-small button-plain" onClick={exportReceipt}>
            <Download size={15} />
            Export JSON
          </button>
          <button className="button button-small button-plain" onClick={() => window.print()}>
            <FileText size={15} />
            Print receipt
          </button>
        </div>
      </div>
      <section
        className={`card activity-card ${tab === 'timeline' ? 'visible-tab' : 'print-hidden-tab'}`}
        aria-label="Event timeline"
      >
        {run.events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Layers3 size={26} />
            </div>
            <h3>Your agent’s paper trail starts here.</h3>
            <p>
              Run the {run.mode === 'rehearsal' ? 'rehearsal' : 'task'} to see each decision,
              purchase, and policy check.
            </p>
          </div>
        ) : (
          <ol className="timeline">
            {run.events.map((event, i) => (
              <li key={event.id} className={event.source === 'policy-probe' ? 'probe-event' : ''}>
                <span className="timeline-point">
                  {event.source === 'policy-probe' ? (
                    <ShieldCheck size={14} />
                  ) : (
                    <Check size={13} />
                  )}
                </span>
                <div>
                  <div className="event-heading">
                    <b>{event.title}</b>
                    <span>
                      {run.mode === 'rehearsal'
                        ? `Step ${String(i + 1).padStart(2, '0')}`
                        : new Date(event.at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                    </span>
                  </div>
                  <p>{event.detail}</p>
                  {event.source === 'policy-probe' && (
                    <span className="mini-label">Policy probe · separate from agent trace</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <section
        className={`card receipt-card ${tab === 'receipt' ? 'visible-tab' : 'print-hidden-tab'}`}
        aria-label="Detailed receipt"
      >
        <div className="receipt-table-head">
          <h3>Purchase receipt</h3>
          <span>
            Amounts in {run.mode === 'rehearsal' ? 'mainnet preview' : 'devnet'} USDC{' '}
            {run.mode === 'rehearsal' && '· simulated'}
          </span>
        </div>
        {run.purchases.length ? (
          run.purchases.map((p) => (
            <PurchaseRow key={p.id} purchase={p} demo={run.mode === 'rehearsal'} />
          ))
        ) : (
          <div className="empty-state compact-empty">
            <ReceiptText size={25} />
            <p>No purchases yet. Your full allowance is available.</p>
          </div>
        )}
        <div className="receipt-totals">
          <span>
            Authorized <b>{formatMoney(run.authorized)}</b>
          </span>
          <span>
            Settled <b>{formatMoney(run.settled)}</b>
          </span>
          <span>
            Held <b>{formatMoney(run.held)}</b>
          </span>
          <span>
            Remaining <b>{formatMoney(run.remaining)}</b>
          </span>
        </div>
        <div className="receipt-cost-note">
          USDC amounts cover merchant tools only. SOL fees/rent and OpenAI usage are separate.{' '}
          {run.mode === 'rehearsal'
            ? 'This fixture incurred no costs and has no transaction signatures.'
            : run.llm.note}
        </div>
      </section>
      {probeReady || probed ? (
        <section className={`probe-card ${probed ? 'probe-completed' : ''}`}>
          <div className="probe-symbol">
            <ShieldCheck size={22} />
          </div>
          <div>
            <span className="eyebrow">Separate policy probe</span>
            <h3>
              {probed ? 'The limit held. No third payment.' : 'What if it asks for one more?'}
            </h3>
            <p>
              {probed
                ? 'The 0.020000 proposal was denied before signing. The remaining 0.010000 is unchanged.'
                : 'Send a 0.020000 proposal through the budget guard with only 0.010000 left. This is a separate check, outside the agent trace.'}
            </p>
          </div>
          {!probed ? (
            <button className="button button-outline" onClick={probe} disabled={probePending}>
              {probePending ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <ShieldCheck size={16} />
              )}
              Test the boundary
            </button>
          ) : (
            <span className="pill red-pill">
              <X size={12} />
              Denied before signing
            </span>
          )}
        </section>
      ) : null}
      {unresolved && reconcile ? (
        <section className="probe-card recovery-card">
          <div className="probe-symbol">
            <CircleDashed size={22} />
          </div>
          <div>
            <span className="eyebrow">Deterministic recovery</span>
            <h3>Reconcile the original hold.</h3>
            <p>
              The fixture timed out after signing. Reconcile the original intent to clear the
              hold; this never creates a second signature or invents delivery.
            </p>
          </div>
          <button className="button button-outline" onClick={reconcile}>
            <RotateCcw size={16} />
            Reconcile fixture hold
          </button>
        </section>
      ) : null}
      {run.report && (
        <section className="card report-card">
          <div className="report-heading">
            <span className="report-icon">
              <FileText size={21} />
            </span>
            <div>
              <div className="eyebrow">The useful part</div>
              <h2>Your wallet activity brief</h2>
            </div>
            <span className={`pill ${run.status === 'completed' ? 'green-pill' : 'amber-pill'}`}>
              {run.status === 'completed'
                ? run.mode === 'rehearsal'
                  ? 'Fixture report'
                  : 'Final report'
                : 'Recovery report'}
            </span>
          </div>
          <div className="report-text">
            {run.report.split('\n\n').map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          <div className="report-source">
            <Fingerprint size={15} />
            <span>
              {run.mode === 'rehearsal'
                ? 'Deterministic fixture · No live RPC or model evidence'
                : `Data: ${run.dataNetwork} · Payments: devnet · Tool data is cited in the brief`}
            </span>
          </div>
        </section>
      )}
      <div className="print-context">
        <Logo />
        <h2>Allowance receipt</h2>
        <p>
          Run {run.id} · Execution: {run.mode} · Payments: {run.mode === 'rehearsal' ? 'mainnet preview' : 'devnet'} · Data: {run.mode === 'rehearsal' ? 'mainnet preview' : run.dataNetwork}
        </p>
        {run.mode === 'rehearsal' && (
          <p>Deterministic fixture. No real signatures, payments, RPC calls or model calls.</p>
        )}
      </div>
    </div>
  );
}
function HostedConsole() {
  return (
    <main className="login-page page-width">
      <section className="login-story">
        <div className="eyebrow">The public rehearsal</div>
        <h1>
          Explore the agent.
          <br />
          See the boundary.
        </h1>
        <p>
          Follow a useful task from allowance to receipt.
          <br />
          Try the spending limit for yourself.
        </p>
        <div className="login-illustration" aria-hidden="true">
          <div className="limit-ceiling" />
          <span className="limit-upright left" />
          <span className="limit-upright right" />
          <span className="limit-dot">
            <Wallet size={30} />
          </span>
          <span className="limit-caption">ROOM TO WORK. A LIMIT TO RESPECT.</span>
        </div>
        <span className="small muted">No account · No wallet connection · No spending</span>
      </section>
      <section className="card login-card">
        <div className="login-key">
          <Layers3 size={25} />
        </div>
        <h2>Live runs need a persistent backend.</h2>
        <p>
          This Vercel site hosts the public rehearsal and developer guide. Operator sign-in, actual
          AI agent runs, and devnet payments are available only on a separately configured server.
        </p>
        <div className="notice">
          <Info size={19} />
          <div>
            <b>Fixture receipts, clearly labeled.</b>
            <p>
              The rehearsal makes no model, RPC, or paid API calls. It creates no signatures or
              verified onchain transactions.
            </p>
          </div>
        </div>
        <div className="login-bottom">
          <Link className="button button-primary full-width" to="/demo">
            Try the rehearsal <ArrowRight size={16} />
          </Link>
          <Link className="text-link" to="/developers">
            Read the backend setup guide <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}
function Login() {
  const { session, error: sessionError, refresh } = useSession();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!session || pending) return;
    setPending(true);
    setError('');
    try {
      await api(
        '/api/login',
        { method: 'POST', body: JSON.stringify({ password }) },
        session.csrfToken
      );
      setPassword('');
      navigate('/app', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
      void refresh();
    } finally {
      setPending(false);
    }
  }
  if (session?.authenticated) return <Navigate to="/app" replace />;
  return (
    <main className="login-page page-width">
      <section className="login-story">
        <div className="eyebrow">The operator’s workspace</div>
        <h1>
          Your agent.
          <br />
          Your boundaries.
        </h1>
        <p>
          Set the task. Approve an allowance.
          <br />
          Let the agent work inside it.
        </p>
        <div className="login-illustration">
          <div className="limit-ceiling" />
          <span className="limit-upright left" />
          <span className="limit-upright right" />
          <span className="limit-dot">
            <Wallet size={30} />
          </span>
          <span className="limit-caption">ROOM TO WORK. A LIMIT TO RESPECT.</span>
        </div>
        <span className="small muted">Single operator · Server-managed development signer</span>
      </section>
      <section className="card login-card">
        <div className="login-key">
          <KeyRound size={25} />
        </div>
        <h2>Welcome to your console.</h2>
        <p>Sign in with your configured operator password.</p>
        {sessionError && (
          <ErrorBox>
            {sessionError}{' '}
            <button className="inline-button" onClick={() => void refresh()}>
              Retry
            </button>
          </ErrorBox>
        )}
        {!session && !sessionError ? (
          <Loading text="Checking operator setup…" />
        ) : session && !session.configured ? (
          <div className="notice">
            <LockKeyhole size={19} />
            <div>
              <b>Operator access needs setup.</b>
              <p>
                Create a password hash locally with <code>npm run setup:operator</code>, add it to
                your server environment, and restart. Live spending stays unavailable until
                configured.
              </p>
              <Link className="text-link" to="/developers">
                View setup guide <ArrowRight size={15} />
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="operator-password" className="field-label">
              Operator password
            </label>
            <input
              id="operator-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
            {error && <ErrorBox>{error}</ErrorBox>}
            <button
              type="submit"
              className="button button-primary full-width"
              disabled={pending || !session}
            >
              {pending ? <LoaderCircle size={17} className="spin" /> : <LockKeyhole size={16} />}
              {pending ? 'Signing in…' : 'Open console'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
        <div className="login-bottom">
          Just looking around?
          <Link className="text-link" to="/demo">
            Try the no-account rehearsal <ArrowUpRight size={15} />
          </Link>
        </div>
      </section>
    </main>
  );
}
function OperatorApp() {
  const { session, error: sessionError, refresh } = useSession();
  const [config, setConfig] = useState<AppConfigDTO | null>(null);
  const [checking, setChecking] = useState(false);
  const [runs, setRuns] = useState<RunDTO[]>([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [wallet, setWallet] = useState('');
  const [task, setTask] = useState(DEFAULT_TASK);
  const [allowance, setAllowance] = useState('0.040000');
  const [cap, setCap] = useState('0.020000');
  const [expiry, setExpiry] = useState('15');
  const [selected, setSelected] = useState<ToolName[]>(['wallet_snapshot', 'transaction_explain']);
  const [externalPending, setExternalPending] = useState(false);
  const [externalGrant, setExternalGrant] = useState<{
    runId: string;
    token: string;
    expiresAt: string;
  } | null>(null);
  const navigate = useNavigate();
  const load = useCallback(async () => {
    setError('');
    try {
      const [nextConfig, nextRuns] = await Promise.all([
        api<AppConfigDTO>('/api/config'),
        api<{ runs: RunDTO[] }>('/api/runs'),
      ]);
      setConfig(nextConfig);
      setWallet((old) => old || nextConfig.defaultWallet);
      setRuns(nextRuns.runs);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load configuration.');
    }
  }, []);
  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session?.authenticated, load]);
  if (sessionError)
    return (
      <main className="page-width console-page">
        <ErrorBox>{sessionError}</ErrorBox>
        <button className="button button-outline" onClick={() => void refresh()}>
          Retry connection
        </button>
      </main>
    );
  if (!session) return <Loading />;
  if (!session.authenticated) return <Navigate to="/login" replace />;
  async function start(event: FormEvent) {
    event.preventDefault();
    if (!config?.ready || !session || pending) return;
    const input = createRunSchema.safeParse({
      wallet,
      task,
      allowance,
      perRequestCap: cap,
      expiresInMinutes: Number(expiry),
      allowedTools: selected,
    });
    if (!input.success) {
      setError(input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '));
      return;
    }
    setPending(true);
    setError('');
    try {
      const run = await api<{ id: string }>(
        '/api/runs',
        { method: 'POST', body: JSON.stringify(input.data) },
        session.csrfToken
      );
      navigate(`/runs/${run.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start run.');
    } finally {
      setPending(false);
    }
  }
  async function checkReadiness() {
    if (!session || checking) return;
    setChecking(true);
    setError('');
    try {
      const result = await api<AppConfigDTO>(
        '/api/preflight',
        { method: 'POST' },
        session.csrfToken
      );
      setConfig(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Readiness check failed.');
    } finally {
      setChecking(false);
    }
  }
  async function authorizeExternal() {
    if (!config?.externalReady || !session || externalPending) return;
    const input = createRunSchema.safeParse({
      wallet,
      task,
      allowance,
      perRequestCap: cap,
      expiresInMinutes: Number(expiry),
      allowedTools: selected,
    });
    if (!input.success) {
      setError(input.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '));
      return;
    }
    setExternalPending(true);
    setError('');
    try {
      const response = await api<{
        run: { id: string };
        grant: { token: string; expiresAt: string };
      }>(
        '/api/external-runs',
        { method: 'POST', body: JSON.stringify(input.data) },
        session.csrfToken
      );
      setExternalGrant({
        runId: response.run.id,
        token: response.grant.token,
        expiresAt: response.grant.expiresAt,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not authorize external agent.');
    } finally {
      setExternalPending(false);
    }
  }
  async function logout() {
    if (!session) return;
    try {
      await api('/api/logout', { method: 'POST' }, session.csrfToken);
      navigate('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign out.');
    }
  }
  return (
    <main className="console-page page-width">
      <PageHeading
        eyebrow="Operator console"
        title="Give useful work a limit."
        action={
          <div className="operator-actions">
            <NetworkPills mode="live" data={config?.dataNetwork} />
            <button className="inline-button" onClick={() => void logout()}>
              Sign out
            </button>
          </div>
        }
      >
        Authorize once. Review every decision along the way.
      </PageHeading>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!config ? (
        <>
          <Loading text="Checking tools, policy, and payer readiness…" />
          <button className="button button-outline" onClick={() => void load()}>
            Retry configuration
          </button>
        </>
      ) : (
        <>
          <div className={`notice ${config.ready ? 'success-notice' : 'setup-notice'}`}>
            <ShieldCheck size={19} />
            <div>
              <b>
                {config.ready
                  ? 'Devnet execution is ready.'
                  : 'Live execution is unavailable until setup is complete.'}
              </b>
              <span>
                {config.ready
                  ? 'Starting a run authorizes paid tool calls within the policy below. No per-request approval is required.'
                  : 'The readiness checks below explain what is missing. The no-account rehearsal is always available.'}
              </span>
            </div>
            {!config.ready && (
              <Link to="/demo" className="text-link">
                Try rehearsal <ArrowUpRight size={15} />
              </Link>
            )}
          </div>
          <div className="workspace-grid">
            <section className="card composer">
              <div className="card-heading">
                <span className="section-index">01</span>
                <h2>New assignment</h2>
              </div>
              <form className="form-content" onSubmit={start}>
                <label className="field-label" htmlFor="wallet">
                  Solana wallet<span>Public address only</span>
                </label>
                <div className="input-with-icon">
                  <Wallet size={17} />
                  <input
                    id="wallet"
                    placeholder="Enter a Solana wallet address"
                    required
                    maxLength={44}
                    value={wallet}
                    onChange={(e) => setWallet(e.target.value)}
                    disabled={pending}
                  />
                </div>
                <label className="field-label" htmlFor="task">
                  What should the agent do?
                </label>
                <textarea
                  id="task"
                  value={task}
                  required
                  minLength={10}
                  maxLength={1500}
                  rows={4}
                  onChange={(e) => setTask(e.target.value)}
                  disabled={pending}
                />
                <div className="two-fields">
                  <div>
                    <label className="field-label" htmlFor="allowance">
                      Total allowance <span>USDC</span>
                    </label>
                    <input
                      id="allowance"
                      inputMode="decimal"
                      required
                      value={allowance}
                      onChange={(e) => setAllowance(e.target.value)}
                      disabled={pending}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="cap">
                      Per-request cap <span>USDC</span>
                    </label>
                    <input
                      id="cap"
                      inputMode="decimal"
                      required
                      value={cap}
                      onChange={(e) => setCap(e.target.value)}
                      disabled={pending}
                    />
                  </div>
                </div>
                <div className="field-label">
                  Permitted services<span>First-party sample merchants</span>
                </div>
                <ToolList
                  tools={config.tools}
                  selected={selected}
                  onToggle={(tool) =>
                    setSelected((old) =>
                      old.includes(tool) ? old.filter((t) => t !== tool) : [...old, tool]
                    )
                  }
                />
                <label className="field-label" htmlFor="expiry">
                  Authorization expires after
                </label>
                <select
                  id="expiry"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  disabled={pending}
                >
                  <option value="5">5 minutes</option>
                  <option value="15">15 minutes</option>
                  <option value="30">30 minutes</option>
                </select>
                <button
                  className="button button-primary full-width"
                  type="submit"
                  disabled={!config.ready || pending || selected.length === 0}
                >
                  {pending ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <ShieldCheck size={17} />
                  )}
                  {pending
                    ? 'Authorizing run…'
                    : config.ready
                      ? 'Authorize & start run'
                      : 'Complete setup to start'}
                  <ArrowRight size={17} />
                </button>
                <button
                  className="button button-outline full-width"
                  type="button"
                  onClick={() => void authorizeExternal()}
                  disabled={
                    !config.externalReady || pending || externalPending || selected.length === 0
                  }
                >
                  {externalPending ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : (
                    <Terminal size={17} />
                  )}
                  {externalPending
                    ? 'Creating MCP grant…'
                    : config.externalReady
                      ? 'Authorize external MCP agent'
                      : 'Enable MCP after readiness'}
                  <ArrowRight size={17} />
                </button>
                {externalGrant && (
                  <div className="notice success-notice external-grant" role="status">
                    <KeyRound size={18} />
                    <div>
                      <b>External run authorized.</b>
                      <span>
                        Save this one-time grant token, then run <code>npm run mcp</code> with{' '}
                        <code>MCP_GRANT_TOKEN</code>. It expires at{' '}
                        {new Date(externalGrant.expiresAt).toLocaleString()}.
                      </span>
                      <button
                        className="grant-token"
                        type="button"
                        aria-label="Copy external agent grant token"
                        onClick={() => void navigator.clipboard?.writeText(externalGrant.token)}
                      >
                        <code>{externalGrant.token}</code>
                      </button>
                      <Link className="text-link" to={`/runs/${externalGrant.runId}`}>
                        Open external run receipt <ArrowUpRight size={15} />
                      </Link>
                    </div>
                  </div>
                )}
                <p className="form-footnote">
                  This authorizes devnet USDC tool charges. SOL fees/rent and OpenAI usage are
                  separate. Stop prevents new payments; submitted payments can still settle.
                </p>
              </form>
            </section>
            <div className="workspace-right">
              <section className="card payer-card">
                <div className="card-heading">
                  <Wallet size={18} />
                  <h2>Development payer</h2>
                  <span className="pill subtle-pill">devnet</span>
                </div>
                <div className="payer-balances">
                  <div>
                    <span>Available USDC</span>
                    <b>
                      {config.balance.usdc === null
                        ? 'Unavailable'
                        : formatMoney(config.balance.usdc)}
                    </b>
                  </div>
                  <div>
                    <span>SOL reserve</span>
                    <b>{config.balance.sol ?? 'Unavailable'}</b>
                  </div>
                </div>
                <div className="payer-address">
                  <span>Server-managed signer</span>
                  <code>{config.payer ?? 'No payer configured'}</code>
                </div>
                <div className="daily-budget">
                  <span>
                    Daily remaining <b>{formatMoney(config.dailyRemaining)} USDC</b>
                  </span>
                  <span>
                    Across all runs <b>Ceiling {formatMoney(config.dailyCeiling)}</b>
                  </span>
                </div>
              </section>
              <section className="card readiness-card">
                <div className="card-heading">
                  <Gauge size={18} />
                  <h2>Readiness</h2>
                  <button
                    className="button button-small button-plain readiness-check"
                    onClick={() => void checkReadiness()}
                    disabled={checking}
                  >
                    {checking ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <RotateCcw size={14} />
                    )}
                    {checking ? 'Checking…' : 'Check readiness'}
                  </button>
                </div>
                <ul>
                  {config.readiness.map((item) => (
                    <li key={item.name}>
                      <span className={item.ready ? 'green-text' : 'amber-text'}>
                        {item.ready ? <CircleCheck size={17} /> : <CircleDashed size={17} />}
                      </span>
                      <div>
                        <b>{item.name}</b>
                        <p>{item.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
              <div className="small-note">
                <Info size={16} />
                <p>
                  {config.llm.note} Model: {config.llm.model ?? 'not configured'}. Limit:{' '}
                  {config.llm.maxCalls} calls, {config.llm.maxOutputTokens} output tokens per
                  response.
                </p>
              </div>
            </div>
          </div>
          <section className="recent-runs">
            <div className="details-heading">
              <h2>Recent runs</h2>
              <span className="small muted">Durable receipts · Recoverable after refresh</span>
            </div>
            <div className="card">
              {runs.length ? (
                runs.map((run) => (
                  <Link className="recent-run" key={run.id} to={`/runs/${run.id}`}>
                    <span className="tool-icon">
                      <FileText size={18} />
                    </span>
                    <div>
                      <b>{run.task}</b>
                      <small>
                        {new Date(run.createdAt).toLocaleString()} · {run.status}
                      </small>
                    </div>
                    <span>
                      {formatMoney(run.settled)}
                      <small>USDC settled</small>
                    </span>
                    <ChevronRight size={17} />
                  </Link>
                ))
              ) : (
                <div className="empty-state compact-empty">
                  <ReceiptText size={24} />
                  <h3>Your first run starts here.</h3>
                  <p>Completed and interrupted runs will remain available in this workspace.</p>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </main>
  );
}
function LiveRun() {
  const { id } = useParams();
  const { session, error: sessionError, refresh } = useSession();
  const [run, setRun] = useState<RunDTO | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [probePending, setProbePending] = useState(false);
  const alive = useRef(true);
  const load = useCallback(async () => {
    try {
      const next = await api<RunDTO>(`/api/runs/${encodeURIComponent(id ?? '')}`);
      if (alive.current) {
        setRun(next);
        setError('');
      }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Could not load run.');
    }
  }, [id]);
  useEffect(() => {
    alive.current = true;
    if (session?.authenticated) void load();
    return () => {
      alive.current = false;
    };
  }, [session?.authenticated, load]);
  useEffect(() => {
    if (
      !session?.authenticated ||
      !run ||
      (terminalStatuses.has(run.status) && Number(run.held) === 0)
    )
      return;
    const timer = setTimeout(() => void load(), 2000);
    return () => clearTimeout(timer);
  }, [run, session?.authenticated, load, error]);
  if (sessionError)
    return (
      <main className="console-page page-width">
        <ErrorBox>{sessionError}</ErrorBox>
        <button className="button button-outline" onClick={() => void refresh()}>
          Retry connection
        </button>
      </main>
    );
  if (!session) return <Loading />;
  if (!session.authenticated) return <Navigate to="/login" replace />;
  async function stop() {
    if (!session || pending) return;
    setPending(true);
    try {
      await api(
        `/api/runs/${encodeURIComponent(id ?? '')}/stop`,
        { method: 'POST' },
        session.csrfToken
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop run.');
    } finally {
      setPending(false);
    }
  }
  async function probe() {
    if (!session || probePending) return;
    setProbePending(true);
    try {
      await api(
        `/api/runs/${encodeURIComponent(id ?? '')}/probe`,
        { method: 'POST' },
        session.csrfToken
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Policy probe failed.');
    } finally {
      setProbePending(false);
    }
  }
  async function exportReceipt() {
    try {
      const receipt = await api<unknown>(`/api/runs/${encodeURIComponent(id ?? '')}/export`);
      downloadJSON(receipt, `allowance-${id}-receipt.json`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.');
    }
  }
  return (
    <main className="console-page page-width">
      <Link className="back-link" to="/app">
        <ArrowDownLeft size={15} />
        Back to console
      </Link>
      <PageHeading
        eyebrow="Run workspace"
        title={
          run?.status === 'completed' ? 'Useful work. Accounted for.' : 'Every step, in the open.'
        }
        action={run && <NetworkPills mode={run.mode} data={run.dataNetwork} />}
      >
        A durable record of this task, its policy, and every purchase.
      </PageHeading>
      {error && (
        <ErrorBox>
          {error}{' '}
          <button className="inline-button" onClick={() => void load()}>
            Refresh run
          </button>
        </ErrorBox>
      )}
      {!run ? (
        !error && <Loading text="Restoring the saved run…" />
      ) : (
        <>
          <div className="workspace-grid">
            <section className="card run-assignment">
              <div className="card-heading">
                <span className="section-index">01</span>
                <h2>The assignment</h2>
                <span className="pill subtle-pill">Policy v{run.policy.version}</span>
              </div>
              <div className="form-content">
                <span className="field-label">Task</span>
                <p className="assignment-task">{run.task}</p>
                <span className="field-label">Wallet</span>
                <code className="address-block">{run.wallet}</code>
                <span className="field-label">Permitted services</span>
                <ToolList
                  tools={CATALOG.filter((tool) => run.policy.allowedTools.includes(tool.name))}
                />
                <dl className="policy-details">
                  <div>
                    <dt>Per-request cap</dt>
                    <dd>{formatMoney(run.policy.perRequestCap)} USDC</dd>
                  </div>
                  <div>
                    <dt>Authorization expires</dt>
                    <dd>{new Date(run.policy.expiresAt).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Tool call limit</dt>
                    <dd>{run.policy.callLimit}</dd>
                  </div>
                  <div>
                    <dt>Daily ceiling</dt>
                    <dd>{formatMoney(run.policy.dailyCeiling)} USDC</dd>
                  </div>
                  <div>
                    <dt>Run ID</dt>
                    <dd className="mono">{run.id}</dd>
                  </div>
                </dl>
                <div className="notice small-notice">
                  <LockKeyhole size={15} />
                  <p>
                    The approved policy is immutable. Further spending after Stop or expiry requires
                    a new run.
                  </p>
                </div>
              </div>
            </section>
            <div className="workspace-right">
              <section className="card budget-card">
                <BudgetMeter run={run} />
              </section>
              <ProgressCard run={run} stop={() => void stop()} pending={pending} />
              <div className="small-note">
                <Info size={16} />
                <p>
                  {run.llm.note} OpenAI calls: {run.llm.calls}/{run.llm.maxCalls}; tokens:{' '}
                  {run.llm.inputTokens} input, {run.llm.outputTokens} output. These costs are
                  separate from USDC.
                </p>
              </div>
            </div>
          </div>
          <RunDetails
            run={run}
            probe={() => void probe()}
            exportReceipt={() => void exportReceipt()}
            probePending={probePending}
          />
        </>
      )}
    </main>
  );
}
const clientExample = `// Server-side only. See examples/paid-tool.ts.
import { createRuntime } from "./server/runtime.js";

const runtime = await createRuntime();
// runId identifies an immutable authorized policy.
const result = await runtime.payments.runPaidTool(
  runId,
  "wallet-snapshot-01", // keep stable across retries
  "wallet_snapshot",
  { address: walletAddress },
);

// Requires explicit network setup. A retry must keep
// the same request ID to recover the same purchase.`;
function Developers() {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(clientExample);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopyError('Copy is unavailable in this browser. Select the code to copy it.');
    }
  }
  return (
    <main className="developers-page page-width">
      <PageHeading
        eyebrow="For developers"
        title="Small pieces. Explicit boundaries."
        action={
          <span className="pill green-pill">
            <Code2 size={14} />
            x402 v2 · exact SVM
          </span>
        }
      >
        Two useful tools and one guarded payment client. Built to be inspected.
      </PageHeading>
      {rehearsalOnly && (
        <div className="notice rehearsal-notice">
          <Info size={18} />
          <div>
            <b>This site hosts the public rehearsal.</b> The architecture and endpoints below
            describe the separately configured persistent backend. This static deployment does not
            run an agent, expose paid APIs, or verify live payments.
          </div>
        </div>
      )}
      <div className="developer-intro">
        <div>
          <h2>
            Give the model tools.
            <br />
            Keep the budget in code.
          </h2>
          <p>
            The agent can propose a wallet snapshot or a transaction explanation. The server checks
            the immutable policy and reserves the charge before signing. Your browser never receives
            the payer key.
          </p>
          <div className="notice small-notice">
            <Info size={16} />
            <p>
              The sample merchants are first-party demonstration services. Controls are enforced by
              the application using a server-managed signer and a fixed payment network.
            </p>
          </div>
        </div>
        <div className="flow-diagram" aria-label="Payment flow">
          <span data-step="1">
            <Sparkles size={17} />
            Agent proposes
          </span>
          <ArrowDown size={17} />
          <span className="flow-guard" data-step="2">
            <ShieldCheck size={17} />
            Policy checks + reserves
          </span>
          <ArrowDown size={17} />
          <span data-step="3">
            <KeyRound size={17} />
            x402 exact payment
          </span>
          <ArrowDown size={17} />
          <span data-step="4">
            <ReceiptText size={17} />
            Settled receipt + tool result
          </span>
        </div>
      </div>
      <section className="developer-tools">
        <div className="details-heading">
          <h2>The permitted tools</h2>
          <span className="small muted">Real Solana RPC data when live mode is configured</span>
        </div>
        <div className="developer-tool-grid">
          {CATALOG.map((tool, i) => (
            <article className="card developer-tool" key={tool.name}>
              <div className="tool-top">
                <span className="feature-icon">
                  {i === 0 ? <Wallet size={23} /> : <FileText size={23} />}
                </span>
                <span className="tool-price">
                  {formatMoney(tool.price)} <small>mainnet-ready USDC</small>
                </span>
              </div>
              <h3>{tool.title}</h3>
              <code>POST {tool.path}</code>
              <p>{tool.description}</p>
              <ul>
                {(i === 0
                  ? [
                      'Validated public address and data cluster',
                      'SOL balance with correct units',
                      'Bounded recent history + source provenance',
                      'Empty wallet is a valid result',
                    ]
                  : [
                      'Success, failure, slot, and transaction fee',
                      'Recognized transfers + balance changes',
                      'Explicit markers for unsupported instructions',
                      'Grounded facts, without invented intent',
                    ]
                ).map((item) => (
                  <li key={item}>
                    <Check size={14} />
                    {item}
                  </li>
                ))}
              </ul>
              <div className="merchant-note">
                First-party sample merchant · Exact per-request price
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="client-section">
        <div>
          <div className="eyebrow">A reusable boundary</div>
          <h2>
            One wrapper.
            <br />
            One logical purchase.
          </h2>
          <p>
            Keep the request ID stable across retries and restarts. The durable ledger binds it to
            the request and approved terms. Unknown settlement stays held until evidence resolves
            it.
          </p>
          <p>
            See the repository’s tested client example for dependency initialization and the
            controlled HTTP integration test.
          </p>
          <div className="client-tags">
            <span className="pill">No arbitrary URLs</span>
            <span className="pill">No model signer access</span>
            <span className="pill">Serial paid calls</span>
          </div>
        </div>
        <div className="terminal-card">
          <div className="terminal-heading">
            <span>guarded client · server-side</span>
            <button
              onClick={() => void copy()}
              className="code-copy"
              aria-label="Copy guarded client example"
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre>
            <code>{clientExample}</code>
          </pre>
          {copyError && <p role="status">{copyError}</p>}
        </div>
      </section>
      <section className="card setup-guide">
        <div className="card-heading">
          <Terminal size={19} />
          <h2>From rehearsal to devnet</h2>
        </div>
        <div className="setup-grid">
          <div>
            <span className="section-index">01</span>
            <h3>Run it locally</h3>
            <pre>
              <code>{'npm ci\ncp .env.example .env\nnpm run setup:operator\nnpm run dev'}</code>
            </pre>
            <p>
              Open 127.0.0.1:4318. Configure the generated password hash on the server. Rehearsal
              works without payment or model configuration.
            </p>
          </div>
          <div>
            <span className="section-index">02</span>
            <h3>Connect the development pieces</h3>
            <p>
              Configure a dedicated low-balance devnet payer, a different merchant recipient, Solana
              RPC, a compatible facilitator, and your server-only OpenAI credentials and model.
            </p>
            <p>
              Check devnet USDC mint and decimals, required token accounts, facilitator support, and
              SOL reserves with <code>npm run preflight</code>.
            </p>
          </div>
          <div>
            <span className="section-index">03</span>
            <h3>Verify a real run</h3>
            <p>
              The opt-in <code>npm run smoke:devnet</code> command requires explicit configuration
              and test funding. See the README for the authorization flag and complete setup.
            </p>
            <p>
              A working fixture or an unpaid 402 response is separate from evidence of real devnet
              settlement.
            </p>
          </div>
        </div>
      </section>
      <div className="deployment-note">
        <Layers3 size={21} />
        <div>
          <h3>One service. One persistent disk.</h3>
          <p>
            Production Express serves the Vite build and runs the bounded worker. SQLite keeps the
            ledger and sessions on a persistent volume. Run a single app instance. See the
            repository Docker instructions for the full command.
          </p>
        </div>
      </div>
      <div className="developer-links">
        <a href="https://github.com/operatoruplift/allowance" target="_blank" rel="noreferrer">
          Source on GitHub <ArrowUpRight size={15} />
        </a>
        <Link to="/brand">
          Allowance brand kit <ArrowRight size={15} />
        </Link>
        <a href="https://docs.x402.org/" target="_blank" rel="noreferrer">
          x402 documentation <ArrowUpRight size={15} />
        </a>
        <a
          href="https://solana.com/docs/payments/agentic-payments"
          target="_blank"
          rel="noreferrer"
        >
          Solana agentic payments <ArrowUpRight size={15} />
        </a>
        <Link to="/demo">
          Try the rehearsal <ArrowUpRight size={15} />
        </Link>
      </div>
    </main>
  );
}
function NotFound() {
  return (
    <main className="not-found page-width">
      <span className="eyebrow">404 / Outside this allowance</span>
      <h1>This page isn’t here.</h1>
      <p>The example is a good place to start.</p>
      <Link className="button button-primary" to="/demo">
        Try the example <ArrowRight size={17} />
      </Link>
    </main>
  );
}
function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title =
      rehearsalOnly &&
      (pathname === '/app' || pathname === '/login' || pathname.startsWith('/runs/'))
        ? 'About live runs · Allowance'
        : pathname === '/'
          ? 'Allowance — Give your agent a budget.'
          : `${pathname === '/brand' ? 'Brand kit' : pathname === '/demo' ? 'Rehearsal' : pathname === '/app' ? 'Operator console' : pathname === '/developers' ? 'For developers' : pathname === '/login' ? 'Operator login' : 'Run receipt'} · Allowance`;
  }, [pathname]);
  return null;
}
export default function App() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <ScrollReset />
      <Header />
      <div id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/demo" element={<Demo />} />
          <Route path="/login" element={rehearsalOnly ? <HostedConsole /> : <Login />} />
          <Route path="/app" element={rehearsalOnly ? <HostedConsole /> : <OperatorApp />} />
          <Route path="/runs/:id" element={rehearsalOnly ? <HostedConsole /> : <LiveRun />} />
          <Route path="/developers" element={<Developers />} />
          <Route
            path="/brand"
            element={
              <>
                <BrandKit />
                <Footer />
              </>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </>
  );
}
