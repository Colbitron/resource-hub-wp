/**
 * DESIGN.md is the one written home of the visual system and tokens.css the
 * one home of its values, so the two must cover each other: every `--rh-*`
 * token tokens.css declares has to be named in DESIGN.md, and every token
 * DESIGN.md names as a `--rh-*` custom property has to exist, in tokens.css
 * or as the one the front end's font loader sets (`--rh-font-figtree`).
 * A token added without a sentence about it, or a sentence about a token
 * that is gone, fails here.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const tokensCss = ( await readFile( path.join( packageRoot, 'tokens.css' ), 'utf8' ) ).replace( /\/\*[\s\S]*?\*\//g, '' );
const designDoc = await readFile( path.join( packageRoot, 'DESIGN.md' ), 'utf8' );

const declared = new Set( [ ...tokensCss.matchAll( /(--rh-[a-z0-9-]+)\s*:/g ) ].map( ( match ) => match[ 1 ] ) );
const mentioned = new Set( [ ...designDoc.matchAll( /--rh-[a-z0-9-]+/g ) ].map( ( match ) => match[ 0 ] ) );

/** Set by the front end's `next/font` loader on <html>, read by tokens.css, never declared there. */
const SET_BY_A_CONSUMER = new Set( [ '--rh-font-figtree' ] );

describe( 'DESIGN.md and tokens.css', () => {
	it( 'tokens.css declares more than thirty tokens, all --rh-*', () => {
		assert.ok( declared.size > 30 );
		assert.deepEqual( [ ...tokensCss.matchAll( /(--[a-z0-9-]+)\s*:/g ) ].map( ( m ) => m[ 1 ] ).filter( ( name ) => ! name.startsWith( '--rh-' ) ), [] );
	} );

	it( 'DESIGN.md names every token tokens.css declares', () => {
		assert.deepEqual( [ ...declared ].filter( ( name ) => ! mentioned.has( name ) ), [] );
	} );

	it( 'DESIGN.md names no token that does not exist', () => {
		assert.deepEqual( [ ...mentioned ].filter( ( name ) => ! declared.has( name ) && ! SET_BY_A_CONSUMER.has( name ) ), [] );
	} );

	it( 'DESIGN.md has the sections in the DESIGN.md order, with the project\'s own in place', () => {
		const headings = [ ...designDoc.matchAll( /^## (.+)$/gm ) ].map( ( match ) => match[ 1 ] );
		assert.deepEqual( headings, [
			'Overview',
			'Brand',
			'Colors',
			'Theme and colour scheme',
			'Typography',
			'Layout',
			'Elevation & Depth',
			'Shapes',
			'Motion',
			'Components',
			'Consumers and loading',
			"Do's and Don'ts",
			'Changing the system',
		] );
	} );
} );
