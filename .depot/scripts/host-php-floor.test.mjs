// Tests for host-php-floor.mjs, run by the `scope` job on every pull request
// (`node --test .depot/scripts/host-php-floor.test.mjs`), and runnable on a
// laptop with Node 24. Plain node:test, so the job installs nothing. The
// deploy itself cannot be trialled without deploying, so these are its
// proof.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { check, cliInfoVersion, main, meets, parseFloor, parseVersion } from './host-php-floor.mjs';

const SCRIPT = fileURLToPath( new URL( './host-php-floor.mjs', import.meta.url ) );
const PLUGIN_COMPOSER = fileURLToPath( new URL( '../../wp-content/plugins/resource-hub-wp/composer.json', import.meta.url ) );
const PLUGIN_LOCK = fileURLToPath( new URL( '../../wp-content/plugins/resource-hub-wp/composer.lock', import.meta.url ) );
const READ_PLATFORM_CHECK = 'the deploy guard reads only the root require.php; once production installs a package or the root requires an ext-*, platform_check.php checks more than that, so .depot/scripts/host-php-floor.mjs must read the generated vendor/composer/platform_check.php instead';

// The shape WP-CLI 2.12.0 prints, from wp-env's cli container, trimmed.
const cliInfo = ( phpVersion ) =>
	JSON.stringify( { system_os: 'Linux', shell: false, php_binary_path: '/usr/bin/php', php_version: phpVersion, wp_cli_version: '2.12.0' } ) + '\n';

const floor = ( php ) => ( { require: { php } } );

test( 'the >=8.4 floor against the host versions that matter', () => {
	const cases = { '8.2.35': false, '8.4.0': true, '8.4.27': true, '8.5.1': true, '8.3.99': false, '9.0.0': true, '7.4.33': false };
	for ( const [ version, ok ] of Object.entries( cases ) ) {
		assert.equal( check( { cliInfo: cliInfo( version ), composer: floor( '>=8.4' ) } ).ok, ok, version );
	}
} );

