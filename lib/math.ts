/**
 * Inline `$…$` math with the Typora / Pandoc rule, which remark-math's own single-dollar tokenizer
 * lacks: remark-math with `singleDollarTextMath: true` turns `Cost is $5 and $6` into math, so it
 * stays off, and this construct adds the one-dollar form back with three guards.
 *
 * - The opening `$` must be followed by a non-space.
 * - The closing `$` must be preceded by a non-space that is not a backslash.
 * - The closing `$` must not be followed by a digit.
 *
 * A `$` that fails a guard is ordinary text, so the rest of the paragraph is unaffected. It is a
 * micromark construct rather than an mdast pass so that escapes (`\$`), code spans and emphasis are
 * resolved by the parser first, exactly as they are for the rest of the markdown.
 */
import type { Processor } from "unified";

type Code = number | null;
type Token = { type: string };
type Effects = { enter(type: string): Token; exit(type: string): Token; consume(code: Code): void };
type State = (code: Code) => State | undefined;
type Ctx = { events: [string, Token, unknown][] };
type Construct = { name: string; tokenize: (this: Ctx, effects: Effects, ok: State, nok: State) => State | undefined; previous: (this: Ctx, code: Code) => boolean };

const DOLLAR = 36;
const BACKSLASH = 92;
const isEol = (c: Code) => c === 10 || c === 13;
const isBlank = (c: Code) => c === 32 || c === 9 || isEol(c);
const isDigit = (c: Code) => c !== null && c >= 48 && c <= 57;

/** Same entry point as micromark-extension-math's `previous`: a run of `$` is only entered at its start. */
function previous(this: Ctx, code: Code): boolean {
  const last = this.events[this.events.length - 1];
  return code !== DOLLAR || !last || last[1].type === "characterEscape";
}

function tokenizeSingleDollar(this: Ctx, effects: Effects, ok: State, nok: State): State | undefined {
  let sizeOpen = 0;
  let size = 0;
  let before: Code = DOLLAR;
  let last: Code = null;
  let token: Token | undefined;
  return start;

  function eat(code: Code): void {
    effects.consume(code);
    last = code;
  }

  function start(code: Code): State | undefined {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    return open(code);
  }

  /** The opening run: exactly one `$` (a longer run is remark-math's `$$` form), then a non-space. */
  function open(code: Code): State | undefined {
    if (code === DOLLAR) {
      eat(code);
      sizeOpen++;
      return open;
    }
    if (sizeOpen !== 1 || code === null || isBlank(code)) return nok(code);
    effects.exit("mathTextSequence");
    last = DOLLAR;
    return between(code);
  }

  function between(code: Code): State | undefined {
    if (code === null) return nok(code);
    if (code === DOLLAR) {
      token = effects.enter("mathTextSequence");
      size = 0;
      before = last;
      return closeRun(code);
    }
    if (isEol(code)) {
      effects.enter("mathTextData");
      eat(code);
      effects.exit("mathTextData");
      return between;
    }
    effects.enter("mathTextData");
    return data(code);
  }

  function data(code: Code): State | undefined {
    if (code === null || code === DOLLAR || isEol(code)) {
      effects.exit("mathTextData");
      return between(code);
    }
    eat(code);
    return data;
  }

  /** A run of `$` after content: it closes only when it is a lone `$` passing all three guards. */
  function closeRun(code: Code): State | undefined {
    if (code === DOLLAR) {
      eat(code);
      size++;
      return closeRun;
    }
    const closes = size === 1 && before !== null && !isBlank(before) && before !== BACKSLASH && !isDigit(code);
    if (closes) {
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok(code);
    }
    // Not a closer: the dollars are text, and scanning goes on.
    if (token) token.type = "mathTextData";
    return data(code);
  }
}

/** The construct, for micromark's `text` hook on code 36 (`$`). */
export function singleDollarMathText(): Construct {
  return { name: "singleDollarMathText", tokenize: tokenizeSingleDollar, previous };
}

/**
 * Adds the single-dollar construct next to remark-math's `$$` one. Must run after `remarkMath` so
 * the two share the `$` hook; micromark tries them in order and the `$$` form is left to remark-math.
 */
export function remarkSingleDollarMath(this: Processor) {
  const data = this.data();
  const extensions = data.micromarkExtensions || (data.micromarkExtensions = []);
  extensions.push({ text: { [DOLLAR]: singleDollarMathText() } } as never);
}
