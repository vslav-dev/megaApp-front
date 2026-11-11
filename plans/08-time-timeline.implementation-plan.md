# TIME — Implementation Plan (Frontend)

Перенос концепта [`TIME._concept.md`](../../TIME._concept.md) на код `megaapp-front`. Layout и структура экрана — калька с MONEY. Демо [`TIME.claude-demo.html`](../../TIME.claude-demo.html) — **только визуальный/UX-референс** (как это должно выглядеть и ощущаться при драге/ресайзе/добавлении), написан без единого взгляда в реальный код проекта и без оглядки на Angular — его JS не переносится, переносится сам приём взаимодействия. Реализация — по нормам текущего Angular (v21, standalone, signals) и принятым в проекте паттернам (money/food), на максимально доступном сейчас уровне качества.

Статистика в этой итерации **не реализуется** — см. отдельный раздел «Отложено на будущее» в конце. Везде ниже речь только про экран ввода.

## Как сейчас

- Фичи TIME на фронте нет вообще.
- **Layout-эталон — `money-screen.html`**: `flex` из двух колонок. Левая — `w-96 flex-shrink-0`, внутри `v-card` с рядом `v-button` (переключатель `activeTab$$`, стили `v-flat`/`v-link`/`v-link-static`, `isLabelHidden` вне активной вкладки), ниже — стек других `v-card` с CRUD-списками (`accounts-list`, `categories-list` и т.д.), видимость которых зависит от `activeTab$$`. Правая — `flex-1`, стек `v-card` с контентом (в money — графики).
- **Локальное хранилище — эталон `BaseFoodService`** (`services/food/food-base.service.ts`): абстрактный класс с `LocalStorageService` (`getUserScoped`/`setUserScoped`, ключ через `buildCacheKey` — юзер-скоуп встроен), `NetworkService` (`isNetworkAvailable$$()`), `SyncQueueService` (очередь офлайн-операций с retry+rollback). `FoodDiaryService extends BaseFoodService` — это более современный и надёжный паттерн, чем прямые вызовы `localStorage.setItem` в `money.service.ts` (старый код, не образец для нового).
- **`SyncQueueService` (`services/sync-queue.service.ts`) уже делает ровно то, что нужно по механике retry/уведомлений**, и переиспользуется как есть: `addOperation` ставит операцию с `retryCount`, `runOperation` крутит `while(true)` — при ошибке `retryCount++`, до `BACKGROUND_SYNC_RETRIES_MAX = 3` попыток с задержкой `1000*retryCount` мс между ними; при финальной неудаче — `rollbackCallback()` + `NotificationService.addNotification('error', ...)` (красное); при успехе — `successCallback(response)` + `('success', ...)` (зелёное); пока ждём — если ответа нет дольше `NOTIFICATION_PENDING_DELAY_MS` (1500 мс), всплывает `('warning', ...)` (жёлтое, persistent, снимается по завершении). Ровно тройка жёлтый/зелёный/красный, которую просил пользователь, — уже реализована, ничего нового изобретать не нужно.
- **Но `SyncQueueService` сейчас последовательный, single-flight**: внутренний `queue: SyncOperation[]` + `isProcessing`-флаг — `processQueue()` берёт операции по одной (`while (queue.length > 0) await runOperation(...)`), следующая не уходит на сервер, пока предыдущая (включая все её ретраи) не завершится. Для money/food это ок (создание транзакции/записи дневника — редкое одиночное действие). Для TIME **не подходит как есть** — см. решение ниже.
- **Загрузка данных — сейчас в FOOD диапазонная** (`getFoodDiaryFullUpdateRange(dateIso, offset)` → `GET /api/food/diary-full-update`, мердж по датам в сигнал, `saveToLocalStorage`, подгрузка новых диапазонов по мере скролла). Для TIME это **не подходит** — см. решение ниже.
- Роутинг — lazy `loadComponent` в `app-routes.ts`, guards `authGuard`+`settingsReadyGuard`+`isChapterSelected`.
- UI-kit: `v-dropdown` (mode `search` — автокомплит по подстроке), `v-modal`, `v-button`, `v-card`, `v-toggle`, `v-input`. Компонента выбора цвета нет вообще — не только под TIME, в UI-ките такого примитива никогда не было.
- Драг/ресайз нигде не через CDK (`@angular/cdk` в проекте вообще не установлен) — везде кастомные `pointerdown`/`pointermove`/`pointerup`, прецедент — `v-slider`.
- Цвет категорий на экранах — паттерн `[style.background]` уже есть (`income-chart.html`), но там цвет только читается, нигде в проекте нет формы, которая цвет бы задавала/редактировала.

## Как должно быть

### Экран — калька структуры MONEY, с одним осмысленным отличием

- Левая колонка: `w-96 flex-shrink-0`, **всегда видна целиком, без сворачивания и без вкладок** (в отличие от money, где вкладки скрывают часть левой колонки) — весь `Setup`-контент money здесь укладывается в один постоянный стек: снап-настройка по умолчанию, `activities-list`+`activity-form`, `categories-list`+`category-form`. Скрываемость левой колонки — явно не в этой итерации, отдельная будущая задача.
- Наверху левой колонки — тот же визуальный компонент, что переключатель вкладок в money (`v-card` с рядом `v-button`, стили `v-flat`/`v-link`/`v-link-static`), но **ровно 2 кнопки** и они управляют **не левой, а правой колонкой**: «Ввод» / «Статистика» (`TimeScreenView` как `as const`-объект `{Entry: 'entry', Stats: 'stats'}` — новый код, по текущей Angular-конвенции проекта, не TS `enum`, которым сделан старый `MoneyTab`).
- Правая колонка: `flex-1`, один `v-card`-контейнер. `@if (activeView$$() === TimeScreenView.Entry)` → доска-таймлайн (полотно). `@if (activeView$$() === TimeScreenView.Stats)` → заглушка «Статистика — в разработке» (см. «Отложено на будущее»).
- Явное разделение по смыслу: левая колонка = все *настройки и справочники* (не меняют полотно напрямую); правая = *прямая работа с записями* (полотно + быстрое добавление). Снап-гранулярность — настройка, значит в левой колонке, не на полотне (в демо была в тулбаре над доской — переносится в settings-card).

