const FORM_CONTROLS = new Set(['SELECT', 'INPUT', 'TEXTAREA'])

/** True when a key event belongs to a form control (the header theme select), not to the board draft. */
export function isFormControlTarget(target: EventTarget | null): boolean {
  const tagName = (target as { tagName?: unknown } | null)?.tagName
  return typeof tagName === 'string' && FORM_CONTROLS.has(tagName)
}
