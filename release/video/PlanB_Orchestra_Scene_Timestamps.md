# Scene timestamps — PlanB_Orchestra_Final_Demo.mp4 (2:46, 1920×1080, 30 fps)

The edit has **no cuts**: the video is one continuous real-time recording (`raw/`), so video time = recording time.
Times below come from `raw/recording_events.json` (logged during recording) and `raw/edit_placement.json`.

| Beat | Scene | Starts | Narration starts | Key moments |
|---|---|---|---|---|
| 1 | Scenarios & Home | 0:00.0 | 0:01.0 (`voice_01_intro`) | hover only; ends on validator figures ~0:13 |
| 2 | Plan Workspace | 0:15.0 | 0:16.8 (`voice_02_plan`) | build 0:15.5 · inspector open 0:21 · lanes pan 0:29–0:40 · KPIs 0:41–0:45 |
| 3 | Simulate disruption | 0:45.0 | 0:49.1 (`voice_03_disruption`) | typing 0:48.0 · **Review shown 0:53.1** (zoom 0:53.4–1:05.9) · **Apply & replan 1:06.3** · Plan B ready 1:06.4 |
| 4 | Timeline Compare | 1:25.0 | 1:43.0 (`voice_04_repair`) | change map pass 1:28–1:37 · Pan-sear task selected 1:40.4 · reasons zoom 1:41.4–1:51.9 · totals 1:46–1:54 |
| 5 | Assistant · reload · History | 2:00.0 | 2:09.2 (`voice_05_memory`) | *Sam can't help* review 2:04.3 · confirm 2:08.7 · reload 2:11.4 → restored 2:13.7 · History r2/r1/r0 2:15–2:24 |
| 6 | $30 budget · Settings · Home | 2:25.0 | 2:31.6 (`voice_06_closing`) | review "No feasible plan" 2:31.7 · crisis panel (proven bound) 2:37.6 · Settings 2:40.4 · Home 2:42.6 · end card 2:43.2 · fade out 2:45.4–2:46.0 |

Zooms (smooth 1.1 s ramps, real footage only): Review ×1.28 · second review ×1.14 · Before/After reasons ×1.16 ·
proven budget bound ×1.18.

UI sounds in the mix (the app's own cues, synthesised with the same parameters as `src/sound.js`, 18 dB under the
voice): success at 0:16.5, 1:06.4, 2:08.8 · open at 0:46.3, 2:26.3 · error at 2:31.7, 2:37.6.
