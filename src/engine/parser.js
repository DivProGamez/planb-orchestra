// LIMITED LOCAL PARSER — deterministic pattern rules, not a language model.
// Maps a bounded set of English phrasings to structured shocks/intents; anything else is
// reported as not understood. Output is always re-validated by shocks.js before use.

const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, twenty: 20,
  'twenty-five': 25, thirty: 30, forty: 40, 'forty-five': 45, fifty: 50, sixty: 60, ninety: 90,
};

const NEG_PERSON = /\b(can'?t|cannot|can not|won'?t|isn'?t|is not|no longer|not (?:able|available|coming|here|around)|unavailable|sick|ill|has to (?:leave|go)|had to (?:leave|go)|leaving|left|bail(?:ed|ing)?|cancel(?:l?ed|s)?|dropped out|called (?:in|away)|busy|anymore|any more)\b/;
const BROKEN = /\b(broke|broken|breaks|break down|broke down|down|not working|stopped working|died|dead|unavailable|out of (?:order|service)|failed|fails|is out|won'?t (?:start|turn on|work|heat)|in the shop|being used|taken)\b/;
const EARLIER = /\b(earl(?:y|ier)|sooner|ahead of (?:time|schedule)|moved up|brought forward)\b/;
const LATER = /\b(later|delayed|pushed back)\b/;
const LONGER = /\b(longer|more time|late|behind|overrun(?:ning)?|running over|extra)\b/;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordRe(word) {
  return new RegExp(`\\b${escapeRe(word.toLowerCase())}\\b`);
}

/** Finds the first duration expression in a clause, in minutes. */
export function findDuration(text) {
  const t = text.toLowerCase();
  const rules = [
    [/\b(?:an?|one)\s+hour\s+and\s+a\s+half\b/, () => 90],
    [/\bhalf\s+an?\s+hour\b/, () => 30],
    [/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b(?:\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b)?/, (m) => Math.round(parseFloat(m[1]) * 60) + (m[2] ? parseInt(m[2], 10) : 0)],
    [/\b(\d+)\s*(?:minutes?|mins?|m)\b/, (m) => parseInt(m[1], 10)],
    [/\b(an?|one|two|three|four)\s+hours?\b/, (m) => NUMBER_WORDS[m[1]] * 60],
    [/\b(five|ten|fifteen|twenty|twenty-five|thirty|forty|forty-five|fifty|sixty|ninety)\s+(?:minutes?|mins?)\b/, (m) => NUMBER_WORDS[m[1]]],
  ];
  for (const [re, fn] of rules) {
    const m = t.match(re);
    if (m) return fn(m);
  }
  return null;
}

/** Finds a clock time ("6:30", "6 pm") and converts it to scenario minutes near a reference. */
export function findClockTime(text, scenario, referenceMin) {
  const m = text.toLowerCase().match(/\b(?:at|by|for|to|is|now)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?(?=\s|$|[.,!?])/);
  if (!m) return null;
  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  if (hour > 23 || minute > 59) return null;
  const suffix = m[3]?.replace(/\./g, '');
  if (!m[2] && !suffix) return null; // a bare number is more likely a quantity than a time
  const candidates = [];
  if (suffix === 'pm') candidates.push((hour % 12) + 12);
  else if (suffix === 'am') candidates.push(hour % 12);
  else candidates.push(hour, (hour + 12) % 24);
  const start = scenario.clockStartMin || 0;
  const options = candidates.map((h) => h * 60 + minute - start);
  options.sort((a, b) => Math.abs(a - referenceMin) - Math.abs(b - referenceMin));
  return options[0];
}

function splitClauses(text) {
  return text
    .split(/(?<=[.!?;])\s+|\s*;\s*|,\s*(?:and\s+|but\s+|also\s+)?|\s+(?:and|but|also|plus)\s+(?=(?:the|our|my|we|she|he|they|it|guests?|[A-Z]))/)
    .map((c) => c.trim())
    .filter(Boolean);
}

function findTask(clause, tasks) {
  const t = clause.toLowerCase();
  for (const task of tasks) {
    const words = [...(task.keywords || []), task.title];
    if (words.some((w) => wordRe(w).test(t))) return task;
  }
  return null;
}

/**
 * Parses a user command against the current constraint state.
 * Returns { intent, shocks, matches, notes, parser: 'local' }.
 */
export function parseCommand(text, state) {
  const s = state.scenario;
  const raw = String(text || '').trim();
  const out = { intent: 'unknown', shocks: [], matches: [], notes: [], parser: 'local' };
  if (!raw) return { ...out, intent: 'empty' };
  const lower = raw.toLowerCase();

  if (/\b(undo|revert|take (?:that|it) back)\b/.test(lower)) return { ...out, intent: 'undo' };
  if (/\b(restore|reset|start over|original plan)\b/.test(lower)) return { ...out, intent: 'restore' };
  if (/^(help|what can (?:you|i) (?:do|say)|commands)\b/.test(lower)) return { ...out, intent: 'help' };

  const advance = lower.match(/\b(?:advance|fast[- ]?forward|jump|skip ahead|move (?:the )?(?:clock|time))\b/);
  if (advance) {
    const minutes = findDuration(lower);
    if (minutes) return { ...out, intent: 'advance', minutes };
  }
  const nowIs = lower.match(/\b(?:it'?s now|time is now|the time is|clock to)\b/);
  if (nowIs) {
    const at = findClockTime(lower.replace(/it'?s now|time is now|the time is|clock to/, 'now'), s, state.nowMin);
    if (at !== null && at > state.nowMin) return { ...out, intent: 'advance', minutes: at - state.nowMin };
  }

  const clauses = splitClauses(raw);
  const seen = new Set();
  const push = (shock, phrase) => {
    const key = `${shock.type}:${JSON.stringify(shock.payload)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.shocks.push(shock);
    out.matches.push({ type: shock.type, phrase });
  };

  // People who can no longer help — matched per sentence so "Sam and Leila can't help" works.
  for (const sentence of raw.split(/(?<=[.!?;])\s+/)) {
    const c = sentence.toLowerCase();
    if (!NEG_PERSON.test(c) || /\b(is back|available again|can help again)\b/.test(c)) continue;
    for (const p of s.people) {
      const names = [p.name, ...(p.aliases || [])];
      if (names.some((n) => wordRe(n).test(c))) push({ type: 'person_unavailable', payload: { personId: p.id } }, sentence);
    }
  }

  for (const clause of clauses) {
    const c = clause.toLowerCase();

    // Equipment outages.
    if (BROKEN.test(c)) {
      for (const r of s.resources) {
        const names = [r.name, ...(r.aliases || [])];
        if (names.some((n) => wordRe(n).test(c))) push({ type: 'resource_unavailable', payload: { resourceId: r.id } }, clause);
      }
    }
    // Budget changes.
    if (/\b(budget|spend|dollars?|bucks)\b|\$/.test(c)) {
      const by = c.match(/\b(?:cut|reduce|lower|drop|trim|slash)\w*\s+(?:the\s+|our\s+|my\s+)?budget\s+by\s+\$?\s*(\d+)/);
      const to = c.match(/\bbudget\b[^\d$]{0,30}\$?\s*(\d+)/) || c.match(/\bonly\s+(?:have|got|can spend)\s+\$?\s*(\d+)/) || c.match(/\$\s*(\d+)\s+(?:left|total|max|budget)/);
      let newCap = null;
      if (by) newCap = s.budgetCap - parseInt(by[1], 10);
      else if (to) newCap = parseInt(to[1], 10);
      if (newCap !== null) {
        if (newCap < s.budgetCap) push({ type: 'budget_reduced', payload: { newCap: Math.max(0, newCap) } }, clause);
        else if (newCap > s.budgetCap) push({ type: 'budget_increased', payload: { newCap } }, clause);
        else out.notes.push(`The budget is already $${s.budgetCap}.`);
      }
    }
    // Task overruns.
    if (LONGER.test(c) && !EARLIER.test(c)) {
      const minutes = findDuration(c);
      const task = findTask(c, s.tasks.filter((t) => t.status === 'todo'));
      if (minutes && task) push({ type: 'duration_increase', payload: { taskId: task.id, extraMin: minutes } }, clause);
      else if (minutes && !task && !/\b(guests?|arriv|deadline)\b/.test(c)) out.notes.push('I could not tell which task is running long.');
    }
    // Deadline changes (relative or absolute).
    const deadlineContext = /\b(guests?|arriv\w*|deadline|due|party|dinner|serve|leave|leaving|start|be there|reservation|check-?in)\b/.test(c);
    if (EARLIER.test(c) && !LONGER.test(c)) {
      const minutes = findDuration(c);
      if (minutes) push({ type: 'deadline_earlier', payload: { minutes } }, clause);
    } else if (LATER.test(c) && deadlineContext) {
      const minutes = findDuration(c);
      if (minutes) push({ type: 'deadline_extended', payload: { minutes } }, clause);
    } else if (deadlineContext && /\b(now|instead|moved|changed|at|by)\b/.test(c)) {
      const at = findClockTime(c, s, s.deadlineMin);
      if (at !== null && at !== s.deadlineMin) {
        if (at < s.deadlineMin) push({ type: 'deadline_earlier', payload: { minutes: s.deadlineMin - at } }, clause);
        else push({ type: 'deadline_extended', payload: { minutes: at - s.deadlineMin } }, clause);
      }
    }
    // Explicit skip requests (user-confirmed relaxation).
    const skip = c.match(/\b(?:skip|drop|forget(?: about)?|leave out|no need for|don'?t bother with|cancel)\s+(?:the\s+)?(.+)/);
    if (skip && !/\bbudget\b/.test(c)) {
      const task = findTask(skip[1], s.tasks.filter((t) => t.status === 'todo'));
      if (task) push({ type: 'task_skipped', payload: { taskId: task.id } }, clause);
    }
  }

  if (out.shocks.length) return { ...out, intent: 'shocks' };
  if (/\b(can we|will we|are we|on time|on track|status|how are we|what'?s left|when (?:is|will|do)|still)\b|\?$/.test(lower)) {
    return { ...out, intent: 'status' };
  }
  return out;
}
