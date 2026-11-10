import { describe, expect, test } from "bun:test";
import { mock } from "bun:test";

// StreamBody renders on the server; its StreamFollow leaf needs the virtual-doc context module
// mocked away from any provider for markup rendering.
mock.module("./StreamFollow", () => ({ StreamFollow: () => null }));

import { renderToStaticMarkup } from "react-dom/server";
import type { StreamNode } from "./StreamBody";
import { StreamBody } from "./StreamBody";
import { followState } from "./StreamFollow";

const node = (n: number, over: Partial<StreamNode> = {}): StreamNode => ({
  id: `b-test-${n}`,
  n,
  action: "answer",
  author: "agent",
  when: "5 min ago",
  writing: false,
  html: `<p>block ${n}</p>`,
  ...over,
});

const render = (nodes: StreamNode[]) => renderToStaticMarkup(<StreamBody nodes={nodes} />);

describe("StreamBody", () => {
  test("renders one section per exchange with its meta line", () => {
    const html = render([node(1), node(2, { action: "append", author: "jun" }), node(3)]);
    expect(html.match(/data-testid="stream-block-/g)).toHaveLength(3);
    expect(html).toContain('id="b-test-1"');
    expect(html).toContain('id="b-test-2"');
    expect(html).toContain("长答");
    expect(html).toContain("追加");
    expect(html).toContain("jun");
    expect(html).toContain("<p>block 2</p>");
  });

  test("a writing exchange carries data-status and the breathing caret", () => {
    const html = render([node(1), node(2, { writing: true })]);
    expect(html).toContain('data-status="writing"');
    expect(html).toContain("stream-caret");
    expect(html).toContain("stream-tail");
    // Only the open exchange is marked.
    expect(html.match(/data-status="writing"/g)).toHaveLength(1);
  });

  test("the follow latch only disengages above the exit band and re-engages near the bottom", () => {
    expect(followState(true, 200)).toBe(false);   // reader scrolled up: stop following
    expect(followState(false, 200)).toBe(false);
    expect(followState(false, 60)).toBe(false);   // inside the hysteresis band: unchanged
    expect(followState(true, 60)).toBe(true);
    expect(followState(false, 10)).toBe(true);    // back at the bottom: follow again
  });

  test("no writing exchange means no caret anywhere", () => {
    const html = render([node(1), node(2)]);
    expect(html).not.toContain("stream-caret");
    expect(html).not.toContain('data-status="writing"');
  });
});
