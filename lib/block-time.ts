/**
 * The clock time a stream block shows: the record's ISO stamp as the process's local `HH:MM:SS`,
 * with the ISO kept for the header's `title` so nothing is lost. The block header and the timeline
 * both use this one helper, so the rail and the reading surface agree. A stamp that is not a valid
 * date (old files wrote short labels) is shown as it is: no clock is invented, nothing is dropped.
 */
export type BlockTime = { time: string; iso: string };

const pad2 = (n: number) => String(n).padStart(2, "0");

export function blockTime(at: string): BlockTime {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return { time: at, iso: at };
  return { time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()), iso: at };
}
