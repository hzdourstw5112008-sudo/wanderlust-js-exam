window.__WanderlustModules = window.__WanderlustModules || {};
(() => {
const WORLD_BANK_URL = "https://api.worldbank.org/v2";
const NAGER_DATE_URL = "https://date.nager.at/api/v3";
const COUNTRIES_NOW_URL = "https://countriesnow.space/api/v0.1/countries";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
const EXCHANGE_RATE_URL = "https://open.er-api.com/v6/latest";
const SUN_URL = "https://api.sunrise-sunset.org/json";
async function fetchJson(url, options = {}) {
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

async function getCountries() {
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

async function getCountryStatistics(countryCode) {
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

function getCities(country) {
  if (!Array.isArray(country?.cities)) {
    throw new Error(`The city service returned no city list for ${country?.name?.common || "this country"}.`);
  }
  return country.cities;
}

function getHolidays(countryCode, year) {
  return fetchJson(`${NAGER_DATE_URL}/PublicHolidays/${encodeURIComponent(year)}/${encodeURIComponent(countryCode)}`);
}

function getLongWeekends(countryCode, year) {
  return fetchJson(`${NAGER_DATE_URL}/LongWeekend/${encodeURIComponent(year)}/${encodeURIComponent(countryCode)}`);
}

function getEvents(countryCode, city = "") {
  const params = new URLSearchParams({ countryCode, size: "20", sort: "date,asc" });
  if (city) params.set("city", city);
  return fetchJson(`/api/events?${params}`);
}

async function getCity(city, countryCode) {
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

function getWeather(latitude, longitude) {
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

async function getCurrencyRates() {
  const response = await fetchJson(`${EXCHANGE_RATE_URL}/USD`);
  if (response.result !== "success" || response.base_code !== "USD" || !response.rates) {
    throw new Error(response["error-type"] || "The exchange-rate service returned an unexpected response.");
  }
  return response;
}

async function getSunTimes(latitude, longitude, date) {
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

function weatherDescription(code) {
  if (code === 0) return { text: "Clear sky", icon: "fa-sun", tone: "sunny" };
  if ([1, 2].includes(code)) return { text: "Partly cloudy", icon: "fa-cloud-sun", tone: "cloudy" };
  if (code === 3) return { text: "Overcast", icon: "fa-cloud", tone: "cloudy" };
  if ([45, 48].includes(code)) return { text: "Fog", icon: "fa-smog", tone: "cloudy" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { text: "Rain", icon: "fa-cloud-rain", tone: "rainy" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { text: "Snow", icon: "fa-snowflake", tone: "snowy" };
  if ([95, 96, 99].includes(code)) return { text: "Thunderstorm", icon: "fa-cloud-bolt", tone: "rainy" };
  return { text: "Weather conditions", icon: "fa-cloud", tone: "cloudy" };
}

function showMessage(container, title, detail, icon = "fa-circle-info") {
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

function formatDate(date, options = { year: "numeric", month: "short", day: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(`${date}T12:00:00`));
}

window.__WanderlustModules['api'] = {'fetchJson': fetchJson, 'getCountries': getCountries, 'getCountryStatistics': getCountryStatistics, 'getCities': getCities, 'getHolidays': getHolidays, 'getLongWeekends': getLongWeekends, 'getEvents': getEvents, 'getCity': getCity, 'getWeather': getWeather, 'getCurrencyRates': getCurrencyRates, 'getSunTimes': getSunTimes, 'weatherDescription': weatherDescription, 'showMessage': showMessage, 'escapeHtml': escapeHtml, 'formatDate': formatDate};
})();
(() => {
const { getCurrencyRates, showMessage } = window.__WanderlustModules['api'];
const QUICK_CONVERT_COUNTRIES = {
  EUR: "DE",
  GBP: "GB",
  EGP: "EG",
  AED: "AE",
  SAR: "SA",
  JPY: "JP",
  CAD: "CA",
  INR: "IN",
  USD: "US"
};

function currencyFormat(value, code) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: code, maximumFractionDigits: 2 }).format(value);
}

class Currency {
  constructor({ onError }) {
    this.onError = onError;
    this.amountInput = document.getElementById("currency-amount");
    this.fromSelect = document.getElementById("currency-from");
    this.toSelect = document.getElementById("currency-to");
    this.result = document.getElementById("currency-result");
    this.popular = document.getElementById("popular-currencies");
    this.names = {};
    this.currencyCodes = [];
    this.currencyCountries = new Map();
    this.usdRates = {};
    this.updatedUtc = "";
    this.requestId = 0;
    this.initialization = null;
    this.destinationCountryCode = "";
    this.fromSelect.replaceChildren(new Option("Loading currencies…", ""));
    this.toSelect.replaceChildren(new Option("Loading currencies…", ""));
    showMessage(this.result, "Loading exchange rates", "Fetching current rates from ExchangeRate-API.", "fa-spinner fa-spin");
    this.popular.replaceChildren();
    document.querySelector("#currency-view .view-header-content p").textContent =
      "Live rates from ExchangeRate-API · updated once per day.";
    document.getElementById("convert-btn").addEventListener("click", () => this.convert());
    document.getElementById("swap-currencies-btn").addEventListener("click", () => this.swap());
    this.fromSelect.addEventListener("change", () => this.convert());
    this.toSelect.addEventListener("change", () => this.convert());
  }

  initialize(country, countries = []) {
    const countryCode = country?.cca2 || "";
    const destinationCurrency = Object.keys(country?.currencies || {})[0] || "";
    const countryChanged = countryCode !== this.destinationCountryCode;
    this.destinationCountryCode = countryCode;
    this.updateCurrencyCountries(countries);
    if (!this.initialization) return this.initialization = this.loadCurrencies(destinationCurrency);
    if (countryChanged && this.currencyCodes.includes(destinationCurrency)) {
      this.toSelect.value = destinationCurrency;
    }
    return this.convert();
  }

  updateCurrencyCountries(countries) {
    const countryByCode = new Map(countries.map((country) => [country.cca2, country]));
    this.currencyCountries.clear();
    Object.entries(QUICK_CONVERT_COUNTRIES).forEach(([currency, countryCode]) => {
      const country = countryByCode.get(countryCode);
      if (country) this.currencyCountries.set(currency, country);
    });
    countries.forEach((country) => {
      Object.keys(country.currencies || {}).forEach((currency) => {
        if (!this.currencyCountries.has(currency)) this.currencyCountries.set(currency, country);
      });
    });
  }

  async loadCurrencies(destinationCurrency) {
    try {
      const response = await getCurrencyRates();
      this.usdRates = response.rates;
      this.updatedUtc = response.time_last_update_utc;
      const displayNames = typeof Intl.DisplayNames === "function"
        ? new Intl.DisplayNames(["en"], { type: "currency" })
        : null;
      this.currencyCodes = Object.keys(this.usdRates)
        .filter((code) => Number.isFinite(this.usdRates[code]) && this.usdRates[code] > 0)
        .sort();
      this.names = Object.fromEntries(this.currencyCodes.map((code) => [code, displayNames?.of(code) || code]));
      if (!this.currencyCodes.length) throw new Error("The currency service returned no supported currencies.");
      this.populateSelect(this.fromSelect, "USD");
      this.populateSelect(this.toSelect, destinationCurrency || "EGP");
      await this.convert();
    } catch (error) {
      this.initialization = null;
      showMessage(this.result, "Exchange rates unavailable", error.message, "fa-triangle-exclamation");
      this.onError(`Currency list: ${error.message}`);
    }
  }

  populateSelect(select, preferred) {
    select.replaceChildren();
    this.currencyCodes.forEach((code) => select.add(new Option(`${code} — ${this.names[code]}`, code)));
    select.value = this.currencyCodes.includes(preferred) ? preferred : this.currencyCodes[0];
  }

  swap() {
    const from = this.fromSelect.value;
    this.fromSelect.value = this.toSelect.value;
    this.toSelect.value = from;
    this.convert();
  }

  async convert() {
    const requestId = ++this.requestId;
    const amount = Number(this.amountInput.value);
    const base = this.fromSelect.value;
    const quote = this.toSelect.value;
    if (!Number.isFinite(amount) || amount < 0 || !base || !quote) {
      showMessage(this.result, "Check your conversion", "Enter a non-negative amount and choose both currencies.", "fa-triangle-exclamation");
      return;
    }
    try {
      const rate = this.usdRates[quote] / this.usdRates[base];
      if (!Number.isFinite(rate)) throw new Error(`No ${base} to ${quote} exchange rate was returned.`);
      this.renderResult(amount, base, quote, rate, this.updatedUtc);
      this.renderPopular(base, requestId);
    } catch (error) {
      if (requestId !== this.requestId) return;
      showMessage(this.result, "Could not convert currency", error.message, "fa-triangle-exclamation");
      this.onError(`Currency conversion: ${error.message}`);
    }
  }

  renderResult(amount, base, quote, rate, updatedUtc) {
    this.result.replaceChildren();
    const display = document.createElement("div");
    display.className = "conversion-display";
    const from = document.createElement("div");
    from.className = "conversion-from";
    const fromAmount = document.createElement("span");
    fromAmount.className = "amount";
    fromAmount.textContent = currencyFormat(amount, base);
    const fromCode = document.createElement("span");
    fromCode.className = "currency-code";
    fromCode.textContent = base;
    from.append(fromAmount, fromCode);
    const equals = document.createElement("div");
    equals.className = "conversion-equals";
    equals.innerHTML = '<i class="fa-solid fa-equals"></i>';
    const to = document.createElement("div");
    to.className = "conversion-to";
    const toAmount = document.createElement("span");
    toAmount.className = "amount";
    toAmount.textContent = currencyFormat(amount * rate, quote);
    const toCode = document.createElement("span");
    toCode.className = "currency-code";
    toCode.textContent = quote;
    to.append(toAmount, toCode);
    const details = document.createElement("div");
    details.className = "exchange-rate-info";
    const rateText = document.createElement("p");
    rateText.textContent = `1 ${base} = ${new Intl.NumberFormat(undefined, { maximumSignificantDigits: 7 }).format(rate)} ${quote}`;
    const dateText = document.createElement("small");
    dateText.textContent = base === quote
      ? "No exchange rate needed for identical currencies."
      : `Rates updated: ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(updatedUtc))} UTC`;
    const attribution = document.createElement("a");
    attribution.href = "https://www.exchangerate-api.com";
    attribution.target = "_blank";
    attribution.rel = "noopener noreferrer";
    attribution.textContent = "Rates by ExchangeRate-API";
    details.append(rateText, dateText, attribution);
    display.append(from, equals, to);
    this.result.append(display, details);
  }

  renderPopular(base, requestId) {
    const preferred = Object.keys(QUICK_CONVERT_COUNTRIES);
    const targets = [...new Set([
      ...preferred,
      ...this.currencyCodes
    ])].filter((code) => code !== base && this.currencyCodes.includes(code)).slice(0, 8);
    const heading = document.querySelector("#currency-view .section-header h2");
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-star";
    const label = document.createTextNode(` Rates from ${base}`);
    heading.replaceChildren(icon, label);
    if (!targets.length) {
      this.popular.replaceChildren();
      return;
    }
    if (requestId !== this.requestId) return;
    this.popular.replaceChildren();
    targets.forEach((code) => {
      const value = this.usdRates[code] / this.usdRates[base];
      if (!Number.isFinite(value)) throw new Error(`No live ${base} to ${code} rate was returned.`);
      const card = document.createElement("div");
      card.className = "popular-currency-card";
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      const country = this.currencyCountries.get(code);
      const countryName = country?.name.common || this.names[code];
      if (country?.cca2) {
        const flag = document.createElement("img");
        flag.className = "flag";
        flag.src = `https://flagcdn.com/w40/${encodeURIComponent(country.cca2.toLowerCase())}.png`;
        flag.alt = `${countryName} flag`;
        flag.loading = "lazy";
        flag.addEventListener("error", () => flag.remove(), { once: true });
        card.append(flag);
      }
      const info = document.createElement("div");
      info.className = "info";
      const currencyCode = document.createElement("div");
      currencyCode.className = "code";
      currencyCode.textContent = code;
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = countryName;
      const rate = document.createElement("div");
      rate.className = "rate";
      rate.textContent = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
      info.append(currencyCode, name);
      card.append(info, rate);
      card.setAttribute("aria-label", `Convert to ${countryName} ${code}`);
      card.addEventListener("click", () => {
        this.toSelect.value = code;
        this.convert();
      });
      card.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.toSelect.value = code;
          this.convert();
        }
      });
      this.popular.append(card);
    });
  }
}
window.__WanderlustModules['currency'] = {default: Currency};
})();
(() => {
const { escapeHtml, getCities, getCity, getCountryStatistics, showMessage } = window.__WanderlustModules['api'];
const CITY_SEARCH_THRESHOLD = 100;
const CITY_OPTION_LIMIT = 100;
function countryFlag(country, size = 160) {
  const code = country?.cca2?.toLowerCase();
  return code ? `https://flagcdn.com/w${size}/${encodeURIComponent(code)}.png` : "";
}

function countryFlagEmoji(code) {
  return [...code.toUpperCase()].map((character) =>
    String.fromCodePoint(character.charCodeAt(0) + 127397)
  ).join("");
}

function countryNumber(statistic, suffix = "") {
  return Number.isFinite(statistic?.value)
    ? `${new Intl.NumberFormat().format(statistic.value)}${suffix}${statistic.year ? ` (${statistic.year})` : ""}`
    : "Not available";
}

function weekStart(countryCode) {
  try {
    const locale = new Intl.Locale(`en-${countryCode}`);
    const firstDay = locale.weekInfo?.firstDay || locale.getWeekInfo?.().firstDay;
    return firstDay ? new Intl.DateTimeFormat("en", { weekday: "long", timeZone: "UTC" })
      .format(new Date(Date.UTC(2023, 0, firstDay % 7 + 1))) : "Not available";
  } catch {
    return "Not available";
  }
}

class Dashboard {
  constructor({ onExplore, onSelectionChange, onError }) {
    this.countrySelect = document.getElementById("global-country");
    this.countrySelect.hidden = true;
    this.countrySelect.tabIndex = -1;
    this.countrySelect.setAttribute("aria-hidden", "true");
    this.countrySearch = document.createElement("input");
    this.countrySearch.type = "search";
    this.countrySearch.className = "form-select country-search-input";
    this.countrySearch.placeholder = "Search countries...";
    this.countrySearch.autocomplete = "off";
    this.countrySearch.setAttribute("role", "combobox");
    this.countrySearch.setAttribute("aria-label", "Search countries");
    this.countrySearch.setAttribute("aria-autocomplete", "list");
    this.countrySearch.setAttribute("aria-expanded", "false");
    this.countrySearch.disabled = true;
    this.countrySelect.parentElement.insertBefore(this.countrySearch, this.countrySelect);
    this.countryMenu = document.createElement("div");
    this.countryMenu.className = "country-search-menu";
    this.countryMenu.id = "global-country-options";
    this.countryMenu.hidden = true;
    this.countryMenu.setAttribute("role", "listbox");
    this.countrySearch.setAttribute("aria-controls", this.countryMenu.id);
    this.countrySelect.parentElement.append(this.countryMenu);
    this.activeCountryIndex = -1;
    this.cityInput = document.getElementById("global-city");
    this.citySearch = document.createElement("input");
    this.citySearch.className = this.cityInput.className;
    this.citySearch.type = "search";
    this.citySearch.autocomplete = "off";
    this.citySearch.setAttribute("aria-label", "Search cities");
    this.citySearch.placeholder = "Search cities...";
    this.citySearch.hidden = true;
    this.citySearch.disabled = true;
    this.cityInput.parentElement.insertBefore(this.citySearch, this.cityInput);
    this.yearSelect = document.getElementById("global-year");
    this.initialCountrySelection = this.countrySelect.value;
    this.initialCity = this.cityInput.value || "";
    this.onExplore = onExplore;
    this.onSelectionChange = onSelectionChange;
    this.onError = onError;
    this.countries = [];
    this.country = null;
    this.countryStatistics = null;
    this.city = "";
    this.cityOptions = [];
    this.year = Number(this.yearSelect.value) || new Date().getFullYear();
    this.timeZone = "";
    this.statisticsRequest = 0;
    this.timeZoneRequest = 0;
    this.cityRequest = 0;
    const currentYear = new Date().getFullYear();
    this.yearSelect.replaceChildren(...Array.from({ length: 5 }, (_, index) => {
      const year = currentYear - 1 + index;
      return new Option(String(year), String(year));
    }));
    this.yearSelect.value = String(currentYear);
    document.getElementById("global-search-btn").addEventListener("click", () => this.explore());
    this.countrySearch.addEventListener("focus", () => {
      if (this.findCountry(this.countrySearch.value)?.cca2 === this.country?.cca2) {
        this.countrySearch.value = "";
      }
      this.updateCountrySuggestions(true);
    });
    this.countrySearch.addEventListener("input", () => this.updateCountrySuggestions(true));
    this.countrySearch.addEventListener("keydown", (event) => this.handleCountryKeydown(event));
    this.countrySearch.addEventListener("blur", () => {
      if (this.country && this.countryMenu.hidden) this.countrySearch.value = this.country.name.common;
    });
    this.countrySelect.addEventListener("change", () => {
      const country = this.findCountry(this.countrySelect.value);
      if (country) this.selectCountry(country.cca2);
      else this.clearSelection();
    });
    document.addEventListener("pointerdown", (event) => {
      if (!this.countrySearch.parentElement.contains(event.target)) this.closeCountryMenu();
    });
    this.cityInput.addEventListener("change", () => {
      this.city = this.cityInput.value.trim();
      this.loadLocalTimeZone();
      this.updateSelectedDestination();
      this.onSelectionChange();
    });
    this.citySearch.addEventListener("input", () => this.renderCityOptions());
    this.cityInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.cityInput.blur();
      }
    });
    this.yearSelect.addEventListener("change", () => {
      this.year = Number(this.yearSelect.value);
      document.getElementById("stat-holidays").textContent = "—";
      this.onSelectionChange();
    });
    document.getElementById("clear-selection-btn").addEventListener("click", () => this.clearSelection());
    this.countrySelect.disabled = true;
    this.countrySearch.disabled = true;
    this.cityInput.value = "";
    this.cityInput.disabled = true;
    document.getElementById("selected-destination").classList.add("hidden");
    showMessage(document.getElementById("dashboard-country-info"), "Loading destination data", "Country information will appear when the public country service responds.", "fa-spinner fa-spin");
    this.updateStats();
  }

  setCountries(countries) {
    this.countries = countries;
    this.countrySelect.replaceChildren(
      new Option("Select a country", ""),
      ...countries.map((country) => new Option(country.name.common, country.cca2))
    );
    this.countrySelect.disabled = false;
    this.countrySearch.disabled = false;
    this.updateCountrySuggestions();
    const initialSelection = this.initialCountrySelection.trim().toLocaleLowerCase();
    const preferred = countries.find((country) =>
      country.cca2.toLocaleLowerCase() === initialSelection ||
      country.name.common.toLocaleLowerCase() === initialSelection
    );
    if (preferred) this.selectCountry(preferred.cca2, false);
    else this.clearSelection();
    this.updateStats();
  }

  findCountry(value) {
    const query = value.trim().toLocaleLowerCase();
    return this.countries.find((country) =>
      country.name.common.toLocaleLowerCase() === query ||
      country.cca2.toLocaleLowerCase() === query
    );
  }

  updateCountrySuggestions(open = false) {
    const query = this.countrySearch.value.trim().toLocaleLowerCase();
    const matches = this.countries.filter((country) =>
      !query || country.name.common.toLocaleLowerCase().includes(query)
    );
    this.activeCountryIndex = -1;
    this.countrySearch.removeAttribute("aria-activedescendant");
    this.countryMenu.replaceChildren();
    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "country-search-empty";
      empty.textContent = "No countries found";
      this.countryMenu.append(empty);
    } else {
      matches.forEach((country, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "country-search-option";
        option.id = `country-option-${country.cca2.toLowerCase()}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", "false");
        const flag = document.createElement("img");
        flag.className = "country-option-flag";
        flag.src = countryFlag(country, 40);
        flag.alt = "";
        flag.loading = "lazy";
        flag.addEventListener("error", () => {
          const fallback = document.createElement("span");
          fallback.className = "country-option-flag-fallback";
          fallback.textContent = countryFlagEmoji(country.cca2);
          flag.replaceWith(fallback);
        }, { once: true });
        const name = document.createElement("span");
        name.className = "country-option-name";
        name.textContent = country.name.common;
        const code = document.createElement("span");
        code.className = "country-option-code";
        code.textContent = country.cca2;
        option.append(flag, name, code);
        option.addEventListener("mousedown", (event) => event.preventDefault());
        option.addEventListener("click", () => this.selectCountry(country.cca2));
        option.addEventListener("pointerenter", () => this.setActiveCountryOption(index));
        this.countryMenu.append(option);
      });
    }
    this.countryMenu.hidden = !open || this.countrySearch.disabled;
    this.countrySearch.setAttribute("aria-expanded", String(!this.countryMenu.hidden));
  }

  handleCountryKeydown(event) {
    const options = this.countryMenu.querySelectorAll(".country-search-option");
    if (event.key === "Escape") {
      this.closeCountryMenu();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (this.countryMenu.hidden) this.updateCountrySuggestions(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      const next = this.activeCountryIndex < 0
        ? direction > 0 ? 0 : options.length - 1
        : (this.activeCountryIndex + direction + options.length) % options.length;
      this.setActiveCountryOption(next);
      return;
    }
    if (event.key === "Enter" && !this.countryMenu.hidden && this.activeCountryIndex >= 0) {
      event.preventDefault();
      options[this.activeCountryIndex]?.click();
    }
  }

  setActiveCountryOption(index) {
    const options = this.countryMenu.querySelectorAll(".country-search-option");
    if (!options.length || index < 0 || index >= options.length) return;
    this.activeCountryIndex = index;
    options.forEach((option, optionIndex) => {
      const active = optionIndex === index;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    });
    this.countrySearch.setAttribute("aria-activedescendant", options[index].id);
  }

  closeCountryMenu() {
    this.countryMenu.hidden = true;
    this.countrySearch.setAttribute("aria-expanded", "false");
    this.countrySearch.removeAttribute("aria-activedescendant");
  }

  selectCountry(code, notify = true) {
    this.cityRequest += 1;
    this.country = this.countries.find((country) => country.cca2 === code) || null;
    this.countryStatistics = null;
    this.timeZone = "";
    document.getElementById("stat-holidays").textContent = "—";
    const capitals = this.country?.capital || [];
    const previousCity = this.city || this.initialCity;
    this.cityOptions = capitals;
    this.city = capitals.includes(previousCity) ? previousCity : capitals[0] || "";
    this.countrySelect.value = this.country?.cca2 || "";
    this.countrySearch.value = this.country?.name.common || "";
    this.closeCountryMenu();
    this.cityInput.replaceChildren(new Option(this.country ? "Loading cities..." : "Select a country first", ""));
    this.cityInput.value = "";
    this.cityInput.disabled = !this.country;
    this.citySearch.value = "";
    this.citySearch.hidden = true;
    this.citySearch.disabled = true;
    this.renderCountry();
    this.updateSelectedDestination();
    this.loadCountryStatistics();
    this.loadLocalTimeZone();
    if (this.country) this.loadCities(this.country, this.cityRequest, notify);
    if (notify) this.onSelectionChange();
  }

  async loadCities(country, requestId, notify) {
    try {
      const cities = await getCities(country);
      if (requestId !== this.cityRequest || this.country?.cca2 !== country.cca2) return;
      const capitals = country.capital || [];
      this.cityOptions = [...new Set([...capitals, ...cities])];
      const currentCity = this.city;
      this.city = this.cityOptions.find((city) => city.toLocaleLowerCase() === currentCity.toLocaleLowerCase()) ||
        capitals[0] ||
        this.cityOptions[0] ||
        "";
      this.citySearch.hidden = this.cityOptions.length <= CITY_SEARCH_THRESHOLD;
      this.citySearch.disabled = !this.cityOptions.length;
      this.citySearch.placeholder = `Search ${new Intl.NumberFormat().format(this.cityOptions.length)} cities...`;
      this.renderCityOptions();
      this.updateSelectedDestination();
      if (this.city !== currentCity) {
        this.loadLocalTimeZone();
        if (notify) this.onSelectionChange();
      }
    } catch (error) {
      if (requestId !== this.cityRequest || this.country?.cca2 !== country.cca2) return;
      this.cityOptions = country.capital || [];
      this.city = this.cityOptions[0] || "";
      this.renderCityOptions();
      this.updateSelectedDestination();
      this.onError(`Cities for ${country.name.common}: ${error.message}`);
    }
  }

  renderCityOptions() {
    const query = this.citySearch.value.trim().toLocaleLowerCase();
    const matches = this.cityOptions.filter((city) => city.toLocaleLowerCase().includes(query));
    const limited = this.citySearch.hidden ? matches : matches.slice(0, CITY_OPTION_LIMIT);
    if (this.city && matches.some((city) => city === this.city) && !limited.includes(this.city)) {
      limited.push(this.city);
    }
    this.cityInput.replaceChildren(new Option(
      !this.cityOptions.length
        ? "No cities available"
        : matches.length
          ? "Select city"
          : "No matching cities",
      ""
    ));
    limited.forEach((city) => this.cityInput.add(new Option(city, city)));
    this.cityInput.disabled = this.cityOptions.length === 0;
    this.cityInput.value = limited.includes(this.city) ? this.city : "";
  }

  getSelection() {
    return { country: this.country, city: this.city, year: this.year };
  }

  async explore() {
    const selectedCountry = this.findCountry(this.countrySelect.value);
    if (!selectedCountry || this.countrySearch.value.trim().toLocaleLowerCase() !== selectedCountry.name.common.toLocaleLowerCase()) {
      this.onError("Choose a country from the search results before exploring.");
      return;
    }
    this.country = selectedCountry;
    this.year = Number(this.yearSelect.value);
    this.city = this.cityInput.value.trim();
    this.updateSelectedDestination();
    await this.onExplore(this.getSelection());
  }

  clearSelection() {
    this.statisticsRequest += 1;
    this.timeZoneRequest += 1;
    this.country = null;
    this.countryStatistics = null;
    this.timeZone = "";
    this.cityOptions = [];
    this.cityRequest += 1;
    this.citySearch.value = "";
    this.citySearch.hidden = true;
    this.citySearch.disabled = true;
    document.getElementById("stat-holidays").textContent = "—";
    this.city = "";
    this.countrySelect.value = "";
    this.countrySearch.value = "";
    this.updateCountrySuggestions();
    this.cityInput.replaceChildren(new Option("Select a country first", ""));
    this.cityInput.disabled = true;
    this.cityInput.value = "";
    document.getElementById("selected-destination").classList.add("hidden");
    document.getElementById("dashboard-country-info-section").classList.remove("hidden");
    showMessage(document.getElementById("dashboard-country-info"), "No Country Selected", "Select a country above and click Explore to see detailed information.");
    this.onSelectionChange();
  }

  updateSelectedDestination() {
    const destination = document.getElementById("selected-destination");
    if (!this.country) {
      destination.classList.add("hidden");
      return;
    }
    destination.classList.remove("hidden");
    const flag = document.getElementById("selected-country-flag");
    flag.src = countryFlag(this.country, 80);
    flag.alt = this.country.name.common;
    document.getElementById("selected-country-name").textContent = this.country.name.common;
    document.getElementById("selected-city-name").textContent = this.city ? `• ${this.city}` : "";
  }

  updateStats() {
    document.getElementById("stat-countries").textContent = this.countries.length
      ? new Intl.NumberFormat().format(this.countries.length)
      : "—";
    document.getElementById("stat-holidays").textContent = "—";
  }

  async loadCountryStatistics() {
    const requestId = ++this.statisticsRequest;
    const country = this.country;
    if (!country) return;
    try {
      const statistics = await getCountryStatistics(country.cca2);
      if (requestId !== this.statisticsRequest || this.country?.cca2 !== country.cca2) return;
      this.countryStatistics = statistics;
      this.renderCountry();
    } catch (error) {
      if (requestId !== this.statisticsRequest) return;
      this.onError(`Country statistics: ${error.message}`);
    }
  }

  async loadLocalTimeZone() {
    const requestId = ++this.timeZoneRequest;
    const country = this.country;
    const city = this.city;
    this.timeZone = "";
    this.updateLocalTime();
    if (!country || !city) return;
    try {
      const location = await getCity(city, country.cca2);
      if (requestId !== this.timeZoneRequest || this.country?.cca2 !== country.cca2 || this.city !== city) return;
      this.timeZone = location.timezone || "";
      this.updateLocalTime();
    } catch (error) {
      if (requestId !== this.timeZoneRequest) return;
      this.onError(`Local time: ${error.message}`);
    }
  }

  renderCountry() {
    const section = document.getElementById("dashboard-country-info-section");
    const container = document.getElementById("dashboard-country-info");
    if (!this.country) {
      section.classList.remove("hidden");
      showMessage(container, "No Country Selected", "Select a country above and click Explore to see detailed information.");
      return;
    }
    section.classList.remove("hidden");
    const country = this.country;
    const name = escapeHtml(country.name.common);
    const region = [country.region, country.subregion].filter(Boolean).map(escapeHtml).join(" • ");
    const flag = countryFlag(country);
    const currencyNames = typeof Intl.DisplayNames === "function"
      ? new Intl.DisplayNames(undefined, { type: "currency" })
      : null;
    const currencyValues = Object.entries(country.currencies || {}).map(([code, details]) =>
      `${details.name && details.name !== code ? details.name : currencyNames?.of(code) || code} (${code}${details.symbol ? ` ${details.symbol}` : ""})`);
    const languageValues = Object.values(country.languages || {});
    const details = [
      ["fa-building-columns", "Capital", (country.capital || []).join(", ") || "Not available"],
      ["fa-users", "Population", countryNumber(this.countryStatistics?.population)],
      ["fa-ruler-combined", "Area", countryNumber(this.countryStatistics?.area, " km²")],
      ["fa-globe", "Region", country.region || "Not available"],
      ["fa-phone", "Calling Code", country.dialCode ? `+${country.dialCode}` : "Not available"],
      ["fa-car", "Driving Side", "Not available"],
      ["fa-calendar-week", "Week Starts", weekStart(country.cca2)]
    ];
    const detailMarkup = details.map(([icon, label, value]) => `
      <div class="dashboard-country-detail">
        <i class="fa-solid ${icon}"></i><span class="label">${escapeHtml(label)}</span>
        <span class="value">${escapeHtml(value || "Not available")}</span>
      </div>`).join("");
    const tagMarkup = (values) => values.length
      ? values.map((value) => `<span class="extra-tag">${escapeHtml(value)}</span>`).join("")
      : '<span class="extra-tag">Not available</span>';
    const latitude = Number(country.latitude);
    const longitude = Number(country.longitude);
    const hasCoordinates = country.latitude !== "" && country.latitude != null &&
      country.longitude !== "" && country.longitude != null &&
      Number.isFinite(latitude) && Number.isFinite(longitude);
    const mapUrl = hasCoordinates
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`
      : "";
    const safeMapUrl = typeof mapUrl === "string" && mapUrl.startsWith("https://") ? mapUrl : "";
    container.innerHTML = `
      <div class="dashboard-country-header">
        ${flag ? `<img src="${flag}" alt="${name}" class="dashboard-country-flag">` : ""}
        <div class="dashboard-country-title">
          <h3>${name}</h3>
          <span class="region"><i class="fa-solid fa-location-dot"></i> ${region || "Region not available"}</span>
        </div>
      </div>
      <div class="dashboard-local-time"><div class="local-time-display">
        <i class="fa-solid fa-clock"></i><span class="local-time-value" id="country-local-time"></span>
        <span class="local-time-zone" id="country-time-zone"></span>
      </div></div>
      <div class="dashboard-country-grid">${detailMarkup}</div>
      <div class="dashboard-country-extras">
        <div class="dashboard-country-extra"><h4><i class="fa-solid fa-coins"></i> Currency</h4><div class="extra-tags">${tagMarkup(currencyValues)}</div></div>
        <div class="dashboard-country-extra"><h4><i class="fa-solid fa-language"></i> Languages</h4><div class="extra-tags">${tagMarkup(languageValues)}</div></div>
        <div class="dashboard-country-extra"><h4><i class="fa-solid fa-map-location-dot"></i> Neighbors</h4><div class="extra-tags">${tagMarkup(country.borders || [])}</div></div>
      </div>
      <p class="data-source-note">Country records: World Bank and CountriesNow APIs. Statistics: World Bank API. Local time zone: Open-Meteo Geocoding API.</p>
      ${safeMapUrl ? `<div class="dashboard-country-actions"><a href="${escapeHtml(safeMapUrl)}" target="_blank" rel="noopener noreferrer" class="btn-map-link"><i class="fa-solid fa-map"></i> View on Google Maps</a></div>` : ""}
    `;
    this.updateLocalTime();
  }

  updateLocalTime() {
    const target = document.getElementById("country-local-time");
    const zone = document.getElementById("country-time-zone");
    if (!target) return;
    if (!this.timeZone) {
      target.textContent = "Not available";
      if (zone) zone.textContent = "Local time unavailable";
      return;
    }
    try {
      target.textContent = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: this.timeZone
      }).format(new Date());
      if (zone) zone.textContent = this.timeZone;
    } catch (error) {
      this.timeZone = "";
      target.textContent = "Not available";
      if (zone) zone.textContent = "Local time unavailable";
      this.onError(`Could not format the local time: ${error.message}`);
    }
  }
}
window.__WanderlustModules['dashboard'] = {default: Dashboard};
})();
(() => {
const { getEvents, showMessage } = window.__WanderlustModules['api'];
function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function formatEventDate(date, time, timeZone) {
  if (!date) return "Date not announced";
  const parsed = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "Date not announced";
  try {
    const formatted = new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      ...(timeZone ? { timeZone } : {})
    }).format(parsed);
    return time ? `${formatted} at ${time}` : formatted;
  } catch {
    return time ? `${date} at ${time}` : date;
  }
}

