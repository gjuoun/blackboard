import type { ReactNode } from "react";
import { type Nav, NavProvider } from "@/components/nav";

/**
 * A Nav for tests: the app's components read `pathname`, three ways to move and a `Link`, so a test
 * supplies its own instead of mocking a router it no longer imports.
 */
export function TestNav({ pathname = "/", children }: { pathname?: string; children: ReactNode }) {
  const value: Nav = {
    pathname,
    push: () => {},
    replace: () => {},
    refresh: () => {},
    Link: ({ href, ...rest }) => <a href={href} {...rest} />,
  };
  return <NavProvider value={value}>{children}</NavProvider>;
}
