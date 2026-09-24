# Воспитание.Про

Публичная автономная демоверсия: https://id140125-max.github.io/vospitanie-platform/

На GitHub Pages сервер и общая база не запускаются: данные демоверсии сохраняются только в браузере пользователя. Вход: `admin@vospitanie.local` или `advisor@vospitanie.local`, без пароля.

Open Source-платформа для советников директоров по воспитанию.

## Статус

Проект находится на этапе MVP-каркаса. Сейчас подготовлены React/Vite frontend, Node.js backend, PostgreSQL и базовая Prisma-модель для пользователей, заданий, отчётов и сообщений.

## Быстрый запуск

Требования: Docker Desktop и Docker Compose.

```bash
copy .env.example .env
docker compose up --build
```

После запуска:

- frontend: http://localhost:5173
- API: http://localhost:3000/api
- health-check: http://localhost:3000/api/health
- PostgreSQL: localhost:5432

## Запуск прототипа без Docker (Windows)

Для локальной разработки используются Node.js 24+, npm и PostgreSQL. Пример настроек находится в `backend/.env.local.example` и `frontend/.env.local.example`.

В backend установите переменные окружения, затем выполните:

```powershell
npm install
npx prisma generate
npx prisma db push
npm run prisma:seed
npm run build
npm start
```

В отдельном окне PowerShell для frontend:

```powershell
npm install
npm run dev
```

Прототип, поднятый в текущей рабочей сессии: `http://localhost:5173`. API: `http://localhost:3000/api`.

Для демонстрации можно включить `DEMO_MODE=true`: тогда существующий пользователь сможет войти по одному email без пароля. Не включайте этот режим в production.

## Авторизация API

Регистрация: `POST /api/auth/register` с JSON `{ "email", "password", "fullName" }`.
Вход: `POST /api/auth/login`. Для защищённых запросов передавайте `Authorization: Bearer <token>`.

Создание задания доступно ролям `COORDINATOR` и `ADMIN`. Новые пользователи получают роль `USER`; роль первого координатора нужно назначить напрямую в базе или через будущую админ-панель.

Основные маршруты заданий:

- `GET /api/tasks` и `GET /api/tasks/:id`;
- `POST /api/tasks`;
- `PATCH /api/tasks/:id`;
- `DELETE /api/tasks/:id`;
- `POST /api/tasks/:id/assign`;
- `PATCH /api/tasks/:id/status`.

Отчёты:

- `GET /api/reports`;
- `POST /api/reports` — создание или сохранение черновика по заданию;
- `PATCH /api/reports/:id/status` — проверка координатором.

Первый администратор создаётся автоматически из `ADMIN_EMAIL`, `ADMIN_PASSWORD` и `ADMIN_NAME` в `.env`. Администратор может назначать роли и блокировать пользователей через интерфейс.

Личные чаты: `GET /api/chats`, `POST /api/chats` (тело `{ "userId": "..." }`), `GET /api/chats/:id/messages`, `POST /api/chats/:id/messages`. Собеседника можно выбрать из каталога `GET /api/auth/directory`. При доступном Socket.IO сообщения приходят мгновенно, REST остаётся резервным способом отправки и загрузки истории.

Уведомления доступны через `GET /api/notifications` и `PATCH /api/notifications/:id/read`.

Вложения отчётов: `POST /api/reports/:id/files` с `multipart/form-data`, поле `files`. Разрешены PDF, DOCX, XLSX, JPG и PNG; максимум 5 файлов по 10 МБ. В локальном MVP они хранятся в Docker volume `uploads_data`.

Это прототип для локальной разработки: роли и региональные права координаторов, email-подтверждение, refresh-токены, S3-загрузка файлов, групповые чаты, WebSocket и ИИ-ассистент ещё не реализованы. Не размещайте персональные данные реальных сотрудников до завершения защиты, развёртывания и проверки доступа.

## Структура

- `backend/` — API и Prisma-схема;
- `frontend/` — React-интерфейс;
- `docs/` — проектная документация;
- `docker-compose.yml` — локальное окружение.

## Следующие шаги

1. Добавить миграции Prisma и seed справочников.
2. Реализовать регистрацию, JWT и роли.
3. Добавить CRUD заданий и отчётов.
4. Подключить MinIO для файлов.
5. Перенести файлы из локального volume в MinIO/S3 для production.
6. Реализовать WebSocket-чат и email/web-push уведомления.
7. Добавить ИИ-ассистента с подтверждением действий пользователя.

Проект планируется распространять под лицензией MIT.