function makeDemoEvents(city, country) {
  const today = new Date();
  const templates = [
    { name: `Live Music Night in ${city}`, category: "Music", days: 7 },
    { name: `City Football Experience in ${city}`, category: "Sports", days: 14 },
    { name: `Theatre and Arts Festival in ${city}`, category: "Arts & Theatre", days: 21 },
    { name: `Weekend Food Festival in ${city}`, category: "Festival", days: 30 }
  ];
  return templates.map((template) => {
    const date = new Date(today);
    date.setDate(date.getDate() + template.days);
    const localDate = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
    return {
      id: `${country.cca2}-${city}-${template.category}-${localDate}`,
      source: "demo",
      name: template.name,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${template.category} events in ${city} ${country.name.common} ${localDate}`)}`,
      dates: { start: { localDate } },
      classifications: [{ segment: { name: template.category } }],
      _embedded: { venues: [{ city: { name: city } }] }
    };
  });
}

class Events {
  constructor({ onError, plans }) {
    this.container = document.getElementById("events-content");
    this.onError = onError;
    this.plans = plans;
    this.selection = null;
    this.requestId = 0;
    const description = document.querySelector("#events-view .view-header-content p");
    description.textContent = "Discover concerts, sports, theatre and more in cities worldwide";

    this.results = makeElement("div", "events-results");
    this.container.replaceChildren(this.results);
    this.updateSelection({});
    this.showDashboardPrompt();
  }

