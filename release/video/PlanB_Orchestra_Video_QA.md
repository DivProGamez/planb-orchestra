# Video QA — PlanB_Orchestra_Final_Demo.mp4

Checked on the rendered files with ffprobe / ffmpeg and by viewing extracted frames. Rebuild: `node
release/video/tools/record.mjs release/video/work` then `node release/video/tools/produce.mjs`.

| # | Check | Result |
|---|---|---|
| 1 | MP4 exists | `PlanB_Orchestra_Final_Demo.mp4` (22 MB, captions burned in) and `PlanB_Orchestra_Final_Demo_clean_with_soft_subtitles.mp4` (no burned captions, English mov_text track) |
| 2 | Playable | full decode with `ffmpeg -v error -f null` → no errors; `+faststart` for web players |
| 3 | Duration < 3:00 | **166.0 s (2:46)** |
| 4 | Resolution / rate | **1920×1080, 30 fps**, H.264 High, yuv420p; AAC-LC 48 kHz stereo 192 kb/s |
| 5 | Narration present and in sync | mean level −17 to −19 dB in every narration window, −91 dB in the pauses; each line placed on its beat from events logged during recording (see timestamps file). Program loudness −13.6 LUFS integrated, LRA 6.8 LU |
| 6 | UI actions genuine | one continuous real-time recording of the real app (Playwright clicks and keystrokes, Chrome screencast); **no cuts, no speed changes**; the replans happen at their real speed (each completed in under 0.2 s) |
| 7 | Numbers match app state | verified against the text the app rendered during the recording run (`raw/recording_events.json`): 66 checks / 6:50 PM / $82 → review 6:00 PM deadline, oven down, 4 tasks, 5:55 PM, $86, 65 checks → Sam: 7 tasks, 64 checks → $30: proven bound $59, option $59 / 6:00 PM. Final state r2, 3 revisions |
| 8 | Review step fully visible | held 13.2 s (0:53.1–1:06.3), zoomed ×1.28: understood items, constraint changes, dry-run impact and all three buttons readable (frame at 0:58 inspected) |
| 9 | Before/After readable | frame at 1:44.5 inspected at 1080p and downscaled to 720p: summary cards, both timelines, change-map reasons legible |
| 10 | Subtitles accurate | 16 cues = exact narration words (with the one correction below); timed to the placed audio; bottom-centre, above no essential control (checked at 0:03, 0:58, 1:44, 2:06, 2:38, 2:44) |
| 11 | No stray overlays | no browser chrome, toolbars or dev overlays (headless capture). The pointer is a drawn cursor that mirrors the real mouse events (headless Chrome draws none) |
| 12 | No unsupported claims | narration and end card say *simulated Alexa+ experience*; end card adds *not affiliated with or endorsed by Amazon*; the app's own labels (local rule parser, not an LLM) are visible throughout |
| 13 | 720p readability | checked (Before/After frame); body text remains legible |
| 14 | Frames and audio inspected | frames at 0:03, 0:20, 0:58, 1:04, 1:10, 1:44.5, 1:48, 2:06.5, 2:14.5, 2:21, 2:34, 2:38.8, 2:44.5 viewed; narration windows measured |

## Known limitations (honest)

- **Narration covers about 52 s of a 2:46 video**, as the storyboard specifies ("let the gaps be natural pauses"). The
  stretches without voice (e.g. 0:26–0:49, 1:06–1:43, 1:51–2:09) carry the real UI and its interface sounds only. No
  background music was added: no licensed track is available locally.
- **Narration fix:** "three hundred random shock sequences," was removed from the closing line; the project's audit
  runs 500 sequences. The remaining sentence is true and in the original voice.
- **No new AI voice:** only Windows SAPI voices exist on this machine and no voice service is configured; the supplied
  recording is better, so it was kept, split into the six requested scene files.
- **Interface sounds** in the mix are re-synthesised from the app's own cue parameters at the logged moments (browser
  audio cannot be captured from a headless screencast); they are 18 dB under the voice.
- The cursor is drawn by the recording harness; every click it shows is a real mouse event to the app.

## Files

- `PlanB_Orchestra_Final_Demo.mp4` — final, captions burned in
- `PlanB_Orchestra_Final_Demo_clean_with_soft_subtitles.mp4` — final without burned captions, soft English subtitles
- `PlanB_Orchestra_Subtitles.srt` · `PlanB_Orchestra_Final_Script.md` · `PlanB_Orchestra_Scene_Timestamps.md`
- `audio/voice_01_intro.wav` … `voice_06_closing.wav`, `ui_cues.wav`, `PlanB_Orchestra_Final_Mix.wav`
- `raw/PlanB_Orchestra_Raw_Screen_Recording_2880x1620_master.mp4` (unedited, 1.5× density) and
  `raw/PlanB_Orchestra_Raw_Screen_Recording_1080p.mp4` — backups of the original screen recording
- `tools/record.mjs`, `tools/produce.mjs` — the reproducible pipeline
