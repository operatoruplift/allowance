import LegalDocument, { ExternalLink, SupportLink, type LegalSection } from './LegalDocument';
import { OPERATOR_NAME, PUBLIC_SITE, repositoryDoc } from './legal';

// Each statement here describes what the code does today: the static rehearsal's
// headers (scripts/rehearsal-config.ts), its one browser-storage key
// (src/motion.tsx), the service worker (public/sw.js), the Android shell
// (android/), and the operator server's auth, schema and providers (server/).
// Change the page when any of those change.

const sections: LegalSection[] = [
  {
    id: 'who',
    title: 'Who this policy covers',
    body: (
      <>
        <p>
          Allowance is published by {OPERATOR_NAME} (“we”, “us”). We run the public site at{' '}
          <a className="legal-link" href={PUBLIC_SITE}>
            allowanceonsolana.vercel.app
          </a>{' '}
          and the Android app that opens it.
        </p>
        <p>
          Allowance is open source under the MIT license, so anyone can run their own deployment.
          Whoever runs a live deployment, including us when we run our own, decides what it keeps
          and for how long. This policy describes what the software does in each case.
        </p>
      </>
    ),
  },
  {
    id: 'public-site',
    title: 'The public site',
    body: (
      <>
        <p>
          The public site is a no-spend rehearsal. It has no sign-up, no accounts and no payments.
          The walkthrough and the policy lab run entirely in your browser, on preloaded examples and
          the limits you type in. The console pages explain the operator backend instead of calling
          it.
        </p>
        <p>
          Its pages make no network requests of their own. Every page is served with the content
          security policy <code>connect-src 'none'</code>, so a page cannot fetch, post or open a
          connection to anyone, including us. Your browser loads only the site’s own files: pages,
          scripts, styles, fonts, images and video.
        </p>
        <p>
          There are no cookies, no analytics and no advertising or tracking scripts. The site is
          hosted on Vercel, which receives the usual details of each request it serves, such as your
          IP address, your browser and the page requested, and may keep them in its logs under its
          own privacy policy.
        </p>
      </>
    ),
  },
  {
    id: 'device',
    title: 'What stays on your device',
    body: (
      <>
        <p>Two things, and neither is personal data:</p>
        <ul className="legal-list">
          <li>
            <b>A motion preference</b> in browser storage, under the key{' '}
            <code>allowance-reduced-motion</code>, set to true or false. The site writes it when it
            loads and updates it when you use Reduce motion.
          </li>
          <li>
            <b>An offline copy of the site</b>, kept by its service worker: the page shell, scripts,
            styles, fonts, icons and the artwork you have viewed, so the site opens without a
            connection. The worker never stores API, payment or receipt responses.
          </li>
        </ul>
        <p>
          Files you export from the policy lab or the walkthrough are built in your browser and
          saved by your browser. They are not uploaded. To remove everything above, clear the site’s
          data in your browser, or the app’s storage on Android.
        </p>
      </>
    ),
  },
  {
    id: 'android',
    title: 'The Android app',
    body: (
      <p>
        The Android app is a WebView shell that opens the public site, so everything above applies
        to it. It needs internet access and asks for no location, camera, microphone, contacts or
        storage permission, and it adds no analytics or tracking of its own. It adds “Solana Mobile
        Web Shell” to its browser user agent, keeps the site’s storage in the app’s own data, and
        opens links to other sites in your default browser.
      </p>
    ),
  },
  {
    id: 'operator',
    title: 'A live operator deployment',
    body: (
      <>
        <p>
          Allowance also includes an operator console you host yourself: an Express server with a
          SQLite journal. It is single-operator. There is no public sign-up, and the server holds
          its own payer key. Nothing in this section happens on the public site.
        </p>
        <p>A live deployment stores:</p>
        <ul className="legal-list">
          <li>
            <b>Operator sessions.</b> The operator signs in with a password checked against an
            Argon2id hash. The session is kept in the journal by express-session and identified by
            an HttpOnly, SameSite=Strict cookie, marked Secure when the console is served over
            HTTPS. A session lasts at most 8 hours.
          </li>
          <li>
            <b>Sign-in attempts.</b> Each attempt is counted against the IP address it came from, to
            slow password guessing. The count lasts 15 minutes.
          </li>
          <li>
            <b>The SQLite journal of policies, receipts and mandates.</b> Each run’s task, the
            wallet address it looks up, its frozen spending policy, agent events, purchases, the
            purchased tool results and the agent’s report. Each mandate’s limits, its allowlisted
            recipients and their labels, and its direct payments with amounts and memos.
          </li>
          <li>
            <b>Payment records.</b> Wallet addresses, transaction signatures, signed payment
            payloads and the chain evidence used to confirm settlement.
          </li>
          <li>
            <b>Agent grants.</b> Scoped access for the local MCP bridge, stored only as hashes of
            the tokens.
          </li>
        </ul>
        <p>
          The journal is a file on the operator’s own disk, written with owner-only permissions. The
          application does not send it anywhere. The server writes no request logs of its own,
          though the operator’s host or proxy may.
        </p>
        <p>
          The repository includes a Docker image and a Render blueprint as ways to deploy the
          server. Including them does not mean a live deployment is running.
        </p>
      </>
    ),
  },
  {
    id: 'processors',
    title: 'Who else receives data',
    body: (
      <>
        <p>
          A live deployment sends data to these services only after its operator configures them:
        </p>
        <ul className="legal-list">
          <li>
            <b>A Solana RPC provider</b> of the operator’s choice. It receives the wallet addresses
            and transaction signatures being looked up, the payer’s balance checks, and direct
            payments when they are submitted.
          </li>
          <li>
            <b>An x402 facilitator</b>, such as PayAI or another the operator chooses. It receives
            each signed x402 payment, including the payer and recipient addresses and the amount, to
            verify and settle it.
          </li>
          <li>
            <b>OpenAI</b>, only when the built-in agent is configured. It receives the task, the
            wallet address, the spending policy and the purchased tool results. Allowance sends
            these requests with OpenAI’s response storage turned off, and OpenAI’s own terms and
            retention still apply.
          </li>
        </ul>
        <p>
          Solana is public. Transactions, addresses and amounts that reach the chain are permanent
          and visible to anyone.
        </p>
        <p>
          We do not sell personal data or share it for advertising. The public site sends nothing to
          any of these services.
        </p>
      </>
    ),
  },
  {
    id: 'retention',
    title: 'Retention',
    body: (
      <ul className="legal-list">
        <li>
          <b>Public site.</b> We keep nothing beyond the host’s request logs. What is on your device
          stays until you clear it.
        </li>
        <li>
          <b>Sessions.</b> Signing out deletes the session. Otherwise it stops working 8 hours after
          sign-in, and the expired record stays in the journal until the operator removes it.
        </li>
        <li>
          <b>Sign-in counts.</b> Expire after 15 minutes.
        </li>
        <li>
          <b>The journal.</b> A financial record, kept until the operator deletes it. The
          application never deletes receipts, signatures or payment records by itself, because a
          missing record could hide a payment that already happened.
        </li>
        <li>
          <b>Onchain data.</b> Permanent. No one can delete it, including us and the operator.
        </li>
      </ul>
    ),
  },
  {
    id: 'backups',
    title: 'Backups and restore',
    body: (
      <>
        <p>
          Operators back up the journal with the built-in maintenance command. It uses SQLite’s
          online backup and writes a checksummed copy readable only by its owner. A backup holds
          everything the journal holds, sessions and payment records included, so the runbook keeps
          it in a private directory with encrypted off-host storage.
        </p>
        <p>
          A restore never overwrites the live database. A restored journal stays locked against new
          spending until the operator reconciles every payment made after the backup and records an
          explicit approval. The full runbook is{' '}
          <ExternalLink href={repositoryDoc('docs/runtime-recovery.md')}>
            docs/runtime-recovery.md
          </ExternalLink>
          .
        </p>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security',
    body: (
      <>
        <p>
          The payer key stays on the server and never reaches a browser. Sessions use HttpOnly,
          SameSite=Strict cookies, marked Secure over HTTPS. Every change needs a same-origin
          request with a CSRF token, and sign-in is throttled. The journal and its backups are
          written with owner-only file permissions.
        </p>
        <p>
          No system is perfectly secure. A host administrator, or anyone holding the payer key, can
          bypass the application’s controls. Read the{' '}
          <ExternalLink href={repositoryDoc('docs/threat-model.md')}>threat model</ExternalLink>{' '}
          before you fund a payer, and keep its balance small.
        </p>
      </>
    ),
  },
  {
    id: 'children',
    title: 'Children',
    body: (
      <p>
        Allowance is for adults. You must be 18 or older to use it. It is not directed at children,
        and we do not knowingly collect their data.
      </p>
    ),
  },
  {
    id: 'rights',
    title: 'Your rights',
    body: (
      <p>
        Depending on where you live, you may have the right to see, correct or delete personal data
        held about you. The public site holds none. For a live deployment, ask its operator, who
        controls that data. Payment records may have to be kept, and onchain data cannot be removed
        by anyone.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to this policy',
    body: (
      <p>
        We will update this page when Allowance changes what it collects or shares. The date at the
        top shows the current version, and earlier versions stay in the public repository history.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about this policy or the public site: <SupportLink />. For a live deployment
        someone else runs, contact its operator.
      </p>
    ),
  },
];

export default function PrivacyPolicy() {
  return (
    <LegalDocument
      kicker="Privacy"
      title="Privacy policy"
      lede="What the public site keeps, what a live operator deployment stores, and which services receive data. Allowance can sign real payments, so this page is specific."
      summary={[
        {
          label: 'Public site',
          text: 'No accounts, cookies or analytics. Its pages make no network requests, so nothing you do on them is sent anywhere.',
        },
        {
          label: 'Your device',
          text: 'Keeps a motion preference and an offline copy of the site. Nothing personal.',
        },
        {
          label: 'Live deployments',
          text: 'Run on the operator’s own server. Its journal holds sessions, policies, receipts and payment records, and the operator controls it.',
        },
      ]}
      sections={sections}
      sibling={{ to: '/terms', label: 'Read the terms of use' }}
    />
  );
}