  updateSelection({ country, city } = {}) {
    const selection = document.querySelector("#events-view .view-header-selection");
    if (!country) {
      selection.replaceChildren();
      return;
    }
    const badge = document.createElement("div");
    badge.className = "current-selection-badge";
    if (country.cca2) {
      const flag = document.createElement("img");
      flag.className = "selection-flag";
      flag.src = `https://flagcdn.com/w40/${encodeURIComponent(country.cca2.toLowerCase())}.png`;
      flag.alt = country.name.common;
      badge.append(flag);
    }
    badge.append(makeElement("span", "", country.name.common));
    if (city) badge.append(makeElement("span", "selection-city", `· ${city}`));
    selection.replaceChildren(badge);
  }

  clear(title, detail, icon = "fa-circle-info") {
    showMessage(this.results, title, detail, icon);
  }

  showDashboardPrompt() {
    this.clear("No Country Selected", "Select a country from the dashboard to discover events", "fa-ticket");
    const button = makeElement("button", "btn-primary");
    button.type = "button";
    button.innerHTML = '<i class="fa-solid fa-globe"></i> Go to Dashboard';
    button.addEventListener("click", () => document.querySelector('.nav-item[data-view="dashboard"]')?.click());
    this.results.querySelector(".data-message").append(button);
  }