### Роутинг

`app-routes.ts`: маршрут `time` (без вложенных `:section` — переключение видов внутри экрана идёт локальным сигналом компонента, а не роутом, ровно как в money `activeTab$$` не завязан на URL), guards `authGuard`/`settingsReadyGuard`/`isChapterSelected`.

### Загрузка данных — полный локальный датасет, никакой пагинации

История — не бесконечный источник с сервера, а конечный и небольшой набор (сейчас порядка 1500 дней = единицы МБ JSON). Сетевая infinite-scroll-пагинация ("подгрузить ещё 20 строк при скролле") отклонена как источник задержек/лагов при плохой сети — вместо неё:

- **`TimeEntriesService`** (аналог `FoodDiaryService`, наследует общий `BaseTimeService` по образцу `BaseFoodService` — тот же `LocalStorageService`/`NetworkService`/`SyncQueueService`) хранит **весь** массив `TimeEntry` пользователя в одном сигнале `entries$$: WritableSignal<TimeEntry[]>`, не диапазон.
- Инициализация (один раз при первом обращении к фиче):
  1. Пробуем `loadFromLocalStorage<TimeEntry[]>()`. Если данные есть — сразу `entries$$.set(cached)` (мгновенная отрисовка без ожидания сети), и **параллельно**, в фоне, запрашиваем у бэка только свежий хвост (последние ~7–14 дней — на случай правок с другого устройства/вкладки), мёрджим результат в `entries$$` (замена записей за этот период, как в `getFoodDiaryFullUpdateRange` — `{...old, ...fresh}` по ключу) и перезаписываем `localStorage`. Без сравнения версий/диффа — просто каждый раз перезатираем этот хвост, как и предложено ("не паримся").
  2. Если в `localStorage` пусто (первый запуск) — грузим **всю** историю целиком (`GET /api/time/entries`, без диапазона) и одним вызовом заполняем `entries$$` + `localStorage`. Ожидается разовый экран загрузки на первый визит, дальше — мгновенно из кэша всегда.
- Мутации (create/update/delete/move/resize) — оптимистично применяются к `entries$$` сразу (для отзывчивости драга) через `SyncQueueService` (тот же паттерн rollback, что в money `createTransaction`/food diary), и сразу переписывают `localStorage` — локальный кэш всегда синхронно отражает то, что видно на экране, независимо от фонового обновления хвоста.
- Бэковый эндпоинт `GET /api/time/entries` продолжает поддерживать необязательный `start` (см. бэковый план) — параметр используется только для двух сценариев выше (полная загрузка при пустом кэше = без `start`; обновление хвоста = `start` = today-N), не как постраничный курсор для скролла.

### Производный индекс по дням — для рендера доски

Полотно рендерит записи по дням/дорожкам; линейный `entries$$.filter(...)` на каждую видимую строку при 1500+ записях в массиве — расточительно на каждый рендер. Вместо этого — один `computed` в сервисе/компоненте: `Map<dateIso, { primary: TimeEntry[]; secondary: TimeEntry[] }>`, пересчитывается один раз при изменении `entries$$`, дальше рендер строки — O(1) по ключу дня.

### Синхронизация с сервером — оптимистично и параллельно, без очереди

Требование: каждое изменение (move/resize/create/delete записи) применяется оптимистично сразу, уходит на сервер с теми же 3 попытками/уведомлениями, что и в FOOD, но при этом **несколько быстрых правок подряд не должны ждать друг друга** — драг пяти отрезков подряд не может блокироваться тем, что первая правка ещё крутит ретраи. Ответы с сервера при этом могут приходить не в том порядке, в котором ушли запросы (какая-то правка быстрая, какая-то медленная, какая-то падает) — система должна разрулить это корректно, без централизованной очереди.

- **Расширить `SyncQueueService`, не дублировать его.** Добавить `addOperation` необязательный флаг режима (например `concurrent?: boolean`, по умолчанию `false` — money/food не меняют поведение). При `concurrent: true` операция не кладётся в `this.queue`/не ждёт `processQueue()` — уходит напрямую в уже существующий приватный `runOperation(operation)` без `await` со стороны вызывающего кода. Весь retry/backoff/notification-код при этом переиспользуется буквально как есть (`runOperation` уже самодостаточен и ничего не знает о том, вызвали его из очереди или напрямую) — минимальное, обратно совместимое изменение общего сервиса.
- **Callback'и успеха/отката — по конкретной записи (по id), никогда по снапшоту всего массива.** Если откатывать через снапшот "всего `entries$$` на момент начала операции" (как сделано в `money.service.ts` для `createTransaction`), при параллельных операциях более поздний уже успешно применённый ответ по другой записи будет случайно затёрт откатом более ранней упавшей операции — именно та ошибка, которой опасается пользователь ("5 быстрых изменений, ответы вперемешку"). Вместо этого на каждый тип мутации — точечный откат по id:
  - **create** — оптимистично добавляем запись с временным (например отрицательным) локальным id. Успех → заменить временный id на серверный (`entries$$.update(list => list.map(e => e.id === tempId ? {...e, id: serverId} : e))`). Провал после 3 попыток → убрать именно запись с этим `tempId` (`filter`), остальные записи не затронуты.
  - **update/move/resize** — перед оптимистичным применением запомнить предыдущие поля именно этой записи (`startAt`/`endAt`/`activityId`/`track`), не весь массив. Провал после 3 попыток → вернуть именно этой записи (по id) старые поля, остальные записи как есть.
  - **delete** — запомнить саму запись перед оптимистичным удалением. Провал после 3 попыток → вставить её обратно (если её id всё ещё отсутствует в массиве).
