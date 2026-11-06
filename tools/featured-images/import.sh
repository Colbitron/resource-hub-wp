#!/usr/bin/env bash
#
# Sets each seeded resource's featured image from artifacts/featured-images/.
#
# Idempotent: a resource that already has a featured image is skipped unless
# --force is given, in which case a new attachment is set and the old one is
# left in the media library. A slug with no published resource gets a warning
# and is counted as "skipped (no post)": a site seeded with fewer than the whole
# catalogue is normal. The run exits non-zero only for a real failure: a WP-CLI
# or SSH error, an import that fails, a catalogue slug with no PNG (checked
# before anything is staged), or a run that set nothing and found nothing
# already set, which means a wrong --wp-path or an unseeded site. Alt text is
# left empty on purpose: the images are decorative beside a printed title.
#
# After each image is set, the resource is saved again through wp_update_post()
# with no changes, so the plugin's revalidation hook sends an `update` event and
# the front end's cached pages pick the image up; the plugin's own result line
# is printed. --no-revalidate skips that; --revalidate-only does only that, for
# every catalogue slug with a post, images untouched. The save bumps the
# resource's modified date, as any editor save does. RH_WP_USER, when set, runs
# the save as that user (login or ID); the seeded bodies survive kses without one.
#
# Targets:
#   import.sh local [--force | --revalidate-only] [--no-revalidate] [--dir DIR]
#       The wp-env of this checkout. Files are staged inside the WordPress
#       directory wp-env bind-mounts, imported with the cli container's wp, and
#       the staging directory is removed again.
#   import.sh host --ssh USER@HOST --wp-path /abs/wordpress/root [same flags]
#       A remote site over SSH: tar the files into a mktemp directory under
#       the host's /tmp over ssh (no scp, whose SFTP a host may chroot away
#       from the shell's /tmp), run there with the host's wp, delete the
#       directory. --ssh and
#       --wp-path default to the RH_SSH_TARGET and RH_WP_PATH environment
#       variables; RH_WP_BIN names the wp binary on the host (one path, no
#       arguments) when it is not on PATH. Nothing is hard-coded.
#   import.sh run --dir DIR --wp-path PATH [same flags]
#       The worker the two targets invoke where `wp` runs. DIR holds the PNGs
#       and a slugs.txt (one slug per line) naming which to import; without
#       slugs.txt every <slug>.png except contact-sheet.png is taken.
#
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SCRIPT")/../.." && pwd)"
DEFAULT_DIR="$ROOT/artifacts/featured-images"
SEEDER="$ROOT/wp-content/plugins/resource-hub-wp/src/Seed/Seeder.php"
STAGE_NAME=".rh-featured-images"

usage() {
	# The header comment above, up to the first line that is not a comment.
	awk 'NR > 1 && !/^#/ { exit } NR > 1 { sub(/^# ?/, ""); print }' "$SCRIPT"
	exit "${1:-1}"
}

log() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# What the EXIT trap removes: a local staging directory, or a remote one. The
# trap keeps the run's own exit status; a cleanup that fails only warns and
# names what was left behind.
CLEANUP_LOCAL=""
CLEANUP_REMOTE=""
CLEANUP_TARGET=""
cleanup() {
	local status="$1"
	set +e
	if [ -n "$CLEANUP_LOCAL" ]; then
		rm -rf "$CLEANUP_LOCAL" || warn "could not remove $CLEANUP_LOCAL; delete it by hand"
	fi
	if [ -n "$CLEANUP_REMOTE" ]; then
		ssh -- "$CLEANUP_TARGET" "rm -rf $(printf '%q' "$CLEANUP_REMOTE")" \
			|| warn "could not remove $CLEANUP_TARGET:$CLEANUP_REMOTE; delete it by hand"
	fi
	exit "$status"
}
trap 'cleanup $?' EXIT

# --------------------------------------------------------------------- run

