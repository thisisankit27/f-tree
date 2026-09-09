/*
 * A date that may be known only to the year or the month.
 *
 * A port of `data/PartialDate.kt`. Family history is full of "born sometime in 1938", so a full
 * date would force people to invent a day they do not know. Stored as a partial ISO-8601 string --
 * `1938`, `1938-04`, `1938-04-17` -- where the precision *is* the statement about how much is
 * known.
 *
 * Only the part the import needs is ported: parsing, the span a partial date covers, and whether
 * two of them could describe the same day. Formatting already exists in `model.js` and is not
 * duplicated here.
 *
 * `isCompatibleWith` is the load-bearing one. It is what stops an import merging two people called
 * Raj Kumar born eleven years apart, which is the single most destructive thing an import could do.
 *
 * Dates are compared as plain integers -- `yyyymmdd` -- rather than through `Date`. The values only
 * ever need ordering and equality, and `Date` would drag a timezone into a question that has none:
 * "1938" is not an instant, and midnight in one place is the previous day in another.
 */

const PATTERN = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** Days in a month, with the leap rule the Gregorian calendar actually uses. */
function daysIn(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export class PartialDate {
  constructor(year, month = null, day = null) {
    this.year = year;
    this.month = month;
    this.day = day;
  }

  /** The ISO-8601 string that gets persisted. */
  serialize() {
    const p = (n, w) => String(n).padStart(w, '0');
    if (this.month == null) return p(this.year, 4);
    if (this.day == null) return `${p(this.year, 4)}-${p(this.month, 2)}`;
    return `${p(this.year, 4)}-${p(this.month, 2)}-${p(this.day, 2)}`;
  }

  /** Earliest day this date could refer to, as yyyymmdd. */
  earliest() {
    return this.year * 10000 + (this.month ?? 1) * 100 + (this.day ?? 1);
  }

  /** Latest day this date could refer to, as yyyymmdd. */
  latest() {
    if (this.month == null) return this.year * 10000 + 1231;
    const day = this.day ?? daysIn(this.year, this.month);
    return this.year * 10000 + this.month * 100 + day;
  }

  /** True when the two could describe the same day, allowing for differing precision. */
  isCompatibleWith(other) {
    return this.earliest() <= other.latest() && other.earliest() <= this.latest();
  }

  toString() {
    return this.serialize();
  }
}

/**
 * Returns null for anything that is not a well-formed, real partial date.
 *
 * "Real" is doing work: `1938-02-30` matches the pattern and is not a day, and the Kotlin rejects
 * it because constructing the date throws. Nothing throws here, so the check is explicit -- without
 * it an impossible date would be treated as a known one and could rule out a correct match.
 */
export function parsePartialDate(value) {
  const match = PATTERN.exec(String(value ?? '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);

  if (month != null && (month < 1 || month > 12)) return null;
  if (day != null && (day < 1 || day > daysIn(year, month))) return null;
  return new PartialDate(year, month, day);
}
