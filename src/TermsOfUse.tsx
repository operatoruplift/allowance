import LegalDocument, { ExternalLink, SupportLink, type LegalSection } from './LegalDocument';
import { OPERATOR_NAME, PUBLIC_SITE, repositoryDoc } from './legal';

// The spending model described here is the one docs/threat-model.md reviews:
// limits checked in application code and a durable journal, a server-managed
// payer, and no onchain escrow. Quote that document rather than paraphrase it.

const THREAT_MODEL_QUOTE =
  'A host administrator or stolen payer key can bypass application controls: there is no onchain budget escrow.';

const sections: LegalSection[] = [
  {
    id: 'agreement',
    title: 'Agreement',
    body: (
      <>
        <p>
          These terms are an agreement between you and {OPERATOR_NAME} (“we”, “us”) for the
          Allowance website at{' '}
          <a className="legal-link" href={PUBLIC_SITE}>
            allowanceonsolana.vercel.app
          </a>
          , its Android app and the Allowance software. By using any of them you accept these terms.
          If you do not accept them, do not use Allowance.
        </p>
        <p>
          You must be 18 or older. The source code is also available under the MIT license, which
          governs copying and changing the code itself.
        </p>
      </>
    ),
  },
  {
    id: 'what',
    title: 'What Allowance is',
    body: (
      <>
        <p>
          Allowance is a developer tool. It lets an operator give an AI agent a fixed,
          human-approved USDC budget, paid from the operator’s own dedicated payer through x402
          purchases or direct transfers to allowlisted recipients. It is single-operator: there is
          no public sign-up, and a live deployment holds its own payer key on the operator’s own
          server.
        </p>
        <p>
          The public site and the Android app are a no-spend rehearsal. They move no funds, call no
          model and connect to no wallet.
        </p>
      </>
    ),
  },
  {
    id: 'limits',
    title: 'Limits are application-enforced',
    body: (
      <>
        <p>
          Allowance checks each payment against the operator’s policy in application code, and
          records it in a durable journal, before the payer can sign. These limits are
          application-enforced. They are not an onchain escrow or a cryptographic cap. In the words
          of the{' '}
          <ExternalLink href={repositoryDoc('docs/threat-model.md')}>threat model</ExternalLink>:
        </p>
        <blockquote className="legal-quote">
          <p>{THREAT_MODEL_QUOTE}</p>
        </blockquote>
        <p>
          Fund the payer with small amounts only, no more than you can afford to lose. Never use
          your main wallet as the payer.
        </p>
      </>
    ),
  },
  {
    id: 'responsibilities',
    title: 'Your responsibilities',
    body: (
      <>
        <p>
          If you run a live deployment, you are responsible for it: the host, its configuration and
          keys, the providers you choose, the recipients you approve and every payment it signs.
          Keep the payer key secret, follow the setup guides before you enable payments, and comply
          with the laws and sanctions that apply to you.
        </p>
        <p>
          Do not use Allowance to break the law, evade sanctions, move funds you are not entitled
          to, or attack the public site or anyone else’s systems.
        </p>
      </>
    ),
  },
  {
    id: 'custody',
    title: 'No custody',
    body: (
      <p>
        We never hold, receive or control your funds. Allowance takes no custody of third-party
        funds: a payer belongs to the operator who configured it, and payments go from that payer to
        the recipients the operator approved. Solana transactions are final. We cannot reverse,
        refund or recover a payment.
      </p>
    ),
  },
  {
    id: 'fees',
    title: 'Fees',
    body: (
      <p>
        Allowance is free to use. Other services charge separately, under their own terms: an x402
        facilitator may charge for settlement, a model provider such as OpenAI bills for the agent’s
        usage, and Solana charges network fees and account rent. These costs are separate from the
        USDC budget you set.
      </p>
    ),
  },
  {
    id: 'advice',
    title: 'Not financial advice',
    body: (
      <p>
        Allowance shows data and records decisions. It is not financial, investment, legal or tax
        advice. Agent reports describe onchain facts and can be incomplete or wrong, so check them
        before you rely on them.
      </p>
    ),
  },
  {
    id: 'warranty',
    title: 'No warranty',
    body: (
      <p>
        Allowance is provided “as is” and “as available”, without warranties of any kind, express or
        implied, including merchantability, fitness for a particular purpose and non-infringement.
        We do not promise that it will be uninterrupted, secure or free of errors, that a payment
        will settle, or that data from an RPC provider, facilitator or model is accurate.
      </p>
    ),
  },
  {
    id: 'liability',
    title: 'Limitation of liability',
    body: (
      <>
        <p>
          To the fullest extent the law allows, {OPERATOR_NAME} is not liable for any indirect,
          incidental, special, consequential, exemplary or punitive damages, or for any loss of
          funds, profits, revenue, data or use, arising from Allowance or these terms. That includes
          payments signed by a payer you configured and losses caused by a compromised host or key.
          Our total liability for any claim is limited to US$100.
        </p>
        <p>Some places do not allow these limits, so parts of them may not apply to you.</p>
      </>
    ),
  },
  {
    id: 'dapp-store',
    title: 'Solana dApp Store',
    body: (
      <p>
        If you obtained Allowance through the Solana dApp Store, these terms are between you and{' '}
        {OPERATOR_NAME} only. Solana Mobile and its parents, subsidiaries, affiliates, officers,
        employees, agents, partners, suppliers and licensors (the Solana Mobile Parties) are not a
        party to these terms. They make no warranty about the app and have no responsibility or
        liability to you in connection with the app, its content, support or maintenance, or any
        Solana Mobile program.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes to these terms',
    body: (
      <p>
        We may update these terms. The date at the top shows the current version, and earlier
        versions stay in the public repository history. If you keep using Allowance after a change,
        the updated terms apply.
      </p>
    ),
  },
  {
    id: 'law',
    title: 'Governing law',
    body: (
      <p>
        These terms are governed by the laws of the place where {OPERATOR_NAME} is established,
        without regard to its conflict-of-law rules. Mandatory consumer protections where you live
        still apply.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms: <SupportLink />. For a live deployment someone else runs,
        contact its operator.
      </p>
    ),
  },
];

export default function TermsOfUse() {
  return (
    <LegalDocument
      kicker="Terms"
      title="Terms of use"
      lede="The agreement for using Allowance: the public site, the Android app and the operator console. Plain terms for a tool that can sign real payments."
      summary={[
        {
          label: 'A developer tool',
          text: 'For an operator paying from their own dedicated payer. No public sign-up, and no custody of anyone’s funds.',
        },
        {
          label: 'Application-enforced limits',
          text: 'Checked in code, not held in onchain escrow. Fund the payer with small amounts only.',
        },
        {
          label: 'Your deployment',
          text: 'You run the server, choose the providers and answer for every payment it signs.',
        },
      ]}
      sections={sections}
      sibling={{ to: '/privacy', label: 'Read the privacy policy' }}
    />
  );
}
