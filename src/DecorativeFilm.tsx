import { useEffect, useRef, useState } from 'react';
import { useMotion } from './motion';

export default function DecorativeFilm({
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
  const { reduced } = useMotion();
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let visible = false;
    let active = true;
    const synchronize = () => {
      if (active && visible && !document.hidden && !reduced && !failed) {
        void video.play().catch(() => undefined);
      } else video.pause();
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      synchronize();
    });
    observer.observe(video);
    document.addEventListener('visibilitychange', synchronize);
    video.addEventListener('canplay', synchronize);
    synchronize();
    return () => {
      active = false;
      observer.disconnect();
      document.removeEventListener('visibilitychange', synchronize);
      video.removeEventListener('canplay', synchronize);
      video.pause();
    };
  }, [reduced, failed]);

  return (
    <div
      className={`decorative-film ${className ?? ''}`}
      data-film={label}
      data-film-state={
        failed ? 'unavailable' : reduced ? 'poster' : playing ? 'playing' : 'loading'
      }
    >
      <img className="decorative-film-poster" src={poster} alt="" aria-hidden="true" />
      <video
        ref={videoRef}
        className="decorative-film-video"
        src={reduced ? undefined : src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay={!reduced}
        preload={reduced ? 'none' : 'metadata'}
        aria-label={label}
        onPlaying={() => setPlaying(true)}
        onError={() => setFailed(true)}
      />
      <div className="film-scrim" aria-hidden="true" />
    </div>
  );
}
