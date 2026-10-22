// Spatial navigation and a unified input adapter (keyboard, TV-remote keys, gamepad, pointer).
// Works on the real DOM: candidates are the visible, enabled, semantic controls of the current
// scope (the open dialog, else the whole app). Focus is identified by a stable key so it survives
// the full re-renders the app performs, and falls back to the nearest control when its target
// disappears (e.g. a task removed by a replan).
// The pure helpers at the top (pickCandidate, gamepadStep, keyToAction) are unit-tested in Node.

/* ---------- Pure helpers ---------- */

export const DIRS = ['up', 'down', 'left', 'right'];

/**
 * Best candidate rect in a direction from `from`, or -1. Rects: {left, top, right, bottom}.
 * A candidate must lie beyond the current element's centre in that direction; the score is the gap
 * along the direction plus twice the misalignment across it, so aligned neighbours win over nearer
 * diagonal ones.
 */
export function pickCandidate(from, rects, dir) {
  const cx = (r) => (r.left + r.right) / 2;
  const cy = (r) => (r.top + r.bottom) / 2;
  const fx = cx(from);
  const fy = cy(from);
  let best = -1;
  let bestScore = Infinity;
  rects.forEach((r, i) => {
    let primary;
    let secondary;
    if (dir === 'right' || dir === 'left') {
      if (dir === 'right' ? cx(r) <= fx + 1 : cx(r) >= fx - 1) return;
      primary = dir === 'right' ? r.left - from.right : from.left - r.right;
      secondary = Math.max(0, Math.max(r.top, from.top) - Math.min(r.bottom, from.bottom));
    } else {
      if (dir === 'down' ? cy(r) <= fy + 1 : cy(r) >= fy - 1) return;
      primary = dir === 'down' ? r.top - from.bottom : from.top - r.bottom;
      secondary = Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right));
    }
    const score = Math.max(primary, -8) + secondary * 2 + (secondary === 0 ? 0 : 24);
    if (score < bestScore) { bestScore = score; best = i; }
  });
  return best;
}

/** Index of the rect whose centre is nearest to a point (used when a focused element disappears). */
export function nearestRect(point, rects) {
  let best = -1;
  let bestD = Infinity;
  rects.forEach((r, i) => {
    const d = Math.hypot((r.left + r.right) / 2 - point.x, (r.top + r.bottom) / 2 - point.y);
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

// Back keys sent by TV browsers and remotes (Tizen 10009, webOS 461) besides Escape/Backspace.
const BACK_KEYS = new Set(['Escape', 'GoBack', 'BrowserBack', 'Back']);
const BACK_CODES = new Set([461, 10009]);

/** Maps a keyboard / remote key to a navigation action, or null. */
export function keyToAction({ key, keyCode }) {
  if (key === 'ArrowUp') return 'up';
  if (key === 'ArrowDown') return 'down';
  if (key === 'ArrowLeft') return 'left';
  if (key === 'ArrowRight') return 'right';
  if (key === 'Enter' || key === ' ' || key === 'Select' || key === 'Accept') return 'select';
  if (BACK_KEYS.has(key) || BACK_CODES.has(keyCode) || key === 'Backspace') return 'back';
  return null;
}

export const GAMEPAD = { deadzone: 0.5, repeatDelay: 380, repeatInterval: 120 };

/**
 * One gamepad poll. `pad` is {buttons: [{pressed}], axes: [x, y]} in the standard mapping
 * (12–15 = D-pad up/down/left/right, 0 = A, 1 = B). Returns the new state and the actions to run:
 * directions fire on press and then repeat while held; A and B fire once per press.
 */
export function gamepadStep(state, pad, now, cfg = GAMEPAD) {
  const next = { dir: null, since: 0, last: 0, a: false, b: false, ...state };
  const actions = [];
  const btn = (i) => Boolean(pad.buttons?.[i]?.pressed);
  const [ax = 0, ay = 0] = pad.axes || [];
  let dir = null;
  if (btn(12) || ay < -cfg.deadzone) dir = 'up';
  else if (btn(13) || ay > cfg.deadzone) dir = 'down';
  else if (btn(14) || ax < -cfg.deadzone) dir = 'left';
  else if (btn(15) || ax > cfg.deadzone) dir = 'right';
  if (dir && dir !== state.dir) {
    actions.push(dir);
    next.dir = dir; next.since = now; next.last = now;
  } else if (dir && now - next.since >= cfg.repeatDelay && now - next.last >= cfg.repeatInterval) {
    actions.push(dir);
    next.last = now;
  } else if (!dir) {
    next.dir = null;
  }
  const a = btn(0);
  const b = btn(1);
  if (a && !state.a) actions.push('select');
  if (b && !state.b) actions.push('back');
  next.a = a; next.b = b;
  return { state: next, actions };
}

/* ---------- DOM engine ---------- */

/** Nearest ancestor that clips its content by scrolling (overflow auto/scroll). */
function scrollParent(el) {
  for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) return n;
  }
  return null;
}

/**
 * A control scrolled out of view inside a scroll container is a target only from inside that same
 * container (where scroll steps reveal it); from outside, a region is entered through its visible part.
 */
function reachableFrom(cur, el) {
  for (let sp = scrollParent(el); sp; sp = scrollParent(sp)) {
    if (sp.contains(cur)) return true;
    const a = el.getBoundingClientRect();
    const b = sp.getBoundingClientRect();
    if (Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) < 4 || Math.min(a.right, b.right) - Math.max(a.left, b.left) < 4) return false;
  }
  return true;
}

