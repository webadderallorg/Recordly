#!/bin/zsh

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
cd "$repo_root"

usage() {
	cat <<'EOF'
Usage: zsh scripts/dispatch-release-build.zsh [options]

Calculates the next semantic version tag, asks for confirmation, then triggers
the Release Builds GitHub Actions workflow.

Options:
  --release-type VALUE     Release type: patch, minor, or major. Prompts if omitted.
  --name VALUE             Release title. Defaults to "Open Recorder v<version>".
  --notes VALUE            Release notes body. Defaults to empty.
  --latest true|false      Whether to mark the release as latest. Defaults to true.
  --ref VALUE              Git branch that contains the workflow file. Defaults to the current branch.
  --repo OWNER/REPO        GitHub repository slug. Defaults to the current origin remote.
  -h, --help               Show this help message.
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

current_version() {
	node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version"
}

latest_semver_tag_version() {
	git tag --list 'v*' --sort=-version:refname | sed -nE 's/^v([0-9]+\.[0-9]+\.[0-9]+)$/\1/p' | sed -n '1p'
}

bump_version() {
	local base_version="$1"
	local release_type="$2"

	node -e '
const version = process.argv[1];
const type = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid semantic version: ${version}`);
  process.exit(1);
}
const [major, minor, patch] = version.split(".").map(Number);
switch (type) {
  case "patch":
    console.log(`${major}.${minor}.${patch + 1}`);
    break;
  case "minor":
    console.log(`${major}.${minor + 1}.0`);
    break;
  case "major":
    console.log(`${major + 1}.0.0`);
    break;
  default:
    console.error(`Unsupported release type: ${type}`);
    process.exit(1);
}
' "$base_version" "$release_type"
}

compare_versions() {
	local first="$1"
	local second="$2"

	node -e '
const parse = (value) => value.split(".").map(Number);
const [aMajor, aMinor, aPatch] = parse(process.argv[1]);
const [bMajor, bMinor, bPatch] = parse(process.argv[2]);
if (aMajor !== bMajor) {
  console.log(aMajor > bMajor ? 1 : -1);
} else if (aMinor !== bMinor) {
  console.log(aMinor > bMinor ? 1 : -1);
} else if (aPatch !== bPatch) {
  console.log(aPatch > bPatch ? 1 : -1);
} else {
  console.log(0);
}
' "$first" "$second"
}

choose_release_type() {
	local base_version="$1"
	local patch_version minor_version major_version choice

	patch_version="$(bump_version "$base_version" patch)"
	minor_version="$(bump_version "$base_version" minor)"
	major_version="$(bump_version "$base_version" major)"

	print -- "Choose release type:"
	print -- "  1) patch -> v$patch_version"
	print -- "  2) minor -> v$minor_version"
	print -- "  3) major -> v$major_version"

	while true; do
		read -r "choice?Select release type [1-3]: "
		case "$choice" in
			1|patch)
				print -- "patch"
				return
				;;
			2|minor)
				print -- "minor"
				return
				;;
			3|major)
				print -- "major"
				return
				;;
			*)
				print -u2 -- "Please choose 1, 2, 3, patch, minor, or major."
				;;
		esac
	done
}

confirm_release_tag() {
	local tag="$1"
	local confirm

	read -r "confirm?Dispatch release workflow for $tag? [y/N]: "
	[[ "$confirm" =~ ^[Yy]$ ]]
}

release_type=""
name=""
notes=""
latest="true"
repo=""
ref=""

while (( $# > 0 )); do
	case "$1" in
		--release-type)
			(( $# >= 2 )) || die "--release-type requires a value"
			release_type="$2"
			shift 2
			;;
		--name)
			(( $# >= 2 )) || die "--name requires a value"
			name="$2"
			shift 2
			;;
		--notes)
			(( $# >= 2 )) || die "--notes requires a value"
			notes="$2"
			shift 2
			;;
		--latest)
			(( $# >= 2 )) || die "--latest requires true or false"
			latest="$2"
			shift 2
			;;
		--repo)
			(( $# >= 2 )) || die "--repo requires a value"
			repo="$2"
			shift 2
			;;
		--ref)
			(( $# >= 2 )) || die "--ref requires a value"
			ref="$2"
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

[[ "$latest" == "true" || "$latest" == "false" ]] || die "--latest must be 'true' or 'false'"
[[ -z "$release_type" || "$release_type" == "patch" || "$release_type" == "minor" || "$release_type" == "major" ]] || die "--release-type must be patch, minor, or major"

require_cmd gh git node sed
gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated. Run 'gh auth login' first."

repo="${repo:-$(resolve_repo)}"
current_branch="$(git branch --show-current 2>/dev/null || true)"
[[ -n "$current_branch" ]] || die "Could not determine the current git branch."
ref="${ref:-$current_branch}"
package_version="$(current_version)"
latest_tag_version="$(latest_semver_tag_version || true)"

base_version="$package_version"
version_source="package.json"

if [[ -n "$latest_tag_version" ]]; then
	case "$(compare_versions "$latest_tag_version" "$package_version")" in
		1)
			base_version="$latest_tag_version"
			version_source="git tag"
			;;
		0)
			version_source="package.json and git tag"
			;;
	esac
fi

release_type="${release_type:-$(choose_release_type "$base_version")}"
next_version="$(bump_version "$base_version" "$release_type")"
tag="v$next_version"
name="${name:-Open Recorder v$next_version}"

print -- "Current package.json version: $package_version"
if [[ -n "$latest_tag_version" ]]; then
	print -- "Latest local release tag: v$latest_tag_version"
else
	print -- "Latest local release tag: none"
fi
print -- "Using base version from $version_source: $base_version"
print -- "Selected release type: $release_type"
print -- "Calculated release tag: $tag"

confirm_release_tag "$tag" || die "Aborted."

print -- "Dispatching Release Builds workflow for $repo"
print -- "Tag: $tag"
print -- "Release title: $name"
print -- "Git ref: $ref"

workflow_args=(
	release.yml
	--repo "$repo"
	-f "tag_name=$tag"
	-f "release_name=$name"
	-f "release_notes=$notes"
	-f "make_latest=$latest"
)

if [[ -n "$ref" ]]; then
	workflow_args+=(--ref "$ref")
fi

gh workflow run "${workflow_args[@]}"

print
print -- "Workflow dispatched."
print -- "Check status with: gh run list --repo $repo --workflow release.yml --limit 5"