  setSelection(selection) {
    const previous = this.selection || {};
    const next = selection || {};
    const changed = previous.country?.cca2 !== next.country?.cca2 || previous.city !== next.city;
    this.selection = selection || null;
    this.updateSelection(this.selection || {});
    if (!next.country && changed) this.showDashboardPrompt();
    return changed;
  }

  async load(selection) {
    this.setSelection(selection);
    const requestId = ++this.requestId;
    const { country, city } = this.selection || {};
    if (!country) {
      this.showDashboardPrompt();
      return;
    }
    const destinationCity = city || country.capital?.[0] || country.name.common;
    this.clear("Searching live events", `Looking for upcoming events in ${destinationCity}, ${country.name.common}.`, "fa-spinner fa-spin");
    try {
      const response = await getEvents(country.cca2, destinationCity);
      if (requestId !== this.requestId) return;
      if (Array.isArray(response.errors) && response.errors.length) {
        throw new Error(response.errors.map((error) => error.detail || error.message).filter(Boolean).join(" "));
      }
      const events = response._embedded?.events || [];
      if (!Array.isArray(events)) throw new Error("The events service returned an unexpected response.");
      if (!events.length) {
        throw new Error(`Ticketmaster returned no upcoming events for ${destinationCity}.`);
      }
      this.render(events, country, "", destinationCity);
    } catch (error) {
      if (requestId !== this.requestId) return;
      if (requestId !== this.requestId) return;
      const demoEvents = makeDemoEvents(destinationCity, country);
      this.render(
        demoEvents,
        country,
        destinationCity
      );
    }
  }

  render(events, country, city = "") {
    this.results.replaceChildren();
    events.forEach((event) => {
      if (!event.id || !event.name) return;
      const venue = event._embedded?.venues?.[0];
      const date = event.dates?.start?.localDate || "";
      const time = event.dates?.start?.localTime || "";
      const timeZone = venue?.timezone || "";
      const category = event.classifications?.[0]?.segment?.name || "Event";
      const detail = [
        formatEventDate(date, time, timeZone),
        [venue?.name, venue?.city?.name || city || country.name.common].filter(Boolean).join(", ")
      ].filter(Boolean).join(" · ");
      const card = makeElement("article", "event-card");
      const imageContainer = makeElement("div", "event-card-image");
      const image = event.images?.find((item) => item.ratio === "16_9") || event.images?.[0];
      if (image?.url && image.url.startsWith("https://")) {
        const imageElement = document.createElement("img");
        imageElement.src = image.url;
        imageElement.alt = "";
        imageElement.loading = "lazy";
        imageContainer.append(imageElement);
      }
      imageContainer.append(makeElement("span", "event-card-category", category));
      const body = makeElement("div", "event-card-body");
      body.append(makeElement("h3", "", event.name));
      const info = makeElement("div", "event-card-info");
      info.append(makeElement("div", "", `Date: ${detail.split(" · ")[0]}`));
      if (detail.includes(" · ")) info.append(makeElement("div", "", `Location: ${detail.split(" · ").slice(1).join(" · ")}`));
      const footer = makeElement("div", "event-card-footer");
      const save = makeElement("button", "btn-event save-plan-btn", "Save");
      save.type = "button";
      save.dataset.id = `${event.source || "ticketmaster"}-${event.id}`;
      save.dataset.type = "event";
      save.dataset.title = event.name;
      save.dataset.detail = detail;
      save.dataset.date = date;
      save.dataset.country = country.name.common;
      save.dataset.city = venue?.city?.name || city;
      const saved = this.plans.has(save.dataset.id, "event");
      save.classList.toggle("saved", saved);
      save.setAttribute("aria-label", saved ? "Remove saved event" : "Save event");
      save.setAttribute("aria-pressed", String(saved));
      save.prepend(document.createElement("i"));
      save.firstElementChild.className = `fa-${saved ? "solid" : "regular"} fa-heart`;
      const ticketLink = makeElement("a", "btn-buy-ticket", "Event details");
      let ticketUrl = "";
      try {
        const url = event.url ? new URL(event.url) : null;
        if (url?.protocol === "https:") ticketUrl = url.href;
      } catch {
        ticketUrl = "";
      }
      if (ticketUrl) {
        ticketLink.href = ticketUrl;
        ticketLink.target = "_blank";
        ticketLink.rel = "noopener noreferrer";
      } else {
        ticketLink.removeAttribute("href");
        ticketLink.setAttribute("aria-disabled", "true");
      }
      footer.append(save, ticketLink);
      body.append(info, footer);
      card.append(imageContainer, body);
      this.results.append(card);
    });
  }
}

