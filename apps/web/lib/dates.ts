/**
 * The one way a publication date is shown: `date_gmt` with its `Z`, formatted
 * in UTC as "Nov 1, 2026", so a card and the resource page agree and a
 * server render never depends on the function's time zone.
 */
const PUBLISHED_DATE = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** `iso`, an ISO 8601 instant, as the site writes a date. */
export function formatPublishedDate(iso: string): string {
  return PUBLISHED_DATE.format(new Date(iso));
}
