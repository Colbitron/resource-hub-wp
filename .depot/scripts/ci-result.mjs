// Whether CI as a whole passed (.depot/workflows/ci.yml, the `ci-result`
// job): the one check a GitHub ruleset requires on main, CI / CI result.
// GitHub counts a check that concluded skipped as passing, and the scope
// job skips jobs on a pull request, so the jobs' own checks cannot be the
// required one; this decides from their results instead.
//
// Deny by default. The scope job must have succeeded, on every event: a
// failed or cancelled scope skips every job behind it. Each job it reads
// must have succeeded, except that on a pull request a job may be skipped
// when scope's output for its side says 'false', which is the only way
// ci.yml skips one. Anything else, an unexpected skip, a missing result, a
// skip off a pull request, an output other than 'true' or 'false', is red.
//
// The workflow passes everything through env, never into the script:
//
//   EVENT_NAME                   github.event_name
//   SCOPE                        needs.scope.result
//   SCOPE_PLUGIN, SCOPE_WEB      needs.scope.outputs.plugin and .web
//   GATE, WEB_CHECKS, WEB_E2E,   needs.<job>.result, one per job in JOBS
//   WEB_SCREENSHOTS
//
// It prints each job's result, writes a table to $GITHUB_STEP_SUMMARY, and
// exits 1 on any problem. A job added to ci.yml has to be named in
// ci-result's needs (and here) or exempted; ci-scope.test.mjs fails until
// it is one or the other.

import { appendFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Each job ci-result reads: the env variable with its result, and the scope side that may skip it. */
export const JOBS = Object.freeze( {
	gate: { env: 'GATE', side: 'plugin' },
	'web-checks': { env: 'WEB_CHECKS', side: 'web' },
	'web-e2e': { env: 'WEB_E2E', side: 'web' },
	'web-screenshots': { env: 'WEB_SCREENSHOTS', side: 'web' },
} );

const SIDE_ENV = Object.freeze( { plugin: 'SCOPE_PLUGIN', web: 'SCOPE_WEB' } );

/**
 * The verdict for one job's result.
 *
 * @param {string} result The job's result.
 * @param {string} side   Its scope side.
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {string|null} Null when it passes, or why it does not.
 */
function problemWith( result, side, env ) {
	if ( result === 'success' ) {
		return null;
	}
	if ( result === 'skipped' ) {
		if ( env.EVENT_NAME !== 'pull_request' ) {
			return `skipped on event ${ JSON.stringify( env.EVENT_NAME ?? '' ) }, where every job must run`;
		}
		const output = env[ SIDE_ENV[ side ] ];
		if ( output === 'false' ) {
			return null;
		}
		return `skipped, though scope's ${ side } output is ${ JSON.stringify( output ?? '' ) }, not 'false'`;
	}
	return `result ${ JSON.stringify( result ) }, not success`;
}

/**
 * Every job's result and verdict, scope's first.
 *
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {{job: string, result: string, problem: string|null}[]} One row a job.
 */
export function verdicts( env = process.env ) {
	const scope = env.SCOPE ?? '';
	const rows = [
		{ job: 'scope', result: scope, problem: scope === 'success' ? null : `result ${ JSON.stringify( scope ) }, not success, so the jobs behind it cannot count as passed` },
	];
	for ( const [ job, { env: name, side } ] of Object.entries( JOBS ) ) {
		const result = env[ name ] ?? '';
		rows.push( { job, result, problem: problemWith( result, side, env ) } );
	}
	return rows;
}

/**
 * The script: prints the rows, writes the summary.
 *
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {boolean} Whether CI passed.
 */
export function main( env = process.env ) {
	const rows = verdicts( env );
	console.log( `event ${ JSON.stringify( env.EVENT_NAME ?? '' ) }, scope outputs plugin=${ JSON.stringify( env.SCOPE_PLUGIN ?? '' ) } web=${ JSON.stringify( env.SCOPE_WEB ?? '' ) }` );
	for ( const { job, result, problem } of rows ) {
		// JSON-encoded, so no value can start a workflow command.
		console.log( problem === null ? `${ job }: ${ JSON.stringify( result ) }, passes` : `::error::${ job }: ${ problem }` );
	}
	const passed = rows.every( ( row ) => row.problem === null );
	if ( env.GITHUB_STEP_SUMMARY ) {
		appendFileSync(
			env.GITHUB_STEP_SUMMARY,
			[
				`### CI ${ passed ? 'passed' : 'failed' }`,
				'',
				'| Job | Result | |',
				'|---|---|---|',
				...rows.map( ( { job, result, problem } ) => `| ${ job } | ${ result || '(none)' } | ${ problem ?? 'passes' } |` ),
				'',
			].join( '\n' )
		);
	}
	return passed;
}

/**
 * Whether this file is the script node was asked to run, rather than a
 * module a test imported. Both sides are compared as realpaths: node loads
 * the main module through argv[1]'s realpath (unless --preserve-symlinks-main),
 * so a symlink anywhere in the checkout's path would make a plain comparison
 * false, main() would never run, and the step would exit 0 with no verdict.
 *
 * @return {boolean} Whether to run main().
 */
function isEntryPoint() {
	if ( ! process.argv[ 1 ] ) {
		return false;
	}
	try {
		return realpathSync( process.argv[ 1 ] ) === realpathSync( fileURLToPath( import.meta.url ) );
	} catch {
		return false;
	}
}

if ( isEntryPoint() ) {
	process.exitCode = main() ? 0 : 1;
}
