#!/bin/bash

set -e  # exit on any error

if [[ -z "$@" ]]; then
  set -- -m "build: deploy"
  echo "No arguments supplied, using generic arguments '${@}'"
fi

cd "$(git rev-parse --show-toplevel)"

git checkout main
git pull

npm run build

git checkout gh-pages
git pull 

# Remove all tracked files except CNAME
git rm -r .
git checkout gh-pages -- CNAME || :

mv dist/* .

git add .
git commit "${@}"
git push origin gh-pages

# remove new untracked objects?? (actl not untracked)
rm -r .vite/ 2>/dev/null || :

git checkout main

echo "Commited with arguments: ${@}"