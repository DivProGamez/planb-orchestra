// Edits the recorded PlanB Orchestra session into the final demo video.
//  1. frames (variable rate, real timestamps) → constant 30 fps master (no retiming of any action)
//  2. the supplied narration "A2 Voice-over.mp3" → six scene files; the one factual fix (the audit
//     ran 500 sequences, not 300) removes the phrase "three hundred random shock sequences," only
//  3. the app's own interface cues (same parameters as src/sound.js) at the moments the app played them
//  4. mix + loudness normalisation; restrained zooms; burned captions; end card; two MP4 variants
// Usage: node release/video/tools/produce.mjs
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const video = path.resolve(here, '..');
const work = path.join(video, 'work');
const audio = path.join(video, 'audio');
const raw = path.join(video, 'raw');
for (const d of [audio, raw]) mkdirSync(d, { recursive: true });
const MP3 = path.resolve(video, '../../../A2 Voice-over.mp3');
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
const frames = JSON.parse(readFileSync(path.join(work, 'frames.json'), 'utf8'));
const { events } = JSON.parse(readFileSync(path.join(work, 'events.json'), 'utf8'));
const ev = (type, k = 0) => events.filter((e) => e.type === type)[k];
const END = 166.0; // video length (s)

/* ---------- 1. constant-frame-rate master from the real frame timestamps ---------- */
const master = path.join(raw, 'PlanB_Orchestra_Raw_Screen_Recording_2880x1620_master.mp4');
if (!existsSync(master)) {
  const lines = [];
  frames.forEach((f, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].t : END;
    lines.push(`file 'frames/${f.name}'`, `duration ${Math.max(0.001, next - f.t).toFixed(6)}`);
  });
  lines.push(`file 'frames/${frames.at(-1).name}'`);
  writeFileSync(path.join(work, 'frames.txt'), lines.join('\n'));
  ff(['-f', 'concat', '-safe', '0', '-i', path.join(work, 'frames.txt'), '-vf', 'fps=30,format=yuv420p', '-t', String(END),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '12', '-movflags', '+faststart', master]);
}
// backup of the unedited screen recording (1080p, no zoom/captions/audio)
const rawOut = path.join(raw, 'PlanB_Orchestra_Raw_Screen_Recording_1080p.mp4');
if (!existsSync(rawOut)) ff(['-i', master, '-vf', 'scale=1920:1080:flags=lanczos', '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-an', '-movflags', '+faststart', rawOut]);

/* ---------- 2. narration: six scene files cut at the pauses of the supplied MP3 ---------- */
// [file, start, end] in the MP3 (cut points sit inside measured silences)
const SCENES = [
  ['voice_01_intro', 0.0, 3.75],
  ['voice_02_plan', 3.75, 13.19],
  ['voice_03_disruption', 13.19, 22.25],
  ['voice_04_repair', 22.25, 30.27],
  ['voice_05_memory', 30.27, 36.22],
  ['voice_06_closing', 36.22, 51.792],
];
for (const [name, a, b] of SCENES) {
  const outWav = path.join(audio, `${name}.wav`);
  if (name === 'voice_06_closing') {
    // factual correction: drop "three hundred random shock sequences," (43.60–45.75 s, silence to silence)
    ff(['-i', MP3, '-filter_complex',
      `[0:a]atrim=${a}:43.60,asetpts=PTS-STARTPTS[x];[0:a]atrim=45.75:${b},asetpts=PTS-STARTPTS[y];[x][y]concat=n=2:v=0:a=1,aresample=48000[o]`,
      '-map', '[o]', '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
  } else {
    ff(['-i', MP3, '-af', `atrim=${a}:${b},asetpts=PTS-STARTPTS,aresample=48000`, '-ac', '1', '-c:a', 'pcm_s16le', outWav]);
  }
}
// where each scene's narration starts in the video (s), aligned to recorded events
const PLACE = {
  voice_01_intro: 1.0,
  voice_02_plan: 16.8,
  voice_03_disruption: +(ev('review-shown').t - 4.31 + 0.25).toFixed(2), // "PlanB first shows…" as Review appears
  voice_04_repair: +(ev('compare-select').t + 2.6).toFixed(2), // reasons visible, cursor on them
  voice_05_memory: +(ev('confirm-2').t + 0.5).toFixed(2), // "…survives a reload" over the reload
  voice_06_closing: +(ev('review-3').t - 0.1).toFixed(2), // "when no plan exists" over the $30 result
};

/* ---------- 3. interface cues: the app's own sound design (src/sound.js) ---------- */
const CUES = {
  open: [[0, 520, 780, 0.12, 0.32, 'sine'], [0.05, 1040, 1180, 0.1, 0.18, 'sine']],
  success: [[0, 660, 660, 0.09, 0.36, 'triangle'], [0.08, 880, 880, 0.09, 0.36, 'triangle'], [0.16, 1320, 1320, 0.16, 0.32, 'sine']],
  error: [[0, 330, 300, 0.14, 0.42, 'triangle'], [0.15, 300, 270, 0.16, 0.36, 'triangle']],
};
const SR = 48000;
const cueBuf = new Float32Array(Math.ceil(END * SR));
const wave = (type, ph) => (type === 'sine' ? Math.sin(2 * Math.PI * ph) : 2 * Math.abs(2 * (ph - Math.floor(ph + 0.5))) - 1);
for (const e of events.filter((x) => x.type === 'sound')) {
  for (const [st, f0, f1, dur, gain, type] of CUES[e.cue]) {
    const start = Math.round((e.t + st) * SR);
    let ph = 0;
    for (let i = 0; i < dur * SR; i += 1) {
      const k = i / (dur * SR);
      const f = f0 * (f1 / f0) ** k;
      ph += f / SR;
      const attack = Math.min(1, i / (0.006 * SR));
      const env = attack * Math.exp(-6.5 * k); // fast attack, exponential decay as in the app
      if (start + i < cueBuf.length) cueBuf[start + i] += wave(type, ph) * gain * env * 0.4; // app master volume 40 %
    }
  }
}
// one-pole low-pass ~4.2 kHz like the app's filter, then write 16-bit WAV
const a1 = Math.exp((-2 * Math.PI * 4200) / SR);
let yPrev = 0;
const pcm = Buffer.alloc(cueBuf.length * 2);
for (let i = 0; i < cueBuf.length; i += 1) { yPrev = (1 - a1) * cueBuf[i] + a1 * yPrev; pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(yPrev * 32767))), i * 2); }
const hdr = Buffer.alloc(44);
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + pcm.length, 4); hdr.write('WAVE', 8); hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16);
hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34);
hdr.write('data', 36); hdr.writeUInt32LE(pcm.length, 40);
writeFileSync(path.join(audio, 'ui_cues.wav'), Buffer.concat([hdr, pcm]));

