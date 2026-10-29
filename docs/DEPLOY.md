# Деплой

Платформа — один контейнер Node (Next.js в режиме standalone) и PostgreSQL. Redis и очереди не нужны:
опрос каналов и живые обновления работают внутри процесса приложения.

## Сервер

- Ubuntu 22.04/24.04, 2 vCPU, 2–4 ГБ памяти, 20+ ГБ диска; Docker и Docker Compose.
- Сервер в России — данные обращений (имена, телефоны, переписка) по 152-ФЗ должны храниться в РФ.

## Первый запуск

```bash
git clone <репозиторий> dom-inbox && cd dom-inbox
cp .env.example .env
```

Заполнить `.env`:

| Переменная | Что указать |
|---|---|
| `APP_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — **сохраните отдельно**: без него сохранённые ключи каналов не расшифровать |
| `APP_URL` | `http://<IP сервера>:3050`, позже `https://<домен>` |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | первый администратор (создаётся, если сотрудников ещё нет) |
| `POSTGRES_PASSWORD` | пароль встроенной базы |
| `TELEGRAM_API_BASE` | необязательно: прокси Bot API, если api.telegram.org недоступен с сервера |

`DATABASE_URL` в docker-compose собирается автоматически.

```bash
docker compose up -d --build
docker compose logs -f app   # «[boot] Создан администратор …», «Каналов запущено: N»
```

Платформа: `http://<IP>:3050`. Проверка живости: `GET /api/health`.

## Домен и HTTPS

Нужен для Одноклассников, WhatsApp, Instagram и вебхука Telegram. Перед контейнером ставится nginx
или Caddy; пример для Caddy:

```
inbox.fundhome.ru {
  reverse_proxy 127.0.0.1:3050
}
```

После этого — `APP_URL=https://inbox.fundhome.ru` в `.env` и `docker compose up -d`.
Для nginx важно не буферизовать живые обновления: у `location /api/stream` —
`proxy_buffering off;` и `proxy_read_timeout 1h;`.

## Обновление

```bash
git pull && docker compose up -d --build
```

Миграции базы применяются автоматически при старте. Перед обновлением снимайте копию базы:

```bash
docker compose exec db pg_dump -U dom dom_inbox | gzip > backup-$(date +%F).sql.gz
```

## Резервные копии

- База: `pg_dump` по расписанию (cron), копии — в другое место.
- Вложения: том `files` (`/app/storage` в контейнере).
- `APP_SECRET` — храните вместе с копиями: без него ключи каналов из копии не восстановить
  (сами обращения и переписка читаются и без него).

## Один экземпляр

Опрос каналов и живые обновления рассчитаны на один экземпляр приложения. Если когда-нибудь
понадобится второй, на нём ставится `CONNECTORS=off`, а живые обновления переводятся на
PostgreSQL LISTEN/NOTIFY.
