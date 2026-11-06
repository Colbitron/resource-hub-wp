<?php
/**
 * The outcome of one revalidation request.
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Revalidation;

/**
 * What came back from one POST to the front end, or why none was made. Built by {@see Sender},
 * stored by {@see ResultStore}, logged by {@see PostHog}. It never holds the secret or any header.
 */
final class Result {
	/**
	 * The front end accepted the batch with a 200 and the contract's `{ "revalidated": [ … ] }` body.
	 */
	public const SENT = 'sent';

	/**
	 * Anything else: a non-200 response, a 200 with the wrong body, no response, or no configuration.
	 */
	public const FAILED = 'failed';

	/**
	 * The outcomes, one per branch the editor notice has to put into words.
	 */
	public const OK              = 'ok';
	public const BAD_BODY        = 'bad_body';
	public const BAD_REQUEST     = 'bad_request';
	public const UNAUTHORIZED    = 'unauthorized';
	public const SERVER_ERROR    = 'server_error';
	public const UNEXPECTED_CODE = 'unexpected_code';
	public const TIMEOUT         = 'timeout';
	public const TRANSPORT_ERROR = 'transport_error';
	public const NOT_CONFIGURED  = 'not_configured';
	public const NO_SINGLE_TYPE  = 'no_single_type';
	public const RESERVED_TYPE   = 'reserved_type_slug';
	public const ENCODE_ERROR    = 'encode_error';

	/**
	 * Every outcome, for the REST field's schema.
	 */
	public const OUTCOMES = array(
		self::OK,
		self::BAD_BODY,
		self::BAD_REQUEST,
		self::UNAUTHORIZED,
		self::SERVER_ERROR,
		self::UNEXPECTED_CODE,
		self::TIMEOUT,
		self::TRANSPORT_ERROR,
		self::NOT_CONFIGURED,
		self::NO_SINGLE_TYPE,
		self::RESERVED_TYPE,
		self::ENCODE_ERROR,
	);

	/**
	 * The message stored for a resource event held back because its `types` is not exactly one element.
	 */
	public const NO_SINGLE_TYPE_MESSAGE = 'Not sent: a resource needs exactly one type.';

	/**
	 * The message stored for a type term event held back because its slug decodes to a reserved word.
	 */
	public const RESERVED_TYPE_MESSAGE = 'Not sent: a type\'s slug cannot be topic or page.';

	/**
	 * The message stored for a 200 whose body is not a JSON object with a `revalidated` array.
	 */
	public const BAD_BODY_MESSAGE = 'The front end answered 200 but not with the expected body; check the front-end URL.';

	/**
	 * The message stored on a `not_configured` result when the cause is a secret that is set but breaks
	 * the rule in {@see Config::is_valid_secret()}. It names the rule, never the value.
	 */
	public const INVALID_SECRET_MESSAGE = 'The revalidation secret is set but is not 32 to 256 printable ASCII characters with no whitespace.';

	/**
	 * The message stored when the payload could not be encoded as JSON, so nothing was sent.
	 */
	public const ENCODE_ERROR_MESSAGE = 'Not sent: the events could not be encoded as JSON.';

	/**
	 * Bytes of a response body kept, before invalid UTF-8 in them is replaced.
	 */
	public const BODY_LIMIT = 1024;

	/**
	 * Constructor.
	 *
	 * @param string      $status      {@see Result::SENT} or {@see Result::FAILED}.
	 * @param string      $outcome     One of the outcome constants.
	 * @param int|null    $code        HTTP status code, or null when no response arrived.
	 * @param string      $body        Response body, already cut to about {@see Result::BODY_LIMIT} bytes by {@see Sender::cut()}.
	 * @param string|null $error       Transport error message when no response arrived, else null.
	 * @param int         $duration_ms Wall time of the request in milliseconds; 0 when none was made.
	 */
	public function __construct(
		public readonly string $status,
		public readonly string $outcome,
		public readonly ?int $code,
		public readonly string $body,
		public readonly ?string $error,
		public readonly int $duration_ms,
	) {
	}