- **Конфликт перекрытия интервалов — уже решается на бэке существующей проверкой, ничего нового городить не нужно.** Сценарий пользователя ("подвинул один отрезок и сразу же — другой на освободившееся место, а первый в итоге упал") закрывается тем же app-level инвариантом overlap-check, который и так уже спроектирован в бэковом плане (см. [`08-time-module.implementation-plan.md`](../../megaapp-back/plans/08-time-module.implementation-plan.md), раздел «Сервис — инварианты», включая обязательную транзакцию на проверку+запись) — при пересечении бэк просто возвращает ошибку на конкретный запрос, фронт трактует её как обычный неуспех (3 попытки → откат именно этой записи по правилам выше). Никакой очереди/сериализации на фронте ради этого редкого кейса не делаем — это осознанное решение (проще, и цена ошибки — откат одной записи, а не блокировка всего экрана).
- **Фронт намеренно не пытается сам детектировать/чинить невалидное состояние** (например визуально пересекшиеся отрезки после серии частичных успехов/откатов) — такая проверка на фронте не нужна и не пишется: это дополнительная хрупкая логика ради крайне редкого случая, который и так закрыт транзакцией на бэке. Два независимых предохранителя вместо этого: (1) фоновое обновление хвоста последних дней (см. «Загрузка данных» выше) при каждой загрузке экрана безусловно перезатирает локальный кэш реальными данными с бэка — любая случайная локальная нестыковка самоустраняется без участия пользователя; (2) если что-то всё же визуально зависло прямо сейчас — просто уведомление вида «непредвиденная ситуация, обновите страницу», без попытки авто-восстановления на месте. Источник истины всегда бэк, фронт его не оспаривает и не переисчисляет.

### Доска таймлайна — переосмысленная реализация, не перенос демо

Демо фиксирует **что** должно происходить визуально: сетка дней (дорожки primary/secondary одна над другой в пределах дня), цветные сегменты записей, драг сегмента для переноса, хендлы по краям для ресайза, кнопка удаления по ховеру, стрелки-продолжения на записях, пересекающих границу дня (сон через полночь), snap-подсказка при вводе, "призрачный" preview свободного слота, поинтер-based DnD без нативного HTML5 drag (у него плохая поддержка touch — важно, если приложение открывается с телефона).

Что меняется при переносе на реальный Angular-код:
- Никакого императивного `innerHTML`-рендера — разметка декларативная: `@for` по списку видимых дней (из индекса выше) → внутри `@for` по primary/secondary записям дня.
- Драг/ресайз — не монолитный vanilla-класс, а компонент с сигналами состояния (`draggingEntryId$$`, `previewSlot$$`, `snapMinutes$$` как входной сигнал из настройки в левой колонке) и вынесенными в чистые функции алгоритмами разметки/ограничений (позиция и ширина сегмента от интервала записи и окна строки; ограничение перетаскивания/ресайза соседними записями того же трека; поиск свободного слота под клик) — это делает их независимо тестируемыми и не завязанными на DOM, в отличие от демо. Поинтер-события навешиваются через `host: {}` в декораторе компонента (текущая конвенция проекта), не императивными `addEventListener` россыпью. `v-slider` — прецедент "поинтер-драг без CDK", не код-донор.
- **Создание записи — один способ, не два, как в демо.** В демо было два пути: (а) перетащить цветную "фишку" активности из тулбара на дорожку, (б) кликнуть по свободному месту → выбор активности. Первый способ (native HTML5 drag chip) на touch-устройствах ненадёжен и дублирует второй без реальной пользы — оставляем только клик по свободному слоту → открывается `v-dropdown` в режиме поиска (по подстроке, как задумано в концепте), с "последними использованными" активностями наверху списка. Так проще, меньше кода, лучше на мобильном.
- Виртуализация 1500+ строк дней — без новой зависимости (`@angular/cdk` в проекте не установлен, и добавлять его только ради virtual-scroll — лишняя тяжесть для персонального проекта). Сначала — простой `@for` по всем дням; если реальный профилинг покажет тормоза при полной прокрутке истории — точечно применить CSS `content-visibility: auto` на строку дня (дешёвая браузерная виртуализация без библиотек и без изменения структуры компонента). Не делать заранее, пока не станет реальной проблемой на реальных данных.
- Якорь прокрутки при открытии — сегодняшний день (последняя дата, не начало истории 2021 года) — прошлое доступно скроллом вверх, всё уже в памяти, задержек нет.

### Цвет — зафиксированное решение, включая базовый color picker для UI-кита

- Цвет живёт на `Category` (см. концепт, раздел 3), не на `Activity` — в отличие от демо, где цвет был жёстко зашит прямо на активности; на реальных данных активность может иметь несколько категорий, категория переиспользуется — красить по категории осмысленнее и не требует дублирования цвета на каждую активность.
- В UI-ките никогда не было компонента выбора цвета — нужен новый базовый примитив `v-color-picker`, а не разовая вёрстка только для `category-form`: он пригодится в любом будущем месте, где потребуется выбрать цвет (не только TIME).
  - Файлы по стандартной структуре UI-кита: `ui-kit/components/v-color-picker/{v-color-picker.ts, v-color-picker.html, v-color-picker.css, readme.v-color-picker.md}` — по образцу `v-dropdown`/`v-toggle`. Как и у остальных UI-kit компонентов (искл. в Angular-правилах проекта) — `.css`, не `.scss`, без Tailwind в разметке.
  - Функционально — две части в одном компоненте: (1) сетка предустановленных свотчей (curated-палитра, кнопки-квадраты) для быстрого выбора одним кликом; (2) возможность задать **произвольный** цвет, не ограничиваясь пресетами — простейший вариант без новой библиотеки: нативный `<input type="color">` рядом с сеткой свотчей. Пресеты закрывают частый случай одним кликом, нативный инпут закрывает "добавить новый цвет", когда пресетов не хватает — без раздутия компонента до полноценного HSL/RGB-пикера, что для личного проекта избыточно.
  - Сигнальный API как у остальных UI-kit компонентов: `value` (текущий цвет, hex-строка), `(onChanged)`/аналог существующих output-конвенций компонента (свериться с `v-checkbox`/`v-toggle` перед реализацией, не изобретать новое соглашение).
