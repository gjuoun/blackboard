import { describe, expect, test } from "bun:test";
import { apiServeOptions } from "./serve-options";

const answer = () => new Response("ok");

describe("the API process options", () => {
  test("the idle timeout is off, so an idle watch stream is not closed", () => {
    // Bun closes an idle connection after 10 s unless this is 0. The SSE heartbeat is slower
    // than that window, so a missing 0 is the bug the browser saw as repeated reconnects.
    expect(apiServeOptions(38801, answer).idleTimeout).toBe(0);
  });

  test("the port is the one asked for, bound to loopback, with the app as the handler", () => {
    const options = apiServeOptions(38801, answer);
    expect(options.port).toBe(38801);
    expect(options.hostname).toBe("127.0.0.1");
    expect(options.fetch).toBe(answer);
  });
});