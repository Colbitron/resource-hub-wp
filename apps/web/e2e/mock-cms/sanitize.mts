/**
 * WordPress's `sanitize_title()`, which is how WordPress turns a title into a
 * slug, how the plugin's resolve route and the terms controller's `slug`
 * filter clean a slug (the `save` context), and, through
 * `sanitize_title_for_query()`, how `WP_Query` cleans the posts controller's
 * `slug` filter (`post_name__in`, the `query` context). Written from
 * WordPress 7.1.4's `wp-includes/formatting.php`, step for step.
 *
 * What it does not cover:
 * - `remove_accents()` is core's table as an `en_US` site has it. The
 *   locale-specific rules core adds for `de_*`, `da_DK`, `ca`, `sr_RS` and
 *   `bs_BA` (`ä` to `ae`, `å` to `aa`, `đ` to `dj`) are left out, and so is
 *   its ISO-8859-1 branch, which a JavaScript string never reaches.
 * - Lower-casing is JavaScript's `toLowerCase()`, not `mb_strtolower()`; the
 *   two differ on a few letters outside Latin.
 * - `strip_tags()` is a regular expression for well-formed tags.
 * - No `sanitize_title` filter other than core's own runs.
 */

/**
 * `remove_accents()`'s table on an `en_US` site, from WordPress 7.1.4,
 * grouped by replacement: each character of the first string becomes the
 * second. A letter not listed, such as `Ḁ` or `ǰ`, is left as it is, and
 * `utf8_uri_encode()` then encodes it.
 */
const ACCENT_GROUPS: readonly (readonly [string, string])[] = [
  ["ªàáâãäåāăąầằảẩẳẫẵấắạậặɑǎ", "a"],
  ["ºòóôõöøōŏőơồờỏổởỗỡốớọộợǒ", "o"],
  ["ÀÁÂÃÄÅĀĂĄẦẰẢẨẲẪẴẤẮẠẬẶǍ", "A"],
  ["Æ", "AE"],
  ["ÇĆĈĊČ", "C"],
  ["ÈÉÊËĒĔĖĘĚƏ€ỀẺỂẼỄẾẸỆ", "E"],
  ["ÌÍÎÏĨĪĬĮİỈỊǏ", "I"],
  ["ÐĎĐ", "D"],
  ["ÑŃŅŇŊ", "N"],
  ["ÒÓÔÕÖØŌŎŐƠỒỜỎỔỞỖỠỐỚỌỘỢǑ", "O"],
  ["ÙÚÛÜŨŪŬŮŰŲƯỪỦỬỮỨỤỰǕǗǓǙǛ", "U"],
  ["ÝŶŸỲỶỸỴ", "Y"],
  ["Þ", "TH"],
  ["ßśŝşšſș", "s"],
  ["æ", "ae"],
  ["çćĉċč", "c"],
  ["èéêëēĕėęěǝềẻểẽễếẹệ", "e"],
  ["ìíîïĩīĭįıỉịǐ", "i"],
  ["ðďđ", "d"],
  ["ñńņňŉŋ", "n"],
  ["ùúûüũūŭůűųưừủửữứụựǖǘǔǚǜ", "u"],
  ["ýÿŷỳỷỹỵ", "y"],
  ["þ", "th"],
  ["ĜĞĠĢ", "G"],
  ["ĝğġģ", "g"],
  ["ĤĦ", "H"],
  ["ĥħ", "h"],
  ["Ĳ", "IJ"],
  ["ĳ", "ij"],
  ["Ĵ", "J"],
  ["ĵ", "j"],
  ["Ķ", "K"],
  ["ķĸ", "k"],
  ["ĹĻĽĿŁ", "L"],
  ["ĺļľŀł", "l"],
  ["Œ", "OE"],
  ["œ", "oe"],
  ["ŔŖŘ", "R"],
  ["ŕŗř", "r"],
  ["ŚŜŞŠȘ", "S"],
  ["ŢŤŦȚ", "T"],
  ["ţťŧț", "t"],
  ["Ŵ", "W"],
  ["ŵ", "w"],
  ["ŹŻŽ", "Z"],
  ["źżž", "z"],
  ["£", ""],
];

const ACCENTS = new Map<string, string>(
  ACCENT_GROUPS.flatMap(([chars, replacement]) => [...chars].map((char) => [char, replacement] as const)),
);

/** `remove_accents()`: NFC first, as core normalizes, then `strtr()` with the table. Every key is one character, so a character-by-character map is `strtr()`. */
function removeAccents(text: string): string {
  if (!/[\u0080-\uffff]/.test(text)) return text;
  return [...text.normalize("NFC")].map((char) => ACCENTS.get(char) ?? char).join("");
}

