<?php
/**
 * Every stored outcome in plain words, and the stale-pending display (ADR 0018).
 *
 * @package ResourceHub
 */

declare(strict_types=1);

namespace ResourceHub\Tests\Admin;

use ResourceHub\Admin\ResultText;
use ResourceHub\Revalidation\Result;
use ResourceHub\Revalidation\ResultStore;
use WP_UnitTestCase;

/**
 * Tests for {@see ResultText}.
 */
final class ResultTextTest extends WP_UnitTestCase {
	/**
	 * A record as {@see ResultStore} writes it, with overrides.
	 *
	 * @param array<string, mixed> $overrides Fields to change.
	 * @return array<string, mixed>
	 */
	public static function record( array $overrides = array() ): array {
		return $overrides + array(
			'status'      => Result::FAILED,
			'outcome'     => Result::SERVER_ERROR,
			'code'        => 500,
			'event'       => 'update',
			'time'        => gmdate( 'Y-m-d\TH:i:s\Z', 1_800_000_000 ),
			'batch_id'    => 'b1',
			'others'      => 0,
			'body'        => '',
			'error'       => null,
			'duration_ms' => 12,
		);
	}

	/**
	 * Each outcome has its own label and sentence, and only `ok` is a success.
	 *
	 * @dataProvider outcomes
	 *
	 * @param string $status   Stored status.
	 * @param string $outcome  Stored outcome.
	 * @param string $label    Expected label.
	 * @param string $sentence Expected sentence.
	 * @param string $level    Expected level.
	 */
	public function test_every_outcome_has_words( string $status, string $outcome, string $label, string $sentence, string $level ): void {
		$record = self::record(
			array(
				'status'  => $status,
				'outcome' => $outcome,
				'code'    => Result::UNEXPECTED_CODE === $outcome ? 302 : null,
				'error'   => Result::TRANSPORT_ERROR === $outcome ? 'cURL error 6: Could not resolve host' : null,
			)
		);

		$this->assertSame( $label, ResultText::label( $record, 1_800_000_000 ) );
		$this->assertSame( $sentence, ResultText::sentence( $record, 1_800_000_000 ) );
		$this->assertSame( $level, ResultText::level( $record ) );
	}

	/**
	 * Cases for test_every_outcome_has_words(): every outcome {@see Result} defines, plus pending.
	 *
	 * @return array<string, array{0: string, 1: string, 2: string, 3: string, 4: string}>
	 */
	public function outcomes(): array {
		return array(
			'pending'         => array( ResultStore::PENDING, ResultStore::PENDING, 'Pending', 'Revalidation is pending: no answer has arrived from the front end yet.', 'warning' ),
			'ok'              => array( Result::SENT, Result::OK, 'Accepted', 'The front end accepted the revalidation (200).', 'success' ),
			'bad_body'        => array( Result::FAILED, Result::BAD_BODY, 'Failed: unexpected body', 'Revalidation failed: the front end answered 200 but not with the expected body. Check the front-end URL.', 'error' ),
			'bad_request'     => array( Result::FAILED, Result::BAD_REQUEST, 'Rejected (400)', 'Revalidation rejected: the front end could not read the request (400).', 'error' ),
			'unauthorized'    => array( Result::FAILED, Result::UNAUTHORIZED, 'Rejected (401)', 'Revalidation rejected: the secret does not match (401).', 'error' ),
			'server_error'    => array( Result::FAILED, Result::SERVER_ERROR, 'Failed (500)', 'Revalidation failed on the front end (500).', 'error' ),
			'unexpected_code' => array( Result::FAILED, Result::UNEXPECTED_CODE, 'Unexpected response (302)', 'Revalidation got an unexpected response (302).', 'error' ),
			'timeout'         => array( Result::FAILED, Result::TIMEOUT, 'Timed out', 'Revalidation timed out: the front end did not answer within 3 seconds.', 'error' ),
			'transport_error' => array( Result::FAILED, Result::TRANSPORT_ERROR, 'Could not reach the front end', 'Revalidation could not reach the front end. cURL error 6: Could not resolve host', 'error' ),
			'not_configured'  => array( Result::FAILED, Result::NOT_CONFIGURED, 'Not configured', 'Revalidation skipped: the front-end URL or the secret is not configured.', 'error' ),
			'no_single_type'  => array( Result::FAILED, Result::NO_SINGLE_TYPE, 'Not sent: needs one type', 'Revalidation not sent: a resource needs exactly one type.', 'error' ),
			'encode_error'    => array( Result::FAILED, Result::ENCODE_ERROR, 'Not sent: encoding error', 'Revalidation not sent: the events could not be encoded as JSON.', 'error' ),
		);
	}

	/**
	 * The outcome list above covers every outcome {@see Result} defines, so a new one cannot go unworded.
	 */
	public function test_every_defined_outcome_is_covered(): void {
		$covered = array_map( static fn( array $row ): string => $row[1], $this->outcomes() );

		$this->assertSame( array(), array_diff( Result::OUTCOMES, $covered ) );
	}