	/**
	 * A result for a send that never happened because the front-end URL or the secret is unset, or the
	 * secret is invalid. An invalid secret is the one cause recorded, as
	 * {@see Result::INVALID_SECRET_MESSAGE} in `error`, so the admin screens can say where to look; an
	 * unset value leaves `error` null.
	 *
	 * @param bool $invalid_secret Whether the secret in force is set but breaks the rule.
	 */
	public static function not_configured( bool $invalid_secret = false ): self {
		return new self( self::FAILED, self::NOT_CONFIGURED, null, '', $invalid_secret ? self::INVALID_SECRET_MESSAGE : null, 0 );
	}

	/**
	 * A result for a resource event that was never sent because the resource does not have exactly one
	 * type, which the schema requires; sending it would earn a 400 for the whole batch.
	 */
	public static function no_single_type(): self {
		return new self( self::FAILED, self::NO_SINGLE_TYPE, null, '', self::NO_SINGLE_TYPE_MESSAGE, 0 );
	}

	/**
	 * A result for a `resource_type` term event that was never sent because the term's slug decodes
	 * to `topic` or `page`, which the schema refuses as a type; sending it would earn a 400 for the
	 * whole batch.
	 */
	public static function reserved_type(): self {
		return new self( self::FAILED, self::RESERVED_TYPE, null, '', self::RESERVED_TYPE_MESSAGE, 0 );
	}

	/**
	 * A result for a payload that `wp_json_encode()` could not encode, so no request was made.
	 */
	public static function encode_error(): self {
		return new self( self::FAILED, self::ENCODE_ERROR, null, '', self::ENCODE_ERROR_MESSAGE, 0 );
	}

	/**
	 * The fields {@see ResultStore} and {@see PostHog} record, as a plain array.
	 *
	 * @return array{status: string, outcome: string, code: int|null, body: string, error: string|null, duration_ms: int}
	 */
	public function to_array(): array {
		return array(
			'status'      => $this->status,
			'outcome'     => $this->outcome,
			'code'        => $this->code,
			'body'        => $this->body,
			'error'       => $this->error,
			'duration_ms' => $this->duration_ms,
		);
	}

	/**
	 * One plain sentence for WP-CLI output. The editor notice has its own wording in JavaScript.
	 */
	public function describe(): string {
		switch ( $this->outcome ) {
			case self::OK:
				return 'Revalidation accepted (200).';
			case self::BAD_BODY:
				return 'Revalidation failed: ' . lcfirst( self::BAD_BODY_MESSAGE );
			case self::BAD_REQUEST:
				return 'Revalidation rejected: the front end could not read the request (400).';
			case self::UNAUTHORIZED:
				return 'Revalidation rejected: the secret does not match (401).';
			case self::SERVER_ERROR:
				return 'Revalidation failed on the front end (500).';
			case self::UNEXPECTED_CODE:
				return sprintf( 'Revalidation got an unexpected response (%d).', $this->code ?? 0 );
			case self::TIMEOUT:
				return 'Revalidation timed out after 3 seconds.';
			case self::TRANSPORT_ERROR:
				return sprintf( 'Revalidation could not reach the front end: %s', $this->error ?? '' );
			case self::NO_SINGLE_TYPE:
				return 'Revalidation ' . lcfirst( self::NO_SINGLE_TYPE_MESSAGE );
			case self::RESERVED_TYPE:
				return 'Revalidation ' . lcfirst( self::RESERVED_TYPE_MESSAGE );
			case self::ENCODE_ERROR:
				return 'Revalidation ' . lcfirst( self::ENCODE_ERROR_MESSAGE );
			case self::NOT_CONFIGURED:
			default:
				return null !== $this->error
					? 'Revalidation skipped: the front-end URL or the secret is not configured. ' . $this->error
					: 'Revalidation skipped: the front-end URL or the secret is not configured.';
		}
	}
}
