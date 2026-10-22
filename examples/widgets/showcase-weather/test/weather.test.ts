import { describe, expect, it } from 'vitest'
import { conditionFor, parseWeather, weatherUrl } from '../src/weather.ts'
import { forecast } from './fixture.ts'

describe('weather source', () => {
  it('reads the current Celsius conditions and the matching local daily range', () => {
    expect(parseWeather(forecast())).toEqual({
      temperature: 14.3, feelsLike: 12.1, humidity: 55, wind: 7.9,
      high: 14.7, low: 8.7, code: 2, isDay: true, localTime: '17:45', timezone: 'Europe/London',
    })
  })

  it('requests only the declared origin with explicit units and location', () => {
    const url = new URL(weatherUrl({ latitude: -33.8688, longitude: 151.2093 }))
    expect(url.origin).toBe('https://api.open-meteo.com')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      latitude: '-33.8688', longitude: '151.2093',
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
      daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '1',
      temperature_unit: 'celsius', wind_speed_unit: 'kmh',
    })
  })

  it.each([
    ['temperature_2m', null], ['temperature_2m', '14'], ['temperature_2m', Number.NaN],
    ['apparent_temperature', Infinity], ['relative_humidity_2m', -1], ['relative_humidity_2m', 101],
    ['wind_speed_10m', -0.1], ['is_day', 2], ['weather_code', 4], ['weather_code', 2.5],
    ['time', null], ['time', '2026-10-22T25:45'], ['time', 'not a date'],
  ])('rejects invalid current %s=%s instead of presenting it as weather', (key, value) => {
    const raw = forecast()
    expect(parseWeather({ ...raw, current: { ...raw.current, [key]: value } })).toBeNull()
  })

  it.each([null, [], {}, { current: null }, { current: [], daily: null }])('rejects incomplete or non-object payload %j', (raw) => {
    expect(parseWeather(raw)).toBeNull()
  })

  it.each([
    { daily: { time: ['2026-10-21'], temperature_2m_max: [14.7], temperature_2m_min: [8.7] } },
    { daily: { time: ['2026-10-22'], temperature_2m_max: [null], temperature_2m_min: [8.7] } },
    { daily: { time: ['2026-10-22'], temperature_2m_max: [7], temperature_2m_min: [8] } },
    { daily: { time: ['2026-10-22'], temperature_2m_max: [], temperature_2m_min: [8.7] } },
    { current_units: { temperature_2m: '°F' } },
    { daily_units: { temperature_2m_max: '°F', temperature_2m_min: '°F' } },
    { timezone: null }, { timezone: '' },
  ])('rejects missing units, malformed daily values or timezone %j', (change) => {
    expect(parseWeather({ ...forecast(), ...change })).toBeNull()
  })

  it('accepts real zero values without replacing them with defaults', () => {
    const raw = forecast()
    expect(parseWeather({ ...raw, current: { ...raw.current, temperature_2m: 0, apparent_temperature: 0, relative_humidity_2m: 0, wind_speed_10m: 0, weather_code: 0, is_day: 0 } }))
      .toMatchObject({ temperature: 0, feelsLike: 0, humidity: 0, wind: 0, code: 0, isDay: false })
  })

  it.each([4, 100, NaN, -1])('does not assign a fabricated condition to unknown code %s', (code) => {
    expect(conditionFor(code, true)).toBeNull()
  })

  it.each([
    [0, true, 'Clear sky', 'sun'], [0, false, 'Clear night', 'moon'],
    [1, true, 'Mainly clear', 'sun-cloud'], [2, false, 'Partly cloudy', 'cloud'],
    [3, true, 'Overcast', 'cloud'], [45, true, 'Fog', 'fog'], [48, false, 'Rime fog', 'fog'],
    [51, true, 'Light drizzle', 'rain'], [53, true, 'Drizzle', 'rain'], [55, true, 'Dense drizzle', 'rain'],
    [56, true, 'Freezing drizzle', 'rain'], [57, true, 'Freezing drizzle', 'rain'],
    [61, true, 'Light rain', 'rain'], [63, true, 'Rain', 'rain'], [65, true, 'Heavy rain', 'rain'],
    [66, true, 'Freezing rain', 'rain'], [67, true, 'Freezing rain', 'rain'],
    [71, true, 'Light snow', 'snow'], [73, true, 'Snow', 'snow'], [75, true, 'Heavy snow', 'snow'],
    [77, true, 'Snow grains', 'snow'], [80, true, 'Light showers', 'rain'], [81, true, 'Showers', 'rain'],
    [82, true, 'Heavy showers', 'rain'], [85, true, 'Snow showers', 'snow'], [86, true, 'Heavy snow showers', 'snow'],
    [95, true, 'Thunderstorm', 'storm'], [96, true, 'Thunderstorm with hail', 'storm'],
    [97, true, 'Heavy thunderstorm', 'storm'],
    [99, true, 'Thunderstorm with hail', 'storm'],
  ] as const)('describes WMO code %s in day=%s without inventing a condition', (code, day, label, icon) => {
    expect(conditionFor(code, day)).toEqual({ label, icon })
  })
})
