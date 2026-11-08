// Whether a .depot/scripts module is the script node was asked to run, for
// the scripts a workflow step runs and a test imports: ci-result.mjs, which
// decides CI / CI result, and host-php-floor.mjs, which guards the deploy.
// Both export main() for their tests and run it only as the script.
//
// It fails closed. A step whose script never called main() exits 0, which
// GitHub reads as a pass with no verdict behind it, so anything short of
// positive evidence either way is an error that exits 1:
//
//   run    argv[1] and the module resolve to the same realpath
//   skip   they resolve to different realpaths: a test, or another script,
//          imported the module
//   error  argv[1] is missing, or either path cannot be resolved
//
// argv[1] is missing only when node runs no file (`-e`, `-p`, stdin, the
// REPL, or a module preloaded with --import), and none of those is how a
// test loads these modules: node --test sets it to the test file, with or
// without --test-isolation=none. So a step that ran a script that way fails
// rather than passes, at the cost that importing one from the REPL prints an
// ::error:: and sets the exit code to 1.
//
// Both sides are compared as realpaths, since node loads the main module
// through argv[1]'s realpath (unless --preserve-symlinks-main): with a
// symlink in the checkout's path a plain comparison would be false, main()
// would never run, and the step would exit 0.
//
// Tested through both scripts: ci-result.test.mjs holds this decision's own
// cases, and each script's tests run it as a subprocess, so the scope job's
// existing test steps cover this file without a step of its own.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Whether the module at `self` is the script node was asked to run.
 *
 * @param {string|undefined} argv1    The script path node was given, process.argv[1].
 * @param {string}           self     The module's file path.
 * @param {(path: string) => string} realpath Resolves a path.
 * @return {'run'|'skip'|'error'} Run main(), stay a module, or fail.
 */
export function entryPoint( argv1, self, realpath = realpathSync ) {
	if ( typeof argv1 !== 'string' || argv1 === '' ) {
		return 'error';
	}
	try {
		return realpath( argv1 ) === realpath( self ) ? 'run' : 'skip';
	} catch {
		return 'error';
	}
}

/**
 * Runs main() and sets the exit code when the module at `moduleUrl` is the
 * script node was asked to run; prints an ::error:: and sets the exit code
 * to 1 when that cannot be told; does nothing when the module was imported.
 *
 * @param {string}       moduleUrl The module's import.meta.url.
 * @param {() => number} main      The script; returns its exit code.
 * @param {string}       failure   The ::error:: message, a constant: it is printed as is.
 */
export function runAsScript( moduleUrl, main, failure ) {
	switch ( entryPoint( process.argv[ 1 ], fileURLToPath( moduleUrl ) ) ) {
		case 'run':
			process.exitCode = main();
			break;
		case 'error':
			console.log( `::error::${ failure }` );
			process.exitCode = 1;
			break;
	}
}
