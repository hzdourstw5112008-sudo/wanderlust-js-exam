import { getEvents, showMessage } from "./api.js";

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

export default class Events {
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
