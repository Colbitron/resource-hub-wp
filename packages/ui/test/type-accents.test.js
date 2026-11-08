/**
 * The type-accent table, `type-accents.json`, which the front end imports and
 * the plugin's build copies into `build/` for the related-resources block.
 *
 * `schemas.test.js` checks the schema against its fixtures; this checks the
 * table itself: that it passes the schema, and the rules a schema cannot
 * state, that no two rows share an ID, a slug or an accent. It also ties the
 * schema's accents to the stylesheets, so every accent the table may name is
 * a `--rh-mark-*` token and a `data-accent` rule in `card-labels.css`. Whether
 * the IDs are the CMS's is checked against the mock CMS's seed on the front
 * end (`apps/web/test/type-accents.test.ts`), and whether the plugin's copy is
 * this one by PHPUnit (`TypeAccentsTest`).
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const packageRoot = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const read = ( name ) => readFile( path.join( packageRoot, name ), 'utf8' );

const table = JSON.parse( await read( 'type-accents.json' ) );
const schemasDir = path.join( packageRoot, 'schemas' );
const schemas = await Promise.all(
	( await readdir( schemasDir ) )
		.filter( ( name ) => name.endsWith( '.schema.json' ) )
		.map( async ( name ) => JSON.parse( await readFile( path.join( schemasDir, name ), 'utf8' ) ) )
);
const schema = schemas.find( ( { $id } ) => $id.endsWith( '/type-accents.schema.json' ) );

const ajv = new Ajv2020( { strict: true, allErrors: true } );
addFormats( ajv );
for ( const data of schemas ) {
	ajv.addSchema( data );
}

describe( 'the type-accent table', () => {
	it( 'passes its schema', () => {
		const validate = ajv.getSchema( schema.$id );
		assert.ok( validate( table ), ajv.errorsText( validate.errors, { separator: '\n' } ) );
	} );

	for ( const key of [ 'id', 'slug', 'accent' ] ) {
		it( `gives no two rows the same ${ key }`, () => {
			const values = table.types.map( ( row ) => row[ key ] );
			assert.equal( new Set( values ).size, values.length, values.join( ', ' ) );
		} );
	}

	it( 'names only accents that are a mark token and a data-accent rule', async () => {
		const tokens = await read( 'tokens.css' );
		const labels = await read( 'card-labels.css' );
		for ( const accent of schema.$defs.accent.enum ) {
			assert.match( tokens, new RegExp( `--rh-mark-${ accent }:` ), `tokens.css has no --rh-mark-${ accent }` );
			assert.ok(
				labels.includes( `.rh-card__type[data-accent="${ accent }"]::before` ),
				`card-labels.css has no rule for data-accent="${ accent }"`
			);
		}
	} );
} );