/**
 * The element focus moves to from `cur` in `dir` among `list`, or null. Nav groups
 * ([data-nav-group]) are searched innermost first (the chat history, then the chat card with its
 * composer); focus leaves a group only when nothing is left in that direction inside it.
 * Exported so tests plan paths with exactly the engine's targeting.
 */
export function directionalTarget(cur, list, dir) {
  const curRect = cur.getBoundingClientRect();
  const others = list.filter((el) => el !== cur && reachableFrom(cur, el));
  for (let g = cur.parentElement?.closest('[data-nav-group]'); g; g = g.parentElement?.closest('[data-nav-group]')) {
    const inGroup = others.filter((el) => g.contains(el));
    const k = pickCandidate(curRect, inGroup.map((el) => el.getBoundingClientRect()), dir);
    if (k >= 0) return inGroup[k];
  }
  const k = pickCandidate(curRect, others.map((el) => el.getBoundingClientRect()), dir);
  return k >= 0 ? others[k] : null;
}

// [data-nav] marks directional-only targets (chat messages): reachable by arrows, skipped by Tab.
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [data-nav]';
const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', '']);

function isTextField(el) {
  return el?.tagName === 'TEXTAREA' || (el?.tagName === 'INPUT' && TEXT_TYPES.has(el.type));
}

