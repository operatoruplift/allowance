import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  Download,
  FileText,
  Plus,
  RotateCcw,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import { CATALOG, formatMoney } from '../shared/domain';
import { planSpending, type PlanInput } from '../shared/plan';
import { downloadJSON } from './api';
import './policy-lab.css';

const initialPlan: PlanInput = {
  allowance: '0.040000',
  perRequestCap: '0.020000',
  dailyAvailable: '0.100000',
  allowedTools: ['wallet_snapshot', 'transaction_explain'],
  requests: ['wallet_snapshot', 'transaction_explain', 'transaction_explain'],
};

export default function PolicyLab() {
  const [input, setInput] = useState<PlanInput>(initialPlan);
  const [saved, setSaved] = useState(false);
  let plan: ReturnType<typeof planSpending> | null = null;
  let error = '';
  try {
    plan = planSpending(input);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'Check your limits.';
  }
  function update(patch: Partial<PlanInput>) {
    setInput((current) => ({ ...current, ...patch }));
    setSaved(false);
  }
  const blocked = plan?.requests.filter((request) => request.decision === 'blocked').length ?? 0;
  return (
    <main className="policy-lab page-width">
      <div className="lab-heading">
        <div>
          <div className="eyebrow">The policy lab / 01</div>
          <h1>
            Find the right
            <br />
            <em>amount of freedom.</em>
          </h1>
        </div>
        <p>
          Set a budget. Choose the tools. See exactly which requests fit — before an agent spends a
          cent.
        </p>
      </div>
      <div className="lab-status">
        <ShieldCheck size={16} />
        <strong>No funds moved.</strong>
        <span>Budget planning · USDC · Solana mainnet</span>
      </div>
      <div className="lab-grid">
        <section className="card lab-controls" aria-labelledby="lab-limits-title">
          <div className="card-heading">
            <span className="section-index">01</span>
            <h2 id="lab-limits-title">Set the boundary</h2>
          </div>
          <div className="lab-control-body">
            <p>Adjust any limit. Your plan updates immediately.</p>
            {(
              [
                ['allowance', 'Total allowance', 'The most this task can use.'],
                ['perRequestCap', 'Per-request cap', 'The most any single tool can cost.'],
                [
                  'dailyAvailable',
                  'Daily capacity',
                  'The amount still available across your tasks.',
                ],
              ] as const
            ).map(([key, label, help]) => (
              <div className="lab-field" key={key}>
                <label htmlFor={`plan-${key}`}>
                  {label}
                  <span>USDC</span>
                </label>
                <input
                  id={`plan-${key}`}
                  inputMode="decimal"
                  autoComplete="off"
                  maxLength={14}
                  value={input[key]}
                  aria-describedby={`plan-${key}-help`}
                  onChange={(event) => update({ [key]: event.target.value })}
                />
                <small id={`plan-${key}-help`}>{help}</small>
              </div>
            ))}
            <fieldset className="lab-permissions">
              <legend>Permitted tools</legend>
              {CATALOG.map((tool) => (
                <label key={tool.name}>
                  <input
                    type="checkbox"
                    checked={input.allowedTools.includes(tool.name)}
                    onChange={() =>
                      update({
                        allowedTools: input.allowedTools.includes(tool.name)
                          ? input.allowedTools.filter((name) => name !== tool.name)
                          : [...input.allowedTools, tool.name],
                      })
                    }
                  />
                  <span>
                    {tool.title}
                    <small>{formatMoney(tool.price)} USDC / request</small>
                  </span>
                </label>
              ))}
            </fieldset>
            <button
              className="text-link"
              onClick={() => {
                setInput(initialPlan);
                setSaved(false);
              }}
            >
              <RotateCcw size={14} />
              Reset limits and requests
            </button>
          </div>
        </section>
        <div className="lab-right">
          <section className="lab-balance" aria-label="Policy plan totals" aria-live="polite">
            <div className="lab-balance-title">
              <span className="eyebrow">Planned tool costs</span>
              <span>USDC</span>
            </div>
            <div className="lab-amount" data-testid="planned-cost">
              {plan ? formatMoney(plan.plannedCost) : '—'}
            </div>
            <div
              className="lab-track"
              role="img"
              aria-label={
                plan
                  ? `${formatMoney(plan.plannedCost)} planned out of ${formatMoney(plan.limits.allowance)} USDC`
                  : 'Enter valid limits'
              }
            >
              <span
                style={{
                  width: plan
                    ? `${(Number(plan.plannedCost) / Number(plan.limits.allowance)) * 100}%`
                    : '0%',
                }}
              />
            </div>
            <div className="lab-balance-bottom">
              <span>
                Capacity left
                <strong data-testid="plan-remaining">
                  {plan ? formatMoney(plan.remaining) : '—'}
                </strong>
              </span>
              <span>
                Within limit<strong>{plan ? plan.requests.length - blocked : '—'}</strong>
              </span>
              <span>
                Blocked<strong>{plan ? blocked : '—'}</strong>
              </span>
            </div>
          </section>
          <section className="card lab-requests" aria-labelledby="lab-requests-title">
            <div className="card-heading">
              <span className="section-index">02</span>
              <h2 id="lab-requests-title">Plan the work</h2>
              <span className="lab-request-count">{input.requests.length} / 8</span>
            </div>
            <p className="lab-requests-intro">
              Requests are checked in order. A blocked request uses no capacity.
            </p>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            <ol className="lab-request-list">
              {input.requests.map((name, index) => {
                const tool = CATALOG.find((item) => item.name === name)!;
                const result = plan?.requests[index];
                return (
                  <li
                    key={`${index}-${name}`}
                    className={
                      result?.decision === 'blocked' ? 'lab-request blocked' : 'lab-request'
                    }
                  >
                    <span className="tool-icon" aria-hidden="true">
                      {name === 'wallet_snapshot' ? <Wallet size={18} /> : <FileText size={18} />}
                    </span>
                    <div className="lab-request-copy">
                      <b>{tool.title}</b>
                      <small>{result?.reason ?? 'Enter valid limits to check this request.'}</small>
                    </div>
                    <div className="lab-request-result">
                      <b>{formatMoney(tool.price)}</b>
                      <span>
                        {result ? (
                          result.decision === 'blocked' ? (
                            <>
                              <X size={12} />
                              Blocked
                            </>
                          ) : (
                            <>
                              <Check size={12} />
                              Within limit
                            </>
                          )
                        ) : (
                          'Unchecked'
                        )}
                      </span>
                    </div>
                    <button
                      className="icon-button"
                      aria-label={`Remove request ${index + 1}`}
                      onClick={() =>
                        update({
                          requests: input.requests.filter((_, position) => position !== index),
                        })
                      }
                    >
                      <X size={15} />
                    </button>
                  </li>
                );
              })}
            </ol>
            {input.requests.length === 0 && (
              <p className="lab-empty">A blank slate. Add a tool below to begin planning.</p>
            )}
            <div className="lab-add-tools">
              {CATALOG.map((tool) => (
                <button
                  className="button button-outline button-small"
                  disabled={input.requests.length >= 8}
                  key={tool.name}
                  onClick={() => update({ requests: [...input.requests, tool.name] })}
                >
                  <Plus size={14} />
                  Add {tool.title.toLowerCase()}
                </button>
              ))}
            </div>
          </section>
          <div className="lab-actions">
            <button
              className="button button-primary"
              disabled={!plan}
              onClick={() => {
                if (plan) {
                  downloadJSON(plan, 'allowance-policy-plan.json');
                  setSaved(true);
                }
              }}
            >
              <Download size={16} />
              Save policy plan
            </button>
            <span role="status">
              {saved
                ? 'Plan downloaded. No payment submitted.'
                : 'A planning document. No transaction submitted.'}
            </span>
          </div>
        </div>
      </div>
      <section className="lab-next">
        <div>
          <div className="eyebrow">From a boundary to useful work</div>
          <h2>A plan is the first step.</h2>
          <p>
            Execution also checks the merchant, destination, network, expiry, current balances, and
            payment readiness. The server reserves each charge before signing. SOL fees and model
            usage are separate from this USDC plan.
          </p>
        </div>
        <Link className="text-link" to="/app">
          Operator access <ArrowRight size={17} />
        </Link>
      </section>
    </main>
  );
}
