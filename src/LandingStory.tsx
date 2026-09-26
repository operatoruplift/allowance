import { ArrowUpRight, Check, ReceiptText, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LandingStory() {
  return (
    <section
      className="allowance-story page-width"
      id="allowance-story"
      aria-labelledby="allowance-story-title"
      data-scroll-scene
    >
      <div className="story-heading" data-reveal>
        <div className="eyebrow">A little independence. A clear limit.</div>
        <h2 id="allowance-story-title">
          Room to act.
          <br />
          <span>Reasons to trust.</span>
        </h2>
        <p>Set a boundary. Plan useful work. See how the policy responds before any funds move.</p>
      </div>
      <div className="story-layout">
        <div className="story-visual-column">
          <div className="allowance-story-stage" data-active-step="0" aria-hidden="true">
            <img
              className="story-landscape"
              src="/brand/art/sky.jpg"
              width="1672"
              height="941"
              alt=""
              loading="lazy"
            />
            <div className="story-stage-shade" />
            <div className="story-stage-top">
              <img src="/allowance-a.svg?v=3" alt="" width="26" height="26" />
              <span>THE POLICY, IN MOTION</span>
            </div>
            <div className="story-orbit orbit-one" />
            <div className="story-orbit orbit-two" />
            <div className="story-budget">
              <span className="story-budget-label">
                <ShieldCheck size={15} /> Allowance limit
              </span>
              <strong>
                0.040000 <small>USDC</small>
              </strong>
              <div className="story-budget-track">
                <i />
                <i />
              </div>
              <span className="story-budget-caption">Your ceiling. Every request checked.</span>
            </div>
            <div className="story-purchase purchase-snapshot">
              <Check size={15} />
              <span>
                Wallet snapshot <small>Within limit</small>
              </span>
              <b>0.010000</b>
            </div>
            <div className="story-purchase purchase-explanation">
              <Check size={15} />
              <span>
                Transaction explanation <small>Within limit</small>
              </span>
              <b>0.020000</b>
            </div>
            <div className="story-receipt">
              <div>
                <ReceiptText size={18} />
                <b>Policy outcome</b>
              </div>
              <span>
                Planned tool costs <b>0.030000</b>
              </span>
              <span>
                Allowance left <b>0.010000</b>
              </span>
              <span className="story-denied">
                <X size={13} /> One more request <b>Blocked</b>
              </span>
            </div>
            <div className="story-stage-foot">
              <span>POLICY PLAN · NO FUNDS MOVED</span>
              <span className="story-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
        </div>
        <div className="story-chapters">
          <article data-story-step="0" data-reveal>
            <span className="story-chapter-number">01 / THE BOUNDARY</span>
            <h3>
              You decide
              <br />
              what’s enough.
            </h3>
            <p>
              A total allowance. A limit for each request. A short list of permitted tools. The
              agent starts with a clear definition of what it can do.
            </p>
            <span className="story-chapter-note">
              <ShieldCheck size={15} /> The policy checks before signing.
            </span>
          </article>
          <article data-story-step="1" data-reveal>
            <span className="story-chapter-number">02 / THE USEFUL WORK</span>
            <h3>
              Small purchases.
              <br />A fuller picture.
            </h3>
            <p>
              A wallet snapshot finds the activity. A transaction explanation adds context. The
              agent can request the tools it needs, inside your boundary.
            </p>
            <span className="story-chapter-note">
              <Check size={15} /> Two tools. Visible prices.
            </span>
          </article>
          <article data-story-step="2" data-reveal>
            <span className="story-chapter-number">03 / THE DECISION</span>
            <h3>
              A clear plan.
              <br />A visible boundary.
            </h3>
            <p>
              Compare proposed costs with the allowance left. A request above your limit is blocked
              before signing, so useful work always starts with a clear decision.
            </p>
            <Link to="/lab" className="text-link">
              Explore the policy lab <ArrowUpRight size={17} />
            </Link>
          </article>
        </div>
      </div>
    </section>
  );
}
