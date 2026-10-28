# Надёжные сессии и realtime — Implementation Plan

## Цель

Пересобрать авторизацию и WebSocket в единый предсказуемый контур:

- пользователь не разлогинивается из-за краткой недоступности сервера;
- серверный рестарт тихо восстанавливает realtime;
- истёкшая или отозванная сессия завершается один раз, без циклов;
- браузер не хранит auth-секреты и не передаёт их в URL;
- reconnect не создаёт лишнюю нагрузку;
- WebSocket остаётся ускорителем доставки, а не единственным источником истины.

## Ограничения и решения

- Один origin: Angular SPA и Go API работают через `app.vslav.dev`.
- Один текущий Go-инстанс и SQLite; дополнительная инфраструктура не нужна.
- Приоритет: простота, корректность, низкая нагрузка.
- Выбор: одна непрозрачная серверная сессия в `HttpOnly` cookie, вместо JWT access/refresh в `localStorage`.
- Сессия хранится на сервере хешем, имеет срок, отзыв и редкое продление. Cookie никогда не читает JavaScript.
- Протокол realtime остаётся одним WebSocket. Критичные пользовательские записи остаются HTTP + существующая идемпотентная очередь.

## Что есть сейчас

### Авторизация

- Login возвращает пару JWT в JavaScript; access и refresh лежат в `localStorage`.
- Access действует 24 часа, refresh — 31 день.
- Оба JWT имеют один тип и одинаковые claims. Пока access действителен, его можно передать в refresh endpoint как refresh token.
- Logout очищает только клиентское состояние; сервер не знает об отзыве.
- Обычный HTTP `401` проходит через interceptor: параллельные запросы делят один refresh.
- Недоступность сервера не должна разлогинивать пользователя — это уже частично соблюдено.
- Bootstrap, роутинг, settings readiness и очистка кэшей уже выделены, но зависят от JWT в браузере.

### WebSocket

- Соединение создаётся после login/bootstrap и при каждом закрытии повторяется через фиксированные 5 секунд.
- В URL передаются access JWT и tab id. JWT попадает в Nginx access log.
- Browser WebSocket обходит HTTP interceptor, поэтому `401` handshake не запускает refresh.
- Нет backoff, jitter, классификации отказа или верхней границы попыток при невалидной сессии.
- Сервер проверяет JWT только при handshake. Уже открытое соединение не знает об expiry/logout/revocation.
- Проверка origin разрешает любой origin.
- Серверный hub хранит raw JSON-сообщения и молча игнорирует неизвестные/ошибочные сообщения.
- Metrics-подписки не удаляются в момент закрытия клиента; очистка происходит только при следующей попытке отправки.

### Потребители realtime

- Food: межвкладочная синхронизация дневника, каталога и веса; после reconnect сверяется серверная метка изменения.
- Metrics: подписка на live updates и отдельная HTTP delta-history recovery.
- Поиск: запрос/ответ ephemeral; сообщение, потерянное при обрыве, не переигрывается.
- Frontend telemetry: очередь с ACK, но без ACK timeout; потерянный ACK может остановить drain до следующего disconnect.
- Voice: frontend шлёт start/chunk/stop, но backend не регистрирует эти handlers. Сообщения теряются молча.

### Storage и lifecycle

- Cache namespace строится из JWT payload. После ухода от JWT ему нужен явный session user id.
- Logout сбрасывает stores и user-scoped storage. Diary IndexedDB очищается отдельным эффектом.
- Асинхронные ответы, начатые до logout/user switch, не имеют общей защиты от поздней записи состояния.
- Online state дублируется в двух сервисах.

## Целевая архитектура

```text
Browser
  HttpOnly session cookie ── HTTP / WS ──> Go session middleware ──> current user
       ^                                  │
       └──── login / renew / logout ──────┴──> hashed session row in SQLite

Session state ──> Realtime state ──> domain subscriptions and recovery
             └─> routes, settings, scoped stores, cache namespace
```

### Session contract

