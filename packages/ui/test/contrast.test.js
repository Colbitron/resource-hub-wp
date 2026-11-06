/**
 * Reads tokens.css, resolves every colour token in the light and the dark
 * scheme, and checks the contrast rules DESIGN.md states (WCAG 2.2 AA):
 * 4.5:1 for every pair of text on a background (1.4.3), and 3:1 for the
 * non-text pairs, the focus ring and a control's boundary, against both
 * surfaces (1.4.11). The pairs are listed here, not derived, because which
 * token is ever drawn on which is a design rule, not a property of the file.
 * Every colour token is either in an asserted pair or in the commented
 * exemption list, so a new one cannot go unchecked by omission. The
 * exemptions are decorative: the hairline and the five marks (the type name
 * is always printed beside a mark); their ratios are printed as diagnostics
 * so a change to them is still seen. A translucent colour is composited over
 * the background it is measured against before its ratio is taken.
 *
 * It also pins the shape DESIGN.md relies on: every token is declared once,
 * in the one `:root` block, so no scoped override can carry a value this
 * test never measured; every colour, the marks included, is written with `light-dark()` and
 * `color-scheme: light dark` is set, so a consumer's theme choice can set
 * `color-scheme` on <html>; and a `prefers-color-scheme` media query, which
 * that choice could not override, is refused.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const css = ( await readFile( path.join( packageRoot, 'tokens.css' ), 'utf8' ) ).replace( /\/\*[\s\S]*?\*\//g, '' );

/** Every `--rh-*` declaration in the file, in order, duplicates kept. */
const declarationList = [ ...css.matchAll( /(--rh-[a-z0-9-]+)\s*:\s*([^;]+);/g ) ].map( ( match ) => [ match[ 1 ], match[ 2 ].trim() ] );

/** Name to raw value; the test below proves each name is declared once, on :root. */
const declarations = new Map( declarationList );

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

/** `#rgb`, `#rrggbb`, `rgb(r g b)` or `rgb(r g b / a)` as { rgb: [r, g, b] in 0..255, alpha in 0..1 }. */
function parseColour( text ) {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec( text );
	if ( hex ) {
		const digits = hex[ 1 ].length === 3 ? [ ...hex[ 1 ] ].map( ( d ) => d + d ).join( '' ) : hex[ 1 ];
		return { rgb: [ 0, 2, 4 ].map( ( i ) => parseInt( digits.slice( i, i + 2 ), 16 ) ), alpha: 1 };
	}
	const rgb = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*(?:\/\s*(\d*\.?\d+)\s*)?\)$/.exec( text );
	if ( rgb ) {
		const alpha = rgb[ 4 ] === undefined ? 1 : Number( rgb[ 4 ] );
		assert.ok( alpha >= 0 && alpha <= 1, `Alpha out of range in "${ text }"` );
		return { rgb: [ rgb[ 1 ], rgb[ 2 ], rgb[ 3 ] ].map( Number ), alpha };
	}
	throw new Error( `Cannot read "${ text }" as a colour` );
}

/**
 * The colour a reader sees: `foreground` painted over the opaque
 * `background`, by source-over compositing in sRGB as browsers paint it.
 */
function composite( foreground, background ) {
	assert.equal( background.alpha, 1, 'A background must be opaque to measure against' );
	return foreground.rgb.map( ( channel, i ) => channel * foreground.alpha + background.rgb[ i ] * ( 1 - foreground.alpha ) );
}

function luminance( [ r, g, b ] ) {
	const channel = ( c ) => {
		const s = c / 255;
		return s <= 0.03928 ? s / 12.92 : ( ( s + 0.055 ) / 1.055 ) ** 2.4;
	};
	return 0.2126 * channel( r ) + 0.7152 * channel( g ) + 0.0722 * channel( b );
}

