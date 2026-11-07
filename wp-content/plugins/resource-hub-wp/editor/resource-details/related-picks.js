/**
 * The related picks control for the "Resource details" panel.
 *
 * `related_picks` is the editor's ordered choice of related resources, as post
 * IDs; the related route puts them first and fills the rest from the
 * resource's topics (issue #50). This control is a search over published
 * resources and the ordered list of picks under it, with Move up, Move down
 * and Remove on each pick and no drag and drop. The parent panel owns the
 * meta: it hands the list in and gets the next list back, and saves it with
 * the post through the `meta.related_picks` edit, so every write goes through
 * the sanitizer and the auth callback the plugin registered. The server
 * deduplicates, drops the resource itself and caps the list at ten
 * (`MetaRules::sanitize_related_picks()`); this control mirrors those rules
 * so an editor never saves something the server will quietly change.
 *
 * The search is one debounced `getEntityRecords` call over published
 * resources, twenty at a time, leaving out the current resource and the picks
 * already made, and narrowed by two selects, type and topic, that default to
 * "Any". With nothing typed it lists the newest resources, so the selects work
 * before the first keystroke. `ComboboxControl` matches the typed text against
 * the option labels on its own as well, so a result the server matched on its
 * content alone and not its title is not shown; typing part of the title finds
 * it.
 *
 * A pick that is no longer published, or no longer exists, stays in the list,
 * because the meta keeps it and the route skips it at read time; it is shown
 * with a plain "Not published, skipped on the site" note, in words and not in
 * colour alone. The picks' records come from one `include` query over every
 * status the user can read, so a draft or private pick still shows its title.
 *
 * Accessibility: every button names its item ("Move up: 'X'", the visible
 * text first, so the name assistive technology hears starts with what a
 * sighted user sees), focus is put
 * back on a sensible element after a move or a remove, because React moves
 * the row's node and the browser drops focus from a moved node, and each
 * change in the order is spoken through `speak()` from `@wordpress/a11y`.
 */
