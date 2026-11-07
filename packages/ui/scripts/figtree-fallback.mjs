/**
 * The size-adjusted fallback faces in `fonts/figtree-fallback.css`: where
 * their numbers come from, and the script that prints them.
 *
 * A fallback face is a system font under a family name of its own, with
 * `size-adjust`, `ascent-override`, `descent-override` and
 * `line-gap-override` set so that text drawn in it takes nearly the space
 * Figtree will (DESIGN.md, Font display). The calculation is the one
 * `next/font` makes for the Arial face it generates (`app/fonts.ts`):
 *
 * - The average advance width of each font over next/font's sample string,
 *   letters weighted by English frequency with six spaces, in ems.
 *   Figtree's is read from `fonts/` at the file's default instance (Light,
 *   300), as next/font reads it.
 * - `size-adjust` is Figtree's average over the fallback's, unless the
 *   entry gives one measured in the browser (`measuredSizeAdjust`, below).
 * - Each override is Figtree's own `hhea` ascent, descent or line gap over
 *   its units per em, divided by that `size-adjust`, since the browser
 *   scales the overrides by it. So every face gets Figtree's line metrics,
 *   and only its width calibration differs.
 *
 * A fallback's average width is read once from its font file, with
 * `--measure`, and recorded in FALLBACKS with the file it came from. The
 * files are OFL or Apache licensed but are not committed, since nothing
 * else needs them; Figtree's side is recomputed from the committed file
 * every time, by this script and by `test/figtree-fallback.test.js`, which
 * fails if the stylesheet and this table disagree.
 *
 *   node scripts/figtree-fallback.mjs                   prints the faces' CSS
 *   node scripts/figtree-fallback.mjs --measure FILE…   prints a font file's names, units per em and average width
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as fontkit from 'fontkit';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
export const FIGTREE_FILE = path.join( packageRoot, 'fonts', 'figtree-latin-wght-normal.woff2' );

/** next/font's sample string (`get-fallback-metrics-from-font-file.js`, `calcAverageWidth`). */
const SAMPLE = 'aaabcdeeeefghiijklmnnoopqrrssttuvwxyz      ';

/**
 * The faces, in the order `--rh-font-sans` lists them after next/font's own
 * (`tokens.css`). `sources` are the names `local()` matches, a face's full
 * name and its PostScript name, since browsers match on those and not on
 * the family; each was checked against the font file and, for DejaVu Sans,
 * Noto Sans and Roboto, against Ubuntu 24.04's packages (`fonts-dejavu-core`,
 * `fonts-noto-core`, `fonts-roboto`), whose files measure the same. Measured
 * on 2026-11-06.
 *
 * - Arial, and its metric clones Liberation Sans (most Linux systems, and
 *   Playwright's image and CI's runner, which get `fonts-liberation`) and
 *   Arimo (ChromeOS): the same advance widths and the same `hhea` line
 *   metrics, so one face covers the three, first because it is the face
 *   next/font calibrates for macOS and Windows. The width is next/font's own
 *   Arial constant, and Liberation Sans 2.1.5 and Arimo measure the same.
 * - DejaVu Sans, the default sans of Debian and Ubuntu, then Noto Sans,
 *   Fedora's, for a Linux system without Liberation.
 * - Roboto, last, for Android, which has none of the others.
 *
 * `measuredSizeAdjust`: Chromium on Linux draws a hinted font at a whole
 * pixel size and rounds each advance to a whole pixel, so a face's width
 * there moves in steps rather than with `size-adjust`. For DejaVu Sans and
 * Noto Sans, which are fallbacks only on Linux, the calculated value drew
 * the site's 14 px text 5% narrower than Figtree, enough for a row of
 * filters at 360 px to wrap onto one line fewer and move a listing by a CLS
 * of 0.17 when Figtree landed. Their value is instead the one at which
 * Chromium in Playwright's Linux image draws the first 1,500 words of
 * DESIGN.md, each word a span, closest to Figtree's width at 14 and 16 px:
 * DejaVu Sans +2.8% and −0.8% at 90%, Noto Sans +0.2% and +0.3% at 96%.
 * The calculated values land on good steps for Liberation Sans (−0.7%,
 * −1.5%) and for Roboto, and are kept.
 */
