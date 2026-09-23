# Landing motion release — September 23, 2026

The landing page now tells a three-part story: choose a spending boundary, request useful tools, and keep the record. On desktop, a stationary visual changes with the adjacent chapters. Small screens present the complete illustrative receipt above a compact reading sequence. The existing example, developer guide and downloadable brand kit remain available throughout.

## Motion direction

- Gentle hero entrances, layered cloud and mountain movement, and staggered section reveals establish a continuous rhythm.
- “Follow the allowance” is an ordinary fragment link, with smooth browser scrolling. Direct fragment URLs also work after React mounts.
- Native wheel, touch and keyboard scrolling remain in control. There is no scroll locking, scroll snapping, replacement scrollbar or artificial scroll-distance multiplier.
- Decorative movement uses a single scheduled animation frame, passive listeners and stable section measurements. No React render is triggered by scrolling.
- Reveals run once and preserve readable content when returning to a section. Keyboard focus reveals a section immediately.
- User preference, OS reduced motion and data saving disable decorative motion. The complete story stays visible; example state updates continue normally.
- Existing films retain their local posters and visibility-based playback behavior. The new artwork reuses Allowance's original Open Sky plate.

The premium [MotionSites Cinematic Landing Page](https://motionsites.ai/?prompt=cinematic-landing-page) was accessible through the user's account and informed the pacing, layered scenes and editorial reveals. Allowance keeps its own A mark, typography, color system, artwork and product content. No third-party template media, tracking, fonts, libraries or runtime requests were added. Browser API behavior was checked against [MDN's Intersection Observer documentation](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API) and [scroll animation accessibility guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Scroll-driven_animations/Timelines).

## Implementation and verification

`src/useLandingMotion.ts` owns observer/listener/frame cleanup. `src/LandingStory.tsx` contains the semantic chapters and an aria-hidden illustrative visual. `src/landing-motion.css` scopes the presentation to the landing page. The payment amounts in this visual are clearly labeled as a rehearsal and are not transaction evidence.

`tests/browser/landing-motion.spec.ts` exercises native wheel and keyboard scrolling, the fragment link, all three desktop scenes, working example navigation, preference changes and persistence, phone/tablet widths, direct fragment loading, route transitions and browser history. It runs in both the application and hosted suites. The final release record and captured screenshots are stored under `evidence/scroll-motion-2026-09-23/`.

The public Vercel site remains the no-spend rehearsal. A real operator/model/payment run requires the persistent backend, dedicated accounts and credentials described in [live setup](live-setup.md). These UI changes neither enable signing nor constitute verified onchain payment evidence.
