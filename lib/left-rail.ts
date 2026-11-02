/**
 * The left rail's tabs for each document type. Pure, so the rule is tested without a browser.
 * A doc has 内容 (the TOC) and 工作区 (the repo tree). A code file has only 工作区: the outline (大纲)
 * is not offered, by ruling. A stream has only 时间线.
 */
import type { DocType } from "./doc-type";

export type LeftTab = "contents" | "workspace" | "timeline";

/** The tabs a document type offers, in the order they show. */
export const LEFT_TABS_BY_TYPE: Record<DocType, readonly LeftTab[]> = {
  doc: ["contents", "workspace"],
  code: ["workspace"],
  stream: ["timeline"],
};

export const LEFT_LABELS: Record<LeftTab, string> = { contents: "内容", workspace: "工作区", timeline: "时间线" };

/**
 * The tab to show for a type. A value the type does not offer (or none) falls back to its first tab,
 * so a stale `?left=` link never shows an empty rail.
 */
export function parseLeftTab(value: unknown, type: DocType): LeftTab {
  const offered = LEFT_TABS_BY_TYPE[type];
  return (offered as readonly unknown[]).includes(value) ? (value as LeftTab) : offered[0];
}