/** `utf8_uri_encode( $title, 200 )`: each non-ASCII byte as lower-case `%xx`, the whole result cut at 200 characters on a character boundary. */
function utf8UriEncode(text: string, limit: number): string {
  let out = "";
  for (const char of text) {
    const encoded =
      char.charCodeAt(0) < 128
        ? char
        : [...Buffer.from(char, "utf8")].map((byte) => `%${byte.toString(16)}`).join("");
    if (out.length + encoded.length > limit) break;
    out += encoded;
  }
  return out;
}

/** Turned into `-` in the `save` context: no-break space, non-breaking hyphen, en and em dash, as octets and as entities. */
const TO_DASH = ["%c2%a0", "%e2%80%91", "%e2%80%93", "%e2%80%94", "&nbsp;", "&#8209;", "&#160;", "&ndash;", "&#8211;", "&mdash;", "&#8212;"];

/** Stripped in the `save` context: soft hyphen, ¡ ¿, angle and curly quotes, bullet, © ® ° … ™, acute, grave, macron and caron accents, zero-width and direction marks. */
const STRIPPED = [
  "%c2%ad",
  "%c2%a1",
  "%c2%bf",
  "%c2%ab",
  "%c2%bb",
  "%e2%80%b9",
  "%e2%80%ba",
  "%e2%80%98",
  "%e2%80%99",
  "%e2%80%9c",
  "%e2%80%9d",
  "%e2%80%9a",
  "%e2%80%9b",
  "%e2%80%9e",
  "%e2%80%9f",
  "%e2%80%a2",
  "%c2%a9",
  "%c2%ae",
  "%c2%b0",
  "%e2%80%a6",
  "%e2%84%a2",
  "%c2%b4",
  "%cb%8a",
  "%cc%81",
  "%cd%81",
  "%cc%80",
  "%cc%84",
  "%cc%8c",
  "%e2%80%8b",
  "%e2%80%8c",
  "%e2%80%8d",
  "%e2%80%8e",
  "%e2%80%8f",
  "%e2%80%aa",
  "%e2%80%ab",
  "%e2%80%ac",
  "%e2%80%ad",
  "%e2%80%ae",
  "%ef%bb%bf",
  "%ef%bf%bc",
];

/** Spaces that display with a width, turned into `-` in the `save` context. */
const WIDE_SPACES = [
  "%e2%80%80",
  "%e2%80%81",
  "%e2%80%82",
  "%e2%80%83",
  "%e2%80%84",
  "%e2%80%85",
  "%e2%80%86",
  "%e2%80%87",
  "%e2%80%88",
  "%e2%80%89",
  "%e2%80%8a",
  "%e2%80%a8",
  "%e2%80%a9",
  "%e2%80%af",
];

function replaceAll(text: string, needles: readonly string[], replacement: string): string {
  return needles.reduce((out, needle) => out.split(needle).join(replacement), text);
}

type Context = "save" | "query";

/** `sanitize_title( $title, '', $context )`: `remove_accents()` in the `save` context only, then `sanitize_title_with_dashes()`. */
function sanitizeTitle(title: string, context: Context): string {
  let slug = context === "save" ? removeAccents(title) : title;
  slug = slug.replace(/<[^>]*>/g, "");
  // Keep escaped octets, drop any other percent sign.
  slug = slug.replace(/%([a-fA-F0-9]{2})/g, "---$1---").replace(/%/g, "").replace(/---([a-fA-F0-9]{2})---/g, "%$1");
  slug = utf8UriEncode(slug.toLowerCase(), 200).toLowerCase();
  if (context === "save") {
    slug = replaceAll(slug, TO_DASH, "-");
    slug = slug.replace(/\//g, "-");
    slug = replaceAll(slug, STRIPPED, "");
    slug = replaceAll(slug, WIDE_SPACES, "-");
    slug = slug.replace(/%c3%97/g, "x");
  }
  slug = slug.replace(/&.+?;/g, "").replace(/\./g, "-");
  slug = slug.replace(/[^%a-z0-9 _-]/g, "");
  return slug.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

/** `sanitize_title( $title )`: the slug WordPress would save for this title. */
export function slugify(title: string): string {
  return sanitizeTitle(title, "save");
}

/**
 * `sanitize_title_for_query( $title )`: the `query` context, which keeps
 * accents and the characters the `save` context turns into dashes or strips,
 * so `a/b` becomes `ab` and `Café` becomes `caf%c3%a9`. `WP_Query` cleans
 * `post_name__in`, the posts controller's `slug` filter, with it.
 */
export function slugifyForQuery(title: string): string {
  return sanitizeTitle(title, "query");
}
