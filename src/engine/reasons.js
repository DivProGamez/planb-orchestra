// Reason codes. Each code is attached only when the matching constraint change actually
// occurred in the turn (see diff.js); messages are templated from plan data.

export const REASONS = {
  EARLIER_DEADLINE: { label: 'Earlier deadline', tone: 'warn' },
  PERSON_UNAVAILABLE: { label: 'Person unavailable', tone: 'warn' },
  RESOURCE_DOWN: { label: 'Equipment down', tone: 'warn' },
  BUDGET_CUT: { label: 'Budget cut', tone: 'warn' },
  DURATION_INCREASED: { label: 'Took longer', tone: 'warn' },
  DEPENDENCY_PROPAGATION: { label: 'Dependency moved', tone: 'info' },
  SCHEDULE_REBALANCED: { label: 'Rebalanced', tone: 'info' },
  OPTIONAL_DROPPED: { label: 'Optional dropped', tone: 'muted' },
  ALTERNATIVE_USED: { label: 'Alternative used', tone: 'accent' },
  DURATION_COMPRESSED: { label: 'Compressed', tone: 'accent' },
  DEADLINE_EXTENDED: { label: 'Deadline extended', tone: 'ok' },
  BUDGET_RAISED: { label: 'Budget raised', tone: 'ok' },
  USER_SKIPPED: { label: 'Skipped by you', tone: 'muted' },
  PERSON_DELAYED: { label: 'Arrives late', tone: 'warn' },
  PERSON_RETURNED: { label: 'Person back', tone: 'ok' },
  RESOURCE_RESTORED: { label: 'Equipment back', tone: 'ok' },
  ORIGINAL_VERSION: { label: 'Original version', tone: 'ok' },
};

export const DIFF_KINDS = ['Removed', 'Restored', 'Replaced', 'Reassigned', 'Shortened', 'Lengthened', 'Moved', 'Unchanged'];

export function reasonLabel(code) {
  return REASONS[code]?.label || code;
}

/** One-line summary of a diff entry built only from its recorded facts. */
export function summarizeEntry(entry) {
  const codes = entry.reasons.map((r) => reasonLabel(r.code).toLowerCase());
  const because = codes.length ? ` (${codes.join(', ')})` : '';
  switch (entry.kind) {
    case 'Removed': return `${entry.title} removed${because}`;
    case 'Restored': return `${entry.title} restored${because}`;
    case 'Replaced': return `${entry.beforeTitle} → ${entry.title}${because}`;
    case 'Reassigned': return `${entry.title} reassigned${because}`;
    case 'Shortened': return `${entry.title} shortened${because}`;
    case 'Lengthened': return `${entry.title} lengthened${because}`;
    case 'Moved': return `${entry.title} moved${because}`;
    default: return `${entry.title} unchanged`;
  }
}