function usable(el) {
  if (el.disabled || el.closest('[inert], [aria-hidden="true"]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.right <= 0 || r.left >= window.innerWidth) return false; // off-canvas (e.g. the skip link) is for Tab only
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
}

/** Stable identity for a control across re-renders. */
export function focusKey(el) {
  if (!el || el === document.body) return null;
  const scope = el.parentElement?.closest('[id]')?.id || '';
  if (el.id) return `#${el.id}`;
  const d = el.dataset || {};
  const data = ['action', 'view', 'task', 'id', 'index', 'tab', 'pref', 'min', 'side', 'text', 'field', 'stage', 'msg', 'dir', 'nav']
    .filter((k) => d[k] !== undefined).map((k) => `${k}=${d[k]}`).join('&');
  return `${scope}|${el.tagName}|${data || (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 48)}`;
}

/**
 * createNavigator({ root, scope, initialFor, onMove, onSelect, onBack, isReduced })
 *  - scope(): element that contains the current candidates (dialog or app)
 *  - initialFor(view): selector list for a screen's first focus
 *  - onBack(): app-level back; returns true when it handled the action
 */
export function createNavigator(opts) {
  const { root } = opts;
  const memory = new Map(); // view → focus key
  let saved = null;
  let modalReturn = null;
  let hadModal = false;
  let lastSelect = 0;
  let lastSource = null;
  let editing = null; // the field the user is editing (native arrows apply)
  let pad = {};
  let polling = false;
  let renderedView = null; // the screen currently in the DOM (ui.view may already point at the next one)

  const setMode = (mode) => { if (document.documentElement.dataset.input !== mode) document.documentElement.dataset.input = mode; };
  const candidates = () => [...(opts.scope() || root).querySelectorAll(FOCUSABLE)].filter(usable);

  function focusEl(el, { sound = false, scroll = true } = {}) {
    if (!el) return false;
    const prev = document.activeElement;
    el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: opts.isReduced() ? 'auto' : 'smooth' });
    if (sound && prev !== el) opts.onMove?.(el);
    return document.activeElement === el;
  }

  function byKey(key, scopeEl = root) {
    if (!key) return null;
    if (key.startsWith('#')) return scopeEl.querySelector(`#${CSS.escape(key.slice(1))}`) || document.getElementById(key.slice(1));
    return [...scopeEl.querySelectorAll(FOCUSABLE)].find((el) => focusKey(el) === key && usable(el)) || null;
  }

  function initial(view) {
    const scopeEl = opts.scope() || root;
    for (const sel of opts.initialFor(view)) {
      const el = [...scopeEl.querySelectorAll(sel)].find(usable);
      if (el) return el;
    }
    return candidates().find((el) => el.closest('#main')) || candidates()[0] || null;
  }

  /** Scroll containers around `el` (itself included), innermost first, that can still scroll in `dir`. */
  function scrollersFor(el, dir) {
    const out = [];
    const vertical = dir === 'up' || dir === 'down';
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const ov = vertical ? cs.overflowY : cs.overflowX;
      if (ov !== 'auto' && ov !== 'scroll') continue;
      const room = vertical
        ? (dir === 'down' ? n.scrollHeight - n.clientHeight - n.scrollTop : n.scrollTop)
        : (dir === 'right' ? n.scrollWidth - n.clientWidth - n.scrollLeft : n.scrollLeft);
      if (room > 1) out.push({ el: n, room });
    }
    return out;
  }

  /**
   * One directional step, the same for every screen:
   *  1. a control in that direction inside the current scroll region → focus it (scrolled into view);
   *  2. otherwise, while the region can still scroll that way, scroll it a step (nothing is skipped);
   *     reading regions ([data-scroll-step], the chat history) also step through content that is not
   *     visible yet before focus jumps;
   *  3. at the region's edge focus leaves to the nearest control outside (never a trap).
   */
  function move(dir) {
    const list = candidates();
    const cur = document.activeElement;
    if (!list.includes(cur)) return focusEl(initial(opts.view()), { sound: true });
    const curRect = cur.getBoundingClientRect();
    const target = directionalTarget(cur, list, dir);
    const tr = target?.getBoundingClientRect();
    const vertical = dir === 'up' || dir === 'down';
    for (const { el: sc, room } of scrollersFor(cur, dir)) {
      if (sc === document.body || sc === root) continue;
      const c = sc.getBoundingClientRect();
      const inside = Boolean(target && sc.contains(target));
      let reveal = !inside; // the next control is outside this region: show the rest of it first
      if (!reveal && sc.hasAttribute('data-scroll-step')) {
        reveal = dir === 'down' ? tr.top > c.bottom - 8 || curRect.bottom > c.bottom + 2
          : dir === 'up' ? tr.bottom < c.top + 8 || curRect.top < c.top - 2
            : false;
      }
      if (!reveal) break; // the target is in this region: just move focus to it
      const size = vertical ? sc.clientHeight : sc.clientWidth;
      const step = Math.min(room, Math.max(64, Math.round(size * 0.6)));
      const shift = (dir === 'down' || dir === 'right') ? step : -step;
      sc.scrollBy({ [vertical ? 'top' : 'left']: shift, behavior: opts.isReduced() ? 'auto' : 'smooth' });
      // if the step carries the focused control out of view, focus the first control coming into view
      if (sc.contains(cur) && sc !== cur) {
        const after = (rr) => (vertical
          ? rr.bottom - shift > c.top + 4 && rr.top - shift < c.bottom - 4
          : rr.right - shift > c.left + 4 && rr.left - shift < c.right - 4);
        if (!after(curRect)) {
          const inView = list.filter((el) => el !== cur && sc.contains(el) && after(el.getBoundingClientRect()));
          const key = vertical ? 'top' : 'left';
          inView.sort((x, y) => ((dir === 'down' || dir === 'right') ? 1 : -1) * (x.getBoundingClientRect()[key] - y.getBoundingClientRect()[key]));
          if (inView[0]) inView[0].focus({ preventScroll: true });
        }
      }
      opts.onMove?.(cur);
      return true;
    }
    if (!target) return false; // edge of the screen: stay put, no sound
    return focusEl(target, { sound: true });
  }

  /**
   * Scroll areas with no control inside (a tool log, a long table) become focusable, labelled regions
   * so a remote can reach and scroll them. Areas that contain controls are reached through those.
   */
  function markScrollRegions() {
    for (const el of root.querySelectorAll('*')) {
      if (el.closest('.tl-body, .modal-backdrop')) continue;
      const cs = getComputedStyle(el);
      const scrollY = (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      const scrollX = (cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
      const auto = el.hasAttribute('data-auto-region');
      if (!scrollY && !scrollX) {
        if (auto) { el.removeAttribute('tabindex'); el.removeAttribute('data-scroll-region'); el.removeAttribute('data-auto-region'); el.removeAttribute('role'); }
        continue;
      }
      if (el.hasAttribute('data-scroll-region') && !auto) continue;
      const box = el.getBoundingClientRect();
      const visibleControl = [...el.querySelectorAll(FOCUSABLE)].some((c) => {
        if (c === el || !usable(c)) return false;
        const cr = c.getBoundingClientRect();
        return cr.bottom > box.top + 4 && cr.top < box.bottom - 4 && cr.right > box.left + 4 && cr.left < box.right - 4;
      });
      if (visibleControl) {
        if (auto && document.activeElement !== el) { el.removeAttribute('tabindex'); el.removeAttribute('data-scroll-region'); el.removeAttribute('data-auto-region'); el.removeAttribute('role'); }
        continue;
      }
      if (!auto) {
        const heading = el.closest('section, .card, [aria-label]')?.querySelector('h2, h3')?.textContent.trim() || el.closest('[aria-label]')?.getAttribute('aria-label') || 'Content';
        el.setAttribute('tabindex', '0');
        el.setAttribute('role', 'region');
        el.setAttribute('aria-label', `${heading} (scrollable)`);
        el.setAttribute('data-scroll-region', '');
        el.setAttribute('data-auto-region', '');
      }
    }
  }

  function activate(el, source) {
    if (!el || el.disabled) return;
    const now = performance.now();
    // one physical press seen by two sources at once (keyboard + gamepad) activates once; repeated
    // presses from one source always count (held keys/buttons are filtered upstream)
    if (source !== lastSource && now - lastSelect < 160) return;
    lastSelect = now;
    lastSource = source;
    opts.onSelect?.(el);
    el.classList.add('neon-press');
    setTimeout(() => el.classList.remove('neon-press'), 160);
    if (el.tagName === 'SELECT') { try { el.showPicker?.(); } catch { /* picker needs a user gesture */ } return; }
    if (isTextField(el)) { el.focus(); editing = el; return; }
    el.click();
  }

  function dispatch(action, source = 'keys') {
    setMode('keys');
    if (DIRS.includes(action)) return move(action);
    if (action === 'select') return activate(document.activeElement, source);
    if (action === 'back') return opts.onBack?.();
    return false;
  }

  /* --- keyboard / remote --- */
  function onKeyDown(ev) {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.key === 'Tab') { setMode('keys'); trapTab(ev); return; }
    const action = keyToAction(ev);
    if (!action) return;
    const el = document.activeElement;
    const text = isTextField(el);
    // Native editing wins inside fields (caret keys, Space, Enter, Backspace); an arrow leaves the
    // field only once the caret is already at that edge, so a field is never a trap.
    if (text && (action === 'select' || ev.key === 'Backspace')) return;
    if (text && (action === 'left' || action === 'right' || (el.tagName === 'TEXTAREA' && (action === 'up' || action === 'down')))) {
      let start = 0;
      let end = 0;
      if (el.type === 'number') { start = 0; end = el.value.length; } // no caret API: Left/Right always navigate
      else { start = el.selectionStart ?? 0; end = el.selectionEnd ?? 0; }
      const atStart = el.type === 'number' || (start === 0 && end === 0);
      const atEnd = el.type === 'number' || (start === el.value.length && end === el.value.length);
      if ((action === 'left' || action === 'up') && !atStart) return;
      if ((action === 'right' || action === 'down') && !atEnd) return;
    }
    // Sliders keep Left/Right for their value, except at the end of the range (then focus moves on).
    if (el?.type === 'range' && (action === 'left' || action === 'right')) {
      const v = Number(el.value);
      if (action === 'left' ? v > Number(el.min || 0) : v < Number(el.max || 100)) return;
    }
    // number fields: Up/Down change the value only while editing (typed into, clicked, or OK pressed);
    // otherwise they navigate, so a remote user can never get stuck in (or silently change) a field
    if (el?.type === 'number' && (action === 'up' || action === 'down') && editing === el) return;
    if (el?.tagName === 'SELECT' && action === 'select' && ev.key === ' ') return;
    if (action === 'back' && ev.key === 'Backspace' && text) return;
    if (action === 'select' && ev.repeat) { ev.preventDefault(); return; }
    ev.preventDefault();
    // Escape inside a field outside a dialog releases it: focus moves to the nearest control below/above.
    if (action === 'back' && text) editing = null;
    if (action === 'back' && text && !el.closest('.modal') && !opts.hasPending?.()) { setMode('keys'); if (!move('down')) move('up'); return; }
    dispatch(action, 'keys');
  }

  /** Keeps Tab / Shift+Tab inside an open dialog. */
  function trapTab(ev) {
    const modal = opts.scope();
    if (!modal || modal === root) return;
    const list = [...modal.querySelectorAll(FOCUSABLE)].filter(usable);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (ev.shiftKey && (document.activeElement === first || !modal.contains(document.activeElement))) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && (document.activeElement === last || !modal.contains(document.activeElement))) { ev.preventDefault(); first.focus(); }
  }

  /* --- gamepad --- */
  function poll() {
    const pads = navigator.getGamepads?.() || [];
    const gp = [...pads].find(Boolean);
    if (!gp) { polling = false; pad = {}; return; }
    const res = gamepadStep(pad, gp, performance.now());
    pad = res.state;
    for (const a of res.actions) dispatch(a, 'gamepad');
    requestAnimationFrame(poll);
  }
  function startPolling() { if (!polling) { polling = true; requestAnimationFrame(poll); } }

  /* --- render integration --- */
  function beforeRender() {
    const el = document.activeElement;
    if (!el || el === document.body || !root.contains(el)) { saved = null; return; }
    const r = el.getBoundingClientRect();
    saved = { key: focusKey(el), point: { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }, view: renderedView, sel: isTextField(el) ? [el.selectionStart, el.selectionEnd] : null };
    memory.set(saved.view, saved.key);
  }

  function afterRender() {
    markScrollRegions();
    const modal = opts.scope();
    const modalOpen = Boolean(modal && modal !== root);
    if (modalOpen && !hadModal) modalReturn = saved?.key || modalReturn;
    const closing = hadModal && !modalOpen;
    hadModal = modalOpen;
    const view = opts.view();
    const sameView = saved && saved.view === view;
    renderedView = view;
    if (modalOpen && modal.contains(document.activeElement)) { renderedView = opts.view(); saved = null; return; } // the app placed focus in the dialog
    let target = null;
    if (closing && modalReturn) { target = byKey(modalReturn); modalReturn = null; }
    if (!target && sameView) target = byKey(saved.key, modal && modalOpen ? modal : root);
    if (!target && sameView && document.documentElement.dataset.input === 'keys') {
      const list = candidates();
      const i = nearestRect(saved.point, list.map((el) => el.getBoundingClientRect()));
      target = list[i] || null; // the focused control was removed: take its nearest neighbour
    }
    if (!target && !sameView && renderedView) target = byKey(memory.get(view)) || (document.documentElement.dataset.input === 'keys' ? initial(view) : null);
    if (!target && modalOpen) target = initial('modal');
    const active = document.activeElement;
    if (target && (!active || active === document.body || !root.contains(active) || (modalOpen && !modal.contains(active)))) {
      focusEl(target, { scroll: document.documentElement.dataset.input === 'keys' });
      if (saved?.sel && isTextField(target) && saved.key === focusKey(target)) { try { target.setSelectionRange(...saved.sel); } catch { /* not selectable */ } }
    }
    saved = null;
  }

  /** Remember where focus was on the screen being left. */
  function leaving(view) {
    const k = focusKey(document.activeElement);
    if (k) memory.set(view, k);
  }

  document.addEventListener('keydown', onKeyDown, true);
  root.addEventListener('input', (ev) => { if (isTextField(ev.target)) editing = ev.target; }, true);
  root.addEventListener('focusout', (ev) => { if (ev.target === editing) editing = null; }, true);
  document.addEventListener('pointerdown', (ev) => { const f = ev.target.closest?.('input, textarea'); editing = f && isTextField(f) ? f : null; }, true);
  document.addEventListener('pointerdown', () => setMode('pointer'), true);
  window.addEventListener('gamepadconnected', startPolling);
  let regionTimer = null;
  document.addEventListener('scroll', () => { clearTimeout(regionTimer); regionTimer = setTimeout(markScrollRegions, 120); }, { capture: true, passive: true });
  if ([...(navigator.getGamepads?.() || [])].some(Boolean)) startPolling();
  setMode('pointer');

  return { dispatch, beforeRender, afterRender, leaving, focusEl, byKey, initial, startPolling, candidates, markScrollRegions };
}
