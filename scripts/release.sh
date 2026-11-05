#!/usr/bin/env bash
#
# Saca una versión: sube el número, commitea y deja la etiqueta en GitHub. Después
# se deploya como siempre. Las reglas están en CLAUDE.md ("Versiones").
#
#   ./scripts/release.sh patch     # 1.0.0 → 1.0.1          arreglos
#   ./scripts/release.sh minor     # 1.0.1 → 1.1.0          algo nuevo que se ve
#   ./scripts/release.sh beta      # 1.1.0-beta.1 → beta.2  otra tanda para la beta
#   ./scripts/release.sh 2.0.0     # un número exacto
#
# Una beta que pasa a producción: `patch` le saca el "-beta" (1.1.0-beta.3 → 1.1.0).
# Antes hay que anotar qué cambió en frontend/lib/changelog.ts: es lo que ve la
# gente en Configuración, y sin esa entrada el script no sigue.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

CHANGELOG=frontend/lib/changelog.ts
what="${1:-}"
case "$what" in
  patch|minor|major) args=("$what") ;;
  beta) args=(prerelease --preid=beta) ;;
  [0-9]*) args=("$what") ;;
  *) sed -n '3,14p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac

# Sólo lo que este script va a commitear puede estar sin guardar: una versión tiene
# que ser exactamente lo que está en la rama.
others="$(git status --porcelain | grep -v " $CHANGELOG\$" || true)"
if [ -n "$others" ]; then
  printf 'Hay cambios sin commitear:\n%s\n' "$others" >&2
  exit 1
fi

cd frontend
version="$(npm version "${args[@]}" --no-git-tag-version | tail -1 | sed 's/^v//')"
cd "$REPO"

if ! grep -q "version: \"$version\"" "$CHANGELOG"; then
  git checkout -- frontend/package.json frontend/package-lock.json
  echo "Falta la entrada de $version en $CHANGELOG." >&2
  exit 1
fi

git add -- frontend/package.json frontend/package-lock.json "$CHANGELOG"
git commit -q -m "chore(release): v$version"
git tag -a "v$version" -m "v$version"
git push -q origin HEAD "v$version"
echo "v$version lista y en GitHub. Si es de main: ./scripts/deploy.sh"
