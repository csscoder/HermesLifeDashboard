import { describe, expect, it } from 'vitest'
import { SLUG_PATTERN, slugFromTitle } from '../src/slug.ts'

describe('slugFromTitle', () => {
  it.each([
    ['Мои суперчасы', 'moi-superchasy'],
    ['Мой ёжик', 'moy-yozhik'],
    ['Café clock', 'cafe-clock'],
    ['Щука и Цапля', 'shchuka-i-tsaplya'],
    ['Їжак Ґудзик', 'yizhak-gudzik'],
    ['Часы №1 ⏰', 'chasy-no1'],
    ['  --Hello__World--  ', 'hello-world'],
    ['Подъезд, объём', 'podezd-obyom'],
  ])('%j → %s', (title, slug) => expect(slugFromTitle(title)).toBe(slug))

  it.each(['時計', '⏰⏰', '123', '', '---'])('%j → null', (title) => {
    expect(slugFromTitle(title)).toBeNull()
  })

  it('cuts long titles to 50 characters at a dash boundary', () => {
    const slug = slugFromTitle('word '.repeat(20))!
    expect(slug.length).toBeLessThanOrEqual(50)
    expect(slug).toMatch(SLUG_PATTERN)
    expect(slug.endsWith('-')).toBe(false)
  })
})
