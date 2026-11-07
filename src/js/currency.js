import { getCurrencyRates, showMessage } from "./api.js";

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

export default class Currency {
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