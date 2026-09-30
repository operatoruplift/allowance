import { useEffect, useRef, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowUpRight,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Play,
  ReceiptText,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import './workspace.css';

export const workspaceViews = ['overview', 'runs', 'payments', 'setup'] as const;
export type WorkspaceView = (typeof workspaceViews)[number];
export function getWorkspaceView(search: string): WorkspaceView {
  const value = new URLSearchParams(search).get('view');
  return workspaceViews.find((view) => view === value) ?? 'overview';
}

const sections = [
  { view: 'overview', label: 'Overview', icon: LayoutDashboard, detail: 'Your daily workspace' },
  { view: 'runs', label: 'Runs', icon: ReceiptText, detail: 'Activity & receipts' },
  { view: 'payments', label: 'Payments', icon: Wallet, detail: 'Recipients & mandates' },
  { view: 'setup', label: 'Setup', icon: Gauge, detail: 'Connections & readiness' },
] as const;

export default function WorkspaceShell({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const { pathname, search } = useLocation();
  const page = pathname.replace(/\/$/, '') || '/';
  const view = getWorkspaceView(search);
  const selected = page.startsWith('/runs/') ? 'runs' : view;
  const previousLocation = useRef(`${pathname}${search}`);
  useEffect(() => {
    const key = `${pathname}${search}`;
    if (enabled && previousLocation.current !== key) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      const heading = document.querySelector<HTMLElement>('#main-content h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    }
    previousLocation.current = key;
  }, [pathname, search, enabled]);
  if (!enabled) return children;
  const title =
    page === '/lab'
      ? 'Policy lab'
      : page === '/demo'
        ? 'Agent walkthrough'
        : page === '/login'
          ? 'Operator access'
          : page.startsWith('/runs/')
            ? 'Run details'
            : sections.find((section) => section.view === selected)!.label;
  return (
    <div className="app-workspace">
      <aside className="workspace-sidebar">
        <Link to="/" className="brand workspace-brand" aria-label="Allowance home">
          <img src="/allowance-a.svg?v=3" alt="" width="33" height="33" />
          <span>
            Allowance<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="workspace-edition">
          A little independence.
          <br />A clear limit.
        </div>
        <nav className="workspace-primary-nav" aria-label="Workspace navigation">
          {sections.map(({ view: item, label, icon: Icon, detail }) => {
            const active = (page === '/app' || page.startsWith('/runs/')) && selected === item;
            return (
              <Link
                key={item}
                to={`/app?view=${item}`}
                className={active ? 'workspace-nav-link is-current' : 'workspace-nav-link'}
                aria-current={active ? 'page' : undefined}
                aria-label={label}
              >
                <Icon size={19} aria-hidden="true" />
                <span>
                  <b>{label}</b>
                  <small>{detail}</small>
                </span>
              </Link>
            );
          })}
        </nav>
        <nav className="workspace-tools-nav" aria-label="Explore Allowance">
          <span className="workspace-nav-caption">Explore</span>
          <Link to="/lab" aria-current={page === '/lab' ? 'page' : undefined}>
            <FlaskConical size={17} aria-hidden="true" />
            Policy lab
          </Link>
          <Link to="/demo" aria-current={page === '/demo' ? 'page' : undefined}>
            <Play size={17} aria-hidden="true" />
            Agent walkthrough
          </Link>
          <Link to="/developers">
            <ArrowUpRight size={17} aria-hidden="true" />
            Developer guide
          </Link>
        </nav>
        <div className="workspace-sidebar-note">
          <ShieldCheck size={22} />
          <b>Your limits come first.</b>
          <p>Every payment needs an authorized policy and a durable receipt.</p>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <Link to="/" className="workspace-mobile-brand" aria-label="Allowance home">
            <img src="/allowance-a.svg?v=3" width="26" height="26" alt="" />
            <b>Allowance.</b>
          </Link>
          <div className="workspace-breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <b>{title}</b>
          </div>
          <Link to="/app?view=setup" className="workspace-network">
            <ShieldCheck size={14} />
            USDC · Solana
          </Link>
        </header>
        <nav className="workspace-mobile-tools" aria-label="Workspace tools">
          <Link to="/lab" aria-current={page === '/lab' ? 'page' : undefined}>
            <FlaskConical size={14} />
            Policy lab
          </Link>
          <Link to="/demo" aria-current={page === '/demo' ? 'page' : undefined}>
            <Play size={14} />
            Walkthrough
          </Link>
          <Link to="/developers">
            <ArrowUpRight size={14} />
            Guide
          </Link>
        </nav>
        {children}
      </div>
    </div>
  );
}
