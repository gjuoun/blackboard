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

describe("pending placeholders", () => {
  const pending = (n: number, over: Partial<import("./StreamBody").PendingNode> = {}): import("./StreamBody").PendingNode => ({
    id: `b-pending-${n}`,
    n,
    action: "append",
    author: "agent",
    when: "5 min ago",
    writing: false,
    est: 300,
    ...over,
  });

  test("pending sections interleave by n, carry data-pending and the estimate", () => {
    const html = renderToStaticMarkup(<StreamBody nodes={[node(1), node(4, { id: "b-tail" })]} pending={[pending(2), pending(3)]} />);
    expect(html.match(/data-pending/g)).toHaveLength(2);
    expect(html).toContain('data-est="300"');
    expect(html).toContain('id="b-pending-2"');
    expect(html).toContain('data-testid="stream-block-pending-2"');
    expect(html).toContain('id="b-tail"');
    const order = [html.indexOf('id="b-test-1"'), html.indexOf('id="b-pending-2"'), html.indexOf('id="b-pending-3"'), html.indexOf('id="b-tail"')];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("no pending means byte-identical output to before", () => {
    const html = render([node(1), node(2, { writing: true })]);
    expect(html).toContain('id="b-test-1"');
    expect(html).toContain('id="b-test-2"');
    expect(html.match(/data-pending/g) ?? []).toHaveLength(0);
  });
});

describe("bare placeholders", () => {
  const pending = (n: number, over: Partial<import("./StreamBody").PendingNode> = {}): import("./StreamBody").PendingNode => ({
    id: `b-p-${n}`,
    n,
    action: "append",
    author: "agent",
    when: "5 min ago",
    writing: false,
    est: 300,
    ...over,
  });

  test("a far placeholder keeps id, estimate and height but ships no meta text", () => {
    const html = renderToStaticMarkup(<StreamBody nodes={[node(1)]} pending={[pending(2, { bare: true })]} />);
    const bare = html.slice(html.indexOf('id="b-p-2"') - 10, html.indexOf('id="b-p-2"') + 200);
    expect(bare).toContain("data-pending");
    expect(bare).toContain('data-est="300"');
    expect(bare).toContain("height:300px");
    // No meta line and no loading label: the whole point of the bare form.
    expect(bare).not.toContain("stream-meta");
    expect(bare).not.toContain("加载中");
    expect(bare).not.toContain("5 min ago");
  });

  test("a near placeholder still shows what is coming", () => {
    const html = renderToStaticMarkup(<StreamBody nodes={[node(1)]} pending={[pending(2)]} />);
    expect(html).toContain("stream-meta");
    expect(html).toContain("加载中");
    expect(html).toContain("#2 · 追加 · agent · 5 min ago");
  });
});