	/**
	 * The sentences map is the one source both PHP and the block editor read: it has a sentence for
	 * every outcome plus the keys the editor's script uses, and `sentence()` takes its words from it.
	 */
	public function test_sentences_are_the_one_source(): void {
		$sentences = ResultText::sentences();

		foreach ( array_merge( Result::OUTCOMES, array( ResultStore::PENDING, 'stale', 'failed', 'no_answer' ) ) as $key ) {
			$this->assertArrayHasKey( $key, $sentences );
			$this->assertNotSame( '', $sentences[ $key ] );
		}

		$this->assertSame( $sentences[ Result::NOT_CONFIGURED ], ResultText::sentence( self::record( array( 'outcome' => Result::NOT_CONFIGURED ) ) ) );
		$this->assertSame( $sentences['failed'], ResultText::sentence( self::record( array( 'outcome' => 'no_answer' ) ) ), 'A non-outcome key is not an outcome.' );
		$this->assertSame( $sentences['failed'], ResultText::sentence( self::record( array( 'outcome' => 'something_new' ) ) ) );
	}

	/**
	 * A record that travelled with other changes says how many, after any error detail.
	 */
	public function test_sentence_counts_the_other_changes(): void {
		$one = self::record(
			array(
				'status'  => Result::SENT,
				'outcome' => Result::OK,
				'others'  => 1,
			)
		);
		$this->assertSame( 'The front end accepted the revalidation (200). It was sent with 1 other change.', ResultText::sentence( $one ) );

		$many = self::record(
			array(
				'outcome' => Result::BAD_REQUEST,
				'body'    => '{"error":"bad"}',
				'others'  => 4,
			)
		);
		$this->assertSame( 'Revalidation rejected: the front end could not read the request (400). bad It was sent with 4 other changes.', ResultText::sentence( $many ) );
	}

	/**
	 * A 400 or 500 quotes the front end's `error` string from its JSON body, never the body itself,
	 * and says nothing extra when the body is not that JSON.
	 */
	public function test_sentence_quotes_the_body_error_string(): void {
		$json = self::record(
			array(
				'outcome' => Result::BAD_REQUEST,
				'code'    => 400,
				'body'    => '{"error":"events[0].types must have exactly one element"}',
			)
		);
		$this->assertSame( 'Revalidation rejected: the front end could not read the request (400). events[0].types must have exactly one element', ResultText::sentence( $json ) );

		$html = self::record( array( 'body' => '<html><body>Internal Server Error</body></html>' ) );
		$this->assertSame( 'Revalidation failed on the front end (500).', ResultText::sentence( $html ) );

		$cut = self::record( array( 'body' => '{"error":"a very long message that was cut' ) );
		$this->assertSame( 'Revalidation failed on the front end (500).', ResultText::sentence( $cut ) );
	}

	/**
	 * A `pending` older than the threshold reads as "no answer recorded" in the label and the sentence;
	 * a fresh one reads as pending. The threshold is five minutes, and the record is not rewritten.
	 */
	public function test_stale_pending(): void {
		$this->assertSame( 300, ResultText::STALE_PENDING_SECONDS );

		$pending = self::record(
			array(
				'status'  => ResultStore::PENDING,
				'outcome' => ResultStore::PENDING,
				'code'    => null,
			)
		);
		$written = 1_800_000_000;

		$this->assertFalse( ResultText::is_stale_pending( $pending, $written + 299 ) );
		$this->assertSame( 'Pending', ResultText::label( $pending, $written + 299 ) );

		$this->assertTrue( ResultText::is_stale_pending( $pending, $written + 301 ) );
		$this->assertSame( 'No answer recorded', ResultText::label( $pending, $written + 301 ) );
		$this->assertSame( 'No answer recorded: the send may not have run.', ResultText::sentence( $pending, $written + 301 ) );
		$this->assertSame( 'warning', ResultText::level( $pending ) );

		$no_time = self::record(
			array(
				'status'  => ResultStore::PENDING,
				'outcome' => ResultStore::PENDING,
				'time'    => '',
			)
		);
		$this->assertTrue( ResultText::is_stale_pending( $no_time, $written ) );

		$failed = self::record();
		$this->assertFalse( ResultText::is_stale_pending( $failed, $written + 10_000 ) );
	}

	/**
	 * Times come from the record's UTC `time`: relative to now, and in the site's format and timezone.
	 */
	public function test_times(): void {
		update_option( 'timezone_string', 'Europe/London' );
		update_option( 'date_format', 'Y-m-d' );
		update_option( 'time_format', 'H:i' );

		$record = self::record( array( 'time' => '2027-01-15T10:00:00Z' ) );
		$at     = (int) strtotime( '2027-01-15T10:00:00Z' );

		$this->assertSame( $at, ResultText::timestamp( $record ) );
		$this->assertSame( '5 minutes ago', ResultText::relative_time( $record, $at + 300 ) );
		$this->assertSame( '2027-01-15 10:00', ResultText::local_time( $record ) );

		$this->assertNull( ResultText::timestamp( self::record( array( 'time' => 'not a time' ) ) ) );
		$this->assertSame( '', ResultText::relative_time( self::record( array( 'time' => '' ) ) ) );
	}
}
