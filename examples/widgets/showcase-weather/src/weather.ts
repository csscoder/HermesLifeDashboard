export type WeatherIcon = 'sun' | 'moon' | 'sun-cloud' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

export interface WeatherSnapshot {
  temperature: number
  feelsLike: number
  humidity: number
  wind: number
  high: number
  low: number
  code: number
  isDay: boolean
  localTime: string
  timezone: string
}

const CONDITIONS: Record<number, { label: string; icon: WeatherIcon }> = {
  0: { label: 'Clear sky', icon: 'sun' },
  1: { label: 'Mainly clear', icon: 'sun-cloud' },
  2: { label: 'Partly cloudy', icon: 'sun-cloud' },
  3: { label: 'Overcast', icon: 'cloud' },
  45: { label: 'Fog', icon: 'fog' }, 48: { label: 'Rime fog', icon: 'fog' },
  51: { label: 'Light drizzle', icon: 'rain' }, 53: { label: 'Drizzle', icon: 'rain' }, 55: { label: 'Dense drizzle', icon: 'rain' },
  56: { label: 'Freezing drizzle', icon: 'rain' }, 57: { label: 'Freezing drizzle', icon: 'rain' },
  61: { label: 'Light rain', icon: 'rain' }, 63: { label: 'Rain', icon: 'rain' }, 65: { label: 'Heavy rain', icon: 'rain' },
  66: { label: 'Freezing rain', icon: 'rain' }, 67: { label: 'Freezing rain', icon: 'rain' },
  71: { label: 'Light snow', icon: 'snow' }, 73: { label: 'Snow', icon: 'snow' }, 75: { label: 'Heavy snow', icon: 'snow' },
  77: { label: 'Snow grains', icon: 'snow' },
  80: { label: 'Light showers', icon: 'rain' }, 81: { label: 'Showers', icon: 'rain' }, 82: { label: 'Heavy showers', icon: 'rain' },
  85: { label: 'Snow showers', icon: 'snow' }, 86: { label: 'Heavy snow showers', icon: 'snow' },
  95: { label: 'Thunderstorm', icon: 'storm' },
  97: { label: 'Heavy thunderstorm', icon: 'storm' },
  96: { label: 'Thunderstorm with hail', icon: 'storm' }, 99: { label: 'Thunderstorm with hail', icon: 'storm' },
}

export function conditionFor(code: number, isDay: boolean): { label: string; icon: WeatherIcon } | null {
  const condition = CONDITIONS[code]
  if (!condition) return null
  if (!isDay && code === 0) return { label: 'Clear night', icon: 'moon' }
  if (!isDay && (code === 1 || code === 2)) return { ...condition, icon: 'cloud' }
  return condition
}

export function parseWeather(value: unknown): WeatherSnapshot | null {
  if (!record(value) || !record(value.current) || !record(value.daily) ||
    !record(value.current_units) || !record(value.daily_units)) return null
  const { current, daily, current_units: units, daily_units: dailyUnits } = value
  const high = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : null
  const low = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : null
  if (
    !finite(current.temperature_2m) || !finite(current.apparent_temperature) ||
    !finite(current.relative_humidity_2m) || current.relative_humidity_2m < 0 || current.relative_humidity_2m > 100 ||
    !finite(current.wind_speed_10m) || current.wind_speed_10m < 0 ||
    !finite(current.weather_code) || !conditionFor(current.weather_code, true) ||
    (current.is_day !== 0 && current.is_day !== 1) ||
    typeof current.time !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d$/.test(current.time) ||
    !Array.isArray(daily.time) || daily.time[0] !== current.time.slice(0, 10) ||
    !finite(high) || !finite(low) || high < low ||
    typeof value.timezone !== 'string' || !/^[A-Za-z0-9_+./-]{1,80}$/.test(value.timezone) ||
    units.time !== 'iso8601' || units.temperature_2m !== '°C' || units.apparent_temperature !== '°C' ||
    units.relative_humidity_2m !== '%' || units.wind_speed_10m !== 'km/h' ||
    dailyUnits.temperature_2m_max !== '°C' || dailyUnits.temperature_2m_min !== '°C'
  ) return null
  return {
    temperature: current.temperature_2m, feelsLike: current.apparent_temperature,
    humidity: current.relative_humidity_2m, wind: current.wind_speed_10m, high, low,
    code: current.weather_code, isDay: current.is_day === 1,
    localTime: current.time.slice(11, 16), timezone: value.timezone,
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function weatherUrl(location: { latitude: number; longitude: number }): string {
  return `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({
    latitude: String(location.latitude), longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min', timezone: 'auto', forecast_days: '1',
    temperature_unit: 'celsius', wind_speed_unit: 'kmh',
  })}`
}