- Cookie: opaque random identifier, `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`.
- SQLite session row: user, hash of secret, issue/expiry/renewal timestamps, revoke timestamp.
- Login creates a fresh session and sets cookie. Register remains separate.
- Bootstrap reads one authenticated session endpoint and receives current user plus expiry.
- Logout revokes current server session, clears cookie, closes its active WebSocket clients, then clears browser state.
- Session renewal occurs only near expiry, at most once per configured long interval. Нет фонового refresh каждые минуты.
- Expired, revoked or malformed cookie returns one definitive `401`.
- Backend unavailable returns transport/`5xx`; session state stays authenticated, transport becomes degraded.
- Auth middleware reads current user from the session row, поэтому роль и отзыв действуют сразу для HTTP и нового WS.
- Unsafe HTTP requests require same-origin validation. WS accepts only configured frontend origins.

### Frontend state boundaries

- Session state: `unknown`, `guest`, `authenticated`. Это только факт авторизации.
- Realtime state: `stopped`, `connecting`, `connected`, `waiting`, `offline`. Это только транспорт.
- Нет состояния «guest because server is down».
- Один session owner запускает bootstrap/login/renew/logout/invalidate и выдаёт current user id для storage.
- Один realtime owner зависит от session state; session owner не зависит от WebSocket.
- HTTP interceptor больше не добавляет токены и не выполняет refresh. Его единственная auth-реакция: окончить сессию после definitive `401` от protected endpoint.
- Все protected stores получают session generation. Результат старого запроса не может примениться после logout/user switch.

### Realtime contract

- WS использует session cookie; URL содержит только не-секретный tab id.
- Tab id хранится в `sessionStorage`: стабилен для вкладки, новый для новой вкладки.
- После connect клиент восстанавливает только декларативно нужные подписки.
- После disconnect reconnect идёт с exponential backoff и jitter: короткая первая попытка, затем рост до ограниченного тихого интервала.
- Backoff сбрасывается только после устойчивого соединения, не после мгновенного `open`/`close`.
- Offline и hidden page не крутят reconnect loop; при возвращении online/visible попытка идёт сразу.
- После неуспешного handshake выполняется один session probe: `401` завершает сессию, transport/server failure продолжает backoff.
- Сервер закрывает уже открытые WS при logout/revoke/expiry с прикладным close code. Клиент понимает его без probe и прекращает reconnect.
- Inbound protocol имеет версию, ограниченный набор typed сообщений, проверку payload и наблюдаемые причины отклонения. Нет silent drop для поддерживаемой команды.
- WebSocket не переносит authoritative writes. HTTP idempotency queue остаётся единственным каналом сохранения пользовательских изменений.

### Recovery rules

| Событие | Итог |
|---|---|
| Рестарт backend | WS закрывается, backoff восстанавливает соединение; сессия и кэш живут. |
| Краткий сетевой сбой | Нет logout; reconnect растёт с jitter и прекращается offline/hidden. |
| Истёкшая/отозванная сессия | Один invalidate, очистка, redirect `/auth`, reconnect остановлен. |
| Logout в другой вкладке | Сервер отзывает сессию и закрывает её WS; все вкладки приходят к guest. |
| Потерянный realtime event | Подписка восстанавливается; food сверяет revision, metrics забирают HTTP delta. |
| Потерянный search request | При connect переигрывается только текущий актуальный query. |
| Потерянный telemetry ACK | Ограниченная очередь ждёт ACK timeout и повторяет безопасный batch после reconnect. |
| Неподдерживаемый voice flow | Не отправляется молча: удалить из протокола/интерфейса до отдельной end-to-end реализации. |
| Поздний ответ старой сессии | Игнорируется по session generation. |

## Реализация

### 1. Зафиксировать контракт и миграцию

- ✅ Cookie session: 30 дней, renewal window 7 дней.
- ✅ Добавлена новая migration server sessions.
- ✅ Единственный session API: session, login, renew, logout.
- ✅ Cookie flags: HttpOnly, SameSite=Lax, Secure через HTTPS/X-Forwarded-Proto.
- ✅ WS коды: revoke, expiry, renew, server shutdown.

### 2. Переписать backend auth boundary

- ✅ Session repository/service: random secret, hash at rest, expiry, revoke, cleanup expired rows.
- ✅ Login/session/logout/renew переведены на cookie contract; runtime JWT path удалён.
- ✅ Auth middleware читает session и current user.
- ✅ Identity передаётся в handlers через request context.
- ✅ Mutation requests защищены same-origin check.
- ✅ Добавлены auth unit/HTTP tests: login, session, revoke, logout.

