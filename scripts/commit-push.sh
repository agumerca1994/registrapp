#!/usr/bin/env bash
#
# Commitea los cambios de archivos ya versionados y pushea.
#
#   ./scripts/commit-push.sh "fix(egresos): el filtro de moneda"
#   MSG="docs: ..." ./scripts/commit-push.sh     # así lo llama la tarea de VS Code
#   ./scripts/commit-push.sh                    # pregunta el mensaje
#
#   --no-push   commitea y para ahí
#   --yes       sin confirmación
#
# POR QUÉ NO HACE `git add -A`, y por qué no hay que "arreglarlo":
# este repo tiene carpetas _staging_<banco>/ con resúmenes de tarjeta reales —
# datos financieros — y no todas están en .gitignore. Y el repo es PÚBLICO. Un
# `add -A` distraído los publica, y eso no se deshace con un revert: quedan en
# el historial y en cualquier fork. Así que se usa `git add -u`, que toca sólo
# archivos que ya están versionados y NUNCA agrega uno nuevo.
#
# El precio es que un archivo nuevo no entra solo. El script te lo lista para
# que lo veas, y lo agregás a mano con `git add <archivo>` antes de correrlo.

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"

ASSUME_YES=false
DO_PUSH=true
MESSAGE="${MSG:-}"

for arg in "$@"; do
  case "$arg" in
    --yes|-y)   ASSUME_YES=true ;;
    --no-push)  DO_PUSH=false ;;
    --help|-h)  sed -n '3,26p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*)         echo "Opción desconocida: $arg (probá --help)" >&2; exit 2 ;;
    *)          MESSAGE="$arg" ;;
  esac
done

branch="$(git rev-parse --abbrev-ref HEAD)"

# ── Qué se va a commitear ────────────────────────────────────────────────────
# `add -u`: modificados y borrados de archivos ya versionados. Nunca un archivo
# nuevo (ver el comentario de arriba).
git add -u

if git diff --cached --quiet; then
  echo "No hay cambios en archivos versionados para commitear."
  untracked="$(git ls-files --others --exclude-standard)"
  if [ -n "$untracked" ]; then
    echo
    echo "Hay archivos nuevos, que este script no agrega a propósito:"
    echo "$untracked" | sed 's/^/  /'
    echo
    echo "Si alguno tiene que entrar: git add <archivo> && ./scripts/commit-push.sh \"mensaje\""
  fi
  exit 0
fi

echo "En el commit (rama: $branch)"
git diff --cached --stat | sed 's/^/  /'

untracked="$(git ls-files --others --exclude-standard)"
if [ -n "$untracked" ]; then
  echo
  printf '\033[33mFuera del commit\033[0m — archivos nuevos, no se agregan solos:\n'
  echo "$untracked" | sed 's/^/  /'
  printf '  \033[33m↑ revisá que no haya nada de _staging_ acá: el repo es público\033[0m\n'
fi

# ── Mensaje ──────────────────────────────────────────────────────────────────
if [ -z "$MESSAGE" ]; then
  echo
  printf 'Mensaje del commit: '
  read -r MESSAGE
fi

if [ -z "$MESSAGE" ]; then
  echo "Sin mensaje, no commiteo. (Se cancela; lo stageado queda como está.)" >&2
  exit 1
fi

# El repo usa `tipo(scope): mensaje`. No lo fuerzo, sólo aviso.
case "$MESSAGE" in
  feat*|fix*|docs*|chore*|refactor*|style*|test*|perf*) ;;
  *) printf '\033[33mOjo:\033[0m el repo usa "tipo(scope): mensaje" (feat, fix, docs, chore, refactor...)\n' ;;
esac

# ── Confirmación ─────────────────────────────────────────────────────────────
if [ "$ASSUME_YES" != true ]; then
  echo
  if [ "$DO_PUSH" = true ]; then
    printf '¿Commitear y pushear a %s? [s/N] ' "$branch"
  else
    printf '¿Commitear? [s/N] '
  fi
  read -r answer
  case "$answer" in
    s|S|si|Si|SI|y|Y|yes) ;;
    *) echo "Cancelado. Lo stageado queda como está (git reset para deshacer)."; exit 0 ;;
  esac
fi

echo
git commit -q -m "$MESSAGE"
printf '\033[32m✓\033[0m %s\n' "$(git log -1 --oneline)"

if [ "$DO_PUSH" != true ]; then
  echo "(--no-push: no se subió nada)"
  exit 0
fi

git push -q origin "$branch"
printf '\033[32m✓\033[0m pusheado a origin/%s\n' "$branch"

# Pushear no deploya — el rebuild lo dispara el webhook, aparte. Pero Easypanel
# va a construir lo que acabás de subir, así que conviene que el build esté sano.
if [ "$branch" = "main" ]; then
  echo
  echo "main deploya a producción, pero recién cuando disparás el rebuild:"
  echo "  Cmd+Shift+Alt+D  (o ./scripts/deploy.sh)"
  echo "Antes conviene correr el build: Cmd+Shift+B"
fi
