const WORLD_BANK_URL = "https://api.worldbank.org/v2";
const NAGER_DATE_URL = "https://date.nager.at/api/v3";
const COUNTRIES_NOW_URL = "https://countriesnow.space/api/v0.1/countries";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest";
const SUN_URL = "https://api.sunrise-sunset.org/json";
export async function fetchJson(url, options = {}) {
  let response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try {
    response = await fetch(url, {
      ...options,
      headers: { Accept: "application/json", ...options.headers },
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("The data service timed out.");
    throw new Error(error instanceof Error ? error.message : "The data service could not be reached.");
  } finally {
    window.clearTimeout(timeout);
  }
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.json();
      detail = typeof body.error === "string" ? ` ${body.error}` : "";
    } catch {
      detail = "";
    }
    throw new Error(`The data service returned ${response.status} ${response.statusText}.${detail}`);
  }
  return response.json();
}

export async function getCountries() {
  const [countryResult, holidayResult, cityDataResult, infoResult] = await Promise.all([
    fetchJson(`${WORLD_BANK_URL}/country?format=json&per_page=400`).then((value) => ({ value }), (error) => ({ error })),
    fetchJson(`${NAGER_DATE_URL}/AvailableCountries`).then((value) => ({ value }), (error) => ({ error })),
    fetchJson(COUNTRIES_NOW_URL).then((value) => ({ value }), (error) => ({ error })),
    fetchJson(`${COUNTRIES_NOW_URL}/info?returns=name,iso2,iso3,capital,currency,flag,unicodeFlag,dialCode`).then((value) => ({ value }), (error) => ({ error }))
  ]);
  if (countryResult.error) throw countryResult.error;
  const response = countryResult.value;
  if (!Array.isArray(response) || !Array.isArray(response[1])) {
    throw new Error(response?.[0]?.message || "The World Bank country service returned an unexpected response.");
  }
  const warnings = [];
  const supportedCodes = new Set();
  if (holidayResult.error) {
    warnings.push(`Holiday country coverage could not be checked: ${holidayResult.error.message}`);
  } else if (Array.isArray(holidayResult.value)) {
    holidayResult.value.forEach((country) => supportedCodes.add(country.countryCode));
  } else {
    warnings.push("The public holiday service returned an unexpected country list.");
  }

  const cityDataByCode = new Map();
  if (cityDataResult.error) {
    warnings.push(`City lists could not be loaded: ${cityDataResult.error.message}`);
  } else if (Array.isArray(cityDataResult.value?.data)) {
    cityDataResult.value.data.forEach((country) => {
      if (country.iso2 && country.country) {
        cityDataByCode.set(country.iso2, {
          name: country.country,
          cities: Array.isArray(country.cities)
            ? [...new Set(country.cities.filter((city) => typeof city === "string" && city.trim()))]
            : []
        });
      }
    });
  } else {
    warnings.push("The city service returned an unexpected country list.");
  }

  const countryInfo = new Map();
  if (infoResult.error) {
    warnings.push(`Some country details could not be loaded: ${infoResult.error.message}`);
  } else if (Array.isArray(infoResult.value?.data)) {
    infoResult.value.data.forEach((country) => {
      if (country.iso2) countryInfo.set(country.iso2, country);
    });
  } else {
    warnings.push("The country-details service returned an unexpected response.");
  }

  const countries = response[1]
    .filter((country) =>
      /^[A-Z]{2}$/.test(country.iso2Code) &&
      country.name &&
      country.iso2Code !== "JG" &&
      country.region?.id !== "NA" &&
      country.region?.value !== "Aggregates"
    )
    .map((country) => {
      const countryData = cityDataByCode.get(country.iso2Code);
      const details = countryInfo.get(country.iso2Code);
      const countryName = countryData?.name || details?.name || country.name;
      const currencyCode = details?.currency;
      return {
        name: { common: countryName },
        cca2: country.iso2Code,
        cca3: country.id,
        capital: details?.capital
          ? [details.capital]
          : country.capitalCity
            ? [country.capitalCity]
          : country.iso2Code === "PS"
            ? ["Ramallah"]
            : [],
        region: country.region?.value || "",
        latitude: country.latitude,
        longitude: country.longitude,
        currencies: currencyCode ? { [currencyCode]: { name: currencyCode } } : {},
        dialCode: details?.dialCode || "",
        flag: details?.flag || "",
        cities: countryData?.cities || [],
        supportsHolidays: holidayResult.error || !Array.isArray(holidayResult.value)
          ? true
          : supportedCodes.has(country.iso2Code),
      };
    })
    .sort((a, b) => a.name.common.localeCompare(b.name.common));
  return { countries, warnings };
}

