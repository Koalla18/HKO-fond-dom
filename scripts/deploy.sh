#!/usr/bin/env bash
# Выкладка на сервер: сборка здесь, на сервере — только образ из готовых файлов.
#   scripts/deploy.sh                    # на сервер по умолчанию
#   DEPLOY_HOST=user@1.2.3.4 scripts/deploy.sh
# Первый запуск сам создаёт на сервере .env со случайными ключами и паролем администратора
# (пароль в выводе не печатается: ssh <сервер> grep ADMIN_PASSWORD <папка>/.env).
set -euo pipefail
HOST="${DEPLOY_HOST:-jakone@31.130.155.216}"
DIR="${DEPLOY_DIR:-dom-inbox}"
cd "$(dirname "$0")/.."

echo "→ Сборка"
cp next-env.d.ts /tmp/dom-next-env.bak 2>/dev/null || true
rm -rf .next/standalone
npm run build >/dev/null
[ -f /tmp/dom-next-env.bak ] && cp /tmp/dom-next-env.bak next-env.d.ts

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/app/.next"
# Локальные вложения (storage) и бинарники sharp под macOS на сервер не везём.
rsync -a --exclude storage --exclude '.env*' --exclude 'node_modules/@img/sharp-darwin*' --exclude 'node_modules/@img/sharp-libvips-darwin*' .next/standalone/ "$STAGE/app/"
rsync -a .next/static "$STAGE/app/.next/"
rsync -a public "$STAGE/app/"
cp deploy/Dockerfile.prebuilt deploy/docker-compose.server.yml "$STAGE/"

echo "→ Загрузка на $HOST:$DIR"
[ -n "$DIR" ] || { echo "DEPLOY_DIR пуст" >&2; exit 1; }
# rsync на сервере может не быть — везём архивом; .env и тома базы не трогаем.
tar -C "$STAGE" -czf - . | ssh "$HOST" "mkdir -p '$DIR' && find '$DIR' -mindepth 1 -maxdepth 1 ! -name .env -exec rm -rf {} + && tar -C '$DIR' -xzf -"

echo "→ Запуск"
ssh "$HOST" "cd $DIR && bash -s" <<'REMOTE'
set -euo pipefail
if [ ! -f .env ]; then
  ip="$(curl -fsS --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
  umask 077
  cat > .env <<ENV
APP_SECRET=$(head -c 32 /dev/urandom | base64)
APP_URL=http://$ip:3050
ADMIN_EMAIL=admin@dom.local
ADMIN_PASSWORD=$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)
ADMIN_NAME=Администратор
CONNECTORS=on
POSTGRES_PASSWORD=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')
ENV
  echo "  создан .env (ключи и пароль администратора — в нём, в вывод не печатаются)"
fi
docker compose -f docker-compose.server.yml up -d --build
docker image prune -f >/dev/null
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:3050/api/health >/dev/null; then echo "  платформа отвечает"; exit 0; fi
  sleep 2
done
echo "  платформа не ответила за минуту — docker compose -f docker-compose.server.yml logs app" >&2
exit 1
REMOTE
