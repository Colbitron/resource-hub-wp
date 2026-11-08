// Whether an installed third-party plugin is exactly the release WordPress.org
// published (.depot/workflows/ci.yml, the `deploy` job, "Check Relevanssi's
// files"). The deploy runs it before the plugin's rsync, which deletes on the
// host whatever its source lacks, so a failure stops the job with nothing sent.
//
// site-plugins/composer.lock pins the version and the archive's URL but no
// checksum: wpackagist's dist entry has none, and WordPress.org builds its
// zips on demand, so a zip's own hash can change between downloads of the
// same release. What WordPress.org does publish is a SHA-256 for every file
// of each release, at downloads.wordpress.org/plugin-checksums/<slug>/
// <version>.json, the list `wp plugin verify-checksums` reads. The step
// downloads that list on the runner and this script compares the installed
// directory with it, file by file.
//
// Inputs, read from the environment only, never interpolated into code:
//
//   PLUGIN_DIR       the installed plugin directory in the checkout
//   CHECKSUMS        the path of the downloaded checksum list
//   PLUGIN_SLUG      the slug the list must name (`relevanssi`)
//   EXPECT_VERSION   the version site-plugins/composer.lock pins
//
// It fails closed. The list must parse, name this slug and this version,
// and include the plugin's main file and its lib/ directory, so an empty or
// truncated list never passes. Every listed file must exist as a regular
// file with that SHA-256, and the directory must hold no file the list does
// not name and no symbolic link, so nothing is added, removed or altered.
// A listed path that is absolute or climbs out with `..` is refused.
//
// Run as a script it prints one line with the count of files verified, or an
// ::error:: naming the first few problems, and exits 1:
//
//   PLUGIN_DIR=... CHECKSUMS=... PLUGIN_SLUG=... EXPECT_VERSION=... node plugin-checksums.mjs

import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Every regular file under a directory, as paths relative to it with `/`
 * separators, sorted. A symbolic link or anything else that is not a file
 * or a directory is returned in `others`.
 *
 * @param {string} dir The directory.
 * @return {{ files: string[], others: string[] }}
 */
export function listTree( dir ) {
	const files = [];
	const others = [];
	const walk = ( relative ) => {
		for ( const entry of readdirSync( join( dir, relative ), { withFileTypes: true } ) ) {
			const path = relative ? `${ relative }/${ entry.name }` : entry.name;
			if ( entry.isDirectory() ) {
				walk( path );
			} else if ( entry.isFile() ) {
				files.push( path );
			} else {
				others.push( path );
			}
		}
	};
	walk( '' );
	return { files: files.sort(), others: others.sort() };
}

/**
 * Compares an installed plugin with WordPress.org's checksum list.
 *
 * @param {object}   input
 * @param {unknown}  input.checksums The parsed list.
 * @param {string}   input.slug      The slug it must name.
 * @param {string}   input.version   The version it must name.
 * @param {string[]} input.files     The installed files, relative.
 * @param {string[]} input.others    Installed entries that are not regular files.
 * @param {(path: string) => string} input.sha256 The SHA-256 of an installed file.
 * @return {{ ok: boolean, message: string }}
 */
