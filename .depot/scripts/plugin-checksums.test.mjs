// Tests for plugin-checksums.mjs, run by the `scope` job on every pull request
// (`node --test .depot/scripts/plugin-checksums.test.mjs`), and runnable on a
// laptop with Node 24. Plain node:test, so the job installs nothing. Each test
// builds a small plugin directory and its checksum list in a temporary
// directory and runs the script as the deploy does, through its environment.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { listTree, verify } from './plugin-checksums.mjs';

const SCRIPT = fileURLToPath( new URL( './plugin-checksums.mjs', import.meta.url ) );
const sha = ( text ) => createHash( 'sha256' ).update( text ).digest( 'hex' );

const FILES = {
	'relevanssi.php': '<?php // main',
	'lib/search.php': '<?php // search',
	'lib/settings/fields/a.php': '<?php // nested',
	'readme.txt': 'readme',
};

// A plugin directory with these files and a checksum list for them, both in a
// fresh temporary directory, which `done` removes.
function fixture( { files = FILES, listed = FILES, plugin = 'relevanssi', version = '4.28.8' } = {} ) {
	const root = mkdtempSync( join( tmpdir(), 'plugin-checksums-' ) );
	const dir = join( root, 'relevanssi' );
	for ( const [ path, body ] of Object.entries( files ) ) {
		mkdirSync( dirname( join( dir, path ) ), { recursive: true } );
		writeFileSync( join( dir, path ), body );
	}
	const list = {
		plugin,
		version,
		files: Object.fromEntries( Object.entries( listed ).map( ( [ path, body ] ) => [ path, { md5: 'x', sha256: sha( body ) } ] ) ),
	};
	const checksums = join( root, 'checksums.json' );
	writeFileSync( checksums, JSON.stringify( list ) );
	return { root, dir, checksums, done: () => rmSync( root, { recursive: true, force: true } ) };
}

// Runs the script as the deploy step does and returns its exit code and output.
function run( env ) {
	try {
		return { code: 0, out: execFileSync( process.execPath, [ SCRIPT ], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' } ) };
	} catch ( error ) {
		return { code: error.status, out: error.stdout };
	}
}

const envFor = ( f, overrides = {} ) => ( { PLUGIN_DIR: f.dir, CHECKSUMS: f.checksums, PLUGIN_SLUG: 'relevanssi', EXPECT_VERSION: '4.28.8', ...overrides } );

test( 'an untouched release passes and says how many files it checked', () => {
	const f = fixture();
	const { code, out } = run( envFor( f ) );
	f.done();
	assert.equal( code, 0 );
	assert.match( out, /relevanssi 4\.28\.8: all 4 files match/ );
} );

test( 'a changed file, a missing file, an extra file each fail', () => {
	const cases = {
		changed: { files: { ...FILES, 'lib/search.php': '<?php // tampered' } },
		missing: { files: Object.fromEntries( Object.entries( FILES ).filter( ( [ path ] ) => path !== 'lib/settings/fields/a.php' ) ) },
		unlisted: { files: { ...FILES, 'lib/extra.php': '<?php // added' } },
	};
	for ( const [ name, options ] of Object.entries( cases ) ) {
		const f = fixture( options );
		const { code, out } = run( envFor( f ) );
		f.done();
		assert.equal( code, 1, name );
		assert.match( out, new RegExp( `^::error::.*${ name }`, 'm' ), name );
		assert.match( out, /Nothing was deployed\./, name );
	}
} );

test( 'a list for another version or plugin fails', () => {
	for ( const options of [ { version: '4.28.7' }, { plugin: 'other' } ] ) {
		const f = fixture( options );
		const { code, out } = run( envFor( f ) );
		f.done();
		assert.equal( code, 1 );
		assert.match( out, /the checksum list is for/ );
	}
} );

test( 'a list without the main file or lib/ fails, so an empty or truncated list never passes', () => {
	for ( const listed of [ {}, { 'relevanssi.php': FILES[ 'relevanssi.php' ] }, { 'lib/search.php': FILES[ 'lib/search.php' ] } ] ) {
		const f = fixture( { files: listed, listed } );
		const { code } = run( envFor( f ) );
		f.done();
		assert.equal( code, 1, JSON.stringify( Object.keys( listed ) ) );
	}
} );

test( 'an empty directory fails as unlisted, since rsync would create it', () => {
	const f = fixture();
	mkdirSync( join( f.dir, 'lib', 'empty' ) );
	const { code, out } = run( envFor( f ) );
	f.done();
	assert.equal( code, 1 );
	assert.match( out, /unlisted "lib\/empty\/"/ );
} );

test( 'a symbolic link in the directory fails', () => {
	const f = fixture();
	symlinkSync( join( f.dir, 'readme.txt' ), join( f.dir, 'lib', 'link.txt' ) );
	const { code, out } = run( envFor( f ) );
	f.done();
	assert.equal( code, 1 );
	assert.match( out, /not a regular file: "lib\/link\.txt"/ );
} );

test( 'a listed path that climbs out or is absolute is refused before any file is read', () => {
	let read = 0;
	for ( const path of [ '../outside.php', '/etc/passwd', 'lib/../../x' ] ) {
		const result = verify( {
			checksums: { plugin: 'relevanssi', version: '1', files: { 'relevanssi.php': { sha256: sha( 'a' ) }, 'lib/a.php': { sha256: sha( 'b' ) }, [ path ]: { sha256: sha( 'c' ) } } },
			slug: 'relevanssi',
			version: '1',
			files: [ 'relevanssi.php', 'lib/a.php' ],
			others: [],
			sha256: () => {
				read++;
				return '';
			},
		} );
		assert.equal( result.ok, false, path );
		assert.match( result.message, /refused listed path/, path );
	}
	assert.equal( read, 0 );
} );

test( 'unreadable input fails closed', () => {
	const f = fixture();
	writeFileSync( f.checksums, '<html>Not found</html>' );
	const notJson = run( envFor( f ) );
	const noDir = run( envFor( f, { PLUGIN_DIR: join( f.root, 'nope' ) } ) );
	const unset = run( envFor( f, { EXPECT_VERSION: '' } ) );
	f.done();
	for ( const { code, out } of [ notJson, noDir, unset ] ) {
		assert.equal( code, 1 );
		assert.match( out, /^::error::Cannot verify/m );
	}
} );

test( 'listTree walks nested directories and sorts', () => {
	const f = fixture();
	const tree = listTree( f.dir );
	f.done();
	assert.deepEqual( tree, { files: [ 'lib/search.php', 'lib/settings/fields/a.php', 'readme.txt', 'relevanssi.php' ], others: [] } );
} );