export const FALLBACKS = [
	{
		family: 'Figtree Fallback Arial',
		sources: [ 'Arial', 'ArialMT', 'Liberation Sans', 'LiberationSans', 'Arimo', 'Arimo Regular', 'Arimo-Regular' ],
		measuredFrom: 'Arial.ttf on macOS 26.6, LiberationSans-Regular.ttf 2.1.5, arimo-latin-400-normal.woff2 (Fontsource 5.3)',
		averageWidth: 934.5116279069767,
		unitsPerEm: 2048,
	},
	{
		family: 'Figtree Fallback DejaVu Sans',
		sources: [ 'DejaVu Sans', 'DejaVuSans' ],
		measuredFrom: 'DejaVuSans.ttf 2.37',
		averageWidth: 1070.3023255813953,
		unitsPerEm: 2048,
		// Calculated: 87.26%, which Chromium on Linux draws at 12 px for 14 px text.
		measuredSizeAdjust: 0.9,
	},
	{
		family: 'Figtree Fallback Noto Sans',
		sources: [ 'Noto Sans', 'Noto Sans Regular', 'NotoSans-Regular' ],
		measuredFrom: 'noto-sans-latin-400-normal.woff2 (Fontsource 5.3)',
		averageWidth: 485.8139534883721,
		unitsPerEm: 1000,
		// Calculated: 93.87%, which Chromium on Linux draws 5% narrow at 14 px.
		measuredSizeAdjust: 0.96,
	},
	{
		family: 'Figtree Fallback Roboto',
		sources: [ 'Roboto', 'Roboto Regular', 'Roboto-Regular' ],
		measuredFrom: 'roboto-latin-400-normal.woff2 (Fontsource 5.3)',
		averageWidth: 938,
		unitsPerEm: 2048,
	},
];

function openFont( file ) {
	return fontkit.create( readFileSync( file ) );
}

/** The average advance over SAMPLE, in font units, as next/font computes it. */
export function averageWidth( font ) {
	const glyphs = font.glyphsForString( SAMPLE );
	return glyphs.reduce( ( sum, glyph ) => sum + glyph.advanceWidth, 0 ) / glyphs.length;
}

function percent( value ) {
	return `${ Math.abs( value * 100 ).toFixed( 2 ) }%`;
}

/** Each face's four descriptors, from Figtree's file and the face's recorded width or measured size-adjust. */
export function fallbackDescriptors( figtree = openFont( FIGTREE_FILE ) ) {
	const figtreeAverage = averageWidth( figtree ) / figtree.unitsPerEm;
	return FALLBACKS.map( ( fallback ) => {
		const sizeAdjust = fallback.measuredSizeAdjust ?? figtreeAverage / ( fallback.averageWidth / fallback.unitsPerEm );
		const em = figtree.unitsPerEm * sizeAdjust;
		return {
			...fallback,
			sizeAdjust: percent( sizeAdjust ),
			ascentOverride: percent( figtree.ascent / em ),
			descentOverride: percent( figtree.descent / em ),
			lineGapOverride: percent( figtree.lineGap / em ),
		};
	} );
}

/** The `@font-face` rules, as `fonts/figtree-fallback.css` holds them below its comment. */
export function fallbackCss( descriptors = fallbackDescriptors() ) {
	return descriptors
		.map( ( face ) =>
			[
				'@font-face {',
				`\tfont-family: "${ face.family }";`,
				`\tsrc: ${ face.sources.map( ( name ) => `local("${ name }")` ).join( ', ' ) };`,
				`\tsize-adjust: ${ face.sizeAdjust };`,
				`\tascent-override: ${ face.ascentOverride };`,
				`\tdescent-override: ${ face.descentOverride };`,
				`\tline-gap-override: ${ face.lineGapOverride };`,
				'}',
			].join( '\n' )
		)
		.join( '\n\n' );
}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {
	const [ flag, ...files ] = process.argv.slice( 2 );
	if ( flag === '--measure' ) {
		for ( const file of files ) {
			const font = openFont( file );
			console.log(
				JSON.stringify( {
					file: path.basename( file ),
					fullName: font.fullName,
					postscriptName: font.postscriptName,
					unitsPerEm: font.unitsPerEm,
					averageWidth: averageWidth( font ),
					hhea: { ascent: font.ascent, descent: font.descent, lineGap: font.lineGap },
				} )
			);
		}
	} else {
		console.log( fallbackCss() );
	}
}
