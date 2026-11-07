/**
 * The size-adjusted fallback faces (`fonts/figtree-fallback.css`) are the
 * rules `scripts/figtree-fallback.mjs` prints: next/font's calculation,
 * against Figtree's committed file and each fallback's recorded width, as
 * next/font computes its Arial face, except for two hand-tuned values. The
 * `size-adjust` of DejaVu Sans and Noto Sans was measured in Chromium on
 * Linux instead (`measuredSizeAdjust`), and a test below pins both the
 * measured and the calculated value for each. A stylesheet edited without
 * the script, a change to the font file, a retune, or a face listed in
 * `--rh-font-sans` out of the stylesheet's order fails here.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FALLBACKS, calculatedSizeAdjust, fallbackCss, fallbackDescriptors, percent } from '../scripts/figtree-fallback.mjs';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const withoutComments = ( css ) => css.replace( /\/\*[\s\S]*?\*\//g, '' ).trim();
const stylesheet = withoutComments( await readFile( path.join( packageRoot, 'fonts', 'figtree-fallback.css' ), 'utf8' ) );
const tokensCss = withoutComments( await readFile( path.join( packageRoot, 'tokens.css' ), 'utf8' ) );

describe( 'the Figtree fallback faces', () => {
	it( 'are the rules the script derives from Figtree’s file', () => {
		assert.equal( stylesheet, fallbackCss() );
	} );

	it( 'give the Arial face the numbers next/font generates for its own', () => {
		// next/font's `adjustFontFallback: "Arial"` face, from the same file
		// and the same Arial width, as the front end's build writes it.
		const arial = fallbackDescriptors().find( ( face ) => face.family === 'Figtree Fallback Arial' );
		assert.deepEqual(
			{ sizeAdjust: arial.sizeAdjust, ascentOverride: arial.ascentOverride, descentOverride: arial.descentOverride, lineGapOverride: arial.lineGapOverride },
			{ sizeAdjust: '99.94%', ascentOverride: '95.06%', descentOverride: '25.02%', lineGapOverride: '0.00%' }
		);
	} );

	it( 'take a measured size-adjust for DejaVu Sans and Noto Sans, and the calculated one for the rest', () => {
		// The measured values were chosen in Chromium on Linux against the
		// calculated ones beside them (the script's comment, DESIGN.md's
		// Fallback faces table). A new Figtree file moves the calculated
		// value and a retune moves the measured one; either fails here until
		// the numbers, the measurement and DESIGN.md's table are redone.
		const sizes = Object.fromEntries(
			fallbackDescriptors().map( ( face ) => [
				face.family,
				{ sizeAdjust: face.sizeAdjust, calculated: percent( calculatedSizeAdjust( face ) ) },
			] )
		);
		assert.deepEqual( sizes, {
			'Figtree Fallback Arial': { sizeAdjust: '99.94%', calculated: '99.94%' },
			'Figtree Fallback DejaVu Sans': { sizeAdjust: '90.00%', calculated: '87.26%' },
			'Figtree Fallback Noto Sans': { sizeAdjust: '96.00%', calculated: '93.87%' },
			'Figtree Fallback Roboto': { sizeAdjust: '99.57%', calculated: '99.57%' },
		} );
		assert.deepEqual(
			FALLBACKS.filter( ( face ) => face.measuredSizeAdjust !== undefined ).map( ( face ) => face.family ),
			[ 'Figtree Fallback DejaVu Sans', 'Figtree Fallback Noto Sans' ],
			'only DejaVu Sans and Noto Sans are hand-tuned'
		);
	} );

	it( 'are listed in --rh-font-sans straight after Figtree, in the stylesheet’s order', () => {
		const stack = /--rh-font-sans:\s*([^;]+);/.exec( tokensCss )[ 1 ].split( ',' ).map( ( name ) => name.trim() );
		assert.equal( stack[ 0 ], 'var(--rh-font-figtree', 'Figtree comes first' );
		assert.deepEqual(
			stack.slice( 2, 2 + FALLBACKS.length ),
			FALLBACKS.map( ( face ) => `"${ face.family }"` )
		);
	} );
} );
