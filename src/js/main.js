import { getCountries, showMessage } from "./api.js";
import Currency from "./currency.js";
import Dashboard from "./dashboard.js";
import Events from "./event.js";
import Holidays from "./holidays.js";
import LongWeekends from "./long-weekends.js";
import Plans from "./plans.js";
import Router from "./router.js";
import SunTimes from "./sun-times.js";
import Weather from "./weather.js";

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