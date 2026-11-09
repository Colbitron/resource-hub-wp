// Whether a `rollback_sha` input names a commit this run may deploy
// (.depot/workflows/ci.yml, the `gate` and `deploy` jobs, "Check the
// rollback target"). A CMS rollback is a `workflow_dispatch` on main whose
// rollback_sha input names an earlier commit of main; both jobs check out
// main's full history, run this, and only then detach onto the target
// (docs/runbooks/deploy.md, "Rolling back"). Nothing of the target is read
// before this passes, and no SSH or rsync runs after it fails.
//
// Inputs, read from the environment only, never interpolated into code or
// a shell; git runs with an argument list, never through a shell:
//
//   EVENT_NAME      github.event_name
//   REF             github.ref
//   MAIN_SHA        github.sha, the head of main the run was dispatched on
//   ROLLBACK_SHA    the rollback_sha input; '' or unset when there is none
//   ROLLBACK_FLOOR  the earliest commit the deploy job can deploy: the one
//                   that gave the job its current shape (ci.yml, `env`)
//
// With no ROLLBACK_SHA the run is not a rollback: it passes, writes no
// output, and the jobs build the commit they checked out, main's head.
// With one, it fails closed unless every one of these holds:
//
//   - the event is workflow_dispatch and the ref is refs/heads/main: a
//     rollback SHA on any other event or ref was not typed into a dispatch
//     on main, so nothing put it there that this script should trust
//   - ROLLBACK_SHA, MAIN_SHA and ROLLBACK_FLOOR are each a full 40-hex SHA
//     in lower case, the one form `git rev-parse` prints; a short SHA, a
//     branch name, a tag or upper case is refused, never resolved
//   - the checkout is not shallow (`git rev-parse --is-shallow-repository`
//     is false): a shallow history cannot answer an ancestry question, and
//     the only wrong answer it gives, "not an ancestor", would be right by
//     accident, so it is refused outright
//   - HEAD is MAIN_SHA: the checkout is the commit the run was dispatched on
//   - the target is a commit in the checkout and an ancestor of MAIN_SHA
//     (`git merge-base --is-ancestor`), so only a commit that has been on
//     main can deploy; a commit on a branch, however well tested, cannot
//   - ROLLBACK_FLOOR is an ancestor of the target, or the target itself:
//     the running job is main's, and it reads the checkout for the files
//     it deploys and the scripts it runs, so a commit from before the job
//     took its current shape would fail later, at some step, with an error
//     about a missing file. This refuses it first, by name. The floor is a
//     constant in ci.yml; bump it when the deploy job changes in a way an
//     older checkout cannot satisfy
//
// On a pass with a target it writes `sha=<the target>` to $GITHUB_OUTPUT,
// which the step after it reads to detach the checkout; on a pass with
// none it writes nothing. On any failure it prints one ::error:: and exits
// 1; a failure to read git (a missing binary, a git error other than the
// yes-or-no exit codes it reads) fails too, since the only safe answer to
// a question it cannot ask is no.
//
//   EVENT_NAME=... REF=... MAIN_SHA=... ROLLBACK_SHA=... ROLLBACK_FLOOR=... \
//     node rollback-target.mjs

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { runAsScript } from './entry-point.mjs';

const SHA = /^[0-9a-f]{40}$/;

/**
 * Whether text is a full SHA in the one form this script accepts.
 *
 * @param {unknown} text The candidate.
 * @return {boolean} True for 40 lower-case hex characters.
 */
export function isSha( text ) {
	return typeof text === 'string' && SHA.test( text );
}

/**
 * Runs git with an argument list, never a shell, and answers with its exit
 * status and stdout, so a yes-or-no command (`merge-base --is-ancestor`,
 * `cat-file -e`) is read from its status.
 *
 * @param {string[]} args The arguments.
 * @return {{status: number, stdout: string}} What git said.
 */
export function git( args ) {
	try {
		const stdout = execFileSync( 'git', args, { stdio: [ 'ignore', 'pipe', 'pipe' ], encoding: 'utf8' } );
		return { status: 0, stdout };
	} catch ( error ) {
		if ( typeof error.status !== 'number' ) {
			// git itself could not run.
			throw error;
		}
		return { status: error.status, stdout: typeof error.stdout === 'string' ? error.stdout : '' };
	}
}

/**
 * The decision, without the environment or the real git.
 *
 * @param {{event: unknown, ref: unknown, mainSha: unknown, rollbackSha: unknown, floor: unknown}} input What the workflow passed.
 * @param {(args: string[]) => {status: number, stdout: string}} runGit How to ask git.
 * @return {{ok: boolean, sha: string|null, message: string}} Whether the run may go on, the target when it is a rollback, and the line to print.
 */