# Reads DIR/slugs.txt (one slug per line, a last line without a newline
# included) or, without it, every <slug>.png except contact-sheet.png.
read_slugs() {
	local dir="$1" slug file
	if [ -f "$dir/slugs.txt" ]; then
		while IFS= read -r slug || [ -n "$slug" ]; do
			[ -n "$slug" ] && printf '%s\n' "$slug"
		done < "$dir/slugs.txt"
	else
		shopt -s nullglob
		for file in "$dir"/*.png; do
			slug="$(basename "$file" .png)"
			[ "$slug" = "contact-sheet" ] || printf '%s\n' "$slug"
		done
		shopt -u nullglob
	fi
}

run_import() {
	local dir="$1" wp_path="$2" force="$3" revalidate="$4" revalidate_only="$5" wp_bin="${RH_WP_BIN:-wp}"
	[ -d "$dir" ] || die "no such directory: $dir"
	command -v "$wp_bin" >/dev/null 2>&1 || die "wp not found (set RH_WP_BIN to the binary's path)"

	# `command` keeps this from calling itself when the binary is also named wp.
	wp() { command "$wp_bin" --path="$wp_path" "$@"; }

	# The ID of the one resource with this slug in the given statuses, empty when
	# there is none; exits non-zero on a lookup error or output that is not an ID
	# (a PHP notice on stdout, say).
	resource_id() {
		local slug="$1" statuses="$2" out
		out="$(wp post list --post_type=resource --post_status="$statuses" --name="$slug" --orderby=ID --order=DESC --field=ID)" || return 1
		out="${out%%$'\n'*}"
		case "$out" in
			*[!0-9]*) printf '%s\n' "$out" >&2; return 1 ;;
		esac
		printf '%s\n' "$out"
	}

	# "WxH, N sizes" when WordPress decoded the attachment, "none" when it did
	# not (a damaged file keeps its header's dimensions but gets no generated
	# sizes); exits non-zero when the metadata could not be read at all.
	attachment_sizes() {
		local out
		out="$(wp eval "\$m = wp_get_attachment_metadata( $1 ); echo ( \$m && ! empty( \$m['width'] ) && ! empty( \$m['height'] ) && ! empty( \$m['sizes'] ) ) ? \$m['width'] . 'x' . \$m['height'] . ', ' . count( \$m['sizes'] ) . ' sizes' : 'none';")" || return 1
		case "$out" in
			none|[0-9]*x[0-9]*' sizes') printf '%s\n' "$out" ;;
			*) return 1 ;;
		esac
	}

	# A no-op save of a resource through wp_update_post(), so the plugin's hook
	# sends an `update` event. The post is read again first and saved only while
	# it is still a published resource: an editor may have drafted or trashed it
	# since the lookup, and a save naming a status would publish it again. The
	# first line of stdout is the marker, "rh:saved" or "rh:not-published"; the
	# plugin prints its result at shutdown, after it, as a log line on stdout
	# when the batch was accepted and as a warning on stderr otherwise.
	revalidate_post() {
		local as_user=()
		[ -n "${RH_WP_USER:-}" ] && as_user=(--user="$RH_WP_USER")
		wp ${as_user[@]+"${as_user[@]}"} eval "\$p = get_post( $1 ); if ( ! \$p || 'resource' !== \$p->post_type || 'publish' !== \$p->post_status ) { echo \"rh:not-published\\n\"; exit; } \$r = wp_update_post( array( 'ID' => $1 ), true ); if ( is_wp_error( \$r ) ) { fwrite( STDERR, \$r->get_error_message() . \"\\n\" ); exit( 1 ); } echo \"rh:saved\\n\";"
	}

	# Runs revalidate_post for a slug and logs the outcome. Returns 0 when the
	# plugin logged an accepted batch (its line is shown), 3 when the save went
	# through but the plugin warned instead (the warning is on stderr above, and
	# in _rh_last_revalidation), 2 when the resource is no longer published, and
	# 1 when the save itself failed.
	revalidate_slug() {
		local slug="$1" id="$2" output marker rest
		output="$(revalidate_post "$id")" || { log "failed   $slug (#$id): the revalidation save failed"; return 1; }
		marker="${output%%$'\n'*}"
		rest="${output#*$'\n'}"
		[ "$rest" = "$output" ] && rest=""
		case "$marker" in
			rh:saved)
				if [ -n "$rest" ]; then
					log "saved    $slug (#$id): $rest"
				else
					log "warning  $slug (#$id): saved, but the plugin reported a problem (its warning is above, and in _rh_last_revalidation)"
					return 3
				fi ;;
			rh:not-published) log "warning  $slug (#$id): no longer a published resource, revalidation skipped"; return 2 ;;
			*) log "failed   $slug (#$id): unexpected save output: $output"; return 1 ;;
		esac
	}

	local slugs=() slug
	while IFS= read -r slug; do slugs+=("$slug"); done < <(read_slugs "$dir")
	[ "${#slugs[@]}" -gt 0 ] || die "nothing to import: $dir has no slugs.txt and no PNGs"

	local set=0 skipped=0 no_post=0 failed=0 saved=0 warned=0 not_published=0 rc
	local file id thumb title attachment dims removed restored candidates candidate basename ours_re lookup_failed
	for slug in "${slugs[@]}"; do
		case "$slug" in
			''|*[!a-z0-9-]*) log "failed   '$slug': not a slug"; failed=$((failed + 1)); continue ;;
		esac

		# --revalidate-only: the guarded save for every resource with the slug, in any
		# status but the trash, so a drafted one is reported rather than passed over.
		# The statuses are spelled out because `any` leaves drafts out of a name query.
		if [ "$revalidate_only" = "1" ]; then
			if ! id="$(resource_id "$slug" publish,draft,pending,private,future)"; then
				log "failed   $slug: could not look up the resource"
				failed=$((failed + 1))
			elif [ -z "$id" ]; then
				log "warning  $slug: no resource with that slug, skipped"
				no_post=$((no_post + 1))
			else
				revalidate_slug "$slug" "$id" && rc=0 || rc=$?
				case "$rc" in
					0) saved=$((saved + 1)) ;;
					3) warned=$((warned + 1)) ;;
					2) not_published=$((not_published + 1)) ;;
					*) failed=$((failed + 1)) ;;
				esac
			fi
			continue
		fi

		file="$dir/$slug.png"
		if [ ! -f "$file" ]; then
			log "failed   $slug: no PNG at $file"
			failed=$((failed + 1))
			continue
		fi

		if ! id="$(resource_id "$slug" publish)"; then
			log "failed   $slug: could not look up the resource"
			failed=$((failed + 1))
			continue
		fi
		if [ -z "$id" ]; then
			log "warning  $slug: no published resource with that slug, skipped"
			no_post=$((no_post + 1))
			continue
		fi

		# The thumbnail ID through PHP, so a WP-CLI or database error is a failure
		# rather than "no featured image". 0 means none, or one whose attachment is gone.
		if ! thumb="$(wp eval "\$t = (int) get_post_thumbnail_id( $id ); echo ( \$t && get_post( \$t ) ) ? \$t : 0;")"; then
			log "failed   $slug (#$id): could not read the featured image"
			failed=$((failed + 1))
			continue
		fi
		case "$thumb" in
			''|*[!0-9]*) log "failed   $slug (#$id): unexpected thumbnail lookup output: $thumb"; failed=$((failed + 1)); continue ;;
		esac
		if [ "$thumb" != "0" ] && [ "$force" != "1" ]; then
			log "skip     $slug (#$id): already has featured image #$thumb"
			skipped=$((skipped + 1))
			continue
		fi

		if ! title="$(wp post get "$id" --field=post_title)"; then
			log "failed   $slug (#$id): could not read the title"
			failed=$((failed + 1))
			continue
		fi

		# A run interrupted between the import and the meta write leaves an attachment
		# on the post with no _thumbnail_id. Reuse the newest such attachment, once it
		# is checked to decode, instead of importing a duplicate; one that does not
		# decode is deleted and the import happens afresh. Ours means the post's
		# attachment with the resource's title whose file is <slug>.png, or the
		# <slug>-N.png WordPress names a second copy; an editor's same-titled upload
		# is left alone. --force always imports afresh. Not covered: a file copied
		# into uploads before the attachment row was written, which WordPress never
		# lists and only the uploads directory shows.
		attachment=""
		if [ "$force" != "1" ]; then
			if ! candidates="$(wp post list --post_type=attachment --post_status=inherit --post_parent="$id" --title="$title" --orderby=ID --order=DESC --field=ID)"; then
				log "failed   $slug (#$id): could not look up the post's attachments"
				failed=$((failed + 1))
				continue
			fi
			lookup_failed=0
			for candidate in $candidates; do
				case "$candidate" in
					''|*[!0-9]*) log "failed   $slug (#$id): unexpected attachment lookup output: $candidate"; lookup_failed=1; break ;;
				esac
				if ! basename="$(wp eval "echo basename( (string) get_attached_file( $candidate ) );")"; then
					log "failed   $slug (#$id): could not read the file of attachment #$candidate"
					lookup_failed=1
					break
				fi
				ours_re="^${slug}(-[0-9]+)?\.png\$"
				if [[ "$basename" =~ $ours_re ]]; then
					attachment="$candidate"
					break
				fi
			done
			if [ "$lookup_failed" = "1" ]; then
				failed=$((failed + 1))
				continue
			fi
		fi
		if [ -n "$attachment" ]; then
			if ! dims="$(attachment_sizes "$attachment")"; then
				log "failed   $slug (#$id): could not read the metadata of attachment #$attachment, which is already on the post"
				failed=$((failed + 1))
				continue
			fi
			if [ "$dims" = "none" ]; then
				if wp post delete "$attachment" --force >/dev/null; then
					log "warning  $slug (#$id): attachment #$attachment on the post could not be decoded; deleted, importing afresh"
					attachment=""
				else
					log "failed   $slug (#$id): attachment #$attachment on the post could not be decoded, and could not be deleted"
					failed=$((failed + 1))
					continue
				fi
			fi
		fi

		if [ -n "$attachment" ]; then
			if ! wp post meta update "$id" _thumbnail_id "$attachment" >/dev/null; then
				log "failed   $slug (#$id): could not set attachment #$attachment as the featured image"
				failed=$((failed + 1))
				continue
			fi
			log "reused   $slug (#$id): attachment #$attachment was already on the post, $dims"
		else
			if ! attachment="$(wp media import "$file" --post_id="$id" --featured_image --alt="" --title="$title" --porcelain)"; then
				log "failed   $slug (#$id): wp media import exited non-zero"
				failed=$((failed + 1))
				continue
			fi
			case "$attachment" in
				''|*[!0-9]*) log "failed   $slug (#$id): unexpected import output: $attachment"; failed=$((failed + 1)); continue ;;
			esac
			# WordPress accepts any file with a PNG signature: a damaged file keeps its
			# header's dimensions but gets no generated sizes and would be a broken
			# featured image. Such an import is rolled back: the attachment deleted and
			# the previous featured image put back (or none, when there was none).
			if ! dims="$(attachment_sizes "$attachment")"; then
				log "failed   $slug (#$id): imported attachment #$attachment but could not read its metadata; left in place as the featured image"
				failed=$((failed + 1))
				continue
			fi
			if [ "$dims" = "none" ]; then
				if [ "$thumb" != "0" ]; then
					if wp post meta update "$id" _thumbnail_id "$thumb" >/dev/null; then restored="previous featured image #$thumb restored"; else restored="previous featured image #$thumb could NOT be restored"; fi
				else
					if wp post meta delete "$id" _thumbnail_id >/dev/null; then restored="featured image cleared"; else restored="featured image could NOT be cleared"; fi
				fi
				if wp post delete "$attachment" --force >/dev/null; then removed="attachment #$attachment removed"; else removed="attachment #$attachment could NOT be removed"; fi
				log "failed   $slug (#$id): WordPress could not decode $file; $removed, $restored"
				failed=$((failed + 1))
				continue
			fi
			log "set      $slug (#$id): attachment #$attachment, $dims"
		fi
		set=$((set + 1))

		if [ "$revalidate" = "1" ]; then
			revalidate_slug "$slug" "$id" && rc=0 || rc=$?
			case "$rc" in
				0) saved=$((saved + 1)) ;;
				3) warned=$((warned + 1)) ;;
				2) not_published=$((not_published + 1)) ;;
				*) failed=$((failed + 1)) ;;
			esac
		fi
	done

	if [ "$revalidate_only" = "1" ]; then
		log "done: $saved revalidated, $warned saved with a plugin warning, $not_published skipped (not published), $no_post skipped (no post), $failed failed"
		[ "$failed" -eq 0 ] || return 1
		[ $((saved + warned)) -gt 0 ] || die "nothing was revalidated: wrong --wp-path, or an unseeded site?"
		return 0
	fi

	local suffix=""
	[ "$revalidate" = "1" ] && suffix=", $saved revalidated, $warned saved with a plugin warning, $not_published not revalidated (no longer published)"
	log "done: $set set, $skipped skipped (already set), $no_post skipped (no post), $failed failed$suffix"
	[ "$failed" -eq 0 ] || return 1
	[ $((set + skipped)) -gt 0 ] || die "nothing was set and nothing was already set: wrong --wp-path, or an unseeded site?"
}

# ---------------------------------------------------------------- staging

# The catalogue's slugs from Seeder.php, one per line: the 'slug' keys inside
# the CATALOGUE constant. Dies when the parse finds nothing, or fewer slugs than
# the block has 'slug' keys, so a reformatted seeder or a slug outside
# [a-z0-9-] is never silently dropped.
catalogue_slugs() {
	local block slugs parsed keys
	[ -f "$SEEDER" ] || die "seeder not found: $SEEDER"
	block="$(awk '/private const CATALOGUE = array\(/ { in_block = 1; next } in_block && /^\t\);/ { exit } in_block' "$SEEDER")"
	[ -n "$block" ] || die "could not find the CATALOGUE constant in $SEEDER; its format has changed"
	slugs="$(printf '%s\n' "$block" | sed -n "s/^[[:space:]]*'slug'[[:space:]]*=>[[:space:]]*'\([a-z0-9-]*\)',.*/\1/p")"
	keys="$(printf '%s\n' "$block" | grep -c "'slug'[[:space:]]*=>" || true)"
	parsed="$(printf '%s\n' "$slugs" | grep -c . || true)"
	[ "$parsed" -gt 0 ] || die "no slugs parsed from the CATALOGUE in $SEEDER; its format has changed"
	[ "$parsed" -eq "$keys" ] || die "parsed $parsed slugs but the CATALOGUE has $keys 'slug' keys; a slug may be outside [a-z0-9-]"
	printf '%s\n' "$slugs"
}

