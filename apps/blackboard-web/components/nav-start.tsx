import { Link as RouterLink, useRouter, useRouterState } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { NavProvider, type Nav, type NavLink } from "@/components/nav";

const Link: NavLink = ({ href, ...rest }) => <RouterLink to={href as never} {...rest} />;

/**
 * The TanStack Start shell's router, in the shape the app's components read. `navigate` takes the
 * `href` form, so a query string or a dynamic segment stays a plain URL string at the call site.
 */
export function StartNavProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const value = useMemo<Nav>(
    () => ({
      pathname,
      push: (href, options) => void router.navigate({ href, resetScroll: options?.scroll !== false }),
      replace: (href, options) => void router.navigate({ href, replace: true, resetScroll: options?.scroll !== false }),
      refresh: () => void router.invalidate(),
      Link,
    }),
    [pathname, router],
  );
  return <NavProvider value={value}>{children}</NavProvider>;
}