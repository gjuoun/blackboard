import type { Dict } from "./types.ts";

export const en: Dict = {
  locale: "en",
  lang: "en",
  title: "Blackboard — review markdown with your coding agent",
  description:
    "Plan review, back in the document: highlight a passage, leave a comment, and your coding agent answers over the same CLI. Local, MIT licensed.",
  languageName: "English",
  switcher: { href: "/zh/", label: "中文", lang: "zh" },
  hero: {
    tagline: "Plan review, back in the document.",
    who: "Highlight a passage, leave a comment; your agent answers over the same CLI — back and forth until it ships.",
    cta: "Get started",
    github: "GitHub ↗",
    shot: {
      src: "/assets/doc.png",
      alt: "Blackboard doc view: a markdown plan with a highlighted passage, table of contents, mermaid diagram and a comments panel where an agent asks about a passage and a human replies",
      width: 1440,
      height: 1160,
      caption: "The doc view — select a passage, comment; the agent answers from its shell and the page updates live.",
    },
  },
  install: {
    rows: ["npm install -g blackboard", "blackboard open docs/plan.md"],
    copy: "Copy",
    copied: "Copied",
    bunPrefix: "or with bun: ",
    bunCommand: "bunx blackboard open docs/plan.md",
  },
  inbox: {
    heading: "Inbox",
    shot: {
      src: "/assets/inbox.png",
      alt: "Blackboard inbox: a flat list of markdown documents, newest update first, unread ones marked with a solid dot — the mail model, not a dashboard",
      width: 1440,
      height: 540,
      caption: "One flat stream of documents, newest first, unread bold with a dot — the mail model. Click a row to read; the doc opens in a reader built for attention.",
      loading: "lazy",
    },
  },
  features: {
    heading: "What it does",
    items: [
      { title: "One markdown file", text: "the agent writes a report, a plan or an audit; `blackboard open` registers it. One file, one document." },
      { title: "Comments on text", text: "select the passage that raised the question, write a note; flat replies, resolve and reopen — the thread is the conversation." },
      { title: "Live view", text: "the page refreshes when the file changes; highlights follow their passage." },
      { title: "Pull, not push", text: "the agent reads comments with `blackboard comments`, answers with `reply`, resolves with `resolve` — no wait, no push, any shell works." },
      { title: "Markdown done right", text: "GFM tables with sticky headers, heading anchors, TOC, front matter as a table." },
      { title: "Offline mermaid", text: "diagrams render in the browser from the bundled library." },
      { title: "Local and safe", text: "binds 127.0.0.1, serves only registered files, re-checks every request." },
      { title: "Copy open", text: "copy the open comments as markdown to paste anywhere." },
    ],
  },
  cli: {
    heading: "CLI for agents",
    rows: [
      { command: "open     <file> [--no-browser]                ", comment: 'prints "<id>  <url>"' },
      { command: "sessions [--json]                             ", comment: "id, title, location, branch, open comments" },
      { command: "comments <session> [--json]                   ", comment: "the comments and their replies" },
      { command: 'reply    <session> <comment-id> "text"' },
      { command: "resolve  <session> <comment-id>               ", comment: "or: reopen" },
      { command: 'comment  <session> --quote "passage" "note"' },
      { command: "blocks   <session>                            ", comment: "the document's content blocks" },
      { command: 'patch    <session> --id <block> --new "text"    ', comment: "splice one block's text" },
    ],
    note: {
      before: "The CLI edits files under ",
      code: "~/.blackboard",
      after: " under a lock shared with the web app, so it works whether or not the app is running; an open page shows its changes live.",
    },
  },
  footer: {
    license: "MIT License",
    requirements: "Requires bun 1.3+ · macOS & Linux · Chrome/Edge, Safari 17.2+",
  },
};