import {
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import {
	BaseControl,
	Button,
	ComboboxControl,
	Flex,
	FlexBlock,
	FlexItem,
	SelectControl,
	Spinner,
} from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { decodeEntities } from '@wordpress/html-entities';
import { __, _n, sprintf } from '@wordpress/i18n';
// `@wordpress/a11y` is not installed in this package: the wp-scripts externals
// resolve it to core's `wp-a11y` script and list it in the asset file, which
// is what the dependency rule below cannot see.
// eslint-disable-next-line import/no-extraneous-dependencies
import { speak } from '@wordpress/a11y';

const POST_TYPE = 'resource';

// Mirrors MetaRules::RELATED_PICKS_MAX and the REST schema's maxItems.
export const RELATED_PICKS_MAX = 10;

// How long the search waits after the last keystroke before it asks the server.
const SEARCH_DELAY = 300;

const SEARCH_PER_PAGE = 20;

// One stable query object per taxonomy, so the store resolves each once.
const TYPES_QUERY = {
	per_page: -1,
	orderby: 'name',
	order: 'asc',
	_fields: 'id,name',
	context: 'view',
};
const TOPICS_QUERY = TYPES_QUERY;

const PICK_FIELDS = 'id,title,status,resource_type';

// One empty list for "no picks", so the selector's result is stable.
const NO_RECORDS = [];

/**
 * Keeps the typed text for SEARCH_DELAY before handing it on, so one request
 * follows a pause in typing instead of one per keystroke.
 *
 * @param {string} value The text as typed.
 * @return {string} The text as of the last pause.
 */
function useDebouncedValue( value ) {
	const [ debounced, setDebounced ] = useState( value );

	useEffect( () => {
		const timer = setTimeout( () => setDebounced( value ), SEARCH_DELAY );
		return () => clearTimeout( timer );
	}, [ value ] );

	return debounced;
}

/**
 * A pick's title for labels and announcements: the decoded title, or a
 * placeholder naming the ID when the record is gone or untitled.
 *
 * @param {Object|undefined} record The known record, if any.
 * @param {number}           id     The pick's post ID.
 * @return {string} The title.
 */
function titleOf( record, id ) {
	const title = record?.title?.rendered
		? decodeEntities( record.title.rendered ).trim()
		: '';

	if ( title ) {
		return title;
	}

	/* translators: %d: post ID. */
	return sprintf( __( 'Resource #%d', 'resource-hub' ), id );
}

/**
 * Moves the item at `from` to `to`, returning a new list.
 *
 * @param {number[]} list The list.
 * @param {number}   from Index to move from.
 * @param {number}   to   Index to move to.
 * @return {number[]} The reordered list.
 */
function move( list, from, to ) {
	const next = [ ...list ];
	const [ item ] = next.splice( from, 1 );
	next.splice( to, 0, item );
	return next;
}

/**
 * The control.
 *
 * @param {Object}                    props
 * @param {number[]}                  props.picks    The current list, from `meta.related_picks`.
 * @param {(picks: number[]) => void} props.onChange Called with the next list.
 */
export default function RelatedPicks( { picks, onChange } ) {
	const postId = useSelect(
		( select ) => select( editorStore ).getCurrentPostId(),
		[]
	);

	const [ search, setSearch ] = useState( '' );
	const [ typeFilter, setTypeFilter ] = useState( '' );
	const [ topicFilter, setTopicFilter ] = useState( '' );
	const debouncedSearch = useDebouncedValue( search );

	// Records by ID for the rows, kept across query changes so a row never
	// falls back to "loading" when a neighbour is added or removed. A pick
	// chosen from the search is stored from its search result at once; the
	// picks query corrects the map when it resolves and marks what it did not
	// return as missing.
	const [ known, setKnown ] = useState( () => new Map() );

	// Which element takes focus after the next change to the list.
	const pendingFocus = useRef( null );
	const buttons = useRef( new Map() );
	const searchWrapper = useRef( null );
	const capMessage = useRef( null );

	const atCap = picks.length >= RELATED_PICKS_MAX;

	// The group is named by its visible label and described by its help, the
	// way a control's label and help are, so `BaseControl` renders both.
	const baseId = useId();
	const labelId = `${ baseId }-label`;
	const helpId = `${ baseId }__help`;

	const searchQuery = useMemo( () => {
		const query = {
			status: 'publish',
			per_page: SEARCH_PER_PAGE,
			exclude: [ postId, ...picks ].filter( Boolean ),
			_fields: 'id,title,resource_type',
			context: 'view',
		};

		if ( debouncedSearch ) {
			query.search = debouncedSearch;
			query.orderby = 'relevance';
		}
		if ( typeFilter ) {
			query.resource_type = [ Number( typeFilter ) ];
		}
		if ( topicFilter ) {
			query.resource_topic = [ Number( topicFilter ) ];
		}

		return query;
	}, [ postId, picks, debouncedSearch, typeFilter, topicFilter ] );

	const picksQuery = useMemo(
		() => ( {
			include: picks,
			orderby: 'include',
			per_page: Math.max( picks.length, 1 ),
			// Every status an editor may read, so a draft or private pick
			// still shows its title; `any` leaves out only the trash.
			status: 'any',
			_fields: PICK_FIELDS,
			context: 'view',
		} ),
		[ picks ]
	);

	const { results, isSearching, pickRecords, types, topics } = useSelect(
		( select ) => {
			const { getEntityRecords, isResolving } = select( coreStore );
			const searchArgs = [ 'postType', POST_TYPE, searchQuery ];

			return {
				results: atCap ? null : getEntityRecords( ...searchArgs ),
				isSearching:
					! atCap && isResolving( 'getEntityRecords', searchArgs ),
				pickRecords:
					picks.length > 0
						? getEntityRecords( 'postType', POST_TYPE, picksQuery )
						: NO_RECORDS,
				types: getEntityRecords(
					'taxonomy',
					'resource_type',
					TYPES_QUERY
				),
				topics: getEntityRecords(
					'taxonomy',
					'resource_topic',
					TOPICS_QUERY
				),
			};
		},
		[ searchQuery, picksQuery, atCap, picks.length ]
	);

	// Fold a resolved picks query into the known records.
	useEffect( () => {
		if ( ! pickRecords ) {
			return;
		}

		setKnown( ( previous ) => {
			const next = new Map( previous );
			const returned = new Set();

			for ( const record of pickRecords ) {
				next.set( record.id, record );
				returned.add( record.id );
			}
			for ( const id of picksQuery.include ) {
				if ( ! returned.has( id ) ) {
					next.set( id, { id, missing: true } );
				}
			}

			return next;
		} );
	}, [ pickRecords, picksQuery ] );

	// After a change to the list, put focus where it belongs. The browser
	// drops focus from a node React moves, so even a move needs this.
	useLayoutEffect( () => {
		const target = pendingFocus.current;

		if ( ! target ) {
			return;
		}
		pendingFocus.current = null;

		let element = null;

		if ( target.kind === 'button' ) {
			element = buttons.current.get(
				`${ target.id }:${ target.action }`
			);
			if ( element?.getAttribute( 'aria-disabled' ) === 'true' ) {
				element = buttons.current.get(
					`${ target.id }:${ target.fallback }`
				);
			}
		} else if ( target.kind === 'search' ) {
			element = searchWrapper.current?.querySelector( 'input' );
		} else if ( target.kind === 'cap' ) {
			element = capMessage.current;
		}

		element?.focus();
	}, [ picks ] );

	const typeNames = useMemo(
		() =>
			new Map(
				( types ?? [] ).map( ( type ) => [
					type.id,
					decodeEntities( type.name ),
				] )
			),
		[ types ]
	);

	const typeNameFor = ( record ) =>
		( record?.resource_type ?? [] )
			.map( ( id ) => typeNames.get( id ) )
			.filter( Boolean )
			.join( ', ' );

	const options = useMemo(
		() =>
			( results ?? [] )
				.filter(
					( record ) =>
						record.id !== postId && ! picks.includes( record.id )
				)
				.map( ( record ) => {
					const typeName = typeNameFor( record );
					return {
						value: String( record.id ),
						label: typeName
							? sprintf(
									/* translators: 1: resource title, 2: type name. */
									__( '%1$s (%2$s)', 'resource-hub' ),
									titleOf( record, record.id ),
									typeName
								)
							: titleOf( record, record.id ),
					};
				} ),
		// typeNameFor reads only typeNames, which is listed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[ results, picks, postId, typeNames ]
	);

	const termOptions = ( terms ) => [
		{ label: __( 'Any', 'resource-hub' ), value: '' },
		...( terms ?? [] ).map( ( term ) => ( {
			label: decodeEntities( term.name ),
			value: String( term.id ),
		} ) ),
	];

	const add = ( value ) => {
		const id = Number( value );
		const record = ( results ?? [] ).find( ( item ) => item.id === id );

		// The combobox keeps its last highlighted suggestion and offers it
		// again on Enter, so a stale or repeated choice is ignored here.
		if ( ! record || picks.includes( id ) || id === postId || atCap ) {
			return;
		}

		setKnown( ( previous ) =>
			new Map( previous ).set( id, { ...record, status: 'publish' } )
		);

		const next = [ ...picks, id ];
		pendingFocus.current =
			next.length >= RELATED_PICKS_MAX
				? { kind: 'cap' }
				: { kind: 'search' };
		onChange( next );
	};

	const moveBy = ( index, offset ) => {
		const target = index + offset;

		if ( target < 0 || target >= picks.length ) {
			return;
		}

		const id = picks[ index ];
		const action = offset < 0 ? 'up' : 'down';
		pendingFocus.current = {
			kind: 'button',
			id,
			action,
			fallback: offset < 0 ? 'down' : 'up',
		};
		onChange( move( picks, index, target ) );

		const title = titleOf( known.get( id ), id );
		const position = target + 1;
		speak(
			offset < 0
				? sprintf(
						/* translators: 1: resource title, 2: new position, 3: number of picks. */
						__(
							"'%1$s' moved up to position %2$d of %3$d.",
							'resource-hub'
						),
						title,
						position,
						picks.length
					)
				: sprintf(
						/* translators: 1: resource title, 2: new position, 3: number of picks. */
						__(
							"'%1$s' moved down to position %2$d of %3$d.",
							'resource-hub'
						),
						title,
						position,
						picks.length
					),
			'polite'
		);
	};

	const remove = ( index ) => {
		const id = picks[ index ];
		const next = picks.filter( ( _, i ) => i !== index );
		const neighbour = next[ index ] ?? next[ index - 1 ];

		pendingFocus.current = neighbour
			? { kind: 'button', id: neighbour, action: 'remove' }
			: { kind: 'search' };
		onChange( next );

		speak(
			sprintf(
				/* translators: 1: resource title, 2: number of picks left. */
				_n(
					"'%1$s' removed. %2$d pick left.",
					"'%1$s' removed. %2$d picks left.",
					next.length,
					'resource-hub'
				),
				titleOf( known.get( id ), id ),
				next.length
			),
			'polite'
		);
	};

	const setButton = ( id, action ) => ( element ) => {
		const key = `${ id }:${ action }`;
		if ( element ) {
			buttons.current.set( key, element );
		} else {
			buttons.current.delete( key );
		}
	};

	const loadingPicks = picks.length > 0 && ! pickRecords;

	return (
		<div
			role="group"
			className="resource-hub-related-picks"
			aria-labelledby={ labelId }
			aria-describedby={ helpId }
		>
			<BaseControl
				__nextHasNoMarginBottom
				id={ baseId }
				help={ sprintf(
					/* translators: %d: maximum number of picks. */
					__(
						'Up to %d published resources shown first in the related list on the site, in this order. Resources in the same topics fill the rest.',
						'resource-hub'
					),
					RELATED_PICKS_MAX
				) }
			>
				<BaseControl.VisualLabel id={ labelId }>
					{ __( 'Related picks', 'resource-hub' ) }
				</BaseControl.VisualLabel>
			</BaseControl>

			{ atCap ? (
				<p
					ref={ capMessage }
					tabIndex={ -1 }
					className="resource-hub-related-picks__cap"
				>
					{ sprintf(
						/* translators: %d: maximum number of picks. */
						__(
							'%d picks is the most a resource can have. Remove one to add another.',
							'resource-hub'
						),
						RELATED_PICKS_MAX
					) }
				</p>
			) : (
				<div ref={ searchWrapper }>
					<Flex align="flex-start" gap={ 2 }>
						<FlexBlock>
							<SelectControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								label={ __( 'Filter by type', 'resource-hub' ) }
								value={ typeFilter }
								options={ termOptions( types ) }
								onChange={ setTypeFilter }
							/>
						</FlexBlock>
						<FlexBlock>
							<SelectControl
								__next40pxDefaultSize
								__nextHasNoMarginBottom
								label={ __(
									'Filter by topic',
									'resource-hub'
								) }
								value={ topicFilter }
								options={ termOptions( topics ) }
								onChange={ setTopicFilter }
							/>
						</FlexBlock>
					</Flex>
					<ComboboxControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Add a pick', 'resource-hub' ) }
						placeholder={ __( 'Search resources', 'resource-hub' ) }
						value={ null }
						options={ options }
						isLoading={ isSearching }
						onFilterValueChange={ setSearch }
						onChange={ add }
						messages={ {
							selected: sprintf(
								/* translators: %d: the new pick's position. */
								__( 'Added as pick %d.', 'resource-hub' ),
								picks.length + 1
							),
						} }
					/>
				</div>
			) }

			{ loadingPicks && known.size === 0 && <Spinner /> }

			{ picks.length > 0 && (
				<ol
					className="resource-hub-related-picks__list"
					aria-label={ __( 'Picks, in order', 'resource-hub' ) }
				>
					{ picks.map( ( id, index ) => {
						const record = known.get( id );
						const title = titleOf( record, id );
						const typeName = typeNameFor( record );
						const skipped =
							record &&
							( record.missing || record.status !== 'publish' );

						return (
							<li
								key={ id }
								className="resource-hub-related-picks__item"
							>
								<div>
									<strong>{ title }</strong>
									{ typeName && <span> ({ typeName })</span> }
								</div>
								{ skipped && (
									<p className="resource-hub-related-picks__note">
										{ __(
											'Not published, skipped on the site.',
											'resource-hub'
										) }
									</p>
								) }
								<Flex justify="flex-start" gap={ 1 }>
									<FlexItem>
										<Button
											ref={ setButton( id, 'up' ) }
											size="compact"
											variant="tertiary"
											accessibleWhenDisabled
											disabled={ index === 0 }
											label={ sprintf(
												/* translators: %s: resource title. */
												__(
													"Move up: '%s'",
													'resource-hub'
												),
												title
											) }
											showTooltip={ false }
											onClick={ () =>
												moveBy( index, -1 )
											}
										>
											{ __( 'Move up', 'resource-hub' ) }
										</Button>
									</FlexItem>
									<FlexItem>
										<Button
											ref={ setButton( id, 'down' ) }
											size="compact"
											variant="tertiary"
											accessibleWhenDisabled
											disabled={
												index === picks.length - 1
											}
											label={ sprintf(
												/* translators: %s: resource title. */
												__(
													"Move down: '%s'",
													'resource-hub'
												),
												title
											) }
											showTooltip={ false }
											onClick={ () => moveBy( index, 1 ) }
										>
											{ __(
												'Move down',
												'resource-hub'
											) }
										</Button>
									</FlexItem>
									<FlexItem>
										<Button
											ref={ setButton( id, 'remove' ) }
											size="compact"
											variant="tertiary"
											isDestructive
											label={ sprintf(
												/* translators: %s: resource title. */
												__(
													"Remove: '%s'",
													'resource-hub'
												),
												title
											) }
											showTooltip={ false }
											onClick={ () => remove( index ) }
										>
											{ __( 'Remove', 'resource-hub' ) }
										</Button>
									</FlexItem>
								</Flex>
							</li>
						);
					} ) }
				</ol>
			) }
		</div>
	);
}
