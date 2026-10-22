// UI sound manager: short interface cues synthesised with the Web Audio API (original sounds, no
// audio files, nothing downloaded). One AudioContext is created lazily after the user has
// interacted with the page (browser autoplay rules); until then, and whenever sound is off or the
// API is missing, every call is a silent no-op. Navigation never depends on audio.

/**
 * Each cue is a list of short tones: [startSec, freqHz, endFreqHz, durSec, gain, wave].
 * One soft timbre (sine/triangle through a low-pass) keeps repeated navigation comfortable.
 */
export const CUES = {
  focus: [[0, 1320, 1180, 0.045, 0.32, 'sine']],
  select: [[0, 880, 990, 0.05, 0.5, 'triangle'], [0.045, 1320, 1320, 0.07, 0.38, 'sine']],
  back: [[0, 990, 740, 0.09, 0.4, 'sine']],
  open: [[0, 520, 780, 0.12, 0.32, 'sine'], [0.05, 1040, 1180, 0.1, 0.18, 'sine']],
  success: [[0, 660, 660, 0.09, 0.36, 'triangle'], [0.08, 880, 880, 0.09, 0.36, 'triangle'], [0.16, 1320, 1320, 0.16, 0.32, 'sine']],
  error: [[0, 330, 300, 0.14, 0.42, 'triangle'], [0.15, 300, 270, 0.16, 0.36, 'triangle']],
  undo: [[0, 1180, 880, 0.07, 0.36, 'sine'], [0.07, 880, 660, 0.09, 0.32, 'sine']],
};

const MIN_GAP = { focus: 45 }; // ms between two focus ticks while a direction is held
const MAX_VOICES = 6;

/**
 * createSoundManager({ createContext, now, enabled, volume })
 *  createContext: () => AudioContext (injectable for tests); now: () => ms clock.
 */
export function createSoundManager({ createContext, now = () => performance.now(), enabled = true, volume = 0.5 } = {}) {
  let ctx = null;
  let master = null;
  let unlocked = false;
  let failed = false;
  let voices = 0;
  const last = {};
  const state = { enabled, volume };

  function ensure() {
    if (ctx || failed || !unlocked) return ctx;
    try {
      ctx = createContext();
      master = ctx.createGain();
      master.gain.value = state.volume;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 4200; // no harsh highs
      master.connect(lp);
      lp.connect(ctx.destination);
    } catch {
      failed = true;
      ctx = null;
    }
    return ctx;
  }

  function tone(at, [start, f0, f1, dur, gain, wave]) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    const t = at + start;
    osc.type = wave;
    osc.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env);
    env.connect(master);
    voices += 1;
    osc.onended = () => { voices -= 1; };
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  return {
    /** Call from a user gesture (keydown, pointerdown, gamepad button). */
    unlock() {
      unlocked = true;
      const c = ensure();
      if (c && c.state === 'suspended') c.resume?.().catch(() => {});
    },
    /** Plays a cue; returns true only when sound was actually scheduled. */
    play(name) {
      const cue = CUES[name];
      if (!cue || !state.enabled || state.volume <= 0) return false;
      const t = now();
      if (MIN_GAP[name] && t - (last[name] || -Infinity) < MIN_GAP[name]) return false;
      if (!ensure() || ctx.state === 'closed') return false;
      if (voices >= MAX_VOICES) return false;
      last[name] = t;
      const at = ctx.currentTime + 0.005;
      for (const part of cue) tone(at, part);
      return true;
    },
    setEnabled(on) { state.enabled = Boolean(on); },
    setVolume(v) {
      state.volume = Math.max(0, Math.min(1, Number(v) || 0));
      if (master) master.gain.setTargetAtTime?.(state.volume, ctx.currentTime, 0.01);
    },
    get enabled() { return state.enabled; },
    get volume() { return state.volume; },
    get active() { return Boolean(ctx); },
    get voices() { return voices; },
  };
}
