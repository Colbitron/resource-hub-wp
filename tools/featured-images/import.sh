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
# After each image is set, the resource is saved again through WP-CLI
# (`wp post update --post_status=publish`, a no-op for its content) so the
# plugin's revalidation hook sends an `update` event and the front end's cached
# pages pick the image up; --no-revalidate skips that. The save bumps the
# resource's modified date, as any editor save does.
#
# Targets:
#   import.sh local [--force] [--no-revalidate] [--dir DIR]
#       The wp-env of this checkout. Files are staged inside the WordPress
#       directory wp-env bind-mounts, imported with the cli container's wp, and
#       the staging directory is removed again.
#   import.sh host --ssh USER@HOST --wp-path /abs/wordpress/root [--force] [--no-revalidate] [--dir DIR]
#       A remote site over SSH: scp to a mktemp directory under the host's
#       /tmp, run there with the host's wp, delete the directory. --ssh and
#       --wp-path default to the RH_SSH_TARGET and RH_WP_PATH environment
#       variables; RH_WP_BIN names the wp binary on the host (one path, no
#       arguments) when it is not on PATH. Nothing is hard-coded.
#   import.sh run --dir DIR --wp-path PATH [--force] [--no-revalidate]
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

run_import() {
	local dir="$1" wp_path="$2" force="$3" revalidate="$4" wp_bin="${RH_WP_BIN:-wp}"
	[ -d "$dir" ] || die "no such directory: $dir"
	command -v "$wp_bin" >/dev/null 2>&1 || die "wp not found (set RH_WP_BIN to the binary's path)"

	# `command` keeps this from calling itself when the binary is also named wp.
	wp() { command "$wp_bin" --path="$wp_path" "$@"; }

	local slugs=() slug
	if [ -f "$dir/slugs.txt" ]; then
		while IFS= read -r slug; do
			[ -n "$slug" ] && slugs+=("$slug")
		done < "$dir/slugs.txt"
	else
		local file
		shopt -s nullglob
		for file in "$dir"/*.png; do
			file="$(basename "$file" .png)"
			[ "$file" = "contact-sheet" ] || slugs+=("$file")
		done
		shopt -u nullglob
	fi
	[ "${#slugs[@]}" -gt 0 ] || die "nothing to import: $dir has no slugs.txt and no PNGs"

	local set=0 skipped=0 no_post=0 failed=0 slug file id thumb title attachment dims
	for slug in "${slugs[@]}"; do
		case "$slug" in
			''|*[!a-z0-9-]*) log "failed   '$slug': not a slug"; failed=$((failed + 1)); continue ;;
		esac
		file="$dir/$slug.png"
		if [ ! -f "$file" ]; then
			log "failed   $slug: no PNG at $file"
			failed=$((failed + 1))
			continue
		fi

		# Only a bare integer is an ID; anything else on stdout (a PHP notice, say) is a failure.
		if ! id="$(wp post list --post_type=resource --post_status=publish --name="$slug" --field=ID)"; then
			log "failed   $slug: wp post list exited non-zero"
			failed=$((failed + 1))
			continue
		fi
		if [ -z "$id" ]; then
			log "warning  $slug: no published resource with that slug, skipped"
			no_post=$((no_post + 1))
			continue
		fi
		case "$id" in
			*[!0-9]*) log "failed   $slug: unexpected ID lookup output: $id"; failed=$((failed + 1)); continue ;;
		esac

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
		# on the post with no _thumbnail_id. Reuse the newest such attachment instead of
		# importing a duplicate; --force always imports afresh. What this does not
		# cover: a file copied into uploads before the attachment row was written,
		# which WordPress never lists and only a look at the uploads directory finds.
		attachment=""
		if [ "$force" != "1" ]; then
			attachment="$(wp post list --post_type=attachment --post_status=inherit --post_parent="$id" --title="$title" --orderby=ID --order=DESC --field=ID | head -n 1)" || attachment=""
			case "$attachment" in
				''|*[!0-9]*) attachment="" ;;
			esac
		fi

		if [ -n "$attachment" ]; then
			if wp post meta update "$id" _thumbnail_id "$attachment" >/dev/null; then
				log "reused   $slug (#$id): attachment #$attachment was already on the post"
			else
				log "failed   $slug (#$id): could not set attachment #$attachment as the featured image"
				failed=$((failed + 1))
				continue
			fi
		elif attachment="$(wp media import "$file" --post_id="$id" --featured_image --alt="" --title="$title" --porcelain)"; then
			# WordPress accepts any file with a PNG signature: a damaged file still
			# gets its header's dimensions but no generated sizes, and would become a
			# broken featured image. An attachment WordPress could not decode (no
			# dimensions, or no sizes) is rolled back and counted as failed.
			case "$attachment" in
				''|*[!0-9]*) log "failed   $slug (#$id): unexpected import output: $attachment"; failed=$((failed + 1)); continue ;;
			esac
			dims="$(wp eval "\$m = wp_get_attachment_metadata( $attachment ); echo ( \$m && ! empty( \$m['width'] ) && ! empty( \$m['height'] ) && ! empty( \$m['sizes'] ) ) ? \$m['width'] . 'x' . \$m['height'] . ', ' . count( \$m['sizes'] ) . ' sizes' : 'none';")" || dims="none"
			if [ "$dims" = "none" ]; then
				wp post meta delete "$id" _thumbnail_id >/dev/null 2>&1 || true
				wp post delete "$attachment" --force >/dev/null 2>&1 || true
				log "failed   $slug (#$id): WordPress could not decode $file; attachment #$attachment removed again"
				failed=$((failed + 1))
				continue
			fi
			log "set      $slug (#$id): attachment #$attachment, $dims"
		else
			log "failed   $slug (#$id): wp media import exited non-zero"
			failed=$((failed + 1))
			continue
		fi
		set=$((set + 1))

		# A no-op save so the plugin's hook sends an `update` event for the resource.
		if [ "$revalidate" = "1" ]; then
			if ! wp post update "$id" --post_status=publish >/dev/null; then
				log "failed   $slug (#$id): the revalidation save exited non-zero"
				failed=$((failed + 1))
			fi
		fi
	done

	log "done: $set set, $skipped skipped (already set), $no_post skipped (no post), $failed failed"
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
# copied anywhere. Prints the slugs it checked.
check_pngs() {
	local dir="$1" slug missing=0 slugs
	[ -d "$dir" ] || die "no such directory: $dir (run pnpm images:generate)"
	slugs="$(catalogue_slugs)" || exit 1
	while IFS= read -r slug; do
		if [ ! -f "$dir/$slug.png" ]; then
			printf 'error: no PNG for catalogue slug %s in %s\n' "$slug" "$dir" >&2
			missing=$((missing + 1))
		fi
	done <<< "$slugs"
	[ "$missing" -eq 0 ] || die "$missing catalogue slug(s) have no PNG; run pnpm images:generate"
	printf '%s\n' "$slugs"
}

# Copies the catalogue's PNGs, slugs.txt and this script into a staging directory.
stage_files() {
	local dir="$1" stage="$2" slugs="$3" slug
	while IFS= read -r slug; do
		cp "$dir/$slug.png" "$stage/"
	done <<< "$slugs"
	printf '%s\n' "$slugs" > "$stage/slugs.txt"
	cp "$SCRIPT" "$stage/import.sh"
}

# The worker's optional flags, space-separated (they hold no spaces themselves).
worker_flags() {
	local force="$1" revalidate="$2"
	[ "$force" = "1" ] && printf '%s ' --force
	[ "$revalidate" = "1" ] || printf '%s ' --no-revalidate
	return 0
}

# ------------------------------------------------------------------- local

run_local() {
	local dir="$1" force="$2" revalidate="$3" slugs status install stage
	cd "$ROOT"
	slugs="$(check_pngs "$dir")" || exit 1

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
	stage_files "$dir" "$stage" "$slugs"

	pnpm exec wp-env run cli -- "/var/www/html/$STAGE_NAME/import.sh" \
		run --dir "/var/www/html/$STAGE_NAME" --wp-path /var/www/html $(worker_flags "$force" "$revalidate")
}

# -------------------------------------------------------------------- host

run_host() {
	local dir="$1" force="$2" revalidate="$3" target="$4" wp_path="$5" slugs tmp stage
	[ -n "$target" ] || die "--ssh USER@HOST (or RH_SSH_TARGET) is required for the host target"
	[ -n "$wp_path" ] || die "--wp-path /abs/wordpress/root (or RH_WP_PATH) is required for the host target"
	slugs="$(check_pngs "$dir")" || exit 1

	# The remote directory name is what mktemp prints, so it is validated before
	# anything is copied to it or deleted from it: a login script that writes to
	# stdout, or a mktemp that fails, must not turn into an rm -rf elsewhere.
	tmp="$(ssh -- "$target" 'mktemp -d "${TMPDIR:-/tmp}/rh-featured-images.XXXXXX"')" || die "could not create a temp directory on $target"
	[[ "$tmp" =~ ^/[A-Za-z0-9._/-]+/rh-featured-images\.[A-Za-z0-9]+$ ]] || die "unexpected mktemp output from $target: $tmp"
	CLEANUP_REMOTE="$tmp"
	CLEANUP_TARGET="$target"
	log "staging in $target:$tmp"

	# Stage locally first so scp sends exactly the catalogue's files in one go.
	stage="$(mktemp -d "${TMPDIR:-/tmp}/rh-featured-images.XXXXXX")"
	CLEANUP_LOCAL="$stage"
	stage_files "$dir" "$stage" "$slugs"
	scp -q -- "$stage"/* "$target:$tmp/"

	ssh -- "$target" "${RH_WP_BIN:+RH_WP_BIN=$(printf '%q' "$RH_WP_BIN") }bash $(printf '%q' "$tmp/import.sh") run --dir $(printf '%q' "$tmp") --wp-path $(printf '%q' "$wp_path") $(worker_flags "$force" "$revalidate")"
}

# -------------------------------------------------------------------- main

[ $# -ge 1 ] || usage
target="$1"
shift

dir="$DEFAULT_DIR"
force=0
revalidate=1
ssh_target="${RH_SSH_TARGET:-}"
wp_path="${RH_WP_PATH:-}"
need_value() { [ $# -ge 2 ] && [ -n "$2" ] || die "$1 needs a value"; }
while [ $# -gt 0 ]; do
	case "$1" in
		--force) force=1 ;;
		--no-revalidate) revalidate=0 ;;
		--dir) need_value "$@"; dir="$2"; shift ;;
		--ssh) need_value "$@"; ssh_target="$2"; shift ;;
		--wp-path) need_value "$@"; wp_path="$2"; shift ;;
		-h|--help) usage 0 ;;
		*) die "unknown argument: $1" ;;
	esac
	shift
done

case "$target" in
	local) run_local "$dir" "$force" "$revalidate" ;;
	host) run_host "$dir" "$force" "$revalidate" "$ssh_target" "$wp_path" ;;
	run) [ -n "$wp_path" ] || die "--wp-path is required"; run_import "$dir" "$wp_path" "$force" "$revalidate" ;;
	-h|--help) usage 0 ;;
	*) usage ;;
esac