test( 'a mismatch names both versions and what to do', () => {
	const { ok, message } = check( { cliInfo: cliInfo( '8.2.35' ), composer: floor( '>=8.4' ) } );
	assert.equal( ok, false );
	assert.match( message, /PHP 8\.2\.35, below the plugin's floor >=8\.4/ );
	assert.match( message, /Nothing was deployed: align the host's CLI PHP or the floor/ );
} );

test( 'a pass names the host version in one line', () => {
	const { ok, message } = check( { cliInfo: cliInfo( '8.4.27' ), composer: floor( '>=8.4' ) } );
	assert.equal( ok, true );
	assert.equal( message, "The host's WP-CLI runs PHP 8.4.27, which meets the plugin's floor >=8.4." );
} );

test( 'a floor with a patch, and a distribution suffix on the host', () => {
	assert.deepEqual( parseFloor( '>=8.4.2' ), [ 8, 4, 2 ] );
	assert.deepEqual( parseFloor( '>= 8.4' ), [ 8, 4, 0 ] );
	assert.equal( check( { cliInfo: cliInfo( '8.4.1' ), composer: floor( '>=8.4.2' ) } ).ok, false );
	assert.equal( check( { cliInfo: cliInfo( '8.4.2' ), composer: floor( '>=8.4.2' ) } ).ok, true );
	assert.deepEqual( parseVersion( '8.4.1-1ubuntu1' ), [ 8, 4, 1 ] );
	assert.deepEqual( parseVersion( '8.4.0RC1' ), [ 8, 4, 0 ] );
	assert.equal( check( { cliInfo: cliInfo( '8.2.35-1+deb12u1' ), composer: floor( '>=8.4' ) } ).ok, false );
} );

test( 'versions compare by number, not as text', () => {
	assert.equal( meets( [ 8, 10, 0 ], [ 8, 4, 0 ] ), true );
	assert.equal( meets( [ 8, 4, 0 ], [ 8, 10, 0 ] ), false );
	assert.equal( meets( [ 10, 0, 0 ], [ 9, 9, 9 ] ), true );
	assert.equal( meets( [ 8, 4, 0 ], [ 8, 4, 0 ] ), true );
} );

test( 'a floor in any other shape fails closed', () => {
	for ( const php of [ '^8.4', '~8.4', '>8.4', '8.4', '>=8', '>=8.4 <9', '>=8.2 || >=8.4', '>=8.4.*', '>=v8.4', '', ' ', null, 8.4, [ '>=8.4' ] ] ) {
		const { ok, message } = check( { cliInfo: cliInfo( '8.5.1' ), composer: floor( php ) } );
		assert.equal( ok, false, JSON.stringify( php ) );
		assert.match( message, /^Cannot read the plugin's PHP floor: /, JSON.stringify( php ) );
	}
	for ( const composer of [ {}, { require: {} }, { require: null }, null, undefined, 'x', [] ] ) {
		assert.equal( check( { cliInfo: cliInfo( '8.5.1' ), composer } ).ok, false, JSON.stringify( composer ) );
	}
} );

test( 'host output that is not a version fails closed', () => {
	const outputs = [
		undefined,
		'',
		'\n\n',
		'8.4.27',
		'not json',
		'{"php_version":"8.4.27"',
		'null',
		'[]',
		'"8.4.27"',
		'{}',
		JSON.stringify( { php_version: null } ),
		JSON.stringify( { php_version: 8.4 } ),
		JSON.stringify( { php_version: '' } ),
		JSON.stringify( { php_version: '8.4' } ),
		JSON.stringify( { php_version: '8' } ),
		JSON.stringify( { php_version: 'v8.4.27' } ),
		JSON.stringify( { php_version: ' 8.4.27' } ),
		JSON.stringify( { php_version: '8.4.27\n::warning::x' } ),
		JSON.stringify( { php_version: '8.4.x' } ),
		JSON.stringify( { php_version: '8.4.27 extra' } ),
		// Valid JSON first, but the last line is not.
		cliInfo( '8.4.27' ) + 'PHP Warning: something',
	];
	for ( const output of outputs ) {
		const { ok, message } = check( { cliInfo: output, composer: floor( '>=8.4' ) } );
		assert.equal( ok, false, JSON.stringify( output ) );
		assert.match( message, /^Cannot read the host's WP-CLI PHP version: .*Nothing was deployed\.$/, JSON.stringify( output ) );
	}
} );

test( 'a notice above the JSON is ignored, the JSON is still required', () => {
	const output = 'PHP Deprecated: something in phar:///usr/local/bin/wp on line 1\n' + cliInfo( '8.4.27' );
	assert.equal( cliInfoVersion( output ), '8.4.27' );
	assert.equal( check( { cliInfo: output, composer: floor( '>=8.4' ) } ).ok, true );
} );

test( 'the plugin floor in the repository is one this script reads', () => {
	const out = [];
	const log = console.log;
	console.log = ( line ) => out.push( line );
	try {
		assert.equal( main( { COMPOSER_JSON: PLUGIN_COMPOSER, HOST_CLI_INFO: cliInfo( '99.0.0' ) } ), 0 );
	} finally {
		console.log = log;
	}
	assert.equal( out.length, 1 );
	assert.match( out[ 0 ], /^The host's WP-CLI runs PHP 99\.0\.0, which meets the plugin's floor >=/ );
} );

// Composer builds platform_check.php from the root and every non-dev package
// it installs, and checks each ext-* they require. The guard reads the
// root's require.php alone, which is the whole floor only while both hold.
test( 'the root require.php is the whole platform floor', () => {
	const lock = JSON.parse( readFileSync( PLUGIN_LOCK, 'utf8' ) );
	assert.ok( Array.isArray( lock.packages ), 'composer.lock has no "packages" list' );
	assert.deepEqual( lock.packages.map( ( pkg ) => pkg.name ), [], READ_PLATFORM_CHECK );
	const composer = JSON.parse( readFileSync( PLUGIN_COMPOSER, 'utf8' ) );
	assert.deepEqual( Object.keys( composer.require ), [ 'php' ], READ_PLATFORM_CHECK );
	assert.deepEqual( Object.keys( lock.platform ), [ 'php' ], READ_PLATFORM_CHECK );
	assert.equal( lock.platform.php, composer.require.php, 'composer.lock is behind composer.json; run `pnpm composer update --lock`' );
} );

// entry-point.mjs's own cases are in ci-result.test.mjs; this is the wiring.
// A main() that never ran would exit 0, a pass, so a script path that
// cannot be resolved, or none at all, must fail the step without checking.
test( 'the script fails when it cannot tell it was run as the script', () => {
	const run = ( preload ) => {
		try {
			execFileSync( process.execPath, [ '--import', `data:text/javascript,${ encodeURIComponent( preload ) }`, SCRIPT ], {
				env: { PATH: process.env.PATH, COMPOSER_JSON: PLUGIN_COMPOSER, HOST_CLI_INFO: cliInfo( '99.0.0' ) },
				stdio: 'pipe',
				encoding: 'utf8',
			} );
			return { status: 0, stdout: '' };
		} catch ( error ) {
			return { status: error.status, stdout: error.stdout };
		}
	};
	for ( const preload of [ `process.argv[1] = ${ JSON.stringify( join( tmpdir(), 'host-php-floor-gone', 'host-php-floor.mjs' ) ) };`, 'process.argv.splice( 1 );' ] ) {
		const failed = run( preload );
		assert.equal( failed.status, 1, preload );
		assert.equal( failed.stdout, '::error::host-php-floor.mjs could not tell whether it was run as the script, so it fails rather than pass without checking. Nothing was deployed.\n', preload );
	}
} );

// The script as the deploy step runs it: inputs through env only, one line
// out, the exit code the step reads. Also through a symlinked directory and
// a symlinked file, since a main() that never ran would exit 0, a pass.
test( 'the script exits 1 with an ::error:: and 0 with one line, through symlinks too', () => {
	const dir = mkdtempSync( join( tmpdir(), 'host-php-floor-' ) );
	try {
		const composer = join( dir, 'composer.json' );
		writeFileSync( composer, JSON.stringify( floor( '>=8.4' ) ) );
		symlinkSync( dirname( SCRIPT ), join( dir, 'scripts' ), 'dir' );
		symlinkSync( SCRIPT, join( dir, 'host-php-floor.mjs' ), 'file' );
		const run = ( path, env ) => {
			try {
				return { status: 0, stdout: execFileSync( process.execPath, [ path ], { env: { PATH: process.env.PATH, ...env }, stdio: 'pipe', encoding: 'utf8' } ) };
			} catch ( error ) {
				return { status: error.status, stdout: error.stdout };
			}
		};
		for ( const path of [ SCRIPT, join( dir, 'scripts', 'host-php-floor.mjs' ), join( dir, 'host-php-floor.mjs' ) ] ) {
			const below = run( path, { COMPOSER_JSON: composer, HOST_CLI_INFO: cliInfo( '8.2.35' ) } );
			assert.equal( below.status, 1, path );
			assert.match( below.stdout, /^::error::The host's WP-CLI runs PHP 8\.2\.35, below the plugin's floor >=8\.4 /, path );

			const passed = run( path, { COMPOSER_JSON: composer, HOST_CLI_INFO: cliInfo( '8.4.27' ) } );
			assert.equal( passed.status, 0, path );
			assert.equal( passed.stdout, "The host's WP-CLI runs PHP 8.4.27, which meets the plugin's floor >=8.4.\n", path );
		}

		for ( const env of [ {}, { COMPOSER_JSON: composer }, { HOST_CLI_INFO: cliInfo( '8.4.27' ) }, { COMPOSER_JSON: join( dir, 'missing.json' ), HOST_CLI_INFO: cliInfo( '8.4.27' ) } ] ) {
			const failed = run( SCRIPT, env );
			assert.equal( failed.status, 1, JSON.stringify( env ) );
			assert.match( failed.stdout, /^::error::Cannot read /, JSON.stringify( env ) );
		}

		writeFileSync( join( dir, 'broken.json' ), '{ "require": ' );
		assert.equal( run( SCRIPT, { COMPOSER_JSON: join( dir, 'broken.json' ), HOST_CLI_INFO: cliInfo( '8.4.27' ) } ).status, 1 );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
} );

test( 'a value from the host cannot start a workflow command', () => {
	const hostile = JSON.stringify( { php_version: '8.4.27\n::add-mask::x%0A' } );
	const out = [];
	const log = console.log;
	console.log = ( line ) => out.push( line );
	try {
		assert.equal( main( { COMPOSER_JSON: PLUGIN_COMPOSER, HOST_CLI_INFO: hostile } ), 1 );
	} finally {
		console.log = log;
	}
	assert.equal( out.length, 1 );
	assert.doesNotMatch( out[ 0 ], /\n|\r/ );
	assert.doesNotMatch( out[ 0 ], /%0A::/ );
	assert.match( out[ 0 ], /^::error::/ );
} );
