export type View = 'today' | 'upcoming' | 'inbox' | 'all'

export const VIEWS: readonly { id: View; label: string }[] = [
  { id: 'today', label: 'Сегодня' },
  { id: 'upcoming', label: 'Скоро' },
  { id: 'inbox', label: 'Входящие' },
  { id: 'all', label: 'Все' },
]
