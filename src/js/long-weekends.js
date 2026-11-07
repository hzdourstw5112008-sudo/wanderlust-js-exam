import { getLongWeekends, formatDate, escapeHtml, showMessage } from "./api.js";

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

export default class LongWeekends {
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