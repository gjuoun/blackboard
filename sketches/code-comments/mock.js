// Hash-route states: #thread (default) #compose #hover #tab #orphan. One product question,
// each state screenshot-able in isolation, combinable with -.
const states = ["thread", "compose", "hover", "tab", "orphan"];

function apply() {
  const raw = location.hash.replace(/^#/, "") || "thread";
  const on = new Set(raw.split("-").filter((s) => states.includes(s)));
  if (on.size === 0) on.add("thread");

  // panes
  const diff = !on.has("tab");
  document.getElementById("pane-diff").hidden = !diff;
  document.getElementById("pane-comments").hidden = diff;
  document.querySelector('.rtab[data-pane="diff"]').setAttribute("aria-selected", String(diff));
  document.querySelector('.rtab[data-pane="comments"]').setAttribute("aria-selected", String(!diff));

  // thread vs composer under the anchored row
  document.getElementById("cc-thread").hidden = !(on.has("thread") || on.has("orphan"));
  document.getElementById("cc-compose").hidden = !on.has("compose");

  // hover: force the + affordance visible on L13 (screenshots cannot hover)
  document.querySelectorAll(".dl.reveal").forEach((el) => el.classList.remove("reveal"));
  if (on.has("hover")) document.querySelectorAll(".dv .dl")[4]?.classList.add("reveal");

  // orphan: the anchored line drifted — warn badge, orphan thread edge
  const badge = document.getElementById("cc-orphan-badge");
  const thread = document.getElementById("cc-thread");
  badge.hidden = !on.has("orphan");
  thread.classList.toggle("orphan", on.has("orphan"));

  // state chips
  document.querySelectorAll("#states a").forEach((a) => {
    a.setAttribute("aria-current", a.getAttribute("href") === "#" + raw ? "true" : "false");
  });
}

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  document.getElementById("seg-paper").setAttribute("aria-pressed", String(t === "paper"));
  document.getElementById("seg-night").setAttribute("aria-pressed", String(t === "night"));
}
function showTab(p) {
  location.hash = p === "comments" ? "tab" : "thread";
}

addEventListener("hashchange", apply);
setTheme("paper");
apply();