- `category-form` использует `v-color-picker` для поля `Category.color` — создание и редактирование цвета доступны в одном и том же месте, где создаётся/редактируется сама категория, отдельного экрана/модалки под цвет не нужно.
- Цвет свободно редактируется в любой момент (концепт не накладывает ограничений на редактирование `Category`, в отличие от `Activity.isArchived`-инварианта) — обычное поле формы.
- Приоритет для покраски сегмента на доске, если у Activity несколько Category: первая категория с `kind = Area`; если таких нет — первая категория из списка; если категорий нет вовсе — нейтральный дефолтный цвет.

## Что нужно сделать (изменения в существующем коде)

- `app-routes.ts` — маршрут `time` + guards.
- Новый базовый UI-kit компонент `ui-kit/components/v-color-picker/` (пресеты + нативный `<input type="color">`) — до или вместе с `category-form`, т.к. форма на него опирается.
- `services/sync-queue.service.ts` — расширить `addOperation`/`SyncOperation` необязательным флагом параллельного режима (`concurrent`), см. «Синхронизация с сервером» выше; поведение по умолчанию (money/food) не меняется.
- Новая директория `components/time/`: `time-screen.ts`+`.html` (layout как выше), `timeline-board/` (доска, сегмент, попап-пикер на `v-dropdown`), `activities-list/`+`activity-form/`, `categories-list/`+`category-form/` (на `v-color-picker`, kind, impact) — все по образцу соответствующих money-компонентов.
- Новая директория `services/time/`: `time-base.service.ts` (абстрактный класс — копия паттерна `BaseFoodService`), `time-catalogue.service.ts` (Activity+Category+связи, CRUD, "последние использованные"), `time-entries.service.ts` (полный локальный датасет, логика из раздела «Загрузка данных» выше, производный индекс по дням, параллельная синхронизация с per-entity rollback).
- Типы TIME (`TimeTrack`/`TimeCategoryKind`/`TimeImpact` как `as const`, интерфейсы Activity/Category/Entry, `TimeScreenView`) — в `shared/types.ts` либо в отдельном `time-types.ts`, если решим не смешивать с уже большим общим файлом (по факту размера на месте).
- `money`/`food`/`metrics` не трогаются — TIME полностью новая изолированная фича.

## To-do

- ✅ `app-routes.ts` — маршрут `time` + guards
- ✅ Типы: `TimeTrack`/`TimeCategoryKind`/`TimeImpact`/`TimeScreenView` (`as const`), интерфейсы Activity/Category/Entry, response-типы по паттерну money/food
- ✅ `ui-kit/components/v-color-picker/` — базовый компонент выбора цвета (пресеты + произвольный цвет), по конвенциям существующих UI-kit компонентов
- ✅ `services/time/time-base.service.ts` — абстрактный базовый класс (LocalStorage/Network/SyncQueue), по образцу `BaseFoodService`
- ✅ `services/time/time-catalogue.service.ts` — `activities$$`/`categories$$`, CRUD, "последние использованные"
- ✅ `services/sync-queue.service.ts` — параллельный режим (`concurrent`-флаг у `addOperation`), поведение по умолчанию для money/food не меняется
- ✅ `services/time/time-entries.service.ts` — полный локальный датасет + фоновое обновление хвоста + производный индекс по дням + оптимистичный CRUD записи с per-entity rollback (create/update-move-resize/delete — см. «Синхронизация с сервером»)
- ✅ `components/time/time-screen.ts`+`.html` — layout из двух колонок, переключатель Ввод/Статистика, постоянный стек настроек слева
- ✅ `components/time/timeline-board/*` — доска (индексированный рендер по дням), сегмент, попап-пикер (`v-dropdown` + последние использованные), собственная реализация драга/ресайза (не перенос демо-кода)
- ✅ `components/time/timeline-board/*` — единая row-grid структура: дата и дорожки в одной строке, шкала часов вне scroll-area
- ✅ `components/time/timeline-board/*` — базовый upward infinite scroll по пустым дням: старт с нижнего края, prepend старых дней при скролле вверх
- ✅ `components/time/timeline-board/*` — пунктирная hour-grid сетка поверх дорожек и обычных activity-сегментов
- ✅ `components/time/activities-list/` + `activity-form/` — CRUD Activity
- ✅ `components/time/categories-list/` + `category-form/` — CRUD Category (`v-color-picker`, kind, impact)
- ✅ Настройка снап-гранулярности по умолчанию — в левой колонке (не на полотне)
- ✅ Кнопка меню (десктоп + мобильный) — `services/navigation.service.ts`, `label: 'Дневник времени'`, `chapterSettingName: 'selectedChapterTime'`
- ✅ Тумблер раздела в настройках — `shared/types.ts`/`shared/const.ts`/`is-chapter-selected.guard.ts`/`components/settings/*` — `selectedChapterTime` по аналогии с food/money

## Отложено на будущее (не в этой итерации)

- Статистика (день/месяц/год/диапазон, группировки area/category/activity) — экран «Статистика» на этот раз только заглушка-плейсхолдер за переключателем; полноценная реализация (данные, графики на `chart-config.ts`) — отдельная будущая задача/план.
- Сворачиваемая левая колонка настроек.
- CSS `content-visibility: auto`-виртуализация строк дней — только если реальный профилинг покажет необходимость.

## Новый этап: frontend для entry-level выбора деятельности

План выше описывает **закрытый этап v1**:
- доска;
- интервалы;
- параллельные треки;
- CRUD Activity/Category;
- flat autocomplete по Activity.

Он остаётся как завершённый исторический этап и не переписывается.

