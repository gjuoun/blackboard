/** Home groups its cards by how recently each doc changed. */
export type HomeGroup = "Today" | "This week" | "Earlier";
export const HOME_GROUPS: HomeGroup[] = ["Today", "This week", "Earlier"];

const DAY = 24 * 60 * 60 * 1000;

/** "Today" is since local midnight; "This week" the six days before that. */
export function groupOf(updatedAt: string, now = Date.now()): HomeGroup {
  const t = Date.parse(updatedAt);
  if (Number.isNaN(t)) return "Earlier";
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  if (t >= midnight.getTime()) return "Today";
  if (t >= midnight.getTime() - 6 * DAY) return "This week";
  return "Earlier";
}
