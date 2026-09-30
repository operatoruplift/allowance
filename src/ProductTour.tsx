import { useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Captions, Film, Play } from 'lucide-react';
import { Link } from 'react-router-dom';
import { productTour } from './product-tour';
import './product-tour.css';

const timestamp = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

export default function ProductTour() {
  const video = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const active = Math.max(
    0,
    productTour.chapters.filter((chapter) => time >= chapter.at).length - 1
  );

  function playbackFailed() {
    setFailed(true);
    setMessage(
      'The video could not load. You can still read the transcript or open the policy lab.'
    );
  }

  async function jump(at: number) {
    if (!video.current || !loaded) return;
    setMessage('');
    try {
      video.current.currentTime = at;
      await video.current.play();
    } catch {
      setMessage('Press play in the video to continue from this chapter.');
    }
  }

  return (
    <section className="product-tour" id="product-tour" aria-labelledby="product-tour-title">
      <div className="tour-heading">
        <div>
          <div className="eyebrow">
            <Film size={14} /> A closer look
          </div>
          <h2 id="product-tour-title">A budget. A boundary. A clear record.</h2>
          <p>Take a short tour, then put the controls through their paces.</p>
        </div>
        <span className="tour-duration">
          <Captions size={15} /> {timestamp(productTour.duration)} · With captions
        </span>
      </div>
      <div className="tour-stage">
        <div className="tour-screen">
          <video
            ref={video}
            controls
            playsInline
            preload="metadata"
            poster={productTour.poster}
            aria-label="Allowance product tour"
            onLoadedMetadata={() => setLoaded(true)}
            onTimeUpdate={() => setTime(video.current?.currentTime ?? 0)}
            onError={playbackFailed}
          >
            <source src={productTour.video} type="video/mp4" onError={playbackFailed} />
            <track
              kind="captions"
              src={productTour.captions}
              srcLang="en"
              label="English"
              default
            />
            Your browser cannot play this video. Read the transcript below.
          </video>
          <div className="tour-screen-note">
            <span /> Product walkthrough · No funds moved
          </div>
        </div>
        <nav className="tour-chapters" aria-label="Product tour chapters">
          <span className="eyebrow">Inside the tour</span>
          {productTour.chapters.map((chapter, index) => (
            <button
              key={chapter.title}
              type="button"
              className={active === index ? 'tour-chapter active' : 'tour-chapter'}
              aria-current={active === index ? 'step' : undefined}
              aria-label={`Play chapter ${index + 1}: ${chapter.title}`}
              disabled={!loaded || failed}
              onClick={() => void jump(chapter.at)}
            >
              <span className="tour-chapter-number">{String(index + 1).padStart(2, '0')}</span>
              <span>
                <b>{chapter.title}</b>
                <small>{timestamp(chapter.at)}</small>
              </span>
              <Play size={13} aria-hidden="true" />
            </button>
          ))}
          <Link className="text-link" to="/lab">
            Try the controls <ArrowUpRight size={15} />
          </Link>
        </nav>
      </div>
      <p className="tour-feedback" role="status">
        {message}
      </p>
      <div className="tour-downloads">
        <span>Keep the walkthrough handy.</span>
        <a href={productTour.video} download="allowance-product-tour.mp4">
          <ArrowDownToLine size={15} /> Save video
        </a>
        <a href={productTour.transcript} download="allowance-product-tour.txt">
          Read transcript
        </a>
        <a href={productTour.captions} download="allowance-product-tour.vtt">
          Download captions
        </a>
      </div>
    </section>
  );
}