Следующий этап меняет не board-механику, а **способ выбора и описания активности при создании/редактировании записи**.

### Что сохраняется

- доска с интервалами
- drag / resize / delete
- `primary` / `secondary`
- локальный full-cache entries
- optimistic sync
- вся механика скролла, хвоста, day-index и board-render

То есть новый этап фронта — это не новый TIME screen с нуля, а **новый picker / editor поверх уже готовой доски**.

### Что меняется по смыслу

Текущее создание записи:
- клик по слоту;
- всплывающий попап под слотом;
- узкий вертикальный список activity-kind, отсортированный по частоте;
- выбор activity-kind;
- после выбора попап расширяется в ширину и показывает применимые группы со значениями.

Целевая форма второго этапа:
- клик по слоту;
- тот же попап со списком activity-kind слева;
- выбор **вида активности**;
- справа выбор значений применимых групп;
- предвыбор самых частых исторических значений внутри уже доступных групп;
- подтверждение записи кнопкой `OK`.

### Целевой UX следующей итерации

Базовый сценарий:
- пользователь кликает по свободному слоту;
- снизу/под слотом открывается попап;
- в левой части попапа показывается вертикальный список activity-kind, отсортированный по частоте использования;
- если activity-kind больше чем помещается в разумную высоту, список просто скроллится внутри;
- при выборе activity-kind левый список остаётся на месте, а справа открывается и обновляется панель значений для текущего выбора;
- переключение на другой activity-kind просто перерисовывает правую панель, не закрывая попап;
- сверху правой панели: кнопка свернуть/назад, название activity-kind, кнопка `OK`;
- ниже показываются применимые группы значений;
- для каждой уже привязанной к этой активности группы фронт пытается предвыбрать самое частое историческое значение;
- если для группы чаще всего встречается пустое состояние, группа остаётся без выбора;
- в типовом случае достаточно выбрать 1 недостающее значение или просто нажать `OK`;
- после `OK` попап закрывается, на доске создаётся новый entry длиной 1 час;
- дальше длина правится только drag/resize, без ручного ввода времени цифрами.
- `Escape` закрывает попап целиком из любого состояния.

Примеры:
- `Игра` → обязательная группа `Игра` → `ATS`, плюс любые другие группы, которые вручную привязаны к `Игра`
- `Видео` → группа `Источник видео`, плюс любые другие группы, которые вручную привязаны к `Видео`
- `Код` → группы, которые вручную привязаны к `Код`

### Что это значит для компонентов

- нужен новый picker-компонент для structured selection
- picker должен поддерживать:
  - список activity-kind слева;
  - постоянный левый список и правую панель деталей;
  - иерархию "вид активности → группы → значения";
  - автопредвыбор самого частого исторического значения в каждой уже привязанной группе;
  - переключение между activity-kind без закрытия попапа;
  - закрытие по `Escape`.

Текущие `activities-list` / `categories-list` тоже перестанут быть финальной формой настроек:
- `activities-list` вероятно эволюционирует в список крупных видов активности
- `categories-list` вероятно эволюционирует в менеджер групп и значений
- потребуется экран/форма применимости:
  - какая группа доступна для какого вида активности
  - какая required
  - привязка каждой группы к каждой активности делается только вручную

### Выбор значений внутри группы

Нужен отдельный UI-примитив выбора значений:
- не `v-dropdown`;
- не input-driven select;
- а набор selectable chips / chips-group.

Желаемый вид:
- у группы 3-4 значения → просто ряд/сетка чипов;
- выбранный чип визуально активен;
- у выбранного чипа можно снять выбор через явный `x` или перевыбрать другой;
- если значений много, над чипами появляется filter input;
- порог включения filter input настраивается в компоненте;
- если значений очень много, компонент может показывать только ограниченное число строк чипов до фильтрации;
- это тоже настраивается в компоненте, а не хранится в reference-данных.

### Что важно для UX-слоя

- не заставлять все activity family проходить одинаково глубокий wizard
- редкие и простые активности должны создаваться дешево
- никакие статические defaults не хранить
- любой предвыбор строить только из самого частого исторического значения внутри пары `activity + group`
- если исторически чаще всего пусто, не подставлять ничего
- никакая группа не должна появляться у активности автоматически только потому, что она используется где-то ещё
- никаких fallback-слоёв ради совместимости с текущим picker'ом: если новая модель требует выкинуть старую форму ввода записи целиком, это и есть правильное решение
- качество итогового UX и простота кода важнее сохранения текущей реализации

### Грубый frontend scope следующей итерации

- новый structured activity picker для create/update entry
- новый state/model для selected groups/options внутри entry editor
- новые справочники и сервисы под activity kinds / groups / options
- переработка левой колонки настроек под новый reference-data management
- адаптация optimistic create/update entry payload к новому structured input
- новый UI-компонент выбора значений групп на базе chips, а не dropdown
- попап-flow "список activity-kind слева + панель групп справа + confirm"
- создание нового entry сразу длиной 1 час по `OK`
- поддержка `Escape` для мгновенного закрытия попапа

### Что пока не зафиксировано

- будет ли фильтр значений отдельным мини-input или встроенной строкой поиска над chips

## Новая архитектура второго этапа: frontend

Этот блок описывает только целевую frontend-модель. Как перейти к ней из текущего v1-кода — в следующем блоке.

### Главный принцип

Board остаётся экраном интервалов. Semantic picker становится отдельным слоем выбора `activityKind + group options`.

Board не знает правил привязки групп:
- получает готовый structured entry input;
- добавляет `track`, `startAt`, `endAt`;
- вызывает entries service.

### Данные

Reference catalog:
- `activityKinds`;
- `categoryGroups`;
- `categoryOptions`.

`activityKinds` содержат `groupBindings`: список вручную привязанных групп + `required`.

`categoryGroups` содержат nullable `kind`; сейчас поддерживается только `area` для основной аналитики и цвета.

