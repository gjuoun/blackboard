/**
 * ULIDs: 48 bits of millisecond time then 80 random bits, Crockford base32, 26 characters. Generated
 * locally with no coordination, and sortable by creation time. Used as the stable id of a stream block.
 */
import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function ulid(now = Date.now(), rand: Uint8Array = randomBytes(10)): string {
  if (!Number.isInteger(now) || now < 0 || now >= 2 ** 48) throw new Error("ulid time out of range");
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  // 80 random bits, read as 16 base32 characters of 5 bits each
  let bits = 0;
  let acc = 0;
  let rest = "";
  for (const byte of rand) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      rest += ALPHABET[(acc >> (bits - 5)) & 31];
      bits -= 5;
    }
    acc &= (1 << bits) - 1;
  }
  return time + rest.slice(0, 16);
}
