// Sample videos for the dev harness, made with FFmpeg into dev/media (git-ignored):
//   sample.mp4  H.264 and AAC, which plays as it is (the "direct" way)
//   sample.mkv  HEVC with two sound tracks (English DTS-like AC-3 5.1, Hindi AAC) and
//               English subtitles, the way most of the provider's files are
//   sample.avi  DivX-style MPEG-4 with MP3 sound, which the helper converts
// Each is 3 minutes of a test picture with a clock, so jumps are easy to check.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const media = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dev", "media");
mkdirSync(media, { recursive: true });

function run(args) {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.error || result.status !== 0) {
    console.error("FFmpeg failed" + (result.error ? ": " + result.error.message : "") + ". Is it installed?");
    process.exit(1);
  }
}

const secs = 180;
const cues = [];
for (let t = 2; t < secs; t += 10) {
  const clock = (s) => "00:" + String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0") + ",000";
  cues.push(cues.length + 1 + "\n" + clock(t) + " --> " + clock(t + 4) + "\nThe file's own subtitle at " + Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0") + "\n");
}
const srt = path.join(media, "subs.srt");
writeFileSync(srt, cues.join("\n"));
const picture = ["-f", "lavfi", "-i", `testsrc=s=1280x720:r=24:d=${secs}`];
run([...picture, "-f", "lavfi", "-i", `sine=f=440:d=${secs}`, "-c:v", "libx264", "-preset", "veryfast", "-g", "48", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", path.join(media, "sample.mp4")]);
run([
  ...picture,
  "-f", "lavfi", "-i", `sine=f=330:d=${secs}`,
  "-f", "lavfi", "-i", `sine=f=660:d=${secs}`,
  "-i", srt,
  "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s",
  "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-g", "48",
  "-c:a:0", "ac3", "-ac:a:0", "6", "-c:a:1", "aac",
  "-c:s", "srt",
  "-metadata:s:a:0", "language=eng", "-metadata:s:a:1", "language=hin", "-metadata:s:s:0", "language=eng",
  path.join(media, "sample.mkv"),
]);
run(["-f", "lavfi", "-i", `testsrc=s=640x272:r=25:d=${secs}`, "-f", "lavfi", "-i", `sine=f=550:d=${secs}`, "-c:v", "mpeg4", "-vtag", "XVID", "-q:v", "5", "-c:a", "libmp3lame", "-b:a", "128k", path.join(media, "sample.avi")]);
console.log("Made sample.mp4, sample.mkv and sample.avi in dev/media.");
