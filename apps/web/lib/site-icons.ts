import type { Metadata } from "next";
import type { StaticImageData } from "next/image";

import appleIcon from "@/app/apple-icon.png";
import iconPng from "@/app/icon.png";
import iconSvg from "@/app/icon.svg";

/**
 * The site's icon links in a fixed order, for the root layout's
 * `generateMetadata` to set as `metadata.icons` (`packages/ui/DESIGN.md`,
 * "Brand"): the 32 px PNG, then the SVG sized `any`, linked last; and the
 * apple touch icon. The `favicon.ico` link is not listed, because Next.js
 * puts the root `app/favicon.ico` in front of every icon list itself, the
 * explicit one included (`postProcessMetadata` in Next.js 16.4), so the head
 * reads ICO, PNG, SVG.
 *
 * Why not leave the links to the file conventions: Turbopack collects the
 * `icon.*` files of a segment in the order the filesystem lists them and
 * sorts only by a numeric suffix (`icon1.png`), so `icon.png` and
 * `icon.svg` came out PNG first on macOS's APFS and GitHub's runners and SVG
 * first on an ext4 sandbox, from the same commit. (Webpack's discovery sorts
 * the paths with `localeCompare` before it emits the links:
 * `createStaticMetadataFromRoute` in
 * `next/dist/build/webpack/loaders/metadata/discover.js`, Next.js 16.4.5.
 * Turbopack, the build this app uses, does not.) Next.js has no setting for
 * that order, and numbering the files would change their URLs.
 * An explicit `icons` replaces the file-based `icon` and `apple` links
 * wholesale (the root segment's, and any nested segment's), so this array is
 * the order whatever the directory says; the files themselves are still
 * served at their convention routes.
 *
 * Each URL is written as the convention writes it, so the links are
 * byte-for-byte what the files produced: the route, then `?` and the file
 * name of the static import's content-hashed copy, as in
 * `/icon.png?icon.2b-euwbkglkuu.png`. Turbopack's generated icon module
 * builds it from the same static import, `src.split("/").splice(-1)[0]`, so
 * the hash changes with the bytes and caches never keep an old icon. Sizes
 * are the import's width and height, read from the file at build time, and
 * `any` for the SVG, as the convention sets them. `test/site-icons.test.ts`
 * fails if an icon file is added under `app/` that this list does not name,
 * since the explicit list would silently drop its link.
 *
 * A function rather than a constant so the imports' `src` is read when the
 * metadata is built, not when the module is imported: under Vite a static
 * image import is a bare string, so a test that imports the layout without
 * standing in the images does not throw until it builds the metadata.
 */
export function siteIcons() {
  return {
    icon: [
      { url: conventionUrl("/icon.png", iconPng), sizes: pixelSize(iconPng), type: "image/png" },
      { url: conventionUrl("/icon.svg", iconSvg as StaticImageData), sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: conventionUrl("/apple-icon.png", appleIcon), sizes: pixelSize(appleIcon), type: "image/png" }],
  } satisfies Metadata["icons"];
}

function conventionUrl(route: string, image: StaticImageData): string {
  return `${route}?${image.src.split("/").splice(-1)[0]}`;
}

function pixelSize(image: StaticImageData): string {
  return `${image.width}x${image.height}`;
}
