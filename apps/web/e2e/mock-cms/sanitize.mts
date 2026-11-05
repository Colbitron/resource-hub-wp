/**
 * WordPress's `sanitize_title()` in its default `save` context, which is how
 * WordPress turns a title into a slug and how the plugin's resolve route
 * cleans the slug it is given: `remove_accents()`, then
 * `sanitize_title_with_dashes()`. Written from WordPress 7.1.4's
 * `wp-includes/formatting.php`, step for step.
 *
 * What it does not cover:
 * - `remove_accents()` here is Unicode decomposition with the combining marks
 *   dropped after a Latin letter, plus core's table entries that do not
 *   decompose (`ß`, `æ`, `ø`, `œ`, `þ`, `ł`, `đ` and the like). That
 *   matches core for the common Latin accents. It does not apply the
 *   locale-specific rules core adds for `de_*`, `da_DK`, `ca` and `sr_RS`
 *   (`ä` to `ae`, `å` to `aa`, `đ` to `dj`): the mock behaves as an
 *   `en_US` site.
 * - `strip_tags()` is a regular expression for well-formed tags.
 * - No `sanitize_title` filter other than core's own runs.
 */

/** `remove_accents()` entries that Unicode decomposition does not produce. */
const LATIN_SPECIAL: Record<string, string> = {
  ª: "a",
  º: "o",
  Æ: "AE",
  æ: "ae",
  Ð: "D",
  ð: "d",
  Ø: "O",
  ø: "o",
  Þ: "TH",
  þ: "th",
  ß: "s",
  Đ: "D",
  đ: "d",
  Ħ: "H",
  ħ: "h",
  ı: "i",
  Ĳ: "IJ",
  ĳ: "ij",
  ĸ: "k",
  Ŀ: "L",
  ŀ: "l",
  Ł: "L",
  ł: "l",
  ŉ: "n",
  Ŋ: "N",
  ŋ: "n",
  Œ: "OE",
  œ: "oe",
  Ŧ: "T",
  ŧ: "t",
  ſ: "s",
};

function removeAccents(text: string): string {
  if (!/[\u0080-\uffff]/.test(text)) return text;
  return text
    .normalize("NFD")
    .replace(/([A-Za-z])[̀-ͯ]+/g, "$1")
    .normalize("NFC")
    .replace(/[\u0080-\uffff]/g, (char) => LATIN_SPECIAL[char] ?? char);
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

/** `sanitize_title( $title )`: the slug WordPress would save for this title. */
export function slugify(title: string): string {
  let slug = removeAccents(title);
  slug = slug.replace(/<[^>]*>/g, "");
  // Keep escaped octets, drop any other percent sign.
  slug = slug.replace(/%([a-fA-F0-9]{2})/g, "---$1---").replace(/%/g, "").replace(/---([a-fA-F0-9]{2})---/g, "%$1");
  slug = utf8UriEncode(slug.toLowerCase(), 200).toLowerCase();
  slug = replaceAll(slug, TO_DASH, "-");
  slug = slug.replace(/\//g, "-");
  slug = replaceAll(slug, STRIPPED, "");
  slug = replaceAll(slug, WIDE_SPACES, "-");
  slug = slug.replace(/%c3%97/g, "x");
  slug = slug.replace(/&.+?;/g, "").replace(/\./g, "-");
  slug = slug.replace(/[^%a-z0-9 _-]/g, "");
  return slug.replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}
