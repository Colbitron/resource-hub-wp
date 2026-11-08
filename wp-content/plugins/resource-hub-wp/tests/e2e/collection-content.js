/**
 * The content the collection specs render: a type, two topics and thirteen
 * published resources on the tests site, the newest featured with an image,
 * so the library has a lead, eleven rows under it and a second page.
 *
 * Fixed titles, dates and summaries, so the screenshot baselines move only
 * when the design does; the slugs carry a stamp, so a run that failed to
 * clean up never collides with the next. The lead's image is drawn here, a
 * 960×540 PNG of two flat colours, deterministic byte for byte, and uploaded
 * through the REST API, so the repository ships no binary fixture.
 *
 * Every resource is published with all four fields (a title, one type, a
 * topic and a summary), as `OneType` and `RequiredFields` require, through
 * `POST /wp/v2/resources`. `deleteCollection()` removes it all again.
 */
const { deflateSync } = require( 'node:zlib' );
const { mkdtempSync, writeFileSync, rmSync } = require( 'node:fs' );
const { tmpdir } = require( 'node:os' );
const path = require( 'node:path' );

/** How many resources: twelve to a page, so one more makes a second page. */
const COUNT = 13;

/** The titles, oldest first: the thirteenth is the newest, and the lead. */
const TITLES = [
	'Measuring what readers feel',
	'A field guide to object caching',
	'Revalidation without the wait',
	'Headless, but not headstrong',
	'The editor as the first reader',
	'Why a slug is the identity',
	'One type per resource, and why',
	'Tables that scroll, not pages',
	'Shipping a block theme in weeks',
	'The lockdown explained to a visitor',
	'Fonts that land before the text moves',
	'A contract in three schemas',
	'Caching and revalidation: the CDN view',
];

/**
 * A PNG of `width`×`height` pixels: a warm field with a darker band across
 * its lower third. One IDAT chunk of stored-and-deflated scanlines, each
 * with the `None` filter.
 *
 * @param {number} width  Pixels across.
 * @param {number} height Pixels down.
 * @return {Buffer} The file.
 */
function png( width, height ) {
	const rows = [];
	for ( let y = 0; y < height; y++ ) {
		const row = Buffer.alloc( 1 + width * 3 );
		const band = y > ( height * 2 ) / 3;
		for ( let x = 0; x < width; x++ ) {
			row[ 1 + x * 3 ] = band ? 0x1b : 0xff;
			row[ 2 + x * 3 ] = band ? 0x14 : 0x5a;
			row[ 3 + x * 3 ] = band ? 0x36 : 0x4f;
		}
		rows.push( row );
	}
	const ihdr = Buffer.alloc( 13 );
	ihdr.writeUInt32BE( width, 0 );
	ihdr.writeUInt32BE( height, 4 );
	ihdr[ 8 ] = 8; // bit depth
	ihdr[ 9 ] = 2; // truecolour
	return Buffer.concat( [
		Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] ),
		chunk( 'IHDR', ihdr ),
		chunk( 'IDAT', deflateSync( Buffer.concat( rows ) ) ),
		chunk( 'IEND', Buffer.alloc( 0 ) ),
	] );
}

/**
 * One PNG chunk: its length, type, data and CRC-32.
 *
 * @param {string} type The chunk type.
 * @param {Buffer} data The chunk's data.
 * @return {Buffer} The chunk.
 */
function chunk( type, data ) {
	const length = Buffer.alloc( 4 );
	length.writeUInt32BE( data.length, 0 );
	const typed = Buffer.concat( [ Buffer.from( type, 'ascii' ), data ] );
	const crc = Buffer.alloc( 4 );
	crc.writeUInt32BE( crc32( typed ), 0 );
	return Buffer.concat( [ length, typed, crc ] );
}

/**
 * CRC-32 as PNG uses it. Bit operations are the algorithm, so the rule
 * against them is off for this one function.
 *
 * @param {Buffer} buffer The bytes.
 * @return {number} The checksum, unsigned.
 */
/* eslint-disable no-bitwise */
function crc32( buffer ) {
	let crc = 0xffffffff;
	for ( const byte of buffer ) {
		crc ^= byte;
		for ( let bit = 0; bit < 8; bit++ ) {
			crc = crc & 1 ? ( crc >>> 1 ) ^ 0xedb88320 : crc >>> 1;
		}
	}
	return ( crc ^ 0xffffffff ) >>> 0;
}
/* eslint-enable no-bitwise */

/**
 * Creates the collection's content.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils The REST client.
 * @param {string}                                                      stamp        A run-unique suffix for the slugs.
 * @return {Promise<{type: Object, topics: Object[], media: Object, resources: Object[], lead: Object}>} What was made.
 */
async function createCollection( requestUtils, stamp ) {
	const type = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/resource_type',
		data: { name: 'Guide', slug: `e2e-guide-${ stamp }` },
	} );
	const topics = [];
	for ( const name of [ 'Caching', 'Accessibility' ] ) {
		topics.push(
			await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/resource_topic',
				data: {
					name,
					slug: `e2e-${ name.toLowerCase() }-${ stamp }`,
				},
			} )
		);
	}
	const [ featured ] = await requestUtils.rest( {
		path: '/wp/v2/resource_flag',
		params: { slug: 'featured' },
	} );

	const dir = mkdtempSync( path.join( tmpdir(), 'rh-lead-' ) );
	const file = path.join( dir, 'lead.png' );
	writeFileSync( file, png( 960, 540 ) );
	let media;
	try {
		media = await requestUtils.uploadMedia( file );
	} finally {
		rmSync( dir, { recursive: true, force: true } );
	}
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/media/${ media.id }`,
		data: { alt_text: 'Two flat colours, a warm field over a dark band' },
	} );

	const resources = [];
	for ( let i = 0; i < COUNT; i++ ) {
		const newest = i === COUNT - 1;
		resources.push(
			await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/resources',
				data: {
					title: TITLES[ i ],
					slug: `e2e-collection-${ i + 1 }-${ stamp }`,
					status: 'publish',
					date_gmt: `2026-10-${ String( i + 1 ).padStart( 2, '0' ) }T09:00:00`,
					resource_type: [ type.id ],
					// Odd ones on both topics, even ones on the first, so each topic lists a different set.
					resource_topic:
						i % 2 === 0
							? [ topics[ 0 ].id, topics[ 1 ].id ]
							: [ topics[ 0 ].id ],
					resource_flag: newest ? [ featured.id ] : [],
					featured_media: newest ? media.id : 0,
					meta: {
						summary: `What ${ TITLES[ i ].toLowerCase() } means for a small headless library, in a paragraph.`,
					},
				},
			} )
		);
	}

	return {
		type,
		topics,
		media,
		resources,
		lead: resources[ COUNT - 1 ],
	};
}

/**
 * Deletes what `createCollection()` made.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils The REST client.
 * @param {Awaited<ReturnType<typeof createCollection>>}                created      What was made.
 */
async function deleteCollection( requestUtils, created ) {
	for ( const resource of created.resources ) {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resources/${ resource.id }`,
			params: { force: true },
		} );
	}
	await requestUtils.deleteMedia( created.media.id );
	for ( const topic of created.topics ) {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/resource_topic/${ topic.id }`,
			params: { force: true },
		} );
	}
	await requestUtils.rest( {
		method: 'DELETE',
		path: `/wp/v2/resource_type/${ created.type.id }`,
		params: { force: true },
	} );
}

module.exports = { COUNT, TITLES, createCollection, deleteCollection };
