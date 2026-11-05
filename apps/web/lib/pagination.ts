/**
 * Which page numbers a listing's pagination shows, as a pure function, so the
 * markup in `components/Pagination.tsx` stays a map over this list.
 *
 * Every page is listed up to `MAX_LISTED` pages. Past that, the first page,
 * the last page and a window of `AROUND` pages either side of the current one
 * are listed, with a gap (`null`) wherever pages are skipped, so the list has
 * a fixed maximum length and a reader always has a way to the ends and to the
 * neighbours. A gap never stands for a single page: that page is listed
 * instead, since it takes the same room.
 */

/** Up to this many pages, every page is listed. */
export const MAX_LISTED = 7;

/** Pages shown either side of the current one in a windowed list. */
export const AROUND = 1;

/** A page number to link, or `null` for a gap in the sequence. */
export type PageItem = number | null;

/**
 * The page numbers to list for page `current` of `total`, in order, with
 * `null` for each gap. Throws a `RangeError` when `current` is not within
 * `1..total` or `total` is less than 1: a listing with no pages shows no
 * pagination and never calls this.
 */
export function pageWindow(current: number, total: number): PageItem[] {
  if (!Number.isSafeInteger(total) || total < 1) {
    throw new RangeError(`Not a page count: ${String(total)}`);
  }
  if (!Number.isSafeInteger(current) || current < 1 || current > total) {
    throw new RangeError(`Page ${String(current)} is not within 1..${total}`);
  }
  if (total <= MAX_LISTED) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const items: PageItem[] = [1];
  const start = Math.max(2, current - AROUND);
  const end = Math.min(total - 1, current + AROUND);
  if (start > 2) {
    // A gap of one page is that page, not an ellipsis.
    items.push(start === 3 ? 2 : null);
  }
  for (let page = start; page <= end; page++) {
    items.push(page);
  }
  if (end < total - 1) {
    items.push(end === total - 2 ? total - 1 : null);
  }
  items.push(total);
  return items;
}