export function verify( { checksums, slug, version, files, others, sha256 } ) {
	const fail = ( problems ) => ( {
		ok: false,
		message: `${ slug } ${ version } does not match WordPress.org's checksums: ${ problems.slice( 0, 5 ).join( '; ' ) }${ problems.length > 5 ? `; and ${ problems.length - 5 } more` : '' }. Nothing was deployed.`,
	} );

	if ( ! checksums || typeof checksums !== 'object' || ! checksums.files || typeof checksums.files !== 'object' ) {
		return fail( [ 'the checksum list has no files' ] );
	}
	if ( checksums.plugin !== slug || checksums.version !== version ) {
		return fail( [ `the checksum list is for ${ shown( checksums.plugin ) } ${ shown( checksums.version ) }` ] );
	}

	const listed = Object.keys( checksums.files ).sort();
	const problems = [];

	if ( ! listed.includes( `${ slug }.php` ) || ! listed.some( ( path ) => path.startsWith( 'lib/' ) ) ) {
		problems.push( `the checksum list lacks ${ slug }.php or lib/` );
	}

	for ( const path of listed ) {
		if ( path.startsWith( '/' ) || path.split( '/' ).includes( '..' ) ) {
			problems.push( `refused listed path ${ shown( path ) }` );
		}
	}
	if ( problems.length ) {
		return fail( problems );
	}

	const installed = new Set( files );
	for ( const path of listed ) {
		const expected = checksums.files[ path ]?.sha256;
		if ( typeof expected !== 'string' || ! SHA256.test( expected ) ) {
			problems.push( `no SHA-256 listed for ${ shown( path ) }` );
		} else if ( ! installed.has( path ) ) {
			problems.push( `missing ${ shown( path ) }` );
		} else if ( sha256( path ) !== expected ) {
			problems.push( `changed ${ shown( path ) }` );
		}
	}

	const known = new Set( listed );
	for ( const path of files ) {
		if ( ! known.has( path ) ) {
			problems.push( `unlisted ${ shown( path ) }` );
		}
	}
	for ( const path of others ) {
		problems.push( `not a regular file: ${ shown( path ) }` );
	}

	if ( problems.length ) {
		return fail( problems );
	}
	return { ok: true, message: `${ slug } ${ version }: all ${ listed.length } files match WordPress.org's checksums.` };
}

/**
 * Reads the inputs from the environment and prints the verdict.
 *
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {number} The exit code.
 */
export function main( env = process.env ) {
	const slug = env.PLUGIN_SLUG ?? '';
	const version = env.EXPECT_VERSION ?? '';
	let checksums;
	let tree;

	try {
		for ( const name of [ 'PLUGIN_DIR', 'CHECKSUMS', 'PLUGIN_SLUG', 'EXPECT_VERSION' ] ) {
			if ( ! env[ name ] ) {
				throw new Error( `${ name } is not set` );
			}
		}
		checksums = JSON.parse( readFileSync( env.CHECKSUMS, 'utf8' ) );
		tree = listTree( env.PLUGIN_DIR );
	} catch ( error ) {
		console.log( `::error::${ escapeData( `Cannot verify ${ slug || 'the plugin' }'s files: ${ error.message }. Nothing was deployed.` ) }` );
		return 1;
	}

	const { ok, message } = verify( {
		checksums,
		slug,
		version,
		files: tree.files,
		others: tree.others,
		sha256: ( path ) => createHash( 'sha256' ).update( readFileSync( join( env.PLUGIN_DIR, path ) ) ).digest( 'hex' ),
	} );
	console.log( ok ? message : `::error::${ escapeData( message ) }` );
	return ok ? 0 : 1;
}

// A value from the list or the directory, quoted and cut short, so it cannot
// start a workflow command or flood the log.
function shown( value ) {
	const text = JSON.stringify( value ) ?? String( value );
	return text.length > 80 ? `${ text.slice( 0, 80 ) }...` : text;
}

// A workflow command's message escapes these three, or they change it.
function escapeData( text ) {
	return text.replaceAll( '%', '%25' ).replaceAll( '\r', '%0D' ).replaceAll( '\n', '%0A' );
}

/**
 * Whether this module was run as the script, as host-php-floor.mjs decides it.
 *
 * @param {string|undefined} argv1    process.argv[1].
 * @param {string}           self     This module's path.
 * @param {(path: string) => string} realpath Resolves a path.
 * @return {'run'|'skip'|'error'}
 */
export function entryPoint( argv1, self, realpath = realpathSync ) {
	if ( ! argv1 ) {
		return 'skip';
	}
	try {
		return realpath( argv1 ) === realpath( self ) ? 'run' : 'skip';
	} catch {
		return 'error';
	}
}

switch ( entryPoint( process.argv[ 1 ], fileURLToPath( import.meta.url ) ) ) {
	case 'run':
		process.exitCode = main();
		break;
	case 'error':
		console.log( '::error::plugin-checksums.mjs could not tell whether it was run as the script, so it fails rather than pass without checking. Nothing was deployed.' );
		process.exitCode = 1;
		break;
}