/** WCAG 2.x contrast ratio between two tokens in one scheme, a translucent foreground composited over the background first. */
function contrast( foreground, background, scheme ) {
	const back = parseColour( resolve( background, scheme ) );
	const a = luminance( composite( parseColour( resolve( foreground, scheme ) ), back ) );
	const b = luminance( back.rgb );
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

/**
 * Non-text pairs (WCAG 1.4.11), against both surfaces; 3:1. The focus ring,
 * and the strong border, the only visible boundary of a control (filter
 * chips, pagination links, topic chips), which sits on the page and around
 * the raised surface of a topic chip.
 */
const NON_TEXT_PAIRS = [
	[ '--rh-color-focus', '--rh-color-surface' ],
	[ '--rh-color-focus', '--rh-color-surface-raised' ],
	[ '--rh-color-border-strong', '--rh-color-surface' ],
	[ '--rh-color-border-strong', '--rh-color-surface-raised' ],
];

const MARKS = [ '--rh-mark-coral', '--rh-mark-cobalt', '--rh-mark-lemon', '--rh-mark-mint', '--rh-mark-grape' ];

/**
 * Colour tokens no pair asserts, each decorative, with the reason. Their
 * ratios against the surface are printed, not asserted.
 */
const EXEMPT = [
	// The hairline: dividers, the card's outline, a table's rules, the card's
	// topic labels (not links). Never the only boundary of a control; a
	// control's edge is --rh-color-border-strong.
	'--rh-color-border',
	// The type marks: decoration beside a printed type name, never text and
	// never the only signal of anything (DESIGN.md, Colors).
	...MARKS,
];

describe( 'tokens.css colour', () => {
	it( 'declares every token once, inside the one :root block and nowhere else', () => {
		const rules = [ ...css.matchAll( /([^{}]*)\{([^{}]*)\}/g ) ];
		assert.equal( rules.length, 1, `expected one rule, found ${ rules.length }` );
		assert.equal( rules[ 0 ][ 1 ].trim(), ':root' );
		assert.doesNotMatch( css, /@[a-z-]+/, 'no at-rule may wrap or override a token' );
		const inRoot = [ ...rules[ 0 ][ 2 ].matchAll( /(--rh-[a-z0-9-]+)\s*:/g ) ].map( ( match ) => match[ 1 ] );
		assert.deepEqual( inRoot, declarationList.map( ( [ name ] ) => name ) );
		const repeated = inRoot.filter( ( name, i ) => inRoot.indexOf( name ) !== i );
		assert.deepEqual( repeated, [], 'a token is declared twice' );
	} );

	it( 'asserts or explicitly exempts every colour token', () => {
		const covered = new Set( [ ...TEXT_PAIRS, ...NON_TEXT_PAIRS ].flat() );
		const colours = [ ...declarations.keys() ].filter( ( name ) => /^--rh-(color|mark)-/.test( name ) );
		assert.deepEqual( colours.filter( ( name ) => ! covered.has( name ) && ! EXEMPT.includes( name ) ), [] );
		assert.deepEqual( EXEMPT.filter( ( name ) => ! declarations.has( name ) ), [], 'an exemption names a token that is gone' );
		assert.deepEqual( EXEMPT.filter( ( name ) => covered.has( name ) ), [], 'an exempt token is also asserted' );
	} );

	it( 'declares every colour with light-dark() and sets color-scheme, with no media query', () => {
		assert.match( css, /:root\s*\{[^}]*color-scheme:\s*light dark;/ );
		assert.doesNotMatch( css, /prefers-color-scheme/ );
		const colourTokens = [ ...declarations.keys() ].filter( ( name ) => /^--rh-(color|mark)-/.test( name ) );
		assert.ok( colourTokens.length >= 13 );
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
			for ( const [ foreground, background ] of NON_TEXT_PAIRS ) {
				it( `${ foreground } against ${ background } reaches 3:1`, () => {
					const ratio = contrast( foreground, background, scheme );
					assert.ok( ratio >= 3, `${ ratio.toFixed( 2 ) }:1` );
				} );
			}
			it( 'reports the exempt colours against both surfaces (decorative, not asserted)', ( t ) => {
				for ( const token of EXEMPT ) {
					for ( const background of [ '--rh-color-surface', '--rh-color-surface-raised' ] ) {
						t.diagnostic( `${ scheme }: ${ token } on ${ background } ${ contrast( token, background, scheme ).toFixed( 2 ) }:1` );
					}
				}
			} );
		} );
	}
} );
