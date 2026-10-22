export function handAngles(date: Date, smooth = true) {
  const seconds = date.getSeconds() + (smooth ? date.getMilliseconds() / 1000 : 0)
  const minutes = date.getMinutes() + seconds / 60
  return {
    hour: ((date.getHours() % 12) + minutes / 60) * 30,
    minute: minutes * 6,
    second: seconds * 6,
  }
}