export async function getCountryStatistics(countryCode) {
  const indicator = async (code) => {
    const response = await fetchJson(`${WORLD_BANK_URL}/country/${encodeURIComponent(countryCode)}/indicator/${code}?format=json&per_page=100`);
    const record = Array.isArray(response) ? response[1]?.find((item) => Number.isFinite(item.value)) : null;
    return record ? { value: record.value, year: record.date } : null;
  };
  const [population, area] = await Promise.all([
    indicator("SP.POP.TOTL"),
    indicator("AG.SRF.TOTL.K2")
  ]);
  return { population, area };
}

export function getCities(country) {
  if (!Array.isArray(country?.cities)) {
    throw new Error(`The city service returned no city list for ${country?.name?.common || "this country"}.`);
  }
  return country.cities;
}

export function getHolidays(countryCode, year) {
  return fetchJson(`${NAGER_DATE_URL}/PublicHolidays/${encodeURIComponent(year)}/${encodeURIComponent(countryCode)}`);
}

export function getLongWeekends(countryCode, year) {
  return fetchJson(`${NAGER_DATE_URL}/LongWeekend/${encodeURIComponent(year)}/${encodeURIComponent(countryCode)}`);
}

export function getEvents(countryCode, city = "") {
  const params = new URLSearchParams({ countryCode, size: "20", sort: "date,asc" });
  if (city) params.set("city", city);
  return fetchJson(`/api/events?${params}`);
}

export async function getCity(city, countryCode) {
  const params = new URLSearchParams({
    name: city,
    count: "10",
    language: "en",
    format: "json"
  });
  const result = await fetchJson(`${GEOCODING_URL}?${params}`);
  const locations = result.results || [];
  const match = locations.find((location) => location.country_code === countryCode);
  if (!match) throw new Error(`No location data was found for ${city}.`);
  return match;
}

export function getWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_direction_10m,uv_index",
    hourly: "temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,relative_humidity_2m_mean,sunrise,sunset,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant",
    timezone: "auto",
    forecast_days: "7"
  });
  return fetchJson(`${WEATHER_URL}?${params}`);
}

export async function getCurrencyRates() {
  const response = await fetchJson(`${EXCHANGE_RATE_URL}/USD`);
  if (response.result !== "success" || response.base_code !== "USD" || !response.rates) {
    throw new Error(response["error-type"] || "The exchange-rate service returned an unexpected response.");
  }
  return response;
}

export async function getSunTimes(latitude, longitude, date) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lng: String(longitude),
    date,
    formatted: "0"
  });
  const response = await fetchJson(`${SUN_URL}?${params}`);
  if (response.status !== "OK") throw new Error("Sunrise and sunset times are unavailable for this location.");
  return response.results;
}

export function weatherDescription(code) {
  if (code === 0) return { text: "Clear sky", icon: "fa-sun", tone: "sunny" };
  if ([1, 2].includes(code)) return { text: "Partly cloudy", icon: "fa-cloud-sun", tone: "cloudy" };
  if (code === 3) return { text: "Overcast", icon: "fa-cloud", tone: "cloudy" };
  if ([45, 48].includes(code)) return { text: "Fog", icon: "fa-smog", tone: "cloudy" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { text: "Rain", icon: "fa-cloud-rain", tone: "rainy" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { text: "Snow", icon: "fa-snowflake", tone: "snowy" };
  if ([95, 96, 99].includes(code)) return { text: "Thunderstorm", icon: "fa-cloud-bolt", tone: "rainy" };
  return { text: "Weather conditions", icon: "fa-cloud", tone: "cloudy" };
}

export function showMessage(container, title, detail, icon = "fa-circle-info") {
  container.replaceChildren();
  const box = document.createElement("div");
  box.className = "data-message";
  const symbol = document.createElement("i");
  symbol.className = `fa-solid ${icon}`;
  const heading = document.createElement("strong");
  heading.textContent = title;
  const paragraph = document.createElement("p");
  paragraph.textContent = detail;
  box.append(symbol, heading, paragraph);
  container.append(box);
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

export function formatDate(date, options = { year: "numeric", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`));
}
