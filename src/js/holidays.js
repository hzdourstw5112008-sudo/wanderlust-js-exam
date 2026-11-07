import { getHolidays, formatDate, escapeHtml, showMessage } from "./api.js";

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

export default class Holidays {
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