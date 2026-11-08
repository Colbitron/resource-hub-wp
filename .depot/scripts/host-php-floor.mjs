// Whether the host's WP-CLI runs a PHP the plugin can load
// (.depot/workflows/ci.yml, the `deploy` job, "Check the host's CLI PHP").
// The deploy runs it before the rsync, so a mismatch fails the job before
// anything reaches the host.
//
// The plugin's composer.json sets a PHP floor in `require.php`, and
// vendor/composer/platform_check.php, which Composer writes into the
// deployed vendor/, enforces it at runtime: on a PHP below it, the
// plugin's first load is a fatal error. The host's web PHP and its CLI PHP
// can differ, so readers can be fine while every WP-CLI call the deploy
// makes after the rsync fatals, which leaves the host half-deployed and
// skips the front end's deploy (main's run ps_lzqkzvjvch, 2026-11-07: the
// floor was 8.4 and the host's CLI ran 8.2.35).
//
// Only the root's `require.php` is read, which is the whole floor only
// while the plugin installs no package for production. Composer generates
// platform_check.php from the highest PHP lower bound across the root and
// every installed non-dev package, and adds a check for each `ext-*` they
// require. Today composer.lock's "packages" is empty and the root requires
// nothing but php, so `require.php` is the floor; the tests fail as soon as
// either stops being true, since this script would then need to read the
// generated vendor/composer/platform_check.php instead.
//
// Inputs, read from the environment only, never interpolated into code:
//
//   HOST_CLI_INFO    the stdout of `$WP_CLI cli info --format=json`, run on
//                    the host the way the deploy's own WP-CLI calls run, so
//                    its php_version is the PHP they will run on
//   COMPOSER_JSON    the path of the plugin's composer.json in the checkout
//
// It fails closed: input it cannot read for certain (no output, output
// that is not WP-CLI's JSON, a version or a floor not in the shape below)
// is a failure, never a pass. The floor is read only in the one shape the
// plugin uses, `>=X.Y` or `>=X.Y.Z`; any other constraint (`^8.4`, a
// range, an `||`) is refused rather than guessed at, so changing the
// floor's shape means changing this script. Versions compare by their
// numeric major, minor and patch, as platform_check.php compares
// PHP_VERSION_ID, so a distribution suffix such as `8.4.1-1ubuntu1` counts
// as 8.4.1.
//
// Run as a script it prints one line with the host's CLI PHP when it meets
// the floor, or an ::error:: naming both versions, and exits 1, when it
// does not or cannot tell:
//
//   HOST_CLI_INFO=... COMPOSER_JSON=... node host-php-floor.mjs

import { readFileSync } from 'node:fs';

import { runAsScript } from './entry-point.mjs';

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+~A-Za-z][0-9A-Za-z.+~-]*)?$/;
const FLOOR = /^>=\s*(\d+)\.(\d+)(?:\.(\d+))?$/;

/**
 * A PHP version string, as PHP_VERSION prints it.
 *
 * @param {unknown} text The version.
 * @return {number[]} Its major, minor and patch.
 * @throws {Error} When it is not a version.
 */
export function parseVersion( text ) {
	const match = typeof text === 'string' ? VERSION.exec( text ) : null;
	if ( ! match ) {
		throw new Error( `${ shown( text ) } is not a PHP version` );
	}
	return match.slice( 1, 4 ).map( Number );
}

/**
 * The floor in composer.json's `require.php`.
 *
 * @param {unknown} constraint The constraint.
 * @return {number[]} Its major, minor and patch (0 when it names none).
 * @throws {Error} When it is not `>=X.Y` or `>=X.Y.Z`.
 */
export function parseFloor( constraint ) {
	const match = typeof constraint === 'string' ? FLOOR.exec( constraint.trim() ) : null;
	if ( ! match ) {
		throw new Error( `require.php ${ shown( constraint ) } is not a floor of the form >=X.Y or >=X.Y.Z` );
	}
	return [ match[ 1 ], match[ 2 ], match[ 3 ] ?? '0' ].map( Number );
}