window.__WanderlustModules['event'] = {default: Events};
})();
(() => {
const { getHolidays, formatDate, escapeHtml, showMessage } = window.__WanderlustModules['api'];
function updateSelection(country, year) {
  const selection = document.getElementById("holidays-selection");
  const paragraph = document.querySelector("#holidays-view .view-header-content p");
  if (!country) {
    selection.replaceChildren();
    paragraph.textContent = "Browse public holidays for your selected destination.";
    return;
  }
  const image = country.cca2 ? `<img src="https://flagcdn.com/w40/${encodeURIComponent(country.cca2.toLowerCase())}.png" alt="${escapeHtml(country.name.common)}" class="selection-flag">` : "";
  selection.innerHTML = `<div class="current-selection-badge">${image}<span>${escapeHtml(country.name.common)}</span><span class="selection-year">${escapeHtml(year)}</span></div>`;
  paragraph.textContent = `Public holidays for ${country.name.common} · Data from Nager.Date.`;
}

class Holidays {
  constructor({ onError, plans }) {
    this.container = document.getElementById("holidays-content");
    this.onError = onError;
    this.plans = plans;
    this.requestId = 0;
    showMessage(this.container, "Choose a destination", "Public holidays are loaded from the Nager.Date public holiday service.");
  }

  async load(country, year) {
    const requestId = ++this.requestId;
    updateSelection(country, year);
    if (!country) {
      document.getElementById("stat-holidays").textContent = "—";
      showMessage(this.container, "Choose a destination", "Select a country on the dashboard to look up its public holidays.");
      return;
    }
    if (!country.supportsHolidays) {
      document.getElementById("stat-holidays").textContent = "—";
      showMessage(this.container, "Holiday data unavailable", `${country.name.common} is not listed by the public holiday data service.`);
      return;
    }
    document.getElementById("stat-holidays").textContent = "…";
    showMessage(this.container, "Loading public holidays", `Fetching ${year} holiday records for ${country.name.common}.`, "fa-spinner fa-spin");
    try {
      const holidays = await getHolidays(country.cca2, year);
      if (requestId !== this.requestId) return;
      if (!Array.isArray(holidays) || holidays.length === 0) {
        if (!Array.isArray(holidays)) throw new Error("The holiday service returned an unexpected response.");
        document.getElementById("stat-holidays").textContent = "0";
        showMessage(this.container, "No holidays found", `The service returned no public holidays for ${country.name.common} in ${year}.`);
        return;
      }
      document.getElementById("stat-holidays").textContent = holidays.length;
      this.render(holidays, country, year);
    } catch (error) {
      if (requestId !== this.requestId) return;
      document.getElementById("stat-holidays").textContent = "—";
      showMessage(this.container, "Could not load holidays", error.message, "fa-triangle-exclamation");
      this.onError(`Holidays: ${error.message}`);
    }
  }

  render(holidays, country, year) {
    this.container.replaceChildren();
    holidays.forEach((holiday) => {
      const date = holiday.date;
      const parsed = new Date(`${date}T12:00:00`);
      const isValidDate = !Number.isNaN(parsed.getTime());
      const day = isValidDate ? parsed.getDate() : "—";
      const month = isValidDate ? new Intl.DateTimeFormat(undefined, { month: "short" }).format(parsed) : "—";
      const weekday = isValidDate ? new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(parsed) : "Date not available";
      const title = holiday.localName || holiday.name || "Public holiday";
      const record = {
        id: `${country.cca2}-${year}-${date}-${holiday.name || title}`,
        type: "holiday",
        title,
        detail: `${country.name.common} · ${isValidDate ? formatDate(date) : date || "Date not available"}`,
        date: date || "",
        country: country.name.common
      };
      const saved = this.plans.has(record.id, record.type);
      const card = document.createElement("article");
      card.className = "holiday-card";
      card.innerHTML = `
        <div class="holiday-card-header">
          <div class="holiday-date-box"><span class="day">${escapeHtml(day)}</span><span class="month">${escapeHtml(month)}</span></div>
          <button type="button" class="holiday-action-btn save-plan-btn ${saved ? "saved" : ""}" aria-label="${saved ? "Remove saved plan" : "Save holiday"}" aria-pressed="${saved}" data-type="holiday" data-id="${escapeHtml(record.id)}" data-title="${escapeHtml(record.title)}" data-detail="${escapeHtml(record.detail)}" data-date="${escapeHtml(record.date)}" data-country="${escapeHtml(record.country)}"><i class="fa-${saved ? "solid" : "regular"} fa-heart"></i></button>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <p class="holiday-name">${escapeHtml(holiday.name || title)}</p>
        <div class="holiday-card-footer">
          <span class="holiday-day-badge"><i class="fa-regular fa-calendar"></i> ${escapeHtml(weekday)}</span>
          <span class="holiday-type-badge">${escapeHtml((holiday.types || ["Public"]).join(", "))}</span>
        </div>`;
      this.container.append(card);
    });
  }
}
window.__WanderlustModules['holidays'] = {default: Holidays};
})();
(() => {
const { getLongWeekends, formatDate, escapeHtml, showMessage } = window.__WanderlustModules['api'];
function updateSelection(country, year) {
  const selection = document.querySelector("#long-weekends-view .view-header-selection");
  const paragraph = document.querySelector("#long-weekends-view .view-header-content p");
  if (!country) {
    selection.replaceChildren();
    paragraph.textContent = "Find long weekends for your selected destination.";
    return;
  }
  const flag = country.cca2 ? `<img src="https://flagcdn.com/w40/${encodeURIComponent(country.cca2.toLowerCase())}.png" alt="${escapeHtml(country.name.common)}" class="selection-flag">` : "";
  selection.innerHTML = `<div class="current-selection-badge">${flag}<span>${escapeHtml(country.name.common)}</span><span class="selection-year">${escapeHtml(year)}</span></div>`;
  paragraph.textContent = `Find public-holiday weekends for ${country.name.common} · Data from Nager.Date.`;
}

function dayName(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: "short", timeZone: "UTC" }).format(date);
}

class LongWeekends {
  constructor({ onError, plans }) {
    this.container = document.getElementById("lw-content");
    this.onError = onError;
    this.plans = plans;
    this.requestId = 0;
    showMessage(this.container, "Choose a destination", "Long weekends are calculated from official public holiday records.");
  }

  async load(country, year) {
    const requestId = ++this.requestId;
    updateSelection(country, year);
    if (!country) {
      showMessage(this.container, "Choose a destination", "Select a country on the dashboard to find long weekends.");
      return;
    }
    if (!country.supportsHolidays) {
      showMessage(this.container, "Weekend data unavailable", `${country.name.common} is not listed by the public holiday data service.`);
      return;
    }
    showMessage(this.container, "Loading long weekends", `Checking ${year} public holidays for ${country.name.common}.`, "fa-spinner fa-spin");
    try {
      const weekends = await getLongWeekends(country.cca2, year);
      if (requestId !== this.requestId) return;
      if (!Array.isArray(weekends) || weekends.length === 0) {
        showMessage(this.container, "No long weekends found", `The service returned no long weekends for ${country.name.common} in ${year}.`);
        return;
      }
      this.render(weekends, country, year);
    } catch (error) {
      if (requestId !== this.requestId) return;
      showMessage(this.container, "Could not load long weekends", error.message, "fa-triangle-exclamation");
      this.onError(`Long weekends: ${error.message}`);
    }
  }

  render(weekends, country, year) {
    this.container.replaceChildren();
    weekends.forEach((weekend, index) => {
      const start = new Date(`${weekend.startDate}T00:00:00Z`);
      const end = new Date(`${weekend.endDate}T00:00:00Z`);
      const title = weekend.name || `Long weekend ${index + 1}`;
      const id = `${country.cca2}-${year}-${weekend.startDate}`;
      const record = {
        id,
        type: "longweekend",
        title,
        detail: `${country.name.common} · ${weekend.startDate} – ${weekend.endDate}`,
        date: weekend.startDate,
        country: country.name.common
      };
      const saved = this.plans.has(id, "longweekend");
      const days = [];
      if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime())) {
        for (let cursor = new Date(start); cursor <= end && days.length < 10; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
          const date = new Date(cursor);
          days.push(`<div class="lw-day"><span class="name">${escapeHtml(dayName(date))}</span><span class="num">${date.getUTCDate()}</span></div>`);
        }
      }
      const card = document.createElement("article");
      card.className = "lw-card";
      card.innerHTML = `
        <div class="lw-card-header">
          <span class="lw-badge"><i class="fa-solid fa-calendar-days"></i> ${escapeHtml(weekend.dayCount)} Days</span>
          <button type="button" class="holiday-action-btn save-plan-btn ${saved ? "saved" : ""}" aria-label="${saved ? "Remove saved plan" : "Save long weekend"}" aria-pressed="${saved}" data-type="longweekend" data-id="${escapeHtml(id)}" data-title="${escapeHtml(title)}" data-detail="${escapeHtml(record.detail)}" data-date="${escapeHtml(record.date)}" data-country="${escapeHtml(record.country)}"><i class="fa-${saved ? "solid" : "regular"} fa-heart"></i></button>
        </div>
        <h3>${escapeHtml(title)}</h3>
        <div class="lw-dates"><i class="fa-regular fa-calendar"></i> ${escapeHtml(formatDate(weekend.startDate))} – ${escapeHtml(formatDate(weekend.endDate))}</div>
        <div class="lw-info-box ${weekend.needBridgeDay ? "warning" : "success"}"><i class="fa-solid ${weekend.needBridgeDay ? "fa-circle-info" : "fa-circle-check"}"></i> ${weekend.needBridgeDay ? "Requires a bridge day off" : "No extra days off needed"}</div>
        <div class="lw-days-visual">${days.join("")}</div>`;
      this.container.append(card);
    });
  }
}
window.__WanderlustModules['long-weekends'] = {default: LongWeekends};
})();
(() => {
const STORAGE_KEY = "wanderlust.savedPlans";

function isSavedPlan(value) {
  return value && typeof value === "object" &&
    typeof value.id === "string" &&
    ["holiday", "event", "longweekend"].includes(value.type) &&
    typeof value.title === "string";
}

class Plans {
  constructor({ onNavigate, onMessage }) {
    this.items = [];
    this.filter = "all";
    this.onNavigate = onNavigate;
    this.onMessage = onMessage;
    this.storageAvailable = true;
    this.container = document.getElementById("plans-content");
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!Array.isArray(parsed) || !parsed.every(isSavedPlan)) throw new Error("Saved plans are not in the expected format.");
        this.items = parsed;
      }
    } catch (error) {
      this.storageAvailable = false;
      this.onMessage(`Saved plans could not be read: ${error.message}`);
    }

    document.addEventListener("click", (event) => {
      const saveButton = event.target.closest(".save-plan-btn");
      if (saveButton) {
        event.preventDefault();
        this.toggle(saveButton);
        return;
      }
      const filterButton = event.target.closest(".plan-filter");
      if (filterButton) {
        this.filter = filterButton.dataset.filter || "all";
        document.querySelectorAll(".plan-filter").forEach((button) => {
          button.classList.toggle("active", button === filterButton);
        });
        this.render();
        return;
      }
      const removeButton = event.target.closest(".plan-remove");
      if (removeButton) {
        this.remove(removeButton.dataset.id, removeButton.dataset.type);
        return;
      }
      if (event.target.closest("#clear-all-plans-btn")) {
        this.clearAll();
        return;
      }
      if (event.target.closest("#start-exploring-btn")) this.onNavigate("dashboard");
    });

    this.render();
  }

  has(id, type) {
    return this.items.some((item) => item.id === id && item.type === type);
  }

  toggle(button) {
    if (!this.storageAvailable) {
      this.onMessage("Saved plans are read-only because the browser could not load their existing data. Use Clear All to reset saved plans.");
      return;
    }
    const { id, type, title, detail, date, country, city } = button.dataset;
    if (!id || !["holiday", "event", "longweekend"].includes(type)) {
      this.onMessage("This item cannot be saved because its data is incomplete.");
      return;
    }
    if (this.has(id, type)) {
      this.commit(this.items.filter((item) => !(item.id === id && item.type === type)));
      return;
    }
    this.commit([...this.items, {
      id,
      type,
      title: title || "Saved travel plan",
      detail: detail || "",
      date: date || "",
      country: country || "",
      city: city || "",
      savedAt: new Date().toISOString()
    }]);
  }

  commit(items) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      this.onMessage(`Could not save your plan: ${error.message}`);
      return;
    }
    this.items = items;
    this.syncButtons();
    this.render();
  }

  remove(id, type) {
    if (!this.storageAvailable) {
      this.onMessage("Saved plans cannot be changed until existing browser storage is reset.");
      return;
    }
    this.commit(this.items.filter((item) => !(item.id === id && item.type === type)));
  }

  clearAll() {
    if (this.items.length && !window.confirm("Remove all saved plans from this browser?")) return;
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      this.onMessage(`Could not clear saved plans: ${error.message}`);
      return;
    }
    this.storageAvailable = true;
    this.items = [];
    this.syncButtons();
    this.render();
  }

  syncButtons() {
    document.querySelectorAll(".save-plan-btn").forEach((button) => {
      const saved = this.has(button.dataset.id, button.dataset.type);
      button.classList.toggle("saved", saved);
      button.setAttribute("aria-pressed", String(saved));
      button.setAttribute("aria-label", saved ? "Remove saved plan" : "Save travel plan");
      const icon = button.querySelector("i");
      if (icon) icon.className = `fa-${saved ? "solid" : "regular"} fa-heart`;
    });
  }

  render() {
    const counts = {
      all: this.items.length,
      holiday: this.items.filter((item) => item.type === "holiday").length,
      event: this.items.filter((item) => item.type === "event").length,
      longweekend: this.items.filter((item) => item.type === "longweekend").length
    };
    document.getElementById("filter-all-count").textContent = counts.all;
    document.getElementById("filter-holiday-count").textContent = counts.holiday;
    document.getElementById("filter-event-count").textContent = counts.event;
    document.getElementById("filter-lw-count").textContent = counts.longweekend;
    document.getElementById("stat-saved").textContent = counts.all;
    const badge = document.getElementById("plans-count");
    badge.textContent = counts.all;
    badge.classList.toggle("hidden", counts.all === 0);

    this.container.replaceChildren();
    const visible = this.filter === "all" ? this.items : this.items.filter((item) => item.type === this.filter);
    if (visible.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const icon = document.createElement("div");
      icon.className = "empty-icon";
      icon.innerHTML = '<i class="fa-solid fa-heart-crack"></i>';
      const heading = document.createElement("h3");
      heading.textContent = this.items.length ? "No plans in this category" : "No Saved Plans Yet";
      const paragraph = document.createElement("p");
      paragraph.textContent = this.items.length ? "Choose another filter to see your saved plans." : "Start exploring and save holidays, events, or long weekends you like.";
      empty.append(icon, heading, paragraph);
      if (!this.items.length) {
        const button = document.createElement("button");
        button.className = "btn-primary";
        button.id = "start-exploring-btn";
        button.innerHTML = '<i class="fa-solid fa-compass"></i> Start Exploring';
        empty.append(button);
      }
      this.container.append(empty);
      return;
    }

    visible.forEach((item) => {
      const card = document.createElement("article");
      card.className = "plan-card";
      const top = document.createElement("div");
      top.className = "plan-card-top";
      const type = document.createElement("span");
      type.className = "plan-type";
      type.textContent = item.type === "longweekend" ? "Long weekend" : item.type;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "plan-remove";
      remove.dataset.id = item.id;
      remove.dataset.type = item.type;
      remove.setAttribute("aria-label", "Remove saved plan");
      remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
      top.append(type, remove);
      const heading = document.createElement("h3");
      heading.textContent = item.title;
      const detail = document.createElement("p");
      detail.textContent = item.detail || [item.country, item.date].filter(Boolean).join(" · ");
      card.append(top, heading, detail);
      this.container.append(card);
    });
  }
}
window.__WanderlustModules['plans'] = {default: Plans};
})();
(() => {
const PAGE_META = {
  dashboard: ["Dashboard", "Welcome back! Ready to plan your next adventure?"],
  holidays: ["Holidays", "Explore public holidays for your selected destination."],
  events: ["Events", "Find concerts, sports, and entertainment"],
  weather: ["Weather", "Current conditions and a 7-day forecast for your destination."],
  "long-weekends": ["Long Weekends", "Find public-holiday weekends to plan your next trip."],
  currency: ["Currency", "Convert currencies using current exchange rates."],
  "sun-times": ["Sun Times", "Sunrise, sunset and daylight for your selected destination."],
  "my-plans": ["My Plans", "Your saved holidays, events, and trip ideas."]
};

const PAGE_PATHS = {
  dashboard: "/",
  holidays: "/holidays",
  events: "/events",
  weather: "/weather",
  "long-weekends": "/long-weekends",
  currency: "/currency",
  "sun-times": "/sun-times",
  "my-plans": "/plans"
};

class Router {
  constructor(onNavigate) {
    this.onNavigate = onNavigate;
    this.current = "dashboard";
    this.fileMode = window.location.protocol === "file:";
    window.history.scrollRestoration = "manual";
    document.querySelectorAll(".nav-item[data-view]").forEach((link) => {
      link.href = this.fileMode
        ? `#${link.dataset.view}`
        : PAGE_PATHS[link.dataset.view] || "/";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        this.navigate(link.dataset.view);
      });
    });
    window.addEventListener("popstate", () => {
      this.show(this.pageFromLocation(), true);
    });
    window.addEventListener("hashchange", () => {
      if (this.fileMode) this.show(this.pageFromLocation(), true);
    });
    this.show(this.pageFromLocation(), false);
  }

  pageFromLocation() {
    if (this.fileMode) {
      const page = window.location.hash.replace(/^#\/?/, "");
      return Object.hasOwn(PAGE_META, page) ? page : "dashboard";
    }
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const legacyHash = window.location.hash.replace(/^#\/?/, "");
    if (path === "/" && Object.hasOwn(PAGE_META, legacyHash)) return legacyHash;
    const page = Object.keys(PAGE_PATHS).find((key) => PAGE_PATHS[key] === path);
    if (page) return page;
    return Object.hasOwn(PAGE_META, legacyHash) ? legacyHash : "dashboard";
  }

  navigate(page) {
    if (!Object.hasOwn(PAGE_META, page)) return;
    if (this.fileMode) {
      if (this.pageFromLocation() !== page) {
        window.location.hash = `#${page}`;
        return;
      }
    } else if (this.pageFromLocation() !== page || window.location.pathname !== PAGE_PATHS[page]) {
      window.history.pushState({ page }, "", PAGE_PATHS[page]);
    }
    this.show(page, true);
  }

  show(page, notify = true) {
    if (!Object.hasOwn(PAGE_META, page)) page = "dashboard";
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.current = page;
    window.scrollTo(0, 0);
    window.requestAnimationFrame(() => {
      if (this.current === page) window.scrollTo(0, 0);
    });
    document.querySelectorAll(".view").forEach((view) => {
      view.classList.toggle("active", view.id === `${page}-view`);
    });
    document.querySelectorAll(".nav-item[data-view]").forEach((link) => {
      const active = link.dataset.view === page;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const [title, subtitle] = PAGE_META[page];
    document.getElementById("page-title").textContent = title;
    document.getElementById("page-subtitle").textContent = subtitle;
    if (notify) this.onNavigate(page);
  }
}
window.__WanderlustModules['router'] = {default: Router};
})();
(() => {
const { getCity, getSunTimes, escapeHtml, showMessage } = window.__WanderlustModules['api'];
function localDateString(timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatSunTime(value, timeZone) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone
  }).format(new Date(value));
}

function durationLabel(seconds) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function updateSelection(country, city) {
  const selection = document.querySelector("#sun-times-view .view-header-selection");
  const paragraph = document.querySelector("#sun-times-view .view-header-content p");
  if (!country) {
    selection.replaceChildren();
    paragraph.textContent = "Sunrise, sunset and daylight for your selected destination.";
    return;
  }
  const badge = document.createElement("div");
  badge.className = "current-selection-badge";
  if (country.cca2) {
    const flag = document.createElement("img");
    flag.className = "selection-flag";
    flag.src = `https://flagcdn.com/w40/${encodeURIComponent(country.cca2.toLowerCase())}.png`;
    flag.alt = country.name.common;
    badge.append(flag);
  }
  const name = document.createElement("span");
  name.textContent = country.name.common;
  badge.append(name);
  if (city) {
    const selectedCity = document.createElement("span");
    selectedCity.className = "selection-city";
    selectedCity.textContent = `• ${city}`;
    badge.append(selectedCity);
  }
  selection.replaceChildren(badge);
  paragraph.textContent = `Sunrise, sunset and daylight for ${city || country.name.common}.`;
}

class SunTimes {
  constructor({ onError }) {
    this.container = document.getElementById("sun-times-content");
    this.onError = onError;
    this.requestId = 0;
    showMessage(this.container, "Choose a destination", "Sunrise and sunset times are loaded from the sunrise-sunset.org service.");
  }

  async load(country, city) {
    const requestId = ++this.requestId;
    updateSelection(country, city);
    if (!country || !city) {
      showMessage(this.container, "Choose a destination", "Select a country with a capital city to look up sun times.");
      return;
    }
    showMessage(this.container, "Loading sun times", `Finding sunrise and sunset for ${city}.`, "fa-spinner fa-spin");
    try {
      const location = await getCity(city, country.cca2);
      if (requestId !== this.requestId) return;
      const timezone = location.timezone || "UTC";
      const date = localDateString(timezone);
      const result = await getSunTimes(location.latitude, location.longitude, date);
      if (requestId !== this.requestId) return;
      this.render(result, location, timezone, date);
    } catch (error) {
      if (requestId !== this.requestId) return;
      showMessage(this.container, "Could not load sun times", error.message, "fa-triangle-exclamation");
      this.onError(`Sun times: ${error.message}`);
    }
  }

  render(result, location, timezone, date) {
    const sunrise = new Date(result.sunrise);
    const sunset = new Date(result.sunset);
    const daySeconds = Number(result.day_length);
    if (Number.isNaN(sunrise.getTime()) || Number.isNaN(sunset.getTime()) || !Number.isFinite(daySeconds)) {
      showMessage(this.container, "Sun times unavailable", "The sun-time service returned incomplete data for this location.");
      return;
    }
    const daylight = durationLabel(daySeconds);
    const darkness = durationLabel(86400 - daySeconds);
    const daylightPercent = Math.min(100, Math.max(0, daySeconds / 86400 * 100));
    const dateInstant = new Date(`${date}T12:00:00Z`);
    const dateLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: timezone }).format(dateInstant);
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: timezone }).format(dateInstant);
    const moments = [
      ["dawn", "fa-moon", "Dawn", result.civil_twilight_begin, "Civil Twilight"],
      ["sunrise", "fa-sun", "Sunrise", result.sunrise, "Day begins"],
      ["noon", "fa-sun", "Solar Noon", result.solar_noon, "Sun at Highest"],
      ["sunset", "fa-sun", "Sunset", result.sunset, "Day ends"],
      ["dusk", "fa-moon", "Dusk", result.civil_twilight_end, "Civil Twilight"],
      ["daylight", "fa-hourglass-half", "Day Length", null, "Total Daylight"]
    ];
    const cards = moments.map(([kind, icon, label, time, subLabel]) => `
      <div class="sun-time-card ${kind}">
        <div class="icon"><i class="fa-solid ${icon}"></i></div>
        <div class="label">${label}</div>
        <div class="time">${time ? escapeHtml(formatSunTime(time, timezone)) : escapeHtml(daylight)}</div>
        <div class="sub-label">${subLabel}</div>
      </div>`).join("");
    this.container.innerHTML = `
      <div class="sun-main-card">
        <div class="sun-main-header">
          <div class="sun-location"><h2><i class="fa-solid fa-location-dot"></i> ${escapeHtml(location.name || "Selected city")}</h2><p>Sunrise-Sunset.org data · ${escapeHtml(timezone)}</p></div>
          <div class="sun-date-display"><div class="date">${escapeHtml(dateLabel)}</div><div class="day">${escapeHtml(weekday)}</div></div>
        </div>
        <div class="sun-times-grid">${cards}</div>
      </div>
      <div class="day-length-card">
        <h3><i class="fa-solid fa-chart-pie"></i> Daylight Distribution</h3>
        <div class="day-progress"><div class="day-progress-bar"><div class="day-progress-fill" style="width: ${daylightPercent.toFixed(1)}%"></div></div></div>
        <div class="day-length-stats">
          <div class="day-stat"><div class="value">${escapeHtml(daylight)}</div><div class="label">Daylight</div></div>
          <div class="day-stat"><div class="value">${daylightPercent.toFixed(1)}%</div><div class="label">of 24 Hours</div></div>
          <div class="day-stat"><div class="value">${escapeHtml(darkness)}</div><div class="label">Darkness</div></div>
        </div>
      </div>`;
  }
}
window.__WanderlustModules['sun-times'] = {default: SunTimes};
})();
(() => {
const { getCity, getWeather, weatherDescription, escapeHtml, showMessage } = window.__WanderlustModules['api'];
const rounded = (value) => Number.isFinite(value) ? Math.round(value) : "—";

function windDirection(degrees) {
  if (!Number.isFinite(degrees)) return "—";
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8];
}

function iconMarkup(code) {
  const condition = weatherDescription(code);
  return `<i class="fa-solid ${condition.icon}" aria-hidden="true"></i>`;
}

function localForecastTime(date, options) {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: "UTC" }).format(new Date(`${date}Z`));
}