Entry DTO:
- `id`;
- `track`;
- `startAt`;
- `endAt`;
- `activityKindId`;
- `options: { groupId, optionId }[]`;
- `createdAt`;
- `updatedAt`.

Внутри одной group у одной entry может быть только один option. Multi-select не поддерживается.

В localStorage сохраняются server DTO, не UI view-model.

### Derived indexes

Frontend строит computed-индексы:
- `activityKindById`;
- `groupById`;
- `areaGroupId`;
- `optionsByGroupId`;
- `applicableGroupsByKindId` из `activityKind.groupBindings`;
- `requiredGroupIdsByKindId` из `activityKind.groupBindings`;
- `entriesByDay`;
- `usageStatsByKindAndGroup`.

### Services

`TimeCatalogueService`:
- грузит `/api/time/catalog`;
- хранит reference data в signals;
- делает CRUD/архивацию kinds, groups, options;
- обновляет group bindings вместе с kind;
- строит индексы для picker/settings.
- не архивирует group локально, если backend отклонил архивацию из-за активных bindings.

`TimeEntriesService`:
- хранит full-cache entries;
- делает load all / refresh tail;
- делает optimistic create;
- делает optimistic update time;
- делает optimistic update selection;
- делает delete;
- сохраняет localStorage после каждой локальной мутации.

`TimeEntriesService` не хранит справочники.

### Entry write flow

Create:
- picker отдаёт `activityKindId + options`;
- board добавляет `track + startAt + endAt`;
- entries service создаёт optimistic entry с temp id;
- success заменяет temp id на server id;
- rollback удаляет только temp entry.

Update time:
- drag/resize/move отправляет только `track + startAt + endAt`;
- rollback возвращает только старые time-поля;
- semantic selection не трогается.

Update selection:
- editor отправляет только `activityKindId + options`;
- rollback возвращает только прежний semantic selection;
- time-поля не трогаются.

### Picker

`structured-activity-picker` — отдельный компонент, не расширение старого `v-dropdown`.

State:
- open/closed;
- create/edit mode;
- anchor slot/entry id;
- selected `activityKindId`;
- selected options as `Map<groupId, optionId>`;
- touched groups;
- validation errors.

Computed:
- activity kinds by usage frequency;
- applicable groups for selected kind;
- options by group;
- required state;
- canSubmit.

Kind switch:
- правая панель пересобирается;
- selected options сбрасываются;
- для каждой applicable group запускается runtime preselect;
- popup остаётся открытым.

### Runtime preselect

Preselect — локальный UI-hint, не catalog default.

Алгоритм:
- взять историю entries для выбранного `activityKindId`;
- для каждой applicable group посчитать частоты `optionId`;
- отдельно посчитать пустое состояние;
- если пустое состояние чаще или равно лучшему option, ничего не выбирать;
- иначе выбрать самый частый option;
- archived options не предвыбирать.

### Components

- `structured-activity-picker` — kind list + groups/options panel + `OK` + `Escape`.
- `time-option-chips` — строго single-select chips, clear, optional filter after threshold.
- `activity-kinds-list` — CRUD/архивация kinds + group bindings в форме kind.
- `category-groups-list` — CRUD/архивация groups.
- `category-options-list` — CRUD/архивация options выбранной group.

`time-option-chips` остаётся внутри TIME. В UI-kit переносить только после второго реального места использования.

### Settings UI

Левая колонка:
- Activity kinds;
- Groups;
- Options выбранной group.

Форма group:
- name;
- kind (`area` или пусто);
- archive.

Привязки групп редактируются прямо в форме activity kind:
- отметить группы;
- отметить `required`;
- сохранить kind.

Никаких global groups, inherited groups, templates.

### Rendering entries

Segment label:
- основа — `activityKind.name`;
- детали — короткий список selected option labels;
- если места мало, показывать только kind;
- tooltip/title показывает full semantic summary.

Segment color:
- selected option из group с `kind='area'`;
- иначе первый selected option с color;
- иначе нейтральный fallback.

Color — display logic, не поле entry.

### API contract

Read:
- `GET /api/time/catalog`;
- `GET /api/time/entries`;
- `GET /api/time/entries?start=...`.

Write:
- catalog CRUD;
- create entry with structured selection;
- patch entry time;
- patch entry selection;
- delete entry.

Backend остаётся финальным validator. Frontend validation нужна только для UX.

## Переход текущей frontend-реализации к новой архитектуре

Этот блок — карта переделки v1-кода. Он не описывает новую архитектуру заново.

### Types

- Заменить flat `Activity` на `ActivityKind`.
- Заменить `Category` на `CategoryGroup` + `CategoryOption`.
- В `ActivityKind` добавить `groupBindings`.
- В `CategoryGroup` добавить nullable `kind`; сейчас только `area`.
- В `TimeEntry` заменить `activityId` на `activityKindId`.
- В `TimeEntry` добавить `options`.
- Зафиксировать single-select: максимум один `{ groupId, optionId }` на group.
- Убрать `categoryIds` у activity.
- Оставить `TimeTrack` и board time fields без смысловых изменений.

### TimeCatalogueService

- Перевести загрузку справочников на `GET /api/time/catalog`.
- Хранить `activityKinds$$`, `categoryGroups$$`, `categoryOptions$$`.
- Построить computed indexes из целевой архитектуры.
- CRUD Activity заменить на CRUD ActivityKind.
- CRUD Category разделить на group CRUD и option CRUD.
- Group bindings сохранять вместе с ActivityKind.
- Group archive показывать как обычную операцию, но backend может отклонить её при активных bindings.
- Убрать старую логику activity categories/categoryIds.

### TimeEntriesService

- Перевести create payload на `activityKindId + options + track + startAt + endAt`.
- Разделить optimistic update на:
  - update time;
  - update selection.
- Update-time rollback должен менять только `track/startAt/endAt`.
- Update-selection rollback должен менять только `activityKindId/options`.
- Full-cache, tail refresh, entriesByDay оставить.
- LocalStorage schema надо считать новой, старый cache несовместим.