/**
 * The PHP version in `wp cli info --format=json`'s output. WP-CLI prints
 * its JSON as the last line; anything above it, such as a PHP notice, is
 * ignored, and the last line must still be that JSON.
 *
 * @param {unknown} stdout The command's output.
 * @return {string} Its php_version, checked to be a version.
 * @throws {Error} When the output holds no such version.
 */
export function cliInfoVersion( stdout ) {
	const lines = typeof stdout === 'string' ? stdout.split( '\n' ).map( ( line ) => line.trim() ).filter( Boolean ) : [];
	if ( lines.length === 0 ) {
		throw new Error( 'the host printed nothing for `wp cli info --format=json`' );
	}
	let info;
	try {
		info = JSON.parse( lines.at( -1 ) );
	} catch {
		throw new Error( 'the last line of `wp cli info --format=json` is not JSON' );
	}
	if ( info === null || typeof info !== 'object' || ! Object.hasOwn( info, 'php_version' ) ) {
		throw new Error( '`wp cli info --format=json` has no php_version' );
	}
	parseVersion( info.php_version );
	return info.php_version;
}

/**
 * Whether one version is at or above another.
 *
 * @param {number[]} version Major, minor, patch.
 * @param {number[]} floor   Major, minor, patch.
 * @return {boolean} True when version >= floor.
 */
export function meets( version, floor ) {
	for ( let i = 0; i < 3; i++ ) {
		if ( version[ i ] !== floor[ i ] ) {
			return version[ i ] > floor[ i ];
		}
	}
	return true;
}

/**
 * The check itself, without the environment.
 *
 * @param {{cliInfo: unknown, composer: unknown}} input The host's cli info output and composer.json's parsed contents.
 * @return {{ok: boolean, message: string}} The verdict and the line to print.
 */
export function check( { cliInfo, composer } ) {
	let floorText;
	let floor;
	let version;
	try {
		floorText = composer?.require?.php;
		floor = parseFloor( floorText );
	} catch ( error ) {
		return { ok: false, message: `Cannot read the plugin's PHP floor: ${ error.message }. Nothing was deployed.` };
	}
	try {
		version = cliInfoVersion( cliInfo );
	} catch ( error ) {
		return { ok: false, message: `Cannot read the host's WP-CLI PHP version: ${ error.message }. Nothing was deployed.` };
	}
	if ( ! meets( parseVersion( version ), floor ) ) {
		return {
			ok: false,
			message: `The host's WP-CLI runs PHP ${ version }, below the plugin's floor ${ floorText.trim() } (composer.json require.php). Nothing was deployed: align the host's CLI PHP or the floor (docs/runbooks/deploy.md, "The host's CLI PHP").`,
		};
	}
	return { ok: true, message: `The host's WP-CLI runs PHP ${ version }, which meets the plugin's floor ${ floorText.trim() }.` };
}

/**
 * The script: reads the environment, prints the verdict.
 *
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {number} The exit code: 0 when the host meets the floor.
 */
export function main( env = process.env ) {
	let composer;
	try {
		if ( ! env.COMPOSER_JSON ) {
			throw new Error( 'COMPOSER_JSON is not set' );
		}
		composer = JSON.parse( readFileSync( env.COMPOSER_JSON, 'utf8' ) );
	} catch ( error ) {
		console.log( `::error::${ escapeData( `Cannot read the plugin's composer.json: ${ error.message }. Nothing was deployed.` ) }` );
		return 1;
	}
	const { ok, message } = check( { cliInfo: env.HOST_CLI_INFO, composer } );
	console.log( ok ? message : `::error::${ escapeData( message ) }` );
	return ok ? 0 : 1;
}

// A value from the host or the checkout, quoted and cut short, so it cannot
// start a workflow command or flood the log.
function shown( value ) {
	const text = JSON.stringify( value ) ?? String( value );
	return text.length > 60 ? `${ text.slice( 0, 60 ) }...` : text;
}

// A workflow command's message escapes these three, or they change it.
function escapeData( text ) {
	return text.replaceAll( '%', '%25' ).replaceAll( '\r', '%0D' ).replaceAll( '\n', '%0A' );
}

runAsScript(
	import.meta.url,
	main,
	'host-php-floor.mjs could not tell whether it was run as the script, so it fails rather than pass without checking. Nothing was deployed.'
);
