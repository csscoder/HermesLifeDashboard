import { describe, expect, it } from 'vitest'
import { addDays, formatDue, nextMonday } from '../src/dates.ts'
import { layoutFor } from '../src/layout.ts'
import { parseQuickAdd } from '../src/quick-add.ts'

const today = '2026-10-11' // a Sunday

describe('layoutFor', () => {
  it('uses the rail from 7 cells and the stacked layout below, down to the 3×4 minimum', () => {
    expect(layoutFor({ w: 7 })).toBe('rail')
    expect(layoutFor({ w: 16 })).toBe('rail')
    expect(layoutFor({ w: 6 })).toBe('stacked')
    expect(layoutFor({ w: 3 })).toBe('stacked')
  })
})

describe('dates', () => {
  it('adds days across months, years and DST changes without the machine clock', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-11', -1)).toBe('2026-10-10')
  })

  it('finds the next Monday, a week ahead from a Monday', () => {
    expect(nextMonday('2026-10-11')).toBe('2026-10-12')
    expect(nextMonday('2026-10-12')).toBe('2026-10-19')
    expect(nextMonday('2026-10-17')).toBe('2026-10-19')
  })

  it('formats due dates relative to the workspace today', () => {
    expect(formatDue('2026-10-11', today)).toBe('сегодня')
    expect(formatDue('2026-10-12', today)).toBe('завтра')
    expect(formatDue('2026-10-10', today)).toBe('вчера')
    expect(formatDue('2026-10-09', today)).toBe('9 окт')
    expect(formatDue('2027-03-18', today)).toBe('18 мар 2027')
    expect(formatDue('2026-10-11T19:00', today)).toBe('сегодня 19:00')
  })
})

describe('parseQuickAdd', () => {
  const context = { today, view: 'today' as const, tag: null }

  it('takes #tags and a date word out of the title', () => {
    expect(parseQuickAdd('Купить молоко #дом завтра', context)).toEqual({ title: 'Купить молоко', tags: ['дом'], date: '2026-10-12' })
    expect(parseQuickAdd('Позвонить маме Сегодня #Близкие', context)).toEqual({ title: 'Позвонить маме', tags: ['близкие'], date: today })
  })

  it('takes the default date from the view', () => {
    expect(parseQuickAdd('Задача', context)?.date).toBe(today)
    expect(parseQuickAdd('Задача', { ...context, view: 'upcoming' })?.date).toBe('2026-10-12')
    expect(parseQuickAdd('Задача', { ...context, view: 'inbox' })?.date).toBeNull()
    expect(parseQuickAdd('Задача', { ...context, view: 'all' })?.date).toBeNull()
  })

  it('adds the selected tag once', () => {
    expect(parseQuickAdd('Фильм #кино', { ...context, tag: 'кино' })?.tags).toEqual(['кино'])
    expect(parseQuickAdd('Фильм', { ...context, tag: 'кино' })?.tags).toEqual(['кино'])
  })

  it('keeps emoji and a lone #, and returns null without a title', () => {
    expect(parseQuickAdd('🎬 Фильм # вечером', context)?.title).toBe('🎬 Фильм # вечером')
    expect(parseQuickAdd('  #дом завтра ', context)).toBeNull()
    expect(parseQuickAdd('', context)).toBeNull()
  })
})