### Board

- Оставить day rows, tracks, drag, resize, delete.
- Убрать old flat activity autocomplete.
- На create открыть `structured-activity-picker`.
- На edit selection открыть тот же picker в edit mode.
- На drag/resize вызывать update-time.
- Segment label/color брать из `activityKind + options`.
- Segment color брать через `categoryGroup.kind === 'area'`, без проверки имени group.

### Picker/components

- Создать `structured-activity-picker`.
- Создать `time-option-chips`.
- Не использовать `v-dropdown` для выбора options.
- Не делать multi-select внутри group.
- Activity kind list остаётся слева, details panel справа.
- `Escape` закрывает весь picker.
- `OK` создаёт/обновляет entry.

### Left settings

- `activities-list` превратить в `activity-kinds-list`.
- `categories-list` разделить по смыслу на groups/options.
- Форму activity kind расширить group bindings.
- Форму group расширить kind-полем.
- Убрать отдельную activity-category настройку.
- Не делать отдельный экран applicability.

### Frontend to-do второго этапа

- ✅ Обновить TIME types: `ActivityKind`, `CategoryGroup`, `CategoryOption`, `GroupBinding`, `EntryOption`.
- ✅ Добавить `CategoryGroup.kind` и константу `area`.
- ✅ Перевести `TimeEntry` на `activityKindId + options`.
- ✅ Переписать `TimeCatalogueService` на `/api/time/catalog`.
- ✅ Разделить old activity/category CRUD на kinds/groups/options.
- ✅ Добавить group bindings в форму ActivityKind.
- ✅ Добавить kind-поле в форму CategoryGroup.
- ✅ Разделить entry mutations на create, update time, update selection, delete.
- ✅ Заменить old picker/autocomplete на `structured-activity-picker`.
- ✅ Добавить strictly single-select `time-option-chips`.
- ✅ Перевести board create/edit на structured picker.
- ✅ Обновить segment label/color под structured entry и `kind='area'`.
- ✅ Обновить optimistic rollback отдельно для time и selection.
- ✅ Сбросить/обновить localStorage cache schema для TIME.

### Отклонения от плана при реализации

- `SyncQueueService`/`SyncOperationType` дополнен вариантом `PATCH` (`http.patch`) — план фиксировал только `CREATE/UPDATE/DELETE` (POST/PUT/DELETE), но бэк v2 отдаёт `PATCH .../time` и `.../selection` вместо `PUT`. Аддитивное расширение по тому же прецеденту, что и более ранний `concurrent`-флаг; money/food не затронуты.
- Жест «открыть picker в edit mode» не был явно зафиксирован в плане (только «на edit selection открыть тот же picker»). Решение: клик по сегменту без движения (в `startMove`, флаг `moved === false` в `onUp`) открывает picker в edit-режиме — драг остаётся на pointerdown+move, resize-хендлы не участвуют.
- `structured-activity-picker`: `Map<groupId, optionId>` пересобирается императивно в обработчике выбора kind (`selectKind`), а не через `computed`/`effect`, реагирующий на `entries$$`. Абстрактное состояние «touched groups» из плана не введено — при выбранном императивном сценарии (preselect запускается ровно один раз на клик по kind, не реактивно) оно не нужно для корректности; повторный клик на уже выбранный kind не сбрасывает текущий выбор.
- `time-option-chips` расположен под `components/time/structured-activity-picker/time-option-chips/` (не плоско под `components/time/`) — используется только пикером, вложенность отражает реальную область применения; план прямо не фиксировал путь.
- `category-options-list` не отдельный самостоятельный пункт левой колонки, а рендерится условно под `category-groups-list` при выборе строки группы (клик по названию) — прямая реализация «Options выбранной group» из плана.
- Цвет/лейбл сегмента берутся из нового computed `optionById$$` в `TimeCatalogueService` (план не называл его явно, но того требовала логика цвета из раздела «Rendering entries»).
- Полный текст лейбла (`kind · option1, option2`) используется одновременно как видимый текст в `segment-label` и как `[title]` для hover-tooltip — «tooltip показывает full semantic summary» решено переиспользованием одной и той же строки, без отдельного вычисления summary.

## Слияние с release 2.9.1 (11.11.2026)

Ветка `time-track-feature` (база `425f136`, 12.07) влита с `release` (175 коммитов). Фича портирована на текущую архитектуру фронта. Номер плана 08 совпадает с `08-global-metrics-delta-history` из release — историческое совпадение, не переименовано.

Решения:

- `SyncQueueService` удалён в release (93ba1e4) → time-сервисы на `SyncEngineService`, `BaseTimeService` повторяет `BaseFoodService` (inject, `SyncOperationInput`, режим `Optimistic`).
- Из правок ветки в sync-queue перенесён только `PATCH` (в движок, с тестом). 4xx без ретраев — уже есть в движке (`isRetryable`). Текст ошибки сервера в тосте — отброшен: движок показывает `feedback.errorMessage`.
- `concurrent`-флаг отброшен: движок single-flight и хранит одну in-flight операцию для повтора после перезагрузки. Правки drag/resize идут в общей очереди.
- DELETE шлёт `data: {}`: движок кладёт `operationId` в тело каждого запроса. Бэку тайм-модуля (ветка `143-timetrack-schema`) нужен приём `operationId`.
- Prefs отображения → `persistedSignal` (план 27): значения перечитываются при смене сессии, а не однажды под guest-ключом.
- `selectedChapterTime` → core-неймспейс настроек (`UserSettings`, `KeyOfUserSettings` как `as const`), чекбокс в settings на `linkedSignal`. Бэку нужно поле `selectedChapterTime` в `CoreSettings` (`DisallowUnknownFields`).
- Шаблоны → ui-kit без `[config]`: отдельные инпуты, `clickOutput`, `surface`, `v-input` через `value`, `v-tooltip` через `v-panel`. Общий тултип доски — top-layer popover (`vTopLayer`) вместо удалённого `ZLayerService`.
- `measureTextWidth` → `measureTextWidthPx` из `shared/text-measure` (дубликат). `kind` группы сужен до `CategoryGroupKind | null` (бэк принимает только `area`).
- Angular 22/lint: без явного OnPush, `public constructor`, `@empty`, `model()` в `time-option-chips`, `parseIsoParts` под `noUncheckedIndexedAccess`.