export function decide( { event, ref, mainSha, rollbackSha, floor }, runGit = git ) {
	const refuse = ( message ) => ( { ok: false, sha: null, message: `${ message } Nothing was deployed.` } );

	if ( rollbackSha === undefined || rollbackSha === null || rollbackSha === '' ) {
		return { ok: true, sha: null, message: 'Not a rollback: no rollback_sha was given, so this run builds the commit it checked out.' };
	}
	if ( event !== 'workflow_dispatch' ) {
		return refuse( `A rollback_sha was given on event ${ shown( event ) }, but a rollback is a workflow_dispatch; nothing else may carry one.` );
	}
	if ( ref !== 'refs/heads/main' ) {
		return refuse( `A rollback_sha was given on ref ${ shown( ref ) }, but a rollback is dispatched on refs/heads/main only.` );
	}
	if ( ! isSha( rollbackSha ) ) {
		return refuse( `rollback_sha ${ shown( rollbackSha ) } is not a full 40-character lower-case SHA; a short SHA, a branch, a tag or upper case is refused, never resolved.` );
	}
	if ( ! isSha( mainSha ) ) {
		return refuse( `MAIN_SHA ${ shown( mainSha ) } is not a full 40-character lower-case SHA, so the run's own commit is unknown.` );
	}
	if ( ! isSha( floor ) ) {
		return refuse( `ROLLBACK_FLOOR ${ shown( floor ) } is not a full 40-character lower-case SHA; set it in ci.yml to the commit that gave the deploy job its current shape.` );
	}

	let answer;
	try {
		answer = ask( runGit, [ 'rev-parse', '--is-shallow-repository' ] );
		if ( answer.status !== 0 || ! [ 'true', 'false' ].includes( answer.stdout.trim() ) ) {
			return refuse( 'git could not say whether the checkout is shallow, so ancestry cannot be decided.' );
		}
		if ( answer.stdout.trim() !== 'false' ) {
			return refuse( 'The checkout is shallow, so ancestry cannot be decided: the rollback steps check out main with fetch-depth 0.' );
		}

		answer = ask( runGit, [ 'rev-parse', '--verify', 'HEAD^{commit}' ], [ 0, 128 ] );
		if ( answer.status !== 0 || answer.stdout.trim() !== mainSha ) {
			return refuse( `The checkout's HEAD is ${ shown( answer.stdout.trim() ) }, not the commit this run was dispatched on, ${ mainSha }.` );
		}

		answer = ask( runGit, [ 'cat-file', '-e', `${ rollbackSha }^{commit}` ], [ 0, 1, 128 ] );
		if ( answer.status !== 0 ) {
			return refuse( `rollback_sha ${ rollbackSha } is not a commit in main's history.` );
		}

		answer = ask( runGit, [ 'merge-base', '--is-ancestor', rollbackSha, mainSha ], [ 0, 1 ] );
		if ( answer.status !== 0 ) {
			return refuse( `rollback_sha ${ rollbackSha } is not an ancestor of main's head ${ mainSha }: only a commit that has been on main can be deployed.` );
		}

		answer = ask( runGit, [ 'merge-base', '--is-ancestor', floor, rollbackSha ], [ 0, 1 ] );
		if ( answer.status !== 0 ) {
			return refuse( `rollback_sha ${ rollbackSha } predates the deploy job's floor ${ floor }, the commit that gave the job its current shape, so this job cannot deploy it; a revert pull request can (docs/runbooks/deploy.md, "Rolling back").` );
		}
	} catch ( error ) {
		return refuse( `git could not answer: ${ error.message }.` );
	}

	return { ok: true, sha: rollbackSha, message: `Rolling back: ${ rollbackSha } is on main, at or after the deploy job's floor, and will be checked out and deployed in place of main's head ${ mainSha }.` };
}

/**
 * Asks git one question, accepting only the exit statuses that answer it.
 *
 * @param {(args: string[]) => {status: number, stdout: string}} runGit How to ask git.
 * @param {string[]} args  The arguments.
 * @param {number[]} known The exit statuses that are answers; any other is an error.
 * @return {{status: number, stdout: string}} The answer.
 * @throws {Error} When git answered with an unknown status or nothing usable.
 */
function ask( runGit, args, known = [ 0 ] ) {
	const answer = runGit( args );
	if ( answer === null || typeof answer !== 'object' || typeof answer.status !== 'number' || typeof answer.stdout !== 'string' ) {
		throw new Error( `git ${ args[ 0 ] } gave no usable answer` );
	}
	if ( ! known.includes( answer.status ) ) {
		throw new Error( `git ${ args.join( ' ' ) } exited ${ answer.status }` );
	}
	return answer;
}

/**
 * The script: reads the environment, prints the verdict, writes the output.
 *
 * @param {NodeJS.ProcessEnv} env The environment.
 * @return {number} The exit code: 0 when the run may go on.
 */
export function main( env = process.env ) {
	const { ok, sha, message } = decide( {
		event: env.EVENT_NAME,
		ref: env.REF,
		mainSha: env.MAIN_SHA,
		rollbackSha: env.ROLLBACK_SHA,
		floor: env.ROLLBACK_FLOOR,
	} );
	console.log( ok ? message : `::error::${ escapeData( message ) }` );
	if ( ok && sha !== null ) {
		if ( ! env.GITHUB_OUTPUT ) {
			console.log( '::error::GITHUB_OUTPUT is not set, so the checked target cannot be handed to the next step. Nothing was deployed.' );
			return 1;
		}
		appendFileSync( env.GITHUB_OUTPUT, `sha=${ sha }\n` );
	}
	return ok ? 0 : 1;
}

// A value from the dispatch or from git, quoted and cut short, so it cannot
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
	'rollback-target.mjs could not tell whether it was run as the script, so it fails rather than pass without checking. Nothing was deployed.'
);
