const STORAGE_KEY = "wanderlust.savedPlans";

function isSavedPlan(value) {
  return value && typeof value === "object" &&
    typeof value.id === "string" &&
    ["holiday", "event", "longweekend"].includes(value.type) &&
    typeof value.title === "string";
}

export default class Plans {
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