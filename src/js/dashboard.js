import { escapeHtml, getCities, getCity, getCountryStatistics, showMessage } from "./api.js";

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

export default class Dashboard {
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