import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const help = `Assemble captured UI with an externally prepared voiceover, captions, and transcript.

  npx tsx scripts/assemble-product-tour.ts --capture test-results/product-tour/capture.json \\
    --audio /absolute/narration.mp3 --captions /absolute/captions.vtt \\
    --transcript /absolute/transcript.txt --out test-results/product-tour-final
    [--audio-offset 1] [--outro 1]

Requires ffmpeg and ffprobe. Outputs allowance-product-tour.mp4, .vtt, .txt,
allowance-product-tour-poster.jpg, and assembly.json. Never overwrites existing files.
`;
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--help') {
    process.stdout.write(help);
    process.exit(0);
  }
  if (
    ![
      '--capture',
      '--audio',
      '--captions',
      '--transcript',
      '--out',
      '--audio-offset',
      '--outro',
    ].includes(flag) ||
    !process.argv[i + 1]
  )
    throw new Error(`Unknown or incomplete option: ${flag}\n${help}`);
  options.set(flag, process.argv[++i]);
}
if (
  ['--capture', '--audio', '--captions', '--transcript', '--out'].some((flag) => !options.has(flag))
)
  throw new Error(help);
const audioOffset = Number(options.get('--audio-offset') ?? 0);
const outro = Number(options.get('--outro') ?? 0);
if ([audioOffset, outro].some((value) => !Number.isFinite(value) || value < 0 || value > 5))
  throw new Error('Audio offset and outro must each be between zero and five seconds.');
const capturePath = path.resolve(options.get('--capture')!);
const capture = JSON.parse(await fs.readFile(capturePath, 'utf8')) as {
  version: number;
  video: string;
  trimStartSeconds: number;
  contentDurationSeconds: number;
  paymentSubmitted: boolean;
  blockedRequests: unknown[];
  browserErrors: unknown[];
};
if (
  capture.version !== 1 ||
  capture.paymentSubmitted !== false ||
  !Array.isArray(capture.blockedRequests) ||
  capture.blockedRequests.length ||
  !Array.isArray(capture.browserErrors) ||
  capture.browserErrors.length ||
  typeof capture.video !== 'string' ||
  path.basename(capture.video) !== capture.video ||
  !Number.isFinite(capture.trimStartSeconds) ||
  capture.trimStartSeconds < 0 ||
  !Number.isFinite(capture.contentDurationSeconds) ||
  capture.contentDurationSeconds <= 0
)
  throw new Error('Use a successful, unmodified public tour capture manifest.');
const videoPath = path.join(path.dirname(capturePath), capture.video);
const audioPath = path.resolve(options.get('--audio')!);
const captionsPath = path.resolve(options.get('--captions')!);
const transcriptPath = path.resolve(options.get('--transcript')!);
function duration(filename: string, stream: 'a' | 'v') {
  const result = JSON.parse(
    execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-select_streams',
        stream,
        '-show_entries',
        'stream=codec_type:format=duration',
        '-of',
        'json',
        filename,
      ],
      { encoding: 'utf8' }
    )
  ) as { streams: unknown[]; format: { duration: string } };
  const seconds = Number(result.format.duration);
  if (!result.streams.length || !Number.isFinite(seconds) || seconds <= 0)
    throw new Error(`No valid ${stream === 'a' ? 'audio' : 'video'} stream in ${filename}.`);
  return seconds;
}
const voiceSeconds = duration(audioPath, 'a');
const videoSeconds = duration(videoPath, 'v');
const targetSeconds = audioOffset + voiceSeconds + outro;
if (Math.abs(targetSeconds - capture.contentDurationSeconds) > 2)
  throw new Error(
    'Voiceover and capture must be within two seconds. Adjust scene timing and record again.'
  );
if (videoSeconds < capture.trimStartSeconds + capture.contentDurationSeconds - 0.2)
  throw new Error('The captured video no longer matches its timing manifest.');
const captions = (await fs.readFile(captionsPath, 'utf8')).replace(/\r\n/g, '\n');
const transcript = await fs.readFile(transcriptPath, 'utf8');
const cues = [
  ...captions.matchAll(
    /^(\d{2}:)?(\d{2}):(\d{2}\.\d{3}) --> (\d{2}:)?(\d{2}):(\d{2}\.\d{3})(?: .*)?$/gm
  ),
];
if (!captions.startsWith('WEBVTT') || !cues.length || transcript.trim().length < 20)
  throw new Error('Supply a nonempty transcript and valid WEBVTT caption cues.');
let previousEnd = 0;
for (const cue of cues) {
  const start = Number((cue[1] || '0:').slice(0, -1)) * 3600 + Number(cue[2]) * 60 + Number(cue[3]);
  const end = Number((cue[4] || '0:').slice(0, -1)) * 3600 + Number(cue[5]) * 60 + Number(cue[6]);
  if (start < previousEnd || end <= start || end > targetSeconds + 0.2)
    throw new Error('Caption cues must be ordered, non-overlapping, and inside the final video.');
  previousEnd = end;
}
const output = path.resolve(options.get('--out')!);
await fs.mkdir(output, { recursive: true });
if ((await fs.readdir(output)).length) throw new Error('Assembly output directory must be empty.');
const outputVideo = path.join(output, 'allowance-product-tour.mp4');
// Arguments are passed directly, never through a shell. Source audio remains unchanged.
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-n',
    '-ss',
    String(capture.trimStartSeconds),
    '-i',
    videoPath,
    '-i',
    audioPath,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=2',
    '-af',
    `loudnorm=I=-16:TP=-1.5:LRA=11,adelay=${Math.round(audioOffset * 1000)}:all=1,apad`,
    '-t',
    String(targetSeconds),
    '-r',
    '30',
    '-c:v',
    'libx264',
    '-threads',
    '2',
    '-preset',
    'medium',
    '-crf',
    '18',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    outputVideo,
  ],
  { stdio: 'inherit' }
);
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-n',
    '-ss',
    '2',
    '-i',
    outputVideo,
    '-frames:v',
    '1',
    '-update',
    '1',
    '-q:v',
    '2',
    path.join(output, 'allowance-product-tour-poster.jpg'),
  ],
  { stdio: 'inherit' }
);
await fs.copyFile(captionsPath, path.join(output, 'allowance-product-tour.vtt'));
await fs.copyFile(transcriptPath, path.join(output, 'allowance-product-tour.txt'));
const hashes: Record<string, string> = {};
for (const file of [capturePath, videoPath, audioPath, captionsPath, transcriptPath, outputVideo])
  hashes[path.basename(file)] = createHash('sha256')
    .update(await fs.readFile(file))
    .digest('hex');
await fs.writeFile(
  path.join(output, 'assembly.json'),
  JSON.stringify(
    {
      version: 1,
      assembledAt: new Date().toISOString(),
      durationSeconds: duration(outputVideo, 'v'),
      sourceCaptureSeconds: capture.contentDurationSeconds,
      voiceSeconds,
      audioOffsetSeconds: audioOffset,
      outroSeconds: outro,
      finalFrameHoldSeconds: Math.max(0, targetSeconds - capture.contentDurationSeconds),
      paymentSubmitted: false,
      hashes,
    },
    null,
    2
  ) + '\n'
);
process.stdout.write(`Assembled product tour: ${outputVideo}\n`);
