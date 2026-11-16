// Canned content for the phone demo. Strings arrive resolved through DemoDict (i18n); the
// shapes below mirror what ReadingList / DocView / CommentPanel consume in the real app.

export interface DemoRow {
  id: string;
  title: string;
  path: string;
  branch: string;
  unread: boolean;
  comments: number;
  updated: string;
}

export interface DemoBlock {
  kind: "h2" | "p" | "code" | "quote";
  text: string;
}

export interface DemoComment {
  author: string;
  time: string;
  body: string;
  resolved?: boolean;
}

export interface DemoDoc {
  id: string;
  title: string;
  path: string;
  branch: string;
  toc: string[];
  blocks: DemoBlock[];
  comments: DemoComment[];
}

export interface DemoDict {
  heading: string;
  caption: string;
  inboxTitle: string;
  openLabel: string;
  tabs: { inbox: string; unread: string; settings: string };
  sheetToc: string;
  sheetComments: string;
  commentsHeading: string;
  replyPlaceholder: string;
  replySend: string;
  backToInbox: string;
  rows: DemoRow[];
  doc: DemoDoc;
}