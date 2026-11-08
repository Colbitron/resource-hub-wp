/**
 * One seeded resource page for the theme's parity and screenshot specs: a
 * type, a topic, a featured image, two resources sharing the topic, one of
 * them an editor's pick, and the host resource with a summary, a source and a
 * body. Every text, date and colour is fixed, so a screenshot of the page
 * moves only when the design does; the slugs carry a stamp, so two runs or
 * two specs never collide on a slug.
 *
 * The image is drawn here rather than committed as a file: a flat colour, so
 * the plate, the corners and the column's width show in the baseline, and no
 * binary sits in the repository for it.
 */
const zlib = require( 'node:zlib' );

/** The host's publish date and the two related resources', newest first: the pick is the older. */
const HOST_DATE = '2026-11-01T09:30:00';
const TOPIC_MATCH_DATE = '2026-10-15T08:00:00';
const PICK_DATE = '2026-10-01T08:00:00';

/** The host's body: one of each thing prose.css styles that a resource usually has. */
const CONTENT = [
	'<!-- wp:paragraph --><p>An opening paragraph with <a href="/resources/">a link to the library</a>, long enough to run past the measure on a wide screen, so the column shows.</p><!-- /wp:paragraph -->',
	'<!-- wp:heading --><h2 class="wp-block-heading">A section heading</h2><!-- /wp:heading -->',
	'<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>One item</li><!-- /wp:list-item --><!-- wp:list-item --><li>Another item</li><!-- /wp:list-item --></ul><!-- /wp:list -->',
	'<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>A quoted line.</p><!-- /wp:paragraph --><cite>Someone</cite></blockquote><!-- /wp:quote -->',
].join( '\n\n' );

/**
 * A PNG of one colour, `width` by `height`, as a buffer.
 *
 * @param {number}                   width  Pixels.
 * @param {number}                   height Pixels.
 * @param {[number, number, number]} rgb    The colour.
 * @return {Buffer} The file.
 */
function flatPng( width, height, rgb ) {
	const chunk = ( type, data ) => {
		const length = Buffer.alloc( 4 );
		length.writeUInt32BE( data.length );
		const typed = Buffer.concat( [ Buffer.from( type, 'ascii' ), data ] );
		const crc = Buffer.alloc( 4 );
		crc.writeUInt32BE( zlib.crc32( typed ) );
		return Buffer.concat( [ length, typed, crc ] );
	};
	const header = Buffer.alloc( 13 );
	header.writeUInt32BE( width, 0 );
	header.writeUInt32BE( height, 4 );
	// 8 bits a channel, truecolour, deflate, no filter, no interlace.
	header.set( [ 8, 2, 0, 0, 0 ], 8 );
	// Each row: the filter byte (none), then the pixels.
	const row = Buffer.alloc( 1 + width * 3 );
	for ( let x = 0; x < width; x++ ) {
		row.set( rgb, 1 + x * 3 );
	}
	const raw = Buffer.concat( Array.from( { length: height }, () => row ) );
	return Buffer.concat( [
		Buffer.from( [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ] ),
		chunk( 'IHDR', header ),
		chunk( 'IDAT', zlib.deflateSync( raw ) ),
		chunk( 'IEND', Buffer.alloc( 0 ) ),
	] );
}

/**
 * Seeds the page. A published resource needs a title, one type, a topic and
 * a summary (OneType, RequiredFields), so every resource gets all four.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils The tests site.
 * @return {Promise<{type: Object, topic: Object, media: Object, pick: Object, match: Object, host: Object}>} What was made, each as REST returned it.
 */
async function seedResourcePage( requestUtils ) {
	const stamp = Date.now();
	const type = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/resource_type',
		data: { name: 'Sample type', slug: `sample-type-${ stamp }` },
	} );
	const topic = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/resource_topic',
		data: { name: 'Sample topic', slug: `sample-topic-${ stamp }` },
	} );
	const media = await requestUtils.uploadMedia( {
		name: `sample-featured-${ stamp }.png`,
		mimeType: 'image/png',
		buffer: flatPng( 1200, 675, [ 0x6b, 0x9e, 0x9a ] ),
	} );
	const resource = ( data ) =>
		requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/resources',
			data: {
				status: 'publish',
				resource_type: [ type.id ],
				resource_topic: [ topic.id ],
				...data,
			},
		} );
	const pick = await resource( {
		title: 'The editor’s pick',
		slug: `sample-pick-${ stamp }`,
		date_gmt: PICK_DATE,
		meta: { summary: 'A resource the editor chose to show first.' },
	} );
	const match = await resource( {
		title: 'The newest in the topic',
		slug: `sample-match-${ stamp }`,
		date_gmt: TOPIC_MATCH_DATE,
		meta: { summary: 'A resource that shares the topic.' },
	} );
	const host = await resource( {
		title: 'A sample resource',
		slug: `sample-resource-${ stamp }`,
		date_gmt: HOST_DATE,
		content: CONTENT,
		featured_media: media.id,
		meta: {
			summary:
				'A summary of the resource, a step larger than the body and in the muted ink.',
			source_url: 'https://example.com/downloads/sample-guide.pdf',
			related_picks: [ pick.id ],
		},
	} );
	return { type, topic, media, pick, match, host };
}

/**
 * Deletes what `seedResourcePage()` made, resources before their terms.
 *
 * @param {import('@wordpress/e2e-test-utils-playwright').RequestUtils} requestUtils The tests site.
 * @param {Object}                                                      seed         What `seedResourcePage()` returned.
 */
async function deleteResourcePage( requestUtils, seed ) {
	const remove = ( path ) =>
		requestUtils.rest( {
			method: 'DELETE',
			path,
			params: { force: true },
		} );
	for ( const resource of [ seed.host, seed.match, seed.pick ] ) {
		if ( resource ) {
			await remove( `/wp/v2/resources/${ resource.id }` );
		}
	}
	if ( seed.media ) {
		await remove( `/wp/v2/media/${ seed.media.id }` );
	}
	if ( seed.topic ) {
		await remove( `/wp/v2/resource_topic/${ seed.topic.id }` );
	}
	if ( seed.type ) {
		await remove( `/wp/v2/resource_type/${ seed.type.id }` );
	}
}

module.exports = { seedResourcePage, deleteResourcePage, flatPng };
