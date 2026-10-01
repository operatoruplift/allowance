import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, Film, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import './launch-film.css';

export default function LaunchFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const unavailable = useRef(false);
  const [started, setStarted] = useState(false);
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  function playbackFailed() {
    unavailable.current = true;
    setFailed(true);
    setMessage(
      'The launch film could not load. Read the visual story below or open the app walkthrough.'
    );
  }
  async function play() {
    const player = video.current;
    if (!player || failed) return;
    setMessage('');
    try {
      await player.play();
    } catch {
      if (!unavailable.current && !player.error)
        setMessage('Press play in the video controls to start the film.');
    }
  }
  return (
    <section
      className="launch-film page-width"
      id="launch-film"
      aria-labelledby="launch-film-title"
    >
      <div className="launch-film-heading">
        <div>
          <div className="eyebrow">
            <Film size={14} aria-hidden="true" />
            The launch film / 00:30
          </div>
          <h2 id="launch-film-title">
            A little independence.
            <br />
            <span>A clear limit.</span>
          </h2>
        </div>
        <p id="launch-film-context">
          A short brand story about useful agents and the boundaries you set. Planning scenes. No
          funds moved.
        </p>
      </div>
      <div className="launch-film-screen">
        <video
          ref={video}
          controls
          playsInline
          preload="none"
          poster="/media/allowance-launch-film-poster.jpg"
          aria-label="Allowance launch film"
          aria-describedby="launch-film-context"
          onPlay={() => {
            setStarted(true);
            setMessage('');
          }}
          onError={playbackFailed}
        >
          <source
            src="/media/allowance-launch-film.mp4"
            type="video/mp4"
            onError={playbackFailed}
          />
          Your browser cannot play this film. Read the visual story below.
        </video>
        {!started && !failed && (
          <button type="button" className="launch-film-play" onClick={() => void play()}>
            <span>
              <Play size={18} fill="currentColor" aria-hidden="true" />
            </span>
            Play launch film
          </button>
        )}
      </div>
      <p className="launch-film-status" role="status">
        {message}
      </p>
      <div className="launch-film-footer">
        <div>
          <b>Behind the idea.</b>
          <span>Budgets, useful work, and the decisions in between.</span>
        </div>
        <a href="/media/allowance-launch-film.mp4" download="allowance-launch-film.mp4">
          <ArrowDownToLine size={15} aria-hidden="true" />
          Save film
        </a>
        <Link to="/demo#product-tour">
          Open the app walkthrough <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <details className="launch-film-story">
        <summary>Read the visual story</summary>
        <p>This description follows the on-screen scenes in the supplied launch film.</p>
        <ol>
          <li>
            <b>A little independence.</b> The red Allowance A takes shape, followed by “Give your
            agent a budget.”
          </li>
          <li>
            <b>You decide what’s enough.</b> A policy card sets a 0.040000 USDC allowance, a
            0.020000 per-request cap, daily capacity, and permitted tools.
          </li>
          <li>
            <b>Small purchases. A fuller picture.</b> A wallet snapshot and a transaction
            explanation bring planned tool costs to 0.030000 USDC, leaving 0.010000.
          </li>
          <li>
            <b>Blocked before signing.</b> Another 0.020000 request exceeds the remaining allowance.
            The policy outcome keeps the permitted requests and the blocked decision together,
            marked “No funds moved.”
          </li>
          <li>
            <b>Find the right amount of freedom.</b> A sculptural red A stands above the water. The
            film closes with the Allowance identity and an invitation to explore the policy lab.
          </li>
        </ol>
      </details>
    </section>
  );
}
