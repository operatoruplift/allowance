import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { LEGAL_LAST_UPDATED, LEGAL_LAST_UPDATED_ISO, OPERATOR_NAME, SUPPORT } from './legal';
import './legal.css';

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

export interface LegalPoint {
  label: string;
  text: ReactNode;
}

interface LegalDocumentProps {
  kicker: string;
  title: string;
  lede: ReactNode;
  summary: LegalPoint[];
  sections: LegalSection[];
  sibling: { to: string; label: string };
}

/** The contact the build was configured with, as a link. */
export function SupportLink() {
  return (
    <a className="legal-link" href={SUPPORT.href}>
      {SUPPORT.label}
    </a>
  );
}

/** An outbound link that opens in a new tab, with the new tab said out loud. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="legal-link" href={href} target="_blank" rel="noreferrer">
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * A legal document: a dated masthead, a three-point summary, then numbered sections
 * beside a contents list. Everything is static text, so the page renders the same
 * offline and under the rehearsal's connect-src 'none'.
 */
export default function LegalDocument({
  kicker,
  title,
  lede,
  summary,
  sections,
  sibling,
}: LegalDocumentProps) {
  return (
    <main className="legal-page" aria-labelledby="legal-title">
      <header className="legal-masthead page-width">
        <p className="eyebrow legal-kicker">
          Legal <span aria-hidden="true">/</span> {kicker}
        </p>
        <h1 id="legal-title">{title}</h1>
        <p className="legal-lede">{lede}</p>
        <div className="legal-meta">
          <p>
            Last updated: <time dateTime={LEGAL_LAST_UPDATED_ISO}>{LEGAL_LAST_UPDATED}</time>
          </p>
          <p>
            Published by <b>{OPERATOR_NAME}</b>
          </p>
          <p>
            Questions: <SupportLink />
          </p>
        </div>
      </header>
      <section className="legal-summary page-width" aria-labelledby="legal-summary-title">
        <h2 id="legal-summary-title" className="eyebrow">
          In short
        </h2>
        <ol>
          {summary.map((point) => (
            <li key={point.label}>
              <b>{point.label}</b>
              <p>{point.text}</p>
            </li>
          ))}
        </ol>
      </section>
      <div className="legal-layout page-width">
        <nav className="legal-contents" aria-label="On this page">
          <p className="eyebrow">On this page</p>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.title}</a>
              </li>
            ))}
          </ol>
          <Link className="legal-sibling" to={sibling.to}>
            {sibling.label} <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </nav>
        <div className="legal-body">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="legal-section"
              aria-labelledby={`${section.id}-title`}
            >
              <h2 id={`${section.id}-title`}>{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
