# Allowance launch film

The landing page includes the supplied 30-second brand film under **Watch launch film**. It sits after the interactive allowance story and links separately to the recorded app walkthrough at `/demo#product-tour`.

The film uses the approved curved A mark and shows a policy plan: a 0.040000 USDC allowance, 0.030000 in planned tool costs, and an additional request blocked before signing. Its receipt is explicitly labeled **Policy outcome** and **Policy plan · No funds moved**. This is brand storytelling; actual settlement evidence remains in connected workspace receipts.

## Supplied delivery and published copies

The delivery project is `allowance-showreel/out/deliver`. Its master, web delivery, and cover were kept unchanged. The site uses the supplied web delivery byte for byte, including its original music and sound effects. No voice or other audio was generated or substituted.

| Supplied file                   | Published file                                  | SHA-256                                                            |
| ------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| `allowance-showreel-master.mp4` | Not copied into the site                        | `7c2e83519a5a7439562432ec215e56b8f12d1e04c005e77abf0ef8cdec931ef6` |
| `allowance-showreel-web.mp4`    | `public/media/allowance-launch-film.mp4`        | `ed934c2d40235a40abfe2135d532081ce73d1a0173b0c74bd16217d83ac9ef64` |
| `allowance-showreel-cover.jpg`  | `public/media/allowance-launch-film-poster.jpg` | `8a61fab658fe876c5c92b2aea88c35428cc96d85da6bd73c96035305e65c1814` |

Web delivery: 9,384,026 bytes; 30.000 seconds; H.264, 1920 × 1080, 60 frames per second; stereo AAC at 48 kHz. Its MP4 metadata precedes the media payload, so playback supports progressive loading. The 18,099,480-byte master remains in the supplied delivery folder.

The delivery project's README credits Tatamusic's **Stylish Fashion Show Music** from Pixabay and describes a music/SFX soundtrack. This attribution comes from the supplied project documentation. The integration does not add narration or claim that the footage verifies a payment.

## Playback and access

- The film waits for an explicit Play action, with `preload="none"` and native playback controls. It does not autoplay or change the existing decorative film preferences.
- The supplied cover stays visible before playback. The layout reserves its dimensions to prevent a page jump.
- **Read the visual story** provides an accurate text alternative for the on-screen scenes. There was no speech transcript or caption file in the delivery folder; no speech captions were invented.
- A readable failure message, the text alternative, and the actual app walkthrough remain available if media cannot load.
- **Save film** downloads the original web delivery.

Browser coverage is in `tests/browser/launch-film.spec.ts`: no initial MP4 fetch, user-initiated playback and metadata, exact download hash, phone layout, and failure recovery. The supplied footage was inspected using a contact sheet and full-resolution policy-outcome frames; this review found no claimed verified transaction or transaction signature.
