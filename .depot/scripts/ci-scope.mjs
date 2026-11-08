// Which of CI's jobs a change needs (.depot/workflows/ci.yml, the `scope`
// job). Only a pull request is ever scoped: on every other event (a push to
// main, a manual dispatch on main or a tag, Depot's own `api` runs) the
// job runs but its outputs are not read, and every job runs, so nothing
// here can skip a job that gates main or a deploy. Lighthouse is not a side:
// its shards never run on a pull request, whatever paths changed, and
// always run everywhere else (ADR 0053).
//
// Each changed path selects the sides it can affect:
//
//   plugin      the gate (schemas, JS lint, block build, PHPCS, PHPUnit,
//               Playwright in wp-env)
//   web         web-checks, web-e2e, web-screenshots
//
// The rules, first match wins:
//
//   wp-content/**              plugin
//   apps/**                    web
//   .wp-env.json               plugin, web (both sides' environment, by the
//                              owner's rule)
//   docs/**, .claude/**,       nothing: no job reads them. .github/ holds
//   .github/**, tools/**,      GitHub's own workflows, which Depot does not
//   a *.md at the root         run; tools/ holds one-off image scripts no
//                              job runs
//   anything else              plugin, web
//
// "Anything else" is everything both sides read (packages/**, the contract
// package with the schemas, tokens, CSS and font; package.json,
// pnpm-lock.yaml and pnpm-workspace.yaml, which every install reads;
// .depot/**, the workflows and the shared setup action; .gitignore) and any
// path added later, so a new top-level file or directory runs every job
// until a rule here says otherwise. A rename counts as its old path and its
// new one, so moving a file out of a side still runs that side.
//
// The union of the paths' sides is the change's scope. A pull request that
// changes only inert paths (docs/, an ADR, a root README) runs no job but
// this one; main's run after the merge runs them all.
//
// When the changed paths cannot be read for certain (no pull request head
// SHA was given; HEAD is not the two-parent merge commit Depot checks out
// for a pull request, refs/pull/N/merge, whose second parent is that head;
// git fails), the scope is everything: the classifier only ever removes
// jobs it can prove a change does not reach. The head check matters: main's
// own HEAD is often a merge commit too, of the last pull request merged.
//
// Run as a script it writes plugin= and web= ('true' or 'false') to
// $GITHUB_OUTPUT and a short table to $GITHUB_STEP_SUMMARY:
//
//   node ci-scope.mjs [--expect-head <sha>] [--paths-file <file>]
//
// --expect-head is the pull request's head SHA, which HEAD^2 must equal;
// without it every job runs. --paths-file reads the changed paths from a
// file, one per line, instead of from git; the tests and a trial run use
// it, the workflow does not.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SIDES = [ 'plugin', 'web' ];

const ALL = Object.freeze( [ 'plugin', 'web' ] );
const NONE = Object.freeze( [] );

const INERT_PREFIXES = [ 'docs/', '.claude/', '.github/', 'tools/' ];

/**
 * The sides one changed path can affect, as a list of SIDES.
 *
 * @param {string} path A repository-relative path, as git prints it.
 * @return {readonly string[]} The sides it selects.
 */
export function sidesOf( path ) {
	if ( path.startsWith( 'wp-content/' ) ) {
		return [ 'plugin' ];
	}
	if ( path.startsWith( 'apps/' ) ) {
		return [ 'web' ];
	}
	if ( path === '.wp-env.json' ) {
		return ALL;
	}
	if ( INERT_PREFIXES.some( ( prefix ) => path.startsWith( prefix ) ) ) {
		return NONE;
	}
	if ( ! path.includes( '/' ) && path.endsWith( '.md' ) ) {
		return NONE;
	}
	return ALL;
}

/**
 * The scope of a change: for each side, whether any path selects it.
 * `null` means the paths could not be read, and selects every side.
 *
 * @param {string[]|null} paths The changed paths, or null.
 * @return {{plugin: boolean, web: boolean}} The scope.
 */
export function scopeOf( paths ) {
	const scope = { plugin: false, web: false };
	for ( const side of paths === null ? ALL : paths.flatMap( sidesOf ) ) {
		scope[ side ] = true;
	}
	return scope;
}

function git( args, cwd ) {
	return execFileSync( 'git', args, { cwd, encoding: 'utf8', stdio: [ 'ignore', 'pipe', 'pipe' ] } );
}

/**
 * The paths a pull request's merge commit changes against its base, or null
 * with the reason when they cannot be read for certain. Renames are listed
 * as their old and new paths (--no-renames reports a delete and an add).
 *
 * @param {{cwd?: string, expectHead?: string}} options Where, and the pull request's head SHA.
 * @return {{paths: string[]|null, reason: string}} The paths, or null.
 */
export function changedPaths( { cwd = process.cwd(), expectHead = '' } = {} ) {
	let parents;
	try {
		parents = git( [ 'rev-list', '--parents', '-n', '1', 'HEAD' ], cwd ).trim().split( ' ' ).slice( 1 );
	} catch ( error ) {
		return { paths: null, reason: `git could not read HEAD (${ firstLine( error ) })` };
	}
	if ( parents.length !== 2 ) {
		return { paths: null, reason: `HEAD has ${ parents.length } parent(s), not the two of a pull request's merge commit` };
	}
	if ( ! expectHead ) {
		return { paths: null, reason: 'no pull request head SHA to check HEAD against' };
	}
	if ( parents[ 1 ] !== expectHead ) {
		return { paths: null, reason: `HEAD's second parent is ${ parents[ 1 ] }, not the pull request's head ${ expectHead }` };
	}
	try {
		const out = git( [ 'diff', '--no-renames', '--name-only', '-z', parents[ 0 ], 'HEAD' ], cwd );
		return { paths: out.split( '\0' ).filter( Boolean ), reason: `diff of HEAD against its first parent ${ parents[ 0 ] }` };
	} catch ( error ) {
		return { paths: null, reason: `git diff failed (${ firstLine( error ) })` };
	}
}

function firstLine( error ) {
	return String( error.stderr || error.message ).trim().split( '\n' )[ 0 ];
}

function argument( argv, name ) {
	const at = argv.indexOf( name );
	return at === -1 ? '' : argv[ at + 1 ] ?? '';
}

/**
 * The script: reads the paths, writes the outputs and the summary.
 *
 * @param {string[]} argv The arguments after the script's path.
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {{plugin: boolean, web: boolean}} The scope written.
 */
export function main( argv = process.argv.slice( 2 ), env = process.env ) {
	const pathsFile = argument( argv, '--paths-file' );
	const { paths, reason } = pathsFile
		? { paths: readFileSync( pathsFile, 'utf8' ).split( '\n' ).map( ( line ) => line.trim() ).filter( Boolean ), reason: `paths from ${ pathsFile }` }
		: changedPaths( { expectHead: argument( argv, '--expect-head' ) } );
	const scope = scopeOf( paths );

	const lines = SIDES.map( ( side ) => `${ side }=${ scope[ side ] }` );
	console.log( paths === null ? `Running every job: ${ reason }.` : `${ paths.length } changed path(s), ${ reason }.` );
	for ( const path of paths ?? [] ) {
		// JSON-encoded, so a crafted file name cannot start a workflow command.
		console.log( `  ${ JSON.stringify( path ) } -> ${ sidesOf( path ).join( ', ' ) || 'nothing' }` );
	}
	console.log( lines.join( '\n' ) );
	if ( env.GITHUB_OUTPUT ) {
		appendFileSync( env.GITHUB_OUTPUT, lines.join( '\n' ) + '\n' );
	}
	if ( env.GITHUB_STEP_SUMMARY ) {
		const row = ( side ) => `| ${ side } | ${ scope[ side ] ? 'runs' : 'skipped' } |`;
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			[
				'### Jobs this pull request needs',
				'',
				paths === null ? `Every job runs: ${ reason }.` : `From ${ paths.length } changed path(s) (.depot/scripts/ci-scope.mjs).`,
				'',
				'| Side | |',
				'|---|---|',
				...SIDES.map( row ),
				'',
			].join( '\n' )
		);
	}
	return scope;
}

if ( import.meta.url === pathToFileURL( process.argv[ 1 ] ?? '' ).href ) {
	main();
}
