export function forecast() {
  return {
    latitude: 51.51147, longitude: -0.13078308, generationtime_ms: 0.15,
    utc_offset_seconds: 3600, timezone: 'Europe/London', timezone_abbreviation: 'GMT+1', elevation: 16,
    current_units: {
      time: 'iso8601', interval: 'seconds', temperature_2m: '°C', relative_humidity_2m: '%',
      apparent_temperature: '°C', is_day: '', weather_code: 'wmo code', wind_speed_10m: 'km/h',
    },
    current: {
      time: '2026-10-22T17:45', interval: 900, temperature_2m: 14.3, relative_humidity_2m: 55,
      apparent_temperature: 12.1, is_day: 1, weather_code: 2, wind_speed_10m: 7.9,
    },
    daily_units: { time: 'iso8601', temperature_2m_max: '°C', temperature_2m_min: '°C' },
    daily: { time: ['2026-10-22'], temperature_2m_max: [14.7], temperature_2m_min: [8.7] },
  }
}