function updateSelection(country, city) {
  const selection = document.querySelector("#weather-view .view-header-selection");
  const paragraph = document.querySelector("#weather-view .view-header-content p");
  if (!country) {
    selection.replaceChildren();
    paragraph.textContent = "Check a 7-day forecast for your selected destination.";
    return;
  }
  const flag = country.cca2 ? `<img src="https://flagcdn.com/w40/${encodeURIComponent(country.cca2.toLowerCase())}.png" alt="${escapeHtml(country.name.common)}" class="selection-flag">` : "";
  selection.innerHTML = `<div class="current-selection-badge">${flag}<span>${escapeHtml(country.name.common)}</span><span class="selection-city">• ${escapeHtml(city)}</span></div>`;
  paragraph.textContent = `Current conditions and a 7-day forecast for ${city || country.name.common} · Data from Open-Meteo.`;
}

class Weather {
  constructor({ onError, onNavigate }) {
    this.container = document.getElementById("weather-content");
    this.onError = onError;
    this.onNavigate = onNavigate;
    this.requestId = 0;
    this.showDashboardPrompt("No city selected", "Select a country and city from the dashboard to see the weather forecast.");
  }

  showDashboardPrompt(title, detail) {
    showMessage(this.container, title, detail);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-primary";
    button.textContent = "Go to Dashboard";
    button.addEventListener("click", () => this.onNavigate?.("dashboard"));
    this.container.querySelector(".data-message").append(button);
  }

  async load(country, city) {
    const requestId = ++this.requestId;
    updateSelection(country, city);
    if (!country || !city) {
      this.showDashboardPrompt("No city selected", "Select a country and city from the dashboard to see the weather forecast.");
      return;
    }
    showMessage(this.container, "Loading forecast", `Looking up current weather for ${city}.`, "fa-spinner fa-spin");
    try {
      const location = await getCity(city, country.cca2);
      if (requestId !== this.requestId) return;
      const forecast = await getWeather(location.latitude, location.longitude);
      if (requestId !== this.requestId) return;
      this.render(forecast, location);
    } catch (error) {
      if (requestId !== this.requestId) return;
      showMessage(this.container, "Could not load weather", error.message, "fa-triangle-exclamation");
      this.onError(`Weather: ${error.message}`);
    }
  }