### 3. Переписать backend WS boundary

- ✅ WS handshake аутентифицируется cookie; URL содержит только tab id.
- ✅ Origin ограничен same-origin и локальными dev origins.
- ✅ Client связан с session id/expiry; закрывается при revoke/expiry/shutdown.
- ✅ Metrics subscription очищается при disconnect.
- ⭕ Typed envelopes и полная валидация payload.
- ✅ Нерабочий voice WebSocket path удалён до отдельной feature.
- ✅ Добавлены WS tests: cookie auth, foreign origin, revoke.

### 4. Собрать frontend session owner

- ✅ JWT storage заменён user/expiry session state.
- ✅ Token decoder/getter/interceptor path удалён.
- ✅ Login/bootstrap/renew/logout/invalidate — session owner.
- ✅ Invalidate идемпотентно останавливает realtime и очищает user state.
- ✅ Cache namespace привязан к user id и blocked до bootstrap.
- ✅ Session generation добавлен как общий lifecycle marker.
- ✅ Online listeners сведены к NetworkService.

### 5. Собрать frontend realtime owner

- ✅ Transport state, reconnect policy и tab id выделены.
- ✅ WS стартует только для session owner; reconnect defer в offline/hidden.
- ✅ Backoff+jitter, stable reset и session probe добавлены.
- ✅ Terminal auth failure отделён от transient transport failure.
- ✅ Metrics desired subscription replay сохраняет существующий effect.
- ✅ Последний catalogue search replay после reconnect.
- ✅ Telemetry ACK timeout снимает зависший in-flight batch.
- ✅ Нерабочий voice WebSocket path удалён.

### 6. Сохранить корректную domain recovery

- ✅ Food: HTTP writes, optimistic rollback и idempotency сохранены; после reconnect переигрывается только актуальный search.
- ✅ Metrics: WS live updates и HTTP delta-history сохранены; подписка восстанавливается declarative effect.
- ⭕ Settings/money/food: применить session generation к async load и mutation callbacks.
- ✅ User-scoped localStorage/IndexedDB blocked вне authenticated session; logout очищает scoped storage.

### 7. Наблюдаемость и rollout

- ⭕ Логировать WS lifecycle без cookie, token, query payload и персональных данных.
- ⭕ Добавить счётчики: active connections, reconnect result, terminal auth invalidation, rejected message, recovery duration.
- ⭕ Подготовить один совместимый deploy: backend migration/API первым, frontend вторым; не оставлять mixed auth protocol.
- ⭕ Добавить rollback: вернуть предыдущий frontend только пока backend временно принимает старый contract; после cutover удалить legacy auth полностью.

### 8. Проверочная матрица

- ✅ Fresh browser, reload, login, logout в двух вкладках: пройдено локально в Chrome.
- ✅ Backend restart во время открытого WS: пройдено локально; socket сам восстановился, `401` нет.
- ⭕ Интернет offline/online, hidden/visible tab, backend `5xx`/timeout.
- ✅ Logout в другой вкладке: обе вкладки перешли на `/auth`; expiry/revoke покрыты backend tests.
- ⭕ Несколько tabs, metrics subscription, food sync, search during disconnect.
- ⭕ Потерянный telemetry ACK и queue cap.
- ✅ WS URL и локальный backend log не содержат auth secret; cookie не инспектировалась, она `HttpOnly` по contract.
- ✅ Go unit/HTTP/WS tests, frontend production build и ручной browser smoke: пройдены.

## Вне этого плана

- Multi-instance session replication и message broker: не нужны одному текущему инстансу.
- Полноценный voice streaming: отдельная feature с серверным протоколом, буферизацией и UX ошибок.
- Новые доменные функции food/money/metrics: только их transport/lifecycle boundary.

## Критерии готовности

- Нет бесконечных `401` или fixed-interval reconnect loops.
- Рестарт backend восстанавливает realtime сам и без logout.
- Logout/revoke закрывает HTTP/WS доступ всех вкладок этой сессии.
- Auth cookie, WS URL и логи не содержат bearer JWT/refresh secret.
- Нет silent drop для заявленного WebSocket message type.
- Один восстановленный socket даёт один replay подписок и один domain recovery, без fan-out запросов.
- Никакой ответ старой сессии не меняет state нового пользователя.
