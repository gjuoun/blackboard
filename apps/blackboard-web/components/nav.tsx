"use client";

import { createContext, useContext, type AnchorHTMLAttributes, type ComponentType, type ReactNode } from "react";

/** A link that takes a plain URL, so a component never names the router it is rendered under. */
export type NavLinkProps = { href: string } & AnchorHTMLAttributes<HTMLAnchorElement>;
export type NavLink = ComponentType<NavLinkProps>;

/**
 * What a component needs from whichever router is hosting it: the current path, three ways to
 * move, and a link. The Next shell and the TanStack Start shell each supply one, so the app's
 * components stay framework-free and both trees can render the same code.
 */
export type Nav = {
  pathname: string;
  push: (href: string, options?: { scroll?: boolean }) => void;
  replace: (href: string, options?: { scroll?: boolean }) => void;
  /** Re-read the server's data for the current page without a navigation. */
  refresh: () => void;
  Link: NavLink;
};

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ value, children }: { value: Nav; children: ReactNode }) {
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav needs a NavProvider — the shell supplies the router");
  return nav;
}