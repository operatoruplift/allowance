// Facts both legal documents and the site footer state. Kept in one place so the
// privacy policy, the terms and the footer cannot disagree about who runs
// Allowance, when the documents last changed, or where to ask a question.

export const OPERATOR_NAME = 'Operator Uplift';
export const LEGAL_LAST_UPDATED = '7 October 2026';
export const LEGAL_LAST_UPDATED_ISO = '2026-10-07';
export const PUBLIC_SITE = 'https://allowanceonsolana.vercel.app';
export const REPOSITORY_URL = 'https://github.com/operatoruplift/allowance';
export const ISSUES_URL = `${REPOSITORY_URL}/issues`;

/** A repository document, linked at its published path on the default branch. */
export const repositoryDoc = (file: string): string => `${REPOSITORY_URL}/blob/main/${file}`;

export interface SupportContact {
  kind: 'email' | 'issues';
  href: string;
  label: string;
}

// Deliberately narrow: a value that could carry mailto parameters or markup is
// treated as not configured rather than repaired.
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/**
 * The published contact. A support address is used only when one was configured
 * at build time; otherwise questions go to the public issue tracker. No address is
 * ever made up.
 */
export function supportContact(configured: string | undefined): SupportContact {
  const email = configured?.trim() ?? '';
  if (email.length <= 254 && EMAIL.test(email))
    return { kind: 'email', href: `mailto:${email}`, label: email };
  return { kind: 'issues', href: ISSUES_URL, label: ISSUES_URL.replace(/^https:\/\//, '') };
}

/** `VITE_SUPPORT_EMAIL` is read at build time, from the environment or a `.env` file. */
export const SUPPORT: SupportContact = supportContact(import.meta.env.VITE_SUPPORT_EMAIL);
