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

export default class Router {
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