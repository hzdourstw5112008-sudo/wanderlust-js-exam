import { getCity, getSunTimes, escapeHtml, showMessage } from "./api.js";

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

export default class SunTimes {
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