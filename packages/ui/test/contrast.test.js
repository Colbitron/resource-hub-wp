/**
 * Reads tokens.css, resolves every colour token in the light and the dark
 * scheme, and checks the contrast rules DESIGN.md states (WCAG 2.2 AA):
 * 4.5:1 for every pair of text on a background, 3:1 for the focus ring
 * against both surfaces. The pairs are listed here, not derived, because
 * which token is ever drawn on which is a design rule, not a property of the
 * file. The five marks are decorative (the type name is always printed
 * beside them) and are not asserted; their ratios are printed as
 * diagnostics so a change to them is still seen.
 *
 * It also pins the shape DESIGN.md relies on: every colour is written with
 * `light-dark()` and `color-scheme: light dark` is set, so a consumer's
 * theme choice can set `color-scheme` on <html>; a `prefers-color-scheme`
 * media query, which that choice could not override, is refused.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const css = ( await readFile( path.join( packageRoot, 'tokens.css' ), 'utf8' ) ).replace( /\/\*[\s\S]*?\*\//g, '' );

/** Every `--rh-*` declaration on :root, name to raw value. */
const declarations = new Map(
	[ ...css.matchAll( /(--rh-[a-z0-9-]+)\s*:\s*([^;]+);/g ) ].map( ( match ) => [ match[ 1 ], match[ 2 ].trim() ] )
);

/** The matching close paren for the open paren at `start`, or -1. */
function closingParen( text, start ) {
	let depth = 0;
	for ( let i = start; i < text.length; i += 1 ) {
		if ( text[ i ] === '(' ) depth += 1;
		if ( text[ i ] === ')' ) {
			depth -= 1;
			if ( depth === 0 ) return i;
		}
	}
	return -1;
}

/** Splits a function's arguments on the top-level commas. */
function splitArguments( text ) {
	const parts = [];
	let depth = 0;
	let current = '';
	for ( const char of text ) {
		if ( char === '(' ) depth += 1;
		if ( char === ')' ) depth -= 1;
		if ( char === ',' && depth === 0 ) {
			parts.push( current.trim() );
			current = '';
		} else {
			current += char;
		}
	}
	parts.push( current.trim() );
	return parts;
}

/**
 * The value of a token in one scheme, with every `light-dark()` collapsed to
 * that scheme's side and every `var()` replaced by the token it names.
 */
function resolve( name, scheme ) {
	const raw = declarations.get( name );
	assert.ok( raw !== undefined, `${ name } is not declared in tokens.css` );
	return resolveValue( raw, scheme );
}

function resolveValue( value, scheme ) {
	let out = value;
	for ( ;; ) {
		const fn = /\b(light-dark|var)\(/.exec( out );
		if ( fn === null ) return out.trim();
		const open = fn.index + fn[ 0 ].length - 1;
		const close = closingParen( out, open );
		assert.notEqual( close, -1, `Unbalanced parentheses in "${ value }"` );
		const args = splitArguments( out.slice( open + 1, close ) );
		let replacement;
		if ( fn[ 1 ] === 'light-dark' ) {
			assert.equal( args.length, 2, `light-dark() takes two values in "${ value }"` );
			replacement = scheme === 'light' ? args[ 0 ] : args[ 1 ];
		} else {
			replacement = resolve( args[ 0 ], scheme );
		}
		out = out.slice( 0, fn.index ) + replacement + out.slice( close + 1 );
	}
}

/** `#rgb`, `#rrggbb` or `rgb(r g b)` as [r, g, b] in 0..255; alpha is refused, because a translucent colour has no one contrast. */
function parseColour( text ) {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec( text );
	if ( hex ) {
		const digits = hex[ 1 ].length === 3 ? [ ...hex[ 1 ] ].map( ( d ) => d + d ).join( '' ) : hex[ 1 ];
		return [ 0, 2, 4 ].map( ( i ) => parseInt( digits.slice( i, i + 2 ), 16 ) );
	}
	const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/.exec( text );
	if ( rgb ) return [ rgb[ 1 ], rgb[ 2 ], rgb[ 3 ] ].map( Number );
	throw new Error( `Cannot read "${ text }" as an opaque colour` );
}

function luminance( [ r, g, b ] ) {
	const channel = ( c ) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ( ( s + 0.055 ) / 1.055 ) ** 2.4;
	};
	return 0.2126 * channel( r ) + 0.7152 * channel( g ) + 0.0722 * channel( b );
}

/** WCAG 2.x contrast ratio between two tokens in one scheme. */
function contrast( foreground, background, scheme ) {
	const a = luminance( parseColour( resolve( foreground, scheme ) ) );
	const b = luminance( parseColour( resolve( background, scheme ) ) );
	return ( Math.max( a, b ) + 0.05 ) / ( Math.min( a, b ) + 0.05 );
}

const SCHEMES = [ 'light', 'dark' ];

/** Every pair of text drawn on a background, anywhere a consumer renders; 4.5:1. */
const TEXT_PAIRS = [
	[ '--rh-color-text', '--rh-color-surface' ],
	[ '--rh-color-text', '--rh-color-surface-raised' ],
	[ '--rh-color-text-muted', '--rh-color-surface' ],
	[ '--rh-color-text-muted', '--rh-color-surface-raised' ],
	[ '--rh-color-accent', '--rh-color-surface' ],
	[ '--rh-color-accent', '--rh-color-surface-raised' ],
	[ '--rh-color-accent-text', '--rh-color-accent' ],
	// The current filter and page: the surface colour as text on the ink.
	[ '--rh-color-surface', '--rh-color-text' ],
];

/** The focus ring, a non-text indicator, against both surfaces; 3:1. */
const FOCUS_PAIRS = [
	[ '--rh-color-focus', '--rh-color-surface' ],
	[ '--rh-color-focus', '--rh-color-surface-raised' ],
];

const MARKS = [ '--rh-mark-coral', '--rh-mark-cobalt', '--rh-mark-lemon', '--rh-mark-mint', '--rh-mark-grape' ];

describe( 'tokens.css colour', () => {
	it( 'declares every colour with light-dark() and sets color-scheme, with no media query', () => {
		assert.match( css, /:root\s*\{[^}]*color-scheme:\s*light dark;/ );
		assert.doesNotMatch( css, /prefers-color-scheme/ );
		const colourTokens = [ ...declarations.keys() ].filter( ( name ) => name.startsWith( '--rh-color-' ) );
		assert.ok( colourTokens.length >= 8 );
		for ( const name of colourTokens ) {
			assert.match( declarations.get( name ), /^light-dark\(/, `${ name } is not a light-dark() pair` );
		}
	} );

	for ( const scheme of SCHEMES ) {
		describe( `in the ${ scheme } scheme`, () => {
			for ( const [ foreground, background ] of TEXT_PAIRS ) {
				it( `${ foreground } on ${ background } reaches 4.5:1`, () => {
					const ratio = contrast( foreground, background, scheme );
					assert.ok( ratio >= 4.5, `${ ratio.toFixed( 2 ) }:1` );
				} );
			}
			for ( const [ foreground, background ] of FOCUS_PAIRS ) {
				it( `${ foreground } against ${ background } reaches 3:1`, () => {
					const ratio = contrast( foreground, background, scheme );
					assert.ok( ratio >= 3, `${ ratio.toFixed( 2 ) }:1` );
				} );
			}
			it( 'reports the marks against the surface (decorative, not asserted)', ( t ) => {
				for ( const mark of MARKS ) {
					t.diagnostic( `${ scheme }: ${ mark } on --rh-color-surface ${ contrast( mark, '--rh-color-surface', scheme ).toFixed( 2 ) }:1` );
				}
			} );
		} );
	}
} );
