import { getCity, getWeather, weatherDescription, escapeHtml, showMessage } from "./api.js";

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

export default class Weather {
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