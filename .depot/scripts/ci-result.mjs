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
// ci.yml skips one off a rollback. Anything else, an unexpected skip, a
// missing result, a skip off a pull request, an output other than 'true'
// or 'false', is red.
//
// A rollback dispatch (ci.yml, "Rolling back": a workflow_dispatch on main
// whose rollback_sha input names an earlier commit) is the other shape.
// There the gate runs on that commit and must succeed, and every
// front-end job is skipped by the `inputs.rollback_sha == ''` clause in
// its condition and must be: the rollback ships nothing of the front end,
// so a front-end job that ran there means those conditions drifted. The
// script reads the same input the conditions read, so the two agree.
//
// The workflow passes everything through env, never into the script:
//
//   EVENT_NAME                   github.event_name
//   ROLLBACK_SHA                 inputs.rollback_sha: '' or unset off a
//                                rollback dispatch
//   SCOPE                        needs.scope.result
//   SCOPE_PLUGIN, SCOPE_WEB      needs.scope.outputs.plugin and .web
//   GATE, WEB_CHECKS, WEB_E2E,   needs.<job>.result, one per job in JOBS
//   WEB_SCREENSHOTS
//
// It prints each job's result, writes a table to $GITHUB_STEP_SUMMARY, and
// exits 1 on any problem. It exits 1 too when it cannot tell whether node
// ran it as the script or a test imported it (entry-point.mjs), since a
// main() that never ran would exit 0, a pass. A job added to ci.yml has to
// be named in ci-result's needs (and here) or exempted; ci-scope.test.mjs
// fails until it is one or the other.

import { appendFileSync } from 'node:fs';

import { runAsScript } from './entry-point.mjs';

/** Each job ci-result reads: the env variable with its result, and the scope side that may skip it. */
export const JOBS = Object.freeze( {
	gate: { env: 'GATE', side: 'plugin' },
	'web-checks': { env: 'WEB_CHECKS', side: 'web' },
	'web-e2e': { env: 'WEB_E2E', side: 'web' },
	'web-screenshots': { env: 'WEB_SCREENSHOTS', side: 'web' },
} );

const SIDE_ENV = Object.freeze( { plugin: 'SCOPE_PLUGIN', web: 'SCOPE_WEB' } );

/**
 * Whether the run is a rollback dispatch: a rollback_sha, read from the
 * same input as the jobs' conditions, on a workflow_dispatch. The event is
 * checked too: a rollback_sha can only reach a dispatch, so one on any
 * other event is not a rollback, and the usual rules then apply (every
 * job must have run), which is red for the skips a rollback would excuse.
 *
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {boolean} True for a workflow_dispatch with a rollback_sha.
 */
export function isRollback( env ) {
	return env.EVENT_NAME === 'workflow_dispatch' && typeof env.ROLLBACK_SHA === 'string' && env.ROLLBACK_SHA !== '';
}

/**
 * The verdict for one job's result.
 *
 * @param {string} result The job's result.
 * @param {string} side   Its scope side.
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {string|null} Null when it passes, or why it does not.
 */
function problemWith( result, side, env ) {
	if ( isRollback( env ) ) {
		if ( side === 'web' ) {
			return result === 'skipped' ? null : `result ${ JSON.stringify( result ) } on a rollback dispatch, where every front-end job is skipped: the rollback ships nothing of the front end, so this job ran only if the rollback clause left its condition`;
		}
		return result === 'success' ? null : `result ${ JSON.stringify( result ) }, not success; on a rollback dispatch the gate runs on the rollback target and must pass`;
	}
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
	console.log( `event ${ JSON.stringify( env.EVENT_NAME ?? '' ) }, rollback ${ isRollback( env ) ? 'yes' : 'no' }, scope outputs plugin=${ JSON.stringify( env.SCOPE_PLUGIN ?? '' ) } web=${ JSON.stringify( env.SCOPE_WEB ?? '' ) }` );
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

// The verdict only as the script, and a red one when it cannot tell whether
// it is the script, so the required check never passes without a verdict.
runAsScript(
	import.meta.url,
	() => ( main() ? 0 : 1 ),
	'ci-result.mjs could not tell whether it was run as the script, so CI result fails rather than pass without a verdict.'
);
