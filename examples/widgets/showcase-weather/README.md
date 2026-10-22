# Live weather

An installable Vue widget built with the LifeDashboard SDK. It shows current model-derived conditions, a daily high/low, feels-like temperature, humidity and wind. Compact frames keep the temperature, condition and source; the daily range appears when height allows. All temperatures use Celsius; wind uses km/h.

From the repository root:

```sh
pnpm install
pnpm -C examples/widgets/showcase-weather dev
pnpm -C examples/widgets/showcase-weather check
pnpm -C examples/widgets/showcase-weather build
```

Install the generated `dist/dev.lifedashboard.showcase.weather-1.0.0/` folder through the dashboard package manager. The manifest requests only `network` access to `https://api.open-meteo.com`; no API key is needed. Configure the city label, latitude and longitude in widget settings. The city label does not geocode coordinates. Defaults are London, `51.5074`, `-0.1278`.

Data refreshes every 15 minutes while the widget is visible. Use Refresh for an immediate update. A failed refresh keeps the last verified data with a Stale label; without a verified response the widget shows Weather unavailable. Changing coordinates clears the previous data and ignores any older in-flight responses; changing only the city label keeps the current data. There is no sample-data fallback or persisted weather cache.

Weather data by [Open-Meteo](https://open-meteo.com/), using its [Forecast API and WMO condition codes](https://open-meteo.com/en/docs). Current conditions come from weather models, not a local sensor. The displayed time is the response's local time for the configured coordinates, independent of the dashboard computer's timezone. Displayed numeric values are rounded; other source values are unchanged.

Open-Meteo data uses [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); see the provider's [data sources and attribution requirements](https://open-meteo.com/en/licence). This example uses the **free endpoint for non-commercial use**, subject to [Open-Meteo's terms and usage limits](https://open-meteo.com/en/terms). Commercial use requires an appropriate provider plan and is outside this example's endpoint configuration.

The sandbox displays the provider name as plain text because external navigation is blocked. When publishing or reusing screenshots or weather data, place clickable Open-Meteo source and licence attribution beside them, as in the repository gallery.

Run focused parser, condition and refresh lifecycle tests with `pnpm -C examples/widgets/showcase-weather test`.