/* ---------- 4. mix: narration placed per scene + cues 18 dB under; loudness −16 LUFS ---------- */
const mix = path.join(audio, 'PlanB_Orchestra_Final_Mix.wav');
{
  const inputs = [];
  const parts = [];
  SCENES.forEach(([name], i) => {
    inputs.push('-i', path.join(audio, `${name}.wav`));
    const ms = Math.round(PLACE[name] * 1000);
    parts.push(`[${i}:a]adelay=${ms}:all=1,apad=whole_dur=${END}[v${i}]`);
  });
  inputs.push('-i', path.join(audio, 'ui_cues.wav'));
  parts.push(`[6:a]volume=-18dB,apad=whole_dur=${END}[c]`);
  const graph = `${parts.join(';')};[v0][v1][v2][v3][v4][v5][c]amix=inputs=7:normalize=0:duration=longest,atrim=0:${END},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,pan=stereo|c0=c0|c1=c0[o]`;
  ff([...inputs, '-filter_complex', graph, '-map', '[o]', '-c:a', 'pcm_s16le', mix]);
}

/* ---------- 5. captions (exact narration text, corrected line 6) timed to the placed audio ---------- */
// [scene, start-in-file, end-in-file, text]  (file times = MP3 time − scene start; line 6 after the cut)
const CAP = [
  ['voice_01_intro', 0.0, 1.33, "Plans don't fail at planning."],
  ['voice_01_intro', 1.88, 3.41, 'They fail at the first surprise.'],
  ['voice_02_plan', 0.34, 5.0, 'PlanB schedules a real dinner: owners, dependencies, equipment, a budget —'],
  ['voice_02_plan', 5.61, 9.02, 'checked by a constraint engine, and re-checked by an independent validator.'],
  ['voice_03_disruption', 0.41, 3.97, 'Now the surprise: guests an hour early, and no oven.'],
  ['voice_03_disruption', 4.72, 6.57, 'PlanB first shows what it understood —'],
  ['voice_03_disruption', 7.13, 8.72, 'nothing moves until you confirm.'],
  ['voice_04_repair', 0.34, 2.87, 'Every change is explained by the constraint that forced it.'],
  ['voice_04_repair', 3.63, 5.51, 'New finish: five fifty-five —'],
  ['voice_04_repair', 6.13, 7.67, 'five minutes before the guests walk in.'],
  ['voice_05_memory', 0.36, 2.02, 'A second shock, absorbed.'],
  ['voice_05_memory', 2.62, 5.68, 'And the plan remembers — this session survives a reload.'],
  ['voice_06_closing', 0.27, 2.87, 'And when no plan exists, PlanB says so —'],
  ['voice_06_closing', 3.38, 5.71, 'it never invents time, people, or money.'],
  ['voice_06_closing', 6.38, 8.89, 'In its own audit: zero broken constraints.'],
  ['voice_06_closing', 9.47, 12.98, 'PlanB Orchestra — a simulated Alexa+ experience.'],
];
const cues = CAP.map(([s, a, b, text]) => ({ start: PLACE[s] + a, end: PLACE[s] + b + 0.35, text }));
for (let i = 0; i + 1 < cues.length; i += 1) cues[i].end = Math.min(cues[i].end, cues[i + 1].start - 0.04);
const ts = (t, sep) => { const ms = Math.round(t * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor(ms / 60000) % 60; const s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
const srt = cues.map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.text}\n`).join('\n');
writeFileSync(path.join(video, 'PlanB_Orchestra_Subtitles.srt'), srt);
const assT = (t) => { const cs = Math.round(t * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
const ass = `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Segoe UI Semibold,34,&H00FFFFFF,&H00FFFFFF,&H3A0B0E18,&H3A0B0E18,0,0,0,0,100,100,0.2,0,3,14,0,2,360,360,38,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${cues.map((c) => `Dialogue: 0,${assT(c.start)},${assT(c.end)},Cap,,0,0,0,,{\\fad(140,160)}${c.text}`).join('\n')}
`;
writeFileSync(path.join(work, 'captions.ass'), ass);

/* ---------- 6. picture: restrained zooms (smoothstep in/out), end card ---------- */
// windows: [start, end, zoom, centreX, centreY] — centre in 1920×1080 page coordinates
const Z = [
  [ev('review-shown').t + 0.3, ev('confirm-1').t - 0.4, 1.28, 960, 545], // Review before replan (Moment B)
  [ev('review-2').t + 0.4, ev('confirm-2').t - 0.3, 1.14, 760, 640], // second review in the assistant
  [ev('compare-select').t + 1.0, ev('compare-select').t + 11.5, 1.16, 1230, 540], // Before/After reasons (Moment C)
  [ev('crisis').t + 0.15, ev('crisis').t + 2.6, 1.18, 1080, 430], // proven budget bound
];
const RAMP = 1.1;
const sm = (u) => `(clip(${u},0,1)*clip(${u},0,1)*(3-2*clip(${u},0,1)))`;
const weight = ([a, b]) => `min(${sm(`(it-${a.toFixed(3)})/${RAMP}`)},${sm(`(${b.toFixed(3)}-it)/${RAMP}`)})`;
const zoomExpr = `1${Z.map((w) => `+${(w[2] - 1).toFixed(3)}*${weight(w)}`).join('')}`;
const pick = (k) => Z.reduceRight((acc, w) => `if(between(it,${(w[0] - 0.05).toFixed(3)},${(w[1] + 0.05).toFixed(3)}),${(w[k] * 1.5).toFixed(1)},${acc})`, k === 3 ? '1440' : '810');
const xExpr = `clip(${pick(3)}-iw/zoom/2,0,iw-iw/zoom)`;
const yExpr = `clip(${pick(4)}-ih/zoom/2,0,ih-ih/zoom)`;
const font = (f) => `C\\:/Windows/Fonts/${f}`;
const E0 = 163.2; // end card
const endCard = [
  `drawbox=x=0:y=0:w=iw:h=ih:color=0x0b0e18@0.78:t=fill:enable='gte(t,${E0})'`,
  `drawtext=fontfile='${font('seguibl.ttf')}':text='PlanB Orchestra':fontsize=96:fontcolor=white:x=(w-text_w)/2:y=h/2-120:alpha='clip((t-${E0 + 0.1})/0.6,0,1)':enable='gte(t,${E0})'`,
  `drawtext=fontfile='${font('segoeui.ttf')}':text='The assistant that rebuilds your plan':fontsize=40:fontcolor=0xc0c1ff:x=(w-text_w)/2:y=h/2+4:alpha='clip((t-${E0 + 0.3})/0.6,0,1)':enable='gte(t,${E0})'`,
  `drawtext=fontfile='${font('segoeui.ttf')}':text='A simulated Alexa+ experience · not affiliated with or endorsed by Amazon':fontsize=26:fontcolor=0x9a9cb0:x=(w-text_w)/2:y=h/2+80:alpha='clip((t-${E0 + 0.5})/0.6,0,1)':enable='gte(t,${E0})'`,
].join(',');
const assPath = path.join(work, 'captions.ass').replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
const pictureBase = `[0:v]zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=1:s=1920x1080:fps=30,${endCard},fade=t=in:st=0:d=0.5,fade=t=out:st=${END - 0.6}:d=0.6`;
writeFileSync(path.join(work, 'filter_captioned.txt'), `${pictureBase},subtitles='${assPath}'[v]`);
writeFileSync(path.join(work, 'filter_clean.txt'), `${pictureBase}[v]`);

const finalOut = path.join(video, 'PlanB_Orchestra_Final_Demo.mp4');
const cleanOut = path.join(video, 'PlanB_Orchestra_Final_Demo_clean_with_soft_subtitles.mp4');
const enc = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart'];
ff(['-i', master, '-i', mix, '-filter_complex_script', path.join(work, 'filter_captioned.txt'), '-map', '[v]', '-map', '1:a', ...enc, '-t', String(END), finalOut]);
ff(['-i', master, '-i', mix, '-i', path.join(video, 'PlanB_Orchestra_Subtitles.srt'), '-filter_complex_script', path.join(work, 'filter_clean.txt'),
  '-map', '[v]', '-map', '1:a', '-map', '2:s', ...enc, '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-disposition:s:0', 'default', '-t', String(END), cleanOut]);
writeFileSync(path.join(work, 'placement.json'), JSON.stringify({ PLACE, cues, zooms: Z }, null, 2));
console.log('placement', PLACE);
console.log('done:', finalOut);
