/**
 * Every stylesheet at the package's top level is one a consumer imports by
 * file name (`README.md`, "Stylesheets"), so each must be listed in
 * `package.json` twice: in `files`, which says what the package ships, and
 * in `exports`, without which a workspace consumer's
 * `import '@colbitron/resource-hub-ui/<name>.css'` does not resolve. A file
 * moved here and left out of either fails here rather than in a consumer's
 * build. The subdirectories (`fonts/`, `brand/`) are exported whole by a
 * pattern and are not checked.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const manifest = JSON.parse( await readFile( path.join( packageRoot, 'package.json' ), 'utf8' ) );
const stylesheets = ( await readdir( packageRoot, { withFileTypes: true } ) )
	.filter( ( entry ) => entry.isFile() && entry.name.endsWith( '.css' ) )
	.map( ( entry ) => entry.name )
	.sort();

describe( 'package.json lists every top-level stylesheet', () => {
	it( 'finds the stylesheets', () => {
		assert.ok( stylesheets.includes( 'tokens.css' ), 'tokens.css is not at the package root' );
		assert.ok( stylesheets.length > 10, `only ${ stylesheets.length } stylesheets found` );
	} );

	it( 'ships each one in files', () => {
		const missing = stylesheets.filter( ( name ) => ! manifest.files.includes( name ) );
		assert.deepEqual( missing, [], `not in files: ${ missing.join( ', ' ) }` );
	} );

	it( 'exports each one at its own name', () => {
		const missing = stylesheets.filter( ( name ) => manifest.exports[ `./${ name }` ] !== `./${ name }` );
		assert.deepEqual( missing, [], `not exported as ./<name>: ${ missing.join( ', ' ) }` );
	} );
} );
