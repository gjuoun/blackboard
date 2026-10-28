/* JW-319 diff-panel mock — interactions only; tokens/palettes live in mock.css */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---- hash deep links: #paper|#night, #drawer, #comments, #list, #grammar, #notoc ---- */
const tokens = location.hash.replace("#", "").split("-").filter(Boolean);
let theme = tokens.includes("night") ? "night" : tokens.includes("plain") ? "plain" : "paper";
let layout = tokens.includes("drawer") ? "drawer" : "tabs";
let pane = tokens.includes("comments") ? "comments" : "diff";
const autoSelect = !tokens.includes("list") && pane === "diff";

function applyChrome() {
  const html = document.documentElement;
  html.dataset.theme = theme;
  html.dataset.layout = layout;
  html.classList.toggle("notoc", tokens.includes("notoc"));
  $("#seg-paper").setAttribute("aria-pressed", String(theme === "paper"));
  $("#seg-night").setAttribute("aria-pressed", String(theme === "night"));
  $("#seg-tabs").setAttribute("aria-pressed", String(layout === "tabs"));
  $("#seg-drawer").setAttribute("aria-pressed", String(layout === "drawer"));
  applyPane();
}
function applyPane() {
  // drawer keeps both panes visible (comments in the rail, diff floating over it); tabs shows exactly one
  if (layout === "drawer") {
    $("#pane-comments").hidden = false;
    $("#pane-diff").hidden = false;
  } else {
    $("#pane-diff").hidden = pane !== "diff";
    $("#pane-comments").hidden = pane !== "comments";
  }
  $("#tab-diff").setAttribute("aria-selected", String(pane === "diff"));
  $("#tab-comments").setAttribute("aria-selected", String(pane === "comments"));
  $("#btn-diff").setAttribute("aria-pressed", String(pane === "diff"));
  $("#btn-comments").setAttribute("aria-pressed", String(pane === "comments"));
  $("#btn-toc").setAttribute("aria-pressed", String(!document.documentElement.classList.contains("notoc")));
}
function setTheme(t) { theme = t; applyChrome(); }
function setLayout(l) { layout = l; applyChrome(); }
function setPane(p) { pane = p; applyPane(); }
applyChrome();

/* ---- rail tabs ---- */
$$(".rtab").forEach((b) => b.addEventListener("click", () => setPane(b.dataset.pane)));

/* ---- bar toggles: contents collapse, comments ⇄ Local PR ---- */
$("#btn-toc").addEventListener("click", () => {
  document.documentElement.classList.toggle("notoc");
  applyPane();
});
$("#btn-comments").addEventListener("click", () => setPane("comments"));
$("#btn-diff").addEventListener("click", () => setPane("diff"));

/* ---- draggable gutters (JW-247 PanelResizer stand-in): TOC and right rail ---- */
$$(".gut").forEach((g) => {
  g.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    const key = "--" + g.dataset.for + "-w";
    const startX = e.clientX;
    const startW = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(key)) || 300;
    g.classList.add("drag");
    g.setPointerCapture(e.pointerId);
    const move = (ev) => {
      // the rail's left edge grows as the pointer moves LEFT, so invert the delta there
      const delta = g.dataset.for === "cm" ? startX - ev.clientX : ev.clientX - startX;
      const w = Math.min(620, Math.max(150, startW + delta));
      document.documentElement.style.setProperty(key, w + "px");
    };
    const up = () => {
      g.classList.remove("drag");
      g.removeEventListener("pointermove", move);
      g.removeEventListener("pointerup", up);
    };
    g.addEventListener("pointermove", move);
    g.addEventListener("pointerup", up);
  });
});

/* ---- local PR: file list ⇄ full-file diff ⇄ snippet (what a file: link opens) ---- */
const RICH = ["lib/markdown.ts", "lib/diff-index.ts"];
function showBlock(which) {
  $("#pr-list").hidden = which !== "list";
  $("#pr-snippet").hidden = which !== "snippet";
  $("#pr-file").hidden = which !== "file";
}
function selectFile(name, range) {
  $$("#pr-list li").forEach((li) => li.classList.toggle("sel", li.dataset.file === name));
  showBlock("file");
  $("#dv-markdown").hidden = name !== "lib/markdown.ts";
  $("#dv-diff-index").hidden = name !== "lib/diff-index.ts";
  $("#dv-generic").hidden = RICH.includes(name);
  $("#gen-name").textContent = name;
  const tag = $("#link-tag");
  tag.hidden = !range;
  if (range) tag.textContent = "来自链接 · L" + range[0] + "-L" + range[1];
  $$(".dv").forEach((dv) => {
    if (dv.hidden) return;
    $$(".dl", dv).forEach((l) => {
      const n = parseInt((l.querySelector(".ln")?.textContent || "").trim(), 10);
      l.classList.toggle("inr", !!range && !!n && n >= range[0] && n <= range[1]);
    });
  });
  setPane("diff");
}
/* the doc link opens the RANGE, not the whole file — snippet-first */
function openSnippet(name, range) {
  $$("#pr-list li").forEach((li) => li.classList.toggle("sel", li.dataset.file === name));
  if (name === "lib/markdown.ts") {
    showBlock("snippet");
    const tag = $("#link-tag");
    tag.hidden = !range;
    if (range) tag.textContent = "来自链接 · L" + range[0] + "-L" + range[1];
    setPane("diff");
  } else {
    selectFile(name, range); /* other files fall back to the full-file view in the mock */
  }
}
$("#snip-fullfile").addEventListener("click", (e) => {
  e.preventDefault();
  selectFile("lib/markdown.ts", [236, 330]);
});
const snipBack = $("#snip-back");
snipBack.addEventListener("click", (e) => {
  e.preventDefault();
  showBlock("list");
  $$(".file-link").forEach((x) => x.removeAttribute("aria-current"));
});
$("#back").addEventListener("click", (e) => {
  e.preventDefault();
  showBlock("list");
  $$(".file-link").forEach((x) => x.removeAttribute("aria-current"));
});
$$("#pr-list li").forEach((li) => li.addEventListener("click", () => selectFile(li.dataset.file)));

/* ---- file: links in the doc body → open THE RANGE as a snippet ---- */
$$(".file-link").forEach((a) =>
  a.addEventListener("click", (e) => {
    e.preventDefault();
    $$(".file-link").forEach((x) => x.removeAttribute("aria-current"));
    a.setAttribute("aria-current", "true");
    const r = a.dataset.range ? a.dataset.range.split(",").map(Number) : null;
    openSnippet(a.dataset.file, r);
  })
);

/* ---- initial state: the markdown.ts link was followed (the money shot) ---- */
if (autoSelect) {
  const a = $('.file-link[data-file="lib/markdown.ts"]');
  a?.setAttribute("aria-current", "true");
  openSnippet("lib/markdown.ts", [236, 330]);
}
/* ---- #grammar: frame the link-grammar section so the file: links are in view ---- */
if (tokens.includes("grammar")) {
  requestAnimationFrame(() => {
    document.getElementById("grammar")?.scrollIntoView({ block: "start" });
  });
}