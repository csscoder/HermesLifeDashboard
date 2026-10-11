// Workspace dates are YYYY-MM-DD strings in the Hermes Tasks time zone. They are computed in UTC from
// those strings and never from the machine clock, whose zone may differ.

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function nextMonday(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return addDays(date, (8 - weekday) % 7 || 7)
}

/** «сегодня», «завтра», «вчера», «9 окт» or «18 мар 2027», plus « 19:00» for a timed due. */
export function formatDue(due: string, today: string): string {
  const date = due.slice(0, 10)
  const time = due.slice(11, 16)
  let day: string
  if (date === today) day = 'сегодня'
  else if (date === addDays(today, 1)) day = 'завтра'
  else if (date === addDays(today, -1)) day = 'вчера'
  else {
    const month = MONTHS[Number(date.slice(5, 7)) - 1]
    day = `${Number(date.slice(8, 10))} ${month}${date.slice(0, 4) === today.slice(0, 4) ? '' : ` ${date.slice(0, 4)}`}`
  }
  return time ? `${day} ${time}` : day
}
