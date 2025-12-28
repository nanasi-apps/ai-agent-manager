#!/usr/bin/env bash
set -euo pipefail

REPO_URL="https://github.com/coderabbitai/git-worktree-runner.git"
INSTALL_ROOT="${HOME}/.local/share/git-worktree-runner"
BIN_DIR="${HOME}/.local/bin"

if [ ! -d "${INSTALL_ROOT}/.git" ]; then
  mkdir -p "$(dirname "${INSTALL_ROOT}")"
  git clone "${REPO_URL}" "${INSTALL_ROOT}"
else
  git -C "${INSTALL_ROOT}" pull --ff-only
fi

mkdir -p "${BIN_DIR}"
ln -sf "${INSTALL_ROOT}/bin/git-gtr" "${BIN_DIR}/git-gtr"

cat <<EOF
git-gtr installed at: ${BIN_DIR}/git-gtr

Make sure ${BIN_DIR} is in PATH, for example:
  echo 'export PATH="${BIN_DIR}:$PATH"' >> ~/.zshrc
  source ~/.zshrc
EOF