# Fails when a catalogue slug has no PNG in the directory, so a generator that
# was not run, or was run against an older seeder, is caught before anything is
# copied anywhere. Prints the slugs it checked. With --revalidate-only no PNG is
# needed, and only the catalogue is read.
check_pngs() {
	local dir="$1" revalidate_only="$2" slug missing=0 slugs
	slugs="$(catalogue_slugs)" || exit 1
	if [ "$revalidate_only" = "1" ]; then
		printf '%s\n' "$slugs"
		return 0
	fi
	[ -d "$dir" ] || die "no such directory: $dir (run pnpm images:generate)"
	while IFS= read -r slug; do
		if [ ! -f "$dir/$slug.png" ]; then
			printf 'error: no PNG for catalogue slug %s in %s\n' "$slug" "$dir" >&2
			missing=$((missing + 1))
		fi
	done <<< "$slugs"
	[ "$missing" -eq 0 ] || die "$missing catalogue slug(s) have no PNG; run pnpm images:generate"
	printf '%s\n' "$slugs"
}

# Copies the catalogue's PNGs (unless --revalidate-only), slugs.txt and this
# script into a staging directory.
stage_files() {
	local dir="$1" stage="$2" slugs="$3" revalidate_only="$4" slug
	if [ "$revalidate_only" != "1" ]; then
		while IFS= read -r slug; do
			cp "$dir/$slug.png" "$stage/"
		done <<< "$slugs"
	fi
	printf '%s\n' "$slugs" > "$stage/slugs.txt"
	cp "$SCRIPT" "$stage/import.sh"
}

# The worker's optional flags, space-separated (they hold no spaces themselves).
worker_flags() {
	local force="$1" revalidate="$2" revalidate_only="$3"
	[ "$force" = "1" ] && printf '%s ' --force
	[ "$revalidate" = "1" ] || printf '%s ' --no-revalidate
	[ "$revalidate_only" = "1" ] && printf '%s ' --revalidate-only
	return 0
}

# ------------------------------------------------------------------- local

run_local() {
	local dir="$1" force="$2" revalidate="$3" revalidate_only="$4" slugs status install stage
	cd "$ROOT"
	slugs="$(check_pngs "$dir" "$revalidate_only")" || exit 1

	status="$(pnpm exec wp-env status --json 2>/dev/null)" || die "wp-env status failed; is wp-env running for this checkout? (pnpm env:start)"
	install="$(printf '%s' "$status" | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).installPath')" \
		|| die "could not read the install path from wp-env status"
	[ -n "$install" ] && [ -d "$install/WordPress" ] || die "wp-env's WordPress directory is missing: $install/WordPress"

	# wp-env bind-mounts $install/WordPress at /var/www/html in every container,
	# so a plain copy is enough to get the files in; .wp-env.json stays as it is.
	stage="$install/WordPress/$STAGE_NAME"
	rm -rf "$stage"
	mkdir -p "$stage"
	CLEANUP_LOCAL="$stage"
	stage_files "$dir" "$stage" "$slugs" "$revalidate_only"

	pnpm exec wp-env run cli -- "/var/www/html/$STAGE_NAME/import.sh" \
		run --dir "/var/www/html/$STAGE_NAME" --wp-path /var/www/html $(worker_flags "$force" "$revalidate" "$revalidate_only")
}

# -------------------------------------------------------------------- host

run_host() {
	local dir="$1" force="$2" revalidate="$3" revalidate_only="$4" target="$5" wp_path="$6" slugs tmp stage
	[ -n "$target" ] || die "--ssh USER@HOST (or RH_SSH_TARGET) is required for the host target"
	[ -n "$wp_path" ] || die "--wp-path /abs/wordpress/root (or RH_WP_PATH) is required for the host target"
	slugs="$(check_pngs "$dir" "$revalidate_only")" || exit 1

	# The remote directory name is what mktemp prints, so it is validated before
	# anything is copied to it or deleted from it: a login script that writes to
	# stdout, or a mktemp that fails, must not turn into an rm -rf elsewhere.
	tmp="$(ssh -- "$target" 'mktemp -d "${TMPDIR:-/tmp}/rh-featured-images.XXXXXX"')" || die "could not create a temp directory on $target"
	[[ "$tmp" =~ ^/[A-Za-z0-9._/-]+/rh-featured-images\.[A-Za-z0-9]+$ ]] || die "unexpected mktemp output from $target: $tmp"
	CLEANUP_REMOTE="$tmp"
	CLEANUP_TARGET="$target"
	log "staging in $target:$tmp"

	# Stage locally, then stream the files through the same ssh shell that made the
	# directory and will run WP-CLI, so one filesystem is seen throughout. scp is
	# not used: it speaks SFTP, which a host may chroot elsewhere (Cloudways keeps
	# SFTP in /home/master), where the shell's /tmp does not exist.
	stage="$(mktemp -d "${TMPDIR:-/tmp}/rh-featured-images.XXXXXX")"
	CLEANUP_LOCAL="$stage"
	stage_files "$dir" "$stage" "$slugs" "$revalidate_only"
	# --no-xattrs and COPYFILE_DISABLE keep macOS's tar from adding Apple
	# extended-attribute headers the host's GNU tar would warn about, file by file.
	COPYFILE_DISABLE=1 tar --no-xattrs -C "$stage" -cf - . | ssh -- "$target" "tar -C $(printf '%q' "$tmp") -xf -"
	ssh -- "$target" "test -f $(printf '%q' "$tmp/import.sh") && test -f $(printf '%q' "$tmp/slugs.txt")" \
		|| die "the staged files did not arrive in $target:$tmp"

	ssh -- "$target" "${RH_WP_BIN:+RH_WP_BIN=$(printf '%q' "$RH_WP_BIN") }${RH_WP_USER:+RH_WP_USER=$(printf '%q' "$RH_WP_USER") }bash $(printf '%q' "$tmp/import.sh") run --dir $(printf '%q' "$tmp") --wp-path $(printf '%q' "$wp_path") $(worker_flags "$force" "$revalidate" "$revalidate_only")"
}

# -------------------------------------------------------------------- main

[ $# -ge 1 ] || usage
target="$1"
shift

dir="$DEFAULT_DIR"
force=0
revalidate=1
revalidate_only=0
ssh_target="${RH_SSH_TARGET:-}"
wp_path="${RH_WP_PATH:-}"
need_value() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }
while [ $# -gt 0 ]; do
	case "$1" in
		--force) force=1 ;;
		--no-revalidate) revalidate=0 ;;
		--revalidate-only) revalidate_only=1 ;;
		--dir) need_value "$@"; dir="$2"; shift ;;
		--ssh) need_value "$@"; ssh_target="$2"; shift ;;
		--wp-path) need_value "$@"; wp_path="$2"; shift ;;
		-h|--help) usage 0 ;;
		*) die "unknown argument: $1" ;;
	esac
	shift
done
[ "$revalidate_only" = "1" ] && [ "$force" = "1" ] && die "--revalidate-only and --force do not go together"
[ "$revalidate_only" = "1" ] && [ "$revalidate" = "0" ] && die "--revalidate-only and --no-revalidate do not go together"

case "$target" in
	local) run_local "$dir" "$force" "$revalidate" "$revalidate_only" ;;
	host) run_host "$dir" "$force" "$revalidate" "$revalidate_only" "$ssh_target" "$wp_path" ;;
	run) [ -n "$wp_path" ] || die "--wp-path is required"; run_import "$dir" "$wp_path" "$force" "$revalidate" "$revalidate_only" ;;
	-h|--help) usage 0 ;;
	*) usage ;;
esac
