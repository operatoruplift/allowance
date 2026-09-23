import { useEffect, useRef } from 'react';
import { useMotion } from './motion';

const clamp = (value: number) => Math.max(0, Math.min(1, value));

/** Decorative motion follows native scrolling; it never controls the scroll position. */
export function useLandingMotion() {
  const ref = useRef<HTMLElement>(null);
  const { reduced } = useMotion();

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const reveals = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
    const scenes = [...root.querySelectorAll<HTMLElement>('[data-scroll-scene]')];
    const steps = [...root.querySelectorAll<HTMLElement>('[data-story-step]')];
    const stage = root.querySelector<HTMLElement>('.allowance-story-stage');
    if (reduced) {
      reveals.forEach((element) => (element.dataset.revealed = 'true'));
      if (stage) stage.dataset.activeStep = '2';
      return;
    }

    let frame = 0;
    let disposed = false;
    const update = () => {
      frame = 0;
      if (disposed || document.hidden) return;
      const height = window.innerHeight;
      const small = window.innerWidth <= 850;
      // Read stable layout boxes together before writing decorative styles.
      const boxes = scenes.map((element) => ({ element, box: element.getBoundingClientRect() }));
      const stepTops = steps.map((element) => element.getBoundingClientRect().top);
      const progress = clamp(
        window.scrollY / Math.max(1, document.documentElement.scrollHeight - height)
      );
      root.style.setProperty('--page-progress', String(progress));
      for (const { element, box } of boxes) {
        if (box.bottom < -height || box.top > height * 2) continue;
        const progress = clamp((height - box.top) / (height + box.height));
        element.style.setProperty(
          '--scene-y',
          `${((progress - 0.5) * (small ? 18 : 56)).toFixed(2)}px`
        );
      }
      let active = 0;
      stepTops.forEach((top, index) => {
        if (top <= height * 0.58) active = index;
      });
      if (stage) stage.dataset.activeStep = String(small ? 2 : active);
      steps.forEach((element, index) => (element.dataset.active = String(index === active)));
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(update);
    };
    const reveal = (element: HTMLElement) => {
      element.dataset.revealed = 'true';
    };
    const observer =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              entries.forEach((entry) => {
                if (entry.isIntersecting) {
                  reveal(entry.target as HTMLElement);
                  observer?.unobserve(entry.target);
                }
              });
            },
            { rootMargin: '0px 0px -24px 0px', threshold: 0.05 }
          );
    reveals.forEach((element) => {
      // Never hide content already reached, including a restored scroll position.
      element.dataset.revealed = String(
        !observer || element.getBoundingClientRect().top < window.innerHeight
      );
      if (element.dataset.revealed !== 'true') observer?.observe(element);
    });
    const onFocus = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      let element = event.target.closest<HTMLElement>('[data-reveal]');
      while (element && root.contains(element)) {
        reveal(element);
        element = element.parentElement?.closest<HTMLElement>('[data-reveal]') ?? null;
      }
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(root);
    root.addEventListener('focusin', onFocus);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('visibilitychange', schedule);
    void document.fonts.ready.then(schedule);
    schedule();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      resizeObserver?.disconnect();
      root.removeEventListener('focusin', onFocus);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      root.style.removeProperty('--page-progress');
      scenes.forEach((element) => element.style.removeProperty('--scene-y'));
      reveals.forEach((element) => delete element.dataset.revealed);
      steps.forEach((element) => delete element.dataset.active);
    };
  }, [reduced]);

  return { ref, reduced };
}
