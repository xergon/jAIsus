#!/usr/bin/env node
/**
 * Builds the hero emotion clips from the MiniMax H3 renders.
 *
 *   node scripts/build-emotion-clips.mjs [--force]
 *
 * Inputs (gitignored, local only):
 *   media-originals/manifest.json    clip id -> Higgsfield job ids ({in, out} or {full})
 *   media-originals/video-urls.json  job id -> result URL (copied from jobs_wait output)
 * Outputs:
 *   media-originals/videos/<id>-{in,out,full}-2k.mp4  downloaded 2K renders (originals)
 *   media-originals/videos/<id>-2k.mp4                joined 2K master, no audio
 *   public/emotions/<id>.mp4                          1080p H.264 for the app
 *
 * Keyframed clips (rest pose -> styleframe -> rest pose) come out ~13 s at
 * native speed; the app version plays 1.4x faster (~9.4 s, close to the
 * legacy 7.8 s clips) so a reaction doesn't hold the hero too long. Idle
 * clips keep native speed. Every output starts and ends on the rest pose.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';

const force = process.argv.includes('--force');
const manifest = JSON.parse(readFileSync('media-originals/manifest.json', 'utf8'));
const urls = JSON.parse(readFileSync('media-originals/video-urls.json', 'utf8'));
mkdirSync('media-originals/videos', { recursive: true });
mkdirSync('public/emotions', { recursive: true });

const KEYFRAMED_SPEED = 1.4;
const ff = (...args) =>
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '4', ...args], { stdio: 'inherit' });

// Skip a step only when its output exists AND ffprobe reads every packet
// cleanly — a truncated / moov-less file left by an older or killed run gets
// rebuilt. (-count_packets walks the whole file: with +faststart the moov is
// up front, so a cut-off file still reports its full duration.)
function done(path) {
  if (force || !existsSync(path)) return false;
  const r = spawnSync('ffprobe', ['-v', 'error', '-count_packets', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
    { encoding: 'utf8' });
  return r.status === 0 && !r.stderr.trim() && Number(r.stdout) > 0;
}

// Every step writes to a temp file and renames only on success, so an
// interrupted run (Ctrl-C, sleep, network drop, failed render) never leaves a
// broken file at the final path. Temps keep the .mp4 extension so ffmpeg can
// infer the format, and live in media-originals/ (gitignored, same volume) so a
// leftover never lands in public/.
function encode(out, tmp, ...args) {
  ff(...args, tmp);
  renameSync(tmp, out);
}

function download(jobId, path) {
  if (done(path)) return true;
  const url = urls[jobId];
  if (!url) return false;
  const tmp = `${path}.part`;
  execFileSync('curl', ['-sfL', '--remove-on-error', '-o', tmp, url]);
  renameSync(tmp, path);
  return true;
}

const built = [];
const missing = [];
for (const [id, parts] of Object.entries(manifest.videos)) {
  const halves = parts.full ? ['full'] : ['in', 'out'];
  const files = halves.map(h => `media-originals/videos/${id}-${h}-2k.mp4`);
  if (!halves.every((h, i) => download(parts[h], files[i]))) {
    missing.push(id);
    continue;
  }
  const master = `media-originals/videos/${id}-2k.mp4`;
  if (!done(master)) {
    const tmp = `media-originals/videos/${id}-2k.partial.mp4`;
    if (files.length === 1) {
      encode(master, tmp, '-i', files[0], '-an', '-c:v', 'copy', '-movflags', '+faststart');
    } else {
      encode(master, tmp, '-i', files[0], '-i', files[1],
        '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
    }
  }
  const out = `public/emotions/${id}.mp4`;
  if (!done(out)) {
    const speed = parts.full ? 1 : KEYFRAMED_SPEED;
    encode(out, `media-originals/videos/${id}-1080.partial.mp4`, '-i', master,
      '-vf', `setpts=PTS/${speed},scale=1080:1920:flags=lanczos,fps=24`,
      '-an', '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-level', '4.0',
      '-crf', '22', '-maxrate', '3M', '-bufsize', '6M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  }
  built.push(id);
}
console.log(`built ${built.length}: ${built.join(', ')}`);
if (missing.length) console.log(`waiting for renders: ${missing.join(', ')}`);
