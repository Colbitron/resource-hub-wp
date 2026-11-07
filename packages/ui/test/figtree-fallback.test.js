/**
 * The size-adjusted fallback faces (`fonts/figtree-fallback.css`) are
 * derived, never hand-tuned: `scripts/figtree-fallback.mjs` computes them
 * from Figtree's committed file and each fallback's recorded width, as
 * next/font computes its Arial face. A stylesheet edited without the
 * script, a change to the font file, or a face listed in `--rh-font-sans`
 * out of the stylesheet's order fails here.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { FALLBACKS, fallbackCss, fallbackDescriptors } from '../scripts/figtree-fallback.mjs';

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

	it( 'are listed in --rh-font-sans straight after Figtree, in the stylesheet’s order', () => {
		const stack = /--rh-font-sans:\s*([^;]+);/.exec( tokensCss )[ 1 ].split( ',' ).map( ( name ) => name.trim() );
		assert.equal( stack[ 0 ], 'var(--rh-font-figtree', 'Figtree comes first' );
		assert.deepEqual(
			stack.slice( 2, 2 + FALLBACKS.length ),
			FALLBACKS.map( ( face ) => `"${ face.family }"` )
		);
	} );
} );
