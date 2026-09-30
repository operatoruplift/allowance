# Producing the product tour

The tour records actual interactions in the public workspace and policy lab. It does not record operator credentials, submit payments, or represent controlled outcomes as chain evidence. A persistent **Workspace tour · No funds moved** caption stays visible throughout the recording.

The recorder uses a fresh Playwright browser without cookies or saved sessions. It blocks service workers, external requests, API/merchant/tool requests, fetch/XHR, WebSockets, and mutations. A blocked request or browser exception fails the capture. Never use it against an authenticated private operator session. A separately authorized, funded mainnet recording requires a different, deliberately scoped procedure.

## Prepare a production build

Use the current public static artifact. Start its server in a separate terminal:

```sh
npm run build:rehearsal
npx vite preview --outDir .vercel/output/static --host 127.0.0.1 --port 4328 --strictPort
```

The machine needs the project's Playwright Chromium installation, `ffmpeg`, and `ffprobe`. The scripts make no paid media API calls and do not read `.env` files. Record only after the workspace navigation changes have built successfully.

## Match the narration

Prepare the voiceover, transcript, and WebVTT captions separately. Use concise, conversational sentences with room for the interface to respond. Listen to the complete voiceover before publishing; avoid promising a human performance for generated speech. Do not use operating-system speech synthesis as the final narration.

Supply scene lengths in seconds as a JSON file. Defaults align to the current 51.040-second narration with a one-second lead-in and outro (53.040 seconds total):

```json
{
  "overview": 11.2,
  "policy": 9.5,
  "cap": 4.8,
  "permissions": 3,
  "workspace": 4.3,
  "save": 4.7,
  "setup": 8.6,
  "closing": 6.94
}
```

| Scene       | Actual action                                                                  |
| ----------- | ------------------------------------------------------------------------------ |
| overview    | Show the workspace and its navigation, including the mainnet setup state.      |
| policy      | Follow the Policy lab link and show the initial 0.030000 planned cost.         |
| cap         | Lower the per-request cap to 0.010000; watch both explanations become blocked. |
| permissions | Reset and disable Transaction explanation; show the resulting plan.            |
| workspace   | Navigate between Runs, Payments, and Setup.                                    |
| save        | Reopen the policy lab and download the real policy-plan JSON.                  |
| setup       | Show the actual persistent-backend and payment-readiness requirements.         |
| closing     | Return to the workspace and point to Setup.                                    |

Every scene is paced to its supplied length. If navigation or interaction takes longer, capture fails rather than silently shifting the narration. Increase that scene's timing and revise the voiceover alignment. Match the sum of the timings to the measured audio duration. A visible cursor follows actual browser mouse movement; no fake payment labels or staged receipt data are added.

## Record and assemble

Output directories must be empty so previous reviewed media cannot be overwritten accidentally.

```sh
npx tsx scripts/record-product-tour.ts \
  --url http://127.0.0.1:4328 \
  --out test-results/product-tour-capture \
  --timing /absolute/path/scene-seconds.json

npx tsx scripts/assemble-product-tour.ts \
  --capture test-results/product-tour-capture/capture.json \
  --audio /absolute/path/narration.mp3 \
  --captions /absolute/path/captions.vtt \
  --transcript /absolute/path/transcript.txt \
  --out test-results/product-tour-final \
  --audio-offset 1 --outro 1
```

Omit `--timing` for default lengths; add `--headed` to inspect the recording browser. To leave one second before the voice and one after it, pass `--audio-offset 1 --outro 1` to the assembler and include those two seconds in the capture timing total. Caption timestamps must already include the audio offset. Neither option changes speech speed. `--help` documents each command. The capture writes its raw 1920×1080 WebM, a genuine downloaded policy plan, and a manifest with scene markers, timings, request/error evidence, and `paymentSubmitted: false`. A failed attempt writes `capture-failed.json` and must not be assembled or published.

The assembler validates the source, audio, and caption timing, trims initial page loading, normalizes narration loudness, and produces a 1080p H.264/AAC MP4 ready for streaming, a JPEG poster, WebVTT captions, a transcript, and an assembly manifest with SHA-256 hashes. It retains the original narration unchanged. It permits at most a two-second mismatch, using only a final-frame hold or trim; a larger mismatch requires a new capture. Caption cues must be chronological and remain inside the voiceover.

## Review before publication

Watch the complete encoded video with sound, then with captions and sound off. Confirm correct pronunciation, natural pacing, readable amounts, accurate scene alignment, unobstructed controls, and the visible no-payment boundary. Check seeking, playback, captions, transcript/download links, and the poster on desktop and phone. Keep playback user-initiated and verify the player fits the page without horizontal overflow.

Copy reviewed media into `public/media/` only after this inspection. These scripts do not copy or deploy automatically. Preserve the dated capture/assembly manifests outside the public media folder and link the fresh recording in the product documentation. A new real mainnet payment recording must show genuine receipt IDs, network-correct signatures, and confirmed onchain evidence; this public tour is not that evidence.
