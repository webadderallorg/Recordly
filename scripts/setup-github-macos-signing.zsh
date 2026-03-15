#!/bin/zsh

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: zsh scripts/setup-github-macos-signing.zsh [options]

Exports the local Developer ID Application identity to a .p12, base64-encodes it
for electron-builder's CSC_LINK secret, and uploads the required GitHub Actions
repository secrets.

Options:
  --repo OWNER/REPO       GitHub repository slug. Defaults to the current origin remote.
  --identity NAME         Exact signing identity name to use.
  --cert-path PATH        Output path for the exported .p12 file.
  -h, --help              Show this help message.

Environment overrides:
  APPLE_ID
  APPLE_APP_SPECIFIC_PASSWORD
  P12_PASSWORD
EOF
}

die() {
	print -u2 -- "Error: $*"
	exit 1
}

require_cmd() {
	local cmd
	for cmd in "$@"; do
		command -v "$cmd" >/dev/null 2>&1 || die "Missing required command: $cmd"
	done
}

resolve_repo() {
	local remote
	remote="$(git remote get-url origin 2>/dev/null || true)"
	[[ -n "$remote" ]] || die "Could not resolve the GitHub repo from the origin remote. Pass --repo OWNER/REPO."
	print -- "$remote" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##'
}

detect_identity() {
	local -a matches
	matches=("${(@f)$(security find-identity -v -p codesigning | sed -n 's/.*"\(Developer ID Application: [^"]*\)"/\1/p')}")

	(( ${#matches} > 0 )) || die "No 'Developer ID Application' signing identity was found in the login keychain."

	if (( ${#matches} > 1 )); then
		print -u2 -- "Multiple Developer ID Application identities were found:"
		printf '  - %s\n' "${matches[@]}" >&2
		die "Pass --identity with the exact one you want to use."
	fi

	print -- "${matches[1]}"
}

extract_team_id() {
	local identity="$1"
	local team_id
	team_id="$(print -- "$identity" | sed -nE 's/.*\(([A-Z0-9]+)\)$/\1/p')"
	[[ -n "$team_id" ]] || die "Could not extract the Apple team ID from identity: $identity"
	print -- "$team_id"
}

prompt_for_value() {
	local prompt="$1"
	local secret="${2:-false}"
	local value

	if [[ "$secret" == "true" ]]; then
		read -s "value?$prompt"
		echo
	else
		read -r "value?$prompt"
	fi

	[[ -n "$value" ]] || die "A value is required for: $prompt"
	print -- "$value"
}

repo=""
identity=""
cert_path=""

while (( $# > 0 )); do
	case "$1" in
		--repo)
			(( $# >= 2 )) || die "--repo requires a value"
			repo="$2"
			shift 2
			;;
		--identity)
			(( $# >= 2 )) || die "--identity requires a value"
			identity="$2"
			shift 2
			;;
		--cert-path)
			(( $# >= 2 )) || die "--cert-path requires a value"
			cert_path="$2"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "Unknown option: $1"
			;;
	esac
done

[[ "$(uname -s)" == "Darwin" ]] || die "This script must be run on macOS."

require_cmd gh git openssl security sed mktemp

gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated. Run 'gh auth login' first."

repo="${repo:-$(resolve_repo)}"
identity="${identity:-$(detect_identity)}"
team_id="$(extract_team_id "$identity")"

if [[ -z "${cert_path}" ]]; then
	slug="$(print -- "$identity" | sed -E 's/[^A-Za-z0-9]+/-/g; s/^-+//; s/-+$//')"
	cert_path="$HOME/Downloads/${slug}.p12"
fi

apple_id="${APPLE_ID:-}"
apple_app_specific_password="${APPLE_APP_SPECIFIC_PASSWORD:-}"
p12_password="${P12_PASSWORD:-}"

[[ -n "$apple_id" ]] || apple_id="$(prompt_for_value 'Apple ID email: ')"
[[ -n "$apple_app_specific_password" ]] || apple_app_specific_password="$(prompt_for_value 'Apple app-specific password: ' true)"
[[ -n "$p12_password" ]] || p12_password="$(prompt_for_value 'Password to protect exported .p12: ' true)"

mkdir -p "$(dirname "$cert_path")"

if [[ -e "$cert_path" ]]; then
	read -r "overwrite?Overwrite existing file at $cert_path? [y/N]: "
	[[ "$overwrite" =~ ^[Yy]$ ]] || die "Aborted."
	rm -f "$cert_path"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

print -- "Using repository: $repo"
print -- "Using signing identity: $identity"
print -- "Derived Apple team ID: $team_id"
print -- "Exporting PKCS#12 bundle to: $cert_path"
print -- "macOS exports identities from the login keychain as a bundle; CSC_NAME will make GitHub Actions use the Developer ID identity."

security export \
	-k "$HOME/Library/Keychains/login.keychain-db" \
	-t identities \
	-f pkcs12 \
	-P "$p12_password" \
	-o "$cert_path"

openssl base64 -in "$cert_path" -A > "$tmp_dir/CSC_LINK.txt"
print -rn -- "$p12_password" > "$tmp_dir/CSC_KEY_PASSWORD.txt"
print -rn -- "$identity" > "$tmp_dir/CSC_NAME.txt"
print -rn -- "$apple_id" > "$tmp_dir/APPLE_ID.txt"
print -rn -- "$apple_app_specific_password" > "$tmp_dir/APPLE_APP_SPECIFIC_PASSWORD.txt"
print -rn -- "$team_id" > "$tmp_dir/APPLE_TEAM_ID.txt"

gh secret set CSC_LINK --repo "$repo" < "$tmp_dir/CSC_LINK.txt"
gh secret set CSC_KEY_PASSWORD --repo "$repo" < "$tmp_dir/CSC_KEY_PASSWORD.txt"
gh secret set CSC_NAME --repo "$repo" < "$tmp_dir/CSC_NAME.txt"
gh secret set APPLE_ID --repo "$repo" < "$tmp_dir/APPLE_ID.txt"
gh secret set APPLE_APP_SPECIFIC_PASSWORD --repo "$repo" < "$tmp_dir/APPLE_APP_SPECIFIC_PASSWORD.txt"
gh secret set APPLE_TEAM_ID --repo "$repo" < "$tmp_dir/APPLE_TEAM_ID.txt"

print
print -- "GitHub Actions signing secrets are set for $repo."
print -- "Exported certificate bundle: $cert_path"
print -- "Next step: npm run release:dispatch"