- ✅ Снять текстовые конфликты (7 файлов) и тихие мис-мержи (guard, меню).
- ✅ Перевести time-сервисы на `SyncEngineService`, добавить `PATCH` в движок.
- ✅ Перевести шаблоны и компоненты на текущий ui-kit и lint.
- ✅ `npm run lint`, `tsc` app/spec, `ng build`, `npm test` — зелёные.
- ⭕ Бэк: слить `143-timetrack-schema` с release, добавить `selectedChapterTime` в `CoreSettings`, принять `operationId` в time-эндпоинтах.

## Полное приведение к курсу release (11.11.2026)

Дополняет раздел выше: там исправлено только то, что ловят сборка и lint. Здесь — сверка с решениями планов 23, 24, 27, 29, 37 и с устройством раздела «Деньги» как образца.

Решения:

- Ключи кэша фичи (8 шт.) зарегистрированы в `CACHE_KEY_VERSIONS` (план 23). Без этого `buildCacheKey` бросал исключение при первой записи — фича падала в рантайме, сборка этого не видела.
- Загрузка — `loadData()` при входе на экран, как в «Деньгах». Раньше данные грузились один раз в конструкторе сервиса и после выхода и повторного входа не возвращались.
- Записи — оптимистично через sync engine, как транзакции денег. Записи с операциями в очереди защищены от перезаписи свежим ответом сервера. Защита — счётчик на запись, а не набор id: по одной записи в очереди может быть drag и смена выбора.
- Справочник (виды деятельности, группы, опции) — `async`-методы с `Promise<boolean>`, как справочники денег. Форма закрывается только после подтверждения сервера. При отказе показывается причина от сервера, если она есть. Базовый `BaseTimeService` удалён: общего кода у двух сервисов не осталось.
- Проверки сети перед операциями удалены: в release их нет нигде, связью занимается sync engine.
- Телеметрия (план 36): `time.screen_ready`, `time.entries_apply`, `time.catalogue_apply` по образцу денег.
- Zoneless: `NgZone` удалён из доски. `Injector` остался только для `afterNextRender` вне контекста внедрения.
- Пикер — top-layer popover (`vTopLayer`) вместо `z-index: 50`. Начальный выбор заполняется в `ngOnInit` вместо `effect` с флагом.
- Шаблоны: `[(value)]`, `@let` вместо повторных вызовов и `@if (…; as)`, прямой вызов сервиса вместо обёрток-пробросов.
- Тема (план 24): тени — `--v-shadow-color-dark-strong`, превью слота — `--v-color-contrast`, звёздочка — `--v-color-danger`, выбранный чип — `--v-color-text-on-accent`. Фон hover-панели меняется вместе с темой. Белые линии и затемнения поверх цветных сегментов оставлены: сегменты одинаковы в обеих темах.
- Тесты (план 29): `time-entries.service.spec` (загрузка, хвост, создание и откат, защита записей в очереди, сброс при выходе), `time-catalogue.service.spec` (загрузка, подтверждённое создание, отказ с причиной и без, удаление).

- ✅ Ключи кэша, загрузка при входе, защита записей в очереди.
- ✅ Справочник на `async`, без базового класса и проверок сети.
- ✅ Zoneless, top-layer пикер, `ngOnInit` вместо `effect`, шаблоны.
- ✅ Токены темы, телеметрия, тесты.
- ✅ `npm run lint` 0, `tsc` app/spec, `ng build`, `npm test` (536) — зелёные.

## Бэкенд под текущую архитектуру и аудит фронта по правилам (11.11.2026)

Парный раздел: `megaapp-back/plans/08-time-module.implementation-plan.md`, «Слияние с release и приведение к текущей архитектуре (11.11.2026)».

Причина: после мержа фронта бэкенд Time остался в ветке `143-timetrack-schema` на старой архитектуре. Галочка Time Log падала с 400 (`unknown field selectedChapterTime`), `/api/time/*` отвечал 404. На бэке: мерж `release`, флаг в неймспейсе `core`, миграция на первом свободном номере, пулы чтения/записи, идемпотентность записей таймлайна по `operationId`.

Контракт с фронтом не меняется: эндпоинты, `{data: {id}}` при создании и `{success: false, error}` при отказе совпадают. Фронт уже шлёт `operationId` во всех операциях sync engine, включая тело DELETE. Ретрай создания больше не плодит дубль, ретрай удаления не откатывается из-за 404.

Аудит фронтовой части по текущим правилам:
- Сигнальные инпуты без суффикса `Input` (segment-label, time-option-chips, structured-activity-picker, category-option-form) переименованы.
- Пикер: два инпута начального выбора объединены в один — начальный выбор это одна сущность (вид + опции).
- Таймлайн: режимы пикера и сторона ручки ресайза — константы `as const` вместо строковых литералов; выбор редактируемой записи — computed вместо логики в шаблоне; положение тултипа — булев сигнал «снизу».
- Порядок членов: запросы view — сразу после инпутов. `private inject()` перед зависящими от него protected-сигналами оставлен: логическая группировка, разрешена правилами и так же сделана в `release`.
- Оставлено как есть: простые тернарники в шаблонах (принятый в `release` стиль), `model` с именем `value` (правило про суффиксы его не касается, так же у ui-kit).

- ✅ Переименование инпутов, константы домена таймлайна, computed выбора для пикера.
- ✅ Lint, tsc (app/spec), тесты, сборка.