  render(forecast, location) {
    const current = forecast.current;
    const daily = forecast.daily;
    const hourly = forecast.hourly;
    const timezone = forecast.timezone || "UTC";
    if (!current || !daily?.time?.length || !hourly?.time?.length) {
      showMessage(this.container, "Forecast unavailable", "The weather service returned an incomplete forecast.");
      return;
    }
    const condition = weatherDescription(current.weather_code);
    const high = daily.temperature_2m_max?.[0];
    const low = daily.temperature_2m_min?.[0];
    const currentHour = Number(current.time.slice(11, 13));
    let firstHour = hourly.time.findIndex((time) => {
      const hour = Number(time.slice(11, 13));
      const day = time.slice(0, 10);
      const currentDay = current.time.slice(0, 10);
      return day > currentDay || (day === currentDay && hour >= currentHour);
    });
    if (firstHour < 0) firstHour = 0;
    const hourlyMarkup = hourly.time.slice(firstHour, firstHour + 10).map((time, index) => {
      const sourceIndex = firstHour + index;
      const label = index === 0 ? "Now" : localForecastTime(time, { hour: "numeric" });
      return `<div class="hourly-item ${index === 0 ? "now" : ""}">
        <span class="hourly-time">${escapeHtml(label)}</span>
        <div class="hourly-icon">${iconMarkup(hourly.weather_code?.[sourceIndex])}</div>
        <span class="hourly-temp">${escapeHtml(rounded(hourly.temperature_2m?.[sourceIndex]))}°</span>
        <span class="hourly-precip">${hourly.precipitation_probability?.[sourceIndex] == null ? "" : `${escapeHtml(rounded(hourly.precipitation_probability[sourceIndex]))}% rain`}</span>
        <span class="hourly-details">${escapeHtml(rounded(hourly.relative_humidity_2m?.[sourceIndex]))}% humidity</span>
        <span class="hourly-details">${escapeHtml(rounded(hourly.wind_speed_10m?.[sourceIndex]))} km/h wind</span>
      </div>`;
    }).join("");
    const forecastMarkup = daily.time.map((date, index) => {
      const description = weatherDescription(daily.weather_code?.[index]);
      const precipitation = daily.precipitation_probability_max?.[index];
      const humidity = daily.relative_humidity_2m_mean?.[index];
      const windSpeed = daily.wind_speed_10m_max?.[index];
      const windAngle = daily.wind_direction_10m_dominant?.[index];
      const precipitationTotal = daily.precipitation_sum?.[index];
      return `<div class="forecast-day ${index === 0 ? "today" : ""}">
        <div class="forecast-day-name"><span class="day-label">${index === 0 ? "Today" : escapeHtml(localForecastTime(`${date}T12:00:00`, { weekday: "short" }))}</span><span class="day-date">${escapeHtml(localForecastTime(`${date}T12:00:00`, { day: "numeric", month: "short" }))}</span></div>
        <div class="forecast-icon" title="${escapeHtml(description.text)}">${iconMarkup(daily.weather_code?.[index])}</div>
        <div class="forecast-temps"><span class="temp-max">${escapeHtml(rounded(daily.temperature_2m_max?.[index]))}°</span><span class="temp-min">${escapeHtml(rounded(daily.temperature_2m_min?.[index]))}°</span></div>
        <div class="forecast-precip">${precipitation == null ? "" : `<i class="fa-solid fa-droplet"></i><span>${escapeHtml(rounded(precipitation))}%</span>`}</div>
        <div class="forecast-details">
          <span><i class="fa-solid fa-droplet"></i> ${escapeHtml(rounded(humidity))}% humidity</span>
          <span><i class="fa-solid fa-wind"></i> ${escapeHtml(rounded(windSpeed))} km/h ${escapeHtml(windDirection(windAngle))}</span>
          <span><i class="fa-solid fa-cloud-rain"></i> ${escapeHtml(rounded(precipitationTotal))} mm</span>
        </div>
      </div>`;
    }).join("");
    const currentDate = localForecastTime(`${current.time.slice(0, 10)}T12:00:00`, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
    const currentTime = localForecastTime(current.time, { hour: "numeric", minute: "2-digit" });
    this.container.innerHTML = `
      <div class="weather-hero-card weather-${condition.tone}">
        <div class="weather-location"><i class="fa-solid fa-location-dot"></i><span>${escapeHtml(location.name || location.admin1 || "Selected city")}, ${escapeHtml(location.country || "")}</span><span class="weather-time">${escapeHtml(currentDate)} · ${escapeHtml(currentTime)} ${escapeHtml(timezone)}</span></div>
        <div class="weather-hero-main">
          <div class="weather-hero-left"><div class="weather-hero-icon">${iconMarkup(current.weather_code)}</div><div class="weather-hero-temp"><span class="temp-value">${escapeHtml(rounded(current.temperature_2m))}</span><span class="temp-unit">°C</span></div></div>
          <div class="weather-hero-right"><div class="weather-condition">${escapeHtml(condition.text)}</div><div class="weather-feels">Feels like ${escapeHtml(rounded(current.apparent_temperature))}°C</div><div class="weather-high-low"><span class="high"><i class="fa-solid fa-arrow-up"></i> ${escapeHtml(rounded(high))}°</span><span class="low"><i class="fa-solid fa-arrow-down"></i> ${escapeHtml(rounded(low))}°</span></div></div>
        </div>
      </div>
      <div class="weather-details-grid">
        <div class="weather-detail-card"><div class="detail-icon humidity"><i class="fa-solid fa-droplet"></i></div><div class="detail-info"><span class="detail-label">Humidity</span><span class="detail-value">${escapeHtml(rounded(current.relative_humidity_2m))}%</span></div></div>
        <div class="weather-detail-card"><div class="detail-icon wind"><i class="fa-solid fa-wind"></i></div><div class="detail-info"><span class="detail-label">Wind</span><span class="detail-value">${escapeHtml(rounded(current.wind_speed_10m))} km/h ${escapeHtml(windDirection(current.wind_direction_10m))}</span></div></div>
        <div class="weather-detail-card"><div class="detail-icon uv"><i class="fa-solid fa-sun"></i></div><div class="detail-info"><span class="detail-label">UV Index</span><span class="detail-value">${escapeHtml(rounded(current.uv_index ?? daily.uv_index_max?.[0]))}</span></div></div>
        <div class="weather-detail-card"><div class="detail-icon precip"><i class="fa-solid fa-cloud-rain"></i></div><div class="detail-info"><span class="detail-label">Precipitation</span><span class="detail-value">${escapeHtml(rounded(current.precipitation))} mm</span></div></div>
      </div>
      <div class="weather-section"><h3 class="weather-section-title"><i class="fa-solid fa-clock"></i> Hourly Forecast</h3><div class="hourly-scroll">${hourlyMarkup}</div></div>
      <div class="weather-section"><h3 class="weather-section-title"><i class="fa-solid fa-calendar-week"></i> 7-Day Forecast</h3><div class="forecast-list">${forecastMarkup}</div></div>`;
  }
}
window.__WanderlustModules['weather'] = {default: Weather};
})();
(() => {
const { getCountries, showMessage } = window.__WanderlustModules['api'];
const Currency = window.__WanderlustModules['currency'].default;
const Dashboard = window.__WanderlustModules['dashboard'].default;
const Events = window.__WanderlustModules['event'].default;
const Holidays = window.__WanderlustModules['holidays'].default;
const LongWeekends = window.__WanderlustModules['long-weekends'].default;
const Plans = window.__WanderlustModules['plans'].default;
const Router = window.__WanderlustModules['router'].default;
const SunTimes = window.__WanderlustModules['sun-times'].default;
const Weather = window.__WanderlustModules['weather'].default;
const loadingOverlay = document.getElementById("loading-overlay");
const toastContainer = document.getElementById("toast-container");

function notify(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastContainer.append(toast);
  window.setTimeout(() => toast.remove(), 6000);
}

function setLoading(visible, text = "Loading…") {
  loadingOverlay.classList.toggle("hidden", !visible);
  document.getElementById("loading-text").textContent = text;
}

function updateDateTime() {
  document.getElementById("current-datetime").textContent = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date());
}

let router;
let dashboard;
let plans;
let holidays;
let events;
let weather;
let longWeekends;
let currency;
let sunTimes;
let dashboardHolidayKey = "";

function closeMobileMenu() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-overlay").classList.add("hidden");
}

function updateEventsSelection(selection) {
  return events.setSelection(selection);
}

async function loadPage(page) {
  const selection = dashboard.getSelection();
  if (page === "holidays") await holidays.load(selection.country, selection.year);
  if (page === "events") events.load(selection);
  if (page === "weather") await weather.load(selection.country, selection.city);
  if (page === "long-weekends") await longWeekends.load(selection.country, selection.year);
  if (page === "currency") await currency.initialize(selection.country, dashboard.countries);
  if (page === "sun-times") await sunTimes.load(selection.country, selection.city);
  if (page === "my-plans") plans.render();
}

function onSelectionChange() {
  const selection = dashboard.getSelection();
  const eventsCountryChanged = updateEventsSelection(selection);
  if (!router) return;
  if (router.current === "dashboard") {
    const key = selection.country ? `${selection.country.cca2}:${selection.year}` : "";
    if (key !== dashboardHolidayKey) {
      dashboardHolidayKey = key;
      holidays.load(selection.country, selection.year);
    }
    return;
  }
  if (router.current === "events") {
    if (eventsCountryChanged) loadPage("events");
    return;
  }
  loadPage(router.current);
}

async function explore(selection) {
  updateEventsSelection(selection);
  await Promise.all([
    holidays.load(selection.country, selection.year),
    longWeekends.load(selection.country, selection.year)
  ]);
  if (router.current === "weather") await weather.load(selection.country, selection.city);
  if (router.current === "sun-times") await sunTimes.load(selection.country, selection.city);
}

function setupModalAndNavigation() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  document.getElementById("mobile-menu-btn").addEventListener("click", () => {
    sidebar.classList.toggle("open");
    overlay.classList.toggle("hidden", !sidebar.classList.contains("open"));
  });
  overlay.addEventListener("click", closeMobileMenu);
  document.querySelectorAll(".nav-item[data-view]").forEach((link) => link.addEventListener("click", closeMobileMenu));

  const modal = document.getElementById("modal-overlay");
  document.getElementById("modal-close-btn").addEventListener("click", () => modal.classList.add("hidden"));
  modal.addEventListener("click", (event) => {
    if (event.target === modal) modal.classList.add("hidden");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      modal.classList.add("hidden");
      closeMobileMenu();
    }
  });
}

async function start() {
  updateDateTime();
  window.setInterval(updateDateTime, 30_000);
  dashboard = new Dashboard({
    onExplore: explore,
    onSelectionChange,
    onError: (message) => notify(message)
  });
  plans = new Plans({
    onNavigate: (page) => router?.navigate(page),
    onMessage: (message) => notify(message)
  });
  holidays = new Holidays({ onError: notify, plans });
  events = new Events({ onError: notify, plans });
  weather = new Weather({
    onError: notify,
    onNavigate: (page) => router?.navigate(page)
  });
  longWeekends = new LongWeekends({ onError: notify, plans });
  currency = new Currency({ onError: notify });
  sunTimes = new SunTimes({ onError: notify });
  router = new Router((page) => {
    closeMobileMenu();
    loadPage(page);
  });
  setupModalAndNavigation();

  setLoading(true, "Loading country data…");
  try {
    const countryData = await getCountries();
    dashboard.setCountries(countryData.countries);
    countryData.warnings.forEach((warning) => notify(warning));
    updateEventsSelection(dashboard.getSelection());
    onSelectionChange();
    if (router.current !== "dashboard") await loadPage(router.current);
  } catch (error) {
    dashboard.countrySelect.value = "";
    dashboard.countrySelect.disabled = true;
    dashboard.cityInput.value = "";
    dashboard.cityInput.disabled = true;
    dashboard.cityInput.replaceChildren(new Option("Country data unavailable", ""));
    showMessage(
      document.getElementById("dashboard-country-info"),
      "Could not load country data",
      error.message,
      "fa-triangle-exclamation"
    );
    notify(`Country data: ${error.message}`);
  } finally {
    setLoading(false);
  }
  window.setInterval(() => dashboard.updateLocalTime(), 1000);
}

start();
window.__WanderlustModules['main'] = {};
})();
