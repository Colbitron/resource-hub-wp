#!/usr/bin/env bash
#
# Sets each seeded resource's featured image from artifacts/featured-images/.
#
# Idempotent: a resource that already has a featured image is skipped unless
# --force is given, in which case a new attachment is set and the old one is
# left in the media library. A slug with no published resource is reported and
# the run exits non-zero, so a seeder change never goes unnoticed. Alt text is
# left empty on purpose: the images are decorative beside a printed title.
#
# Targets:
#   import.sh local [--force] [--dir DIR]
#       The wp-env of this checkout. Files are staged inside the WordPress
#       directory wp-env bind-mounts, imported with the cli container's wp, and
#       the staging directory is removed again.
#   import.sh host --ssh USER@HOST --wp-path /abs/wordpress/root [--force] [--dir DIR]
#       A remote site over SSH: scp to a mktemp directory, run there with the
#       host's wp, delete the directory. --ssh and --wp-path default to the
#       RH_SSH_TARGET and RH_WP_PATH environment variables; RH_WP_BIN names the
#       wp binary on the host when it is not on PATH. Nothing is hard-coded.
#   import.sh run --dir DIR --wp-path PATH [--force]
#       The worker the two targets invoke where `wp` runs. Usable directly on
#       any machine with WP-CLI and the PNGs.
#
set -euo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ROOT="$(cd "$(dirname "$SCRIPT")/../.." && pwd)"
DEFAULT_DIR="$ROOT/artifacts/featured-images"
STAGE_NAME=".rh-featured-images"

usage() {
	sed -n '2,24p' "$SCRIPT" | sed 's/^# \{0,1\}//'
	exit "${1:-1}"
}

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# What the EXIT trap removes: a local staging directory, or a remote one.
CLEANUP_LOCAL=""
CLEANUP_REMOTE=""
CLEANUP_TARGET=""
cleanup() {
	[ -n "$CLEANUP_LOCAL" ] && rm -rf "$CLEANUP_LOCAL"
	[ -n "$CLEANUP_REMOTE" ] && ssh "$CLEANUP_TARGET" "rm -rf $(printf '%q' "$CLEANUP_REMOTE")"
	return 0
}
trap cleanup EXIT

# --------------------------------------------------------------------- run

run_import() {
	local dir="$1" wp_path="$2" force="$3" wp_bin="${RH_WP_BIN:-wp}"
	[ -d "$dir" ] || die "no such directory: $dir"
	command -v "$wp_bin" >/dev/null 2>&1 || die "wp not found (set RH_WP_BIN)"

	# `command` keeps this from calling itself when the binary is also named wp.
	wp() { command "$wp_bin" --path="$wp_path" "$@"; }

	local set=0 skipped=0 missing=0 failed=0 file slug id thumb title attachment
	shopt -s nullglob
	for file in "$dir"/*.png; do
		slug="$(basename "$file" .png)"
		[ "$slug" = "contact-sheet" ] && continue

		id="$(wp post list --post_type=resource --post_status=publish --name="$slug" --field=ID | head -n 1)"
		if [ -z "$id" ]; then
			log "missing  $slug: no published resource with that slug"
			missing=$((missing + 1))
			continue
		fi

		thumb="$(wp post meta get "$id" _thumbnail_id 2>/dev/null || true)"
		if [ -n "$thumb" ] && [ "$force" != "1" ]; then
			log "skip     $slug (#$id): already has featured image #$thumb"
			skipped=$((skipped + 1))
			continue
		fi

		title="$(wp post get "$id" --field=post_title)"
		if attachment="$(wp media import "$file" --post_id="$id" --featured_image --alt="" --title="$title" --porcelain)"; then
			log "set      $slug (#$id): attachment #$attachment"
			set=$((set + 1))
		else
			log "failed   $slug (#$id): wp media import exited non-zero"
			failed=$((failed + 1))
		fi
	done

	log "done: $set set, $skipped skipped, $missing missing, $failed failed"
	[ "$missing" -eq 0 ] && [ "$failed" -eq 0 ]
}

# ------------------------------------------------------------------- local

run_local() {
	local dir="$1" force="$2" install stage
	cd "$ROOT"
	install="$(pnpm exec wp-env status --json 2>/dev/null | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).installPath')"
	[ -n "$install" ] && [ -d "$install/WordPress" ] || die "wp-env is not running for this checkout (pnpm env:start)"

	# wp-env bind-mounts $install/WordPress at /var/www/html in every container,
	# so a plain copy is enough to get the files in; .wp-env.json stays as it is.
	stage="$install/WordPress/$STAGE_NAME"
	rm -rf "$stage"
	mkdir -p "$stage"
	CLEANUP_LOCAL="$stage"
	cp "$dir"/*.png "$SCRIPT" "$stage/"

	local args=(run --dir "/var/www/html/$STAGE_NAME" --wp-path /var/www/html)
	[ "$force" = "1" ] && args+=(--force)
	pnpm exec wp-env run cli -- "/var/www/html/$STAGE_NAME/import.sh" "${args[@]}"
}

# -------------------------------------------------------------------- host

run_host() {
	local dir="$1" force="$2" target="$3" wp_path="$4" tmp
	[ -n "$target" ] || die "--ssh USER@HOST (or RH_SSH_TARGET) is required for the host target"
	[ -n "$wp_path" ] || die "--wp-path /abs/wordpress/root (or RH_WP_PATH) is required for the host target"

	tmp="$(ssh "$target" 'mktemp -d')"
	[ -n "$tmp" ] || die "could not create a temp directory on $target"
	CLEANUP_REMOTE="$tmp"
	CLEANUP_TARGET="$target"
	log "staging in $target:$tmp"
	scp -q "$dir"/*.png "$SCRIPT" "$target:$tmp/"

	local args=(run --dir "$tmp" --wp-path "$wp_path")
	[ "$force" = "1" ] && args+=(--force)
	ssh "$target" "${RH_WP_BIN:+RH_WP_BIN=$(printf '%q' "$RH_WP_BIN") }bash $(printf '%q' "$tmp/import.sh") $(printf '%q ' "${args[@]}")"
}

# -------------------------------------------------------------------- main

[ $# -ge 1 ] || usage
target="$1"
shift

dir="$DEFAULT_DIR"
force=0
ssh_target="${RH_SSH_TARGET:-}"
wp_path="${RH_WP_PATH:-}"
while [ $# -gt 0 ]; do
	case "$1" in
		--force) force=1 ;;
		--dir) dir="$2"; shift ;;
		--ssh) ssh_target="$2"; shift ;;
		--wp-path) wp_path="$2"; shift ;;
		-h|--help) usage 0 ;;
		*) die "unknown argument: $1" ;;
	esac
	shift
done

case "$target" in
	local) run_local "$dir" "$force" ;;
	host) run_host "$dir" "$force" "$ssh_target" "$wp_path" ;;
	run) [ -n "$wp_path" ] || die "--wp-path is required"; run_import "$dir" "$wp_path" "$force" ;;
	*) usage ;;
esac
