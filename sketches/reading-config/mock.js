/* Reading-config mock: palette + font switching, persisted locally so Jun can leave it in a state. */
(() => {
  const KEY = "bb-mock-prefs";
  const DEFAULTS = { theme: "paper", latin: "qublack", cjk: "qublack", mono: "qublack-mono" };
  const root = document.documentElement;
  const $ = (s) => document.querySelector(s);
  const settings = $("#settings");
  const cards = [...document.querySelectorAll("[data-theme-pick]")];

  const load = () => {
    try {
      return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || "{}") || {}) };
    } catch {
      return { ...DEFAULTS };
    }
  };

  const apply = (p, save) => {
    root.dataset.theme = p.theme;
    root.dataset.fontLatin = p.latin;
    root.dataset.fontCjk = p.cjk;
    root.dataset.fontMono = p.mono;
    for (const c of cards) {
      const on = c.dataset.themePick === p.theme;
      c.dataset.active = String(on);
      c.setAttribute("aria-checked", String(on));
    }
    $("#font-latin").value = p.latin;
    $("#font-cjk").value = p.cjk;
    $("#font-mono").value = p.mono;
    if (save) {
      try {
        localStorage.setItem(KEY, JSON.stringify(p));
      } catch {
        /* storage blocked: the choice lasts for this page */
      }
    }
    return p;
  };

  let prefs = apply(load(), false);

  cards.forEach((c) => c.addEventListener("click", () => (prefs = apply({ ...prefs, theme: c.dataset.themePick }, true))));
  $("#font-latin").addEventListener("change", (e) => (prefs = apply({ ...prefs, latin: e.target.value }, true)));
  $("#font-cjk").addEventListener("change", (e) => (prefs = apply({ ...prefs, cjk: e.target.value }, true)));
  $("#font-mono").addEventListener("change", (e) => (prefs = apply({ ...prefs, mono: e.target.value }, true)));
  $("#reset").addEventListener("click", () => (prefs = apply({ ...DEFAULTS }, true)));

  // The palette button toggles the panel; ?settings=1 opens it for screenshots.
  const setOpen = (open) => {
    settings.hidden = !open;
    $("#open-settings").setAttribute("aria-pressed", String(open));
  };
  $("#open-settings").addEventListener("click", () => setOpen(settings.hidden));
  setOpen(new URLSearchParams(location.search).get("settings") === "1");

  // Keyboard: 1/2/3 pick a palette, esc closes the panel.
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") setOpen(false);
    if (["1", "2", "3"].includes(e.key)) {
      const id = ["paper", "plain", "night"][Number(e.key) - 1];
      prefs = apply({ ...prefs, theme: id }, true);
    }
  });
})();
