/**
 * Feature switches. One line each, so hiding a surface is a one-word change and re-enabling it is
 * the same edit in reverse — never a revert of the code.
 */

/**
 * Local PR rail (Comments / Local PR tabs + `file:` links + code-anchored comments).
 *
 * OFF since 2026-11-01 (Jun: 「这个 local pr 的 tab 暂时隐藏」). Root cause: the diff base is the
 * merge-base of the document's OWN repository, so a plan kept in ~/.notebook diffs the notebook
 * repo — the file changes he wants to read (the code repo the card is about) can never appear.
 * The pane is not broken; it is bound to the wrong repo.
 *
 * Re-enable only together with a diff base that can name a FOREIGN repo: front matter carries the
 * target repository (e.g. `pr.repo: ~/code/gjuoun/blackboard`) and both the pin and the `file:`
 * paths resolve against it. Flipping this flag back without that change restores exactly the
 * behaviour that was hidden.
 */
export const LOCAL_PR = false;
