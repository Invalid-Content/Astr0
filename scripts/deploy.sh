#!/bin/sh
# Publishes the built site in dist/ to the gh-pages branch, which GitHub Pages
# serves at https://invalid-content.github.io/Astr0/. Run via `npm run deploy`.
set -e
cd "$(dirname "$0")/.."

if [ ! -f dist/index.html ]; then
  echo "dist/ is missing. Run 'npm run build' first." >&2
  exit 1
fi

find dist -name .DS_Store -delete
touch dist/.nojekyll # serve the files as they are, without GitHub's Jekyll step

# Build the commit from dist/ with a throwaway index, so the working tree,
# the current branch and anything staged are left alone.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export GIT_INDEX_FILE="$tmp/index"
git --work-tree=dist add --all
tree=$(git write-tree)

git fetch --quiet origin gh-pages 2>/dev/null || true
parent=$(git rev-parse --quiet --verify refs/remotes/origin/gh-pages || true)
message="Publish site from $(git rev-parse --short HEAD)"

if [ -n "$parent" ]; then
  if [ "$(git rev-parse "$parent^{tree}")" = "$tree" ]; then
    echo "The published site is already up to date."
    exit 0
  fi
  commit=$(git commit-tree "$tree" -p "$parent" -m "$message")
else
  commit=$(git commit-tree "$tree" -m "$message")
fi

git push origin "$commit:refs/heads/gh-pages"
echo "Published. Changes can take a minute to appear."
