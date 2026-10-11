import { addDays } from './dates.ts'
import type { View } from './views.ts'

export interface QuickAdd {
  title: string
  tags: string[]
  date: string | null
}

/** «Купить молоко #дом завтра» → title, tags and date; null when no title is left. */
export function parseQuickAdd(text: string, context: { today: string; view: View; tag: string | null }): QuickAdd | null {
  const tags = new Set<string>(context.tag === null ? [] : [context.tag])
  let date: string | undefined
  const words: string[] = []
  for (const word of text.trim().split(/\s+/)) {
    const lower = word.toLowerCase()
    if (word.length > 1 && word.startsWith('#')) tags.add(lower.slice(1))
    else if (lower === 'сегодня') date = context.today
    else if (lower === 'завтра') date = addDays(context.today, 1)
    else if (word !== '') words.push(word)
  }
  const title = words.join(' ')
  if (title === '') return null
  return { title, tags: [...tags], date: date ?? defaultDate(context.view, context.today) }
}

// Spec «Quick add»: a task added in a view should show up in it.
function defaultDate(view: View, today: string): string | null {
  if (view === 'today') return today
  if (view === 'upcoming') return addDays(today, 1)
  return null
}
