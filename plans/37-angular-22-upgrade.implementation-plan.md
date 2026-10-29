# Апгрейд Angular 21 → 22 и выравнивание с философией фреймворка — Design Doc

## Суть

Проект на Angular 21.1.0, уже signal-first. Angular 22 (stable, 2026-06-03) — не косметика, а консолидационный релиз: то, что раньше было experimental (Signal Forms, zoneless, Angular Aria, `resource()`/`httpResource()`), стало stable и default. Следующий мажор (v23) — не раньше середины 2027 (Angular перешёл на годовой цикл релизов), так что v22 — целевая версия на обозримое время, спешить рискованно, но и тянуть незачем.

Задача этого документа — не просто "поднять циферку", а: где конкретно код проекта расходится с текущей философией Angular, и какого объёма рефакторинг нужен, чтобы дотянуть каждое место до актуального идиоматичного стандарта. Так как продакшена с оплатой нет — ограничений на смелость рефакторинга нет.

## Сделано (2026-09-17) — базовый `ng update` 21→22

- ✅ `ng update @angular/cli@22 @angular/core@22` — все пакеты `@angular/*` → `22.1.7`, `@angular/cli`/`@angular/build` → `22.1.8`, `typescript` → авто-подобрано CLI на `6.0.3` (единственная версия, совместимая с `@angular/compiler-cli@22`, которая требует строго `>=6.0 <6.1` — новее ставить нельзя, latest на npm сейчас `7.0.2`, он несовместим)
- ✅ Авто-миграции CLI применились: `ChangeDetectionStrategy.Eager` расставлен явно на 42 компонентах без прежней явной стратегии; `withXhr()` добавлен в `provideHttpClient()` в `main.ts` (миграция сохранила старое поведение через XHR, не переключила на Fetch — переход на Fetch намеренно отложен, это отдельное идиоматичное решение, не часть авто-апдейта); в `tsconfig.app.json`/`tsconfig.spec.json` добавлено подавление `nullishCoalescingNotNullable`/`optionalChainNotNullable`, чтобы сохранить старую семантику optional chaining
- ✅ Проверка после апгрейда: `tsc --noEmit` — 0 ошибок, `ng build --configuration dev` — чисто, `vitest` — 212/212 тестов, 23/23 файлов
- ⚠️ **`src/ui-kit` — git submodule** (`angular-ui-kit`, branch `release`). Авто-миграция `Eager` задела и его — 20 файлов внутри submodule изменены и не закоммичены. Это отдельный репозиторий, нужно отдельно просмотреть и закоммитить там же.
- Не трогал: `@angular/cdk` в `overrides` остался на `21.1.0` — сейчас это не проблема (peer-диапазон `^21.0.0 || ^22.0.0` покрывает текущий core), но при следующем мажоре потребует ручного bump

## `angular-ui-kit` — где используется и что с ним

Сабмодуль (`git@github.com:VanVakarian/angular-ui-kit.git`) подключён в 5 проектах, каждый закреплён на своём коммите:

| Проект | Angular | Commit ui-kit |
|---|---|---|
| `megaapp/megaapp-front` | `22.1.7` ✅ | `e500275…` + локальные несохранённые правки (Eager) |
| `ui-kit-showcase` | `22.1.7` ✅ (обновлено 2026-09-17) | `82e5c06…` + локальные несохранённые правки (Eager) |
| `tg-app/tg-app-front` | `21.2.6` — не трогаем, не прод | `1ba4b28…` |
| `polybot/polybot-front` | `21.2.4` — не трогаем, не прод | `f9e7ac6…` |
| `polybot/old-projects-for-reference/tg-app-front` | `21.x` — архив | — |

`ChangeDetectionStrategy.Eager` (то, что расставила авто-миграция) существует уже в Angular 21 как замена `@deprecated`-`Default` — проверено напрямую в установленном `@angular/core@21.2.6`. На v21-проекты это **не повлияет**, даже если туда попадёт.

⚠️ **Сабмодуль сейчас разъехался на два несовместимых локальных состояния** — в `megaapp-front` (база `e500275`) и в `ui-kit-showcase` (база `82e5c06`, там же заодно поправил устаревший `baseUrl` в `tsconfig.json` — TS 6.0 депрекейтит его в паре с `paths`, без правки `tsc --noEmit` падал с `TS5090`). Оба — независимые несохранённые правки одного и того же файла-набора, не закоммичены никуда. Перед коммитом в `angular-ui-kit` нужно решить, какую версию считать канонической (скорее всего — из `megaapp-front`, она новее по базе) и синхронизировать остальные, а не коммитить обе параллельно.

## Куда движется Angular (синтез roadmap + v20/21/22)

- **Signals — единственная модель реактивности.** `signal`/`computed`/`effect`/`linkedSignal` — stable с v20. `resource()`/`httpResource()`/`rxResource()` — stable с v22, замена ручных `subscribe()`-паттернов для async-данных.
- **Zoneless — stable, default для новых приложений с v21.** Zone.js — опциональный legacy-слой, а не основа CD.
- **`OnPush` — новый default для новых компонентов** (v22). Старый безымянный default переименован в `ChangeDetectionStrategy.Eager`.
- **Signal Forms (`@angular/forms/signals`) — stable с v22.** Заявлены как замена и Reactive, и Template-driven forms: типобезопасность реактивных форм + эргономика template-driven в одном declarative API (`form()` + schema-функция для валидации).
- **Функциональный стиль — идиома, а не альтернатива.** Guards/interceptors/resolvers как функции (`CanActivateFn`, `HttpInterceptorFn`) — стандарт с v15, class-based — legacy-путь.
- **`@Service()` (v22)** — упрощённая альтернатива `@Injectable({ providedIn: 'root' })` для synchronous-singleton сервисов.
- **Angular Aria (`@angular/aria`) — stable с v22.** Headless доступные примитивы (accordion, menu/dropdown, listbox, tree и др.) — не переизобретать keyboard-nav/focus-trap/ARIA внутри своих компонентов.
- **HttpClient — Fetch API под капотом по умолчанию**, XHR — legacy-путь.
- **Тестирование — Vitest через `@angular/build:unit-test`**, Karma официально угасает.
- **AI-tooling (WebMCP, Agent Skills, MCP dev server)** — experimental, ориентировано на агентные workflow вокруг Angular-приложений. Для одиночного pet-проекта не приоритет, но зафиксировано на будущее.
- Не relevant для этого проекта: SSR/hydration-градации, token-based Material theming (нет Angular Material) — чистый CSR SPA, это архитектурный выбор, не отставание.

## Аудит текущего состояния проекта (факт, 2026-09-17)

### Версии и инструментарий
- Angular/CLI/build/compiler-cli/forms/router/platform-*: единообразно `22.1.7` (`@angular/cli`/`@angular/build` — `22.1.8`) — обновлено 2026-09-17, см. «Сделано» выше.
- TypeScript `6.0.3` (обновлено вместе с Angular). Node локально `24.19.0` — выше любого минимума.
- `zone.js 0.16.0`, `rxjs 7.8.1` — без изменений, обе версии входят в peer-диапазон `@angular/core@22`.
- Тесты: `@angular/build:unit-test` (нативный Vitest-builder) + `vitest ^4.0.8`, Karma/Jasmine как прямые зависимости отсутствуют — **уже полностью смигрировано**, ничего делать не нужно.
- ESLint + `@html-eslint` в devDependencies, но конфиг-файла (`eslint.config.*`/`.eslintrc*`) в репозитории не найдено — линтер по факту не запускается, мёртвый вес в зависимостях. Не про Angular-апгрейд, но стоит либо настроить, либо убрать при следующей уборке зависимостей.

### Change detection
- 72 компонента всего (51 в `app`, 21 в `ui-kit`), из них `ChangeDetectionStrategy.OnPush` явно стоит только у 29. Оставшиеся 42 после `ng update` получили явный `ChangeDetectionStrategy.Eager` (авто-миграция) — раньше это был неявный default, теперь стратегия явная, но всё ещё не `OnPush`.
- `main.ts`: `provideZoneChangeDetection()` явно, `zone.js` в `angular.json` polyfills — zoneless не включён.

### Signals и component API
- `signal()` — 167 вызовов, `computed()` — 356, `effect()` — 60. Кодовая база насквозь signal-first на уровне state/derived-state.
- Новые signal-based I/O почти не приняты: `input()` — 4 файла, `viewChild()`/`contentChildren()` — по 1, `output()`/`model()`/`linkedSignal()` — 0 файлов.
- Легаси-декораторы почти изжиты, но не до конца: `@Input()`/`@Output()`/`@ViewChild()` — по 1 файлу (`diary-entry-edit-form.ts`, `camera-preview.ts`), `@HostListener()` — 2 файла (`v-modal`, `v-wheel-select`), `@HostBinding()` — 0.
- 4 файла с явным `standalone: true` (`flip-animate.directive.ts` ×2, `diary-entry-product-info.ts`, `v-accordion.ts`) — избыточно, standalone — default с v19.
- `NgModule` — 0 использований во всём проекте, архитектура полностью standalone.

### Control flow и шаблоны
- Legacy `*ngIf`/`*ngFor`/`*ngSwitch` — **0 файлов**, полностью на `@if`/`@for`/`@switch` (46/31/2 файла). Уже соответствует стандарту v18+.
- `@defer` — только 1 использование (`food-diary.html`, `on timer(300)`), `@let` — 2 файла. Потенциал `@defer` для тяжёлых веток (графики, модалки) почти не раскрыт.
- `ngClass`/`ngStyle` — по 2 файла, вместо `[class.x]`/`[style.x]` — небольшой хвост, легко зачистить.

### Формы
- Reactive Forms: `FormGroup` — 7 файлов, `FormControl` — 8, `FormBuilder` — 0 (собирают группы вручную, не через builder). `ReactiveFormsModule` — 8 файлов.
- Template-driven: `ngModel`/`FormsModule` — 7/15 файлов — оба подхода живут параллельно.
- Signal Forms (`@angular/forms/signals`) — 0 использований. Это самый прямой философский разрыв: именно формы Angular теперь продвигает как единый signal-native API, а у нас — оба старых подхода одновременно.

### Data fetching и RxJS
- `.subscribe()` — 49 вызовов, сосредоточены в ~14 сервисах (`food-diary.service`, `food-catalogue.service`, `metrics.service`, `money.service`, `telemetry.service`, `router.service`, `navigation.service`, `device-info.service`, `namespace-settings-store`, `food-sync-coordinator.service`, `food-stats.service`, `food-product-history-state.service`, `metrics-health.service`, плюс `v-dropdown` в ui-kit).
- `resource()`/`rxResource()`/`httpResource()` — 0 использований.
- `BehaviorSubject` — 1 файл, `new Subject` — 8 файлов.
- `AsyncPipe`/`| async` — **0 использований во всём проекте.** RxJS полностью инкапсулирован внутри сервисов, наружу в шаблоны никогда не течёт — хорошая дисциплина, снижает риск при будущей миграции на `resource()`.

### DI и routing
- `inject()` — 229 использований, constructor-DI ещё встречается в 39 файлах. `providedIn: 'root'` — 32 файла (кандидаты на `@Service()`).
- Guards — **полностью функциональные** (`CanActivateFn`): `auth.guard.ts`, `admin-only.guard.ts`, `guest-only.guard.ts`, `settings-ready.guard.ts`, `root-redirect.guard.ts`, `is-chapter-selected.guard.ts`. Уже соответствует стандарту.
- Interceptor — ровно 1 (`auth.interceptor.ts`), но **class-based** (`implements HttpInterceptor`, `@Injectable()`, регистрация через `HTTP_INTERCEPTORS` multi-provider + `withInterceptorsFromDi()`) — единственный legacy-паттерн в этом слое.
- Роуты (`app-routes.ts`) — 5 верхнеуровневых, все через `loadComponent` (lazy). Параметризованных путей (`:id`) нет — смена дефолта `paramsInheritanceStrategy` на v22 проекту не угрожает.

### SSR и рендеринг
- Чистый CSR SPA: `bootstrapApplication`, `server.ts`/hydration нет. Это осознанный архитектурный выбор для one-user приложения, не технический долг — трогать не нужно.

### Доступность (ui-kit)
- `aria-*` атрибутов во всём `ui-kit` — всего 7 уникальных, на 18 интерактивных компонентов (`v-modal`, `v-dropdown`, `v-expand`/accordion, `v-wheel-select`, `v-slider`, `v-toast`, `v-tooltip`, `v-checkbox`, `v-toggle`, `v-color-picker`, `v-date-wheel-input`, `v-wheel-input`, `v-input`, `v-card`, `v-chip`, `v-icon`, `v-button`, `v-progress`, `v-rolling-number`). Keyboard-nav/focus-trap/ARIA-роли в основном самописные или отсутствуют — прямое попадание в назначение Angular Aria.

### Графики (chart.js/ng2-charts)
- 8 файлов интеграции. Hover-highlight уже реализован как Chart.js plugin (`category-hover-highlight.ts`), а не через `NgZone.runOutsideAngular()`/ручные listener'ы — снижает риск при переходе на zoneless (известная точка боли ng2-charts в чужих проектах — здесь её нет).

## Расхождения с философией Angular — сводка приоритетов

| # | Разрыв | Масштаб | Риск |
|---|---|---|---|
| 1 | Zoneless не включён (`zone.js` + `provideZoneChangeDetection()`) | 1 файл конфигурации + аудит всего проекта | Высокий — требует ручного smoke-теста CD везде |
| 2 | 42/72 компонента на явном `Eager`, не `OnPush` | 42 файла | Низкий, механический |
| 3 | Signal Forms не используются, 2 старых подхода к формам параллельно | ~15 файлов форм | Средний — реальный рерайт форм |
| 4 | `resource()`/`httpResource()` не используются, 49 `subscribe()` в сервисах | ~14 сервисов | Средний-высокий, делать поэтапно |
| 5 | Interceptor class-based вместо functional | 1 файл + `main.ts` | Низкий |
| 6 | `@Injectable({providedIn:'root'})` вместо `@Service()` | 32 файла | Низкий, механический |
| 7 | Angular Aria не используется, ui-kit почти без ARIA | 18 компонентов | Средний, но растянут во времени |
| 8 | Остаточные легаси-декораторы (`@Input`/`@Output`/`@ViewChild`/`@HostListener`) | 4 файла | Низкий |
| 9 | Явный `standalone: true` | 4 файла | Тривиальный |
| 10 | `ngClass`/`ngStyle` вместо `[class.]`/`[style.]` | 2+2 файла | Тривиальный |
| 11 | ~~TypeScript 5.9.3 → нужен 6.x~~ | package.json | ✅ сделано 2026-09-17 |

## Группы работ и рекомендуемая последовательность

### Группа 0 — уже соответствует, трогать не нужно
- ✅ (для справки) Control flow — 0 legacy `*ngIf`/`*ngFor`/`*ngSwitch`
- ✅ (для справки) Guards — все функциональные
- ✅ (для справки) Standalone-архитектура — 0 `NgModule`
- ✅ (для справки) Тесты — уже на `@angular/build:unit-test` + Vitest, Karma не тянется
- ✅ (для справки) RxJS изолирован в сервисах, `AsyncPipe` в шаблонах не используется — облегчает будущий переход на `resource()`

### Группа 1 — обязательные технические правки под `ng update` 21→22
- ✅ Поднять TypeScript до `6.x` (`6.0.3`, авто-подобрано `ng update`)
- ✅ Прогнать `ng update @angular/core@22 @angular/cli@22` + все авто-миграции CLI (в т.ч. простановка `ChangeDetectionStrategy.Eager` на 42 компонентах без явной стратегии — временно, до Группы 2)
- ✅ `HttpClient`/`AuthInterceptor` — авто-миграция добавила `withXhr()`, поведение сохранено как было (переход на Fetch — осознанное решение, не часть авто-апдейта, см. Группа 2/3)
- ✅ Optional chaining на строгих `=== null` — авто-миграция подавила `nullishCoalescingNotNullable`/`optionalChainNotNullable` в `tsconfig.app.json`/`tsconfig.spec.json`, старая семантика сохранена без ручной правки шаблонов
- ✅ `vitest`-сьют — 212/212 тестов, `tsc --noEmit` и `ng build` чистые

### Группа 2 — идиоматический синтаксис, низкий риск, точечно
- ⭕ Заменить авто-`Eager` на осознанный `OnPush` во всех 43 компонентах (или наоборот — `Eager` там, где обоснованно, но по умолчанию — `OnPush`)
- ⭕ Домигрировать `@Input()`/`@Output()`/`@ViewChild()`/`@HostListener()` (4 файла) на `input()`/`output()`/`viewChild()`/`host: {}` — готовые CLI-миграции
- ⭕ Убрать избыточный явный `standalone: true` (4 файла)
- ⭕ Заменить `ngClass`/`ngStyle` на `[class.]`/`[style.]` (по 2 файла)
- ⭕ Точечно применить новый шаблонный синтаксис v22 (spread/rest в шаблонных выражениях, exhaustive `@switch` с `@default never`, инлайн-стрелочные обработчики событий) — там, где реально упрощает код, не ради самого факта

### Группа 3 — глубокое выравнивание с философией (основной объём рефакторинга)
- ⭕ **Zoneless**: включить `provideZonelessChangeDetection()`, убрать `zone.js` из `angular.json` polyfills и из package.json, пройти по всем 60 `effect()` и 49 `subscribe()` и убедиться, что запись состояния всегда идёт через `signal.set()/update()`, а не через мутацию plain-полей; отдельно смоук-тест графиков (chart.js callbacks) и `v-dropdown`/`v-wheel-select` (используют `subscribe()`/`@HostListener` вне сигнального графа)
- ⭕ **Signal Forms**: перевести все ~15 файлов на `@angular/forms/signals` (`form()` + schema-валидация), убрать `ReactiveFormsModule`/`FormsModule`/`ngModel`/`FormBuilder` — один способ работы с формами вместо двух
- ✅ **Functional interceptor**: переписать `auth.interceptor.ts` на `HttpInterceptorFn`, заменить `withInterceptorsFromDi()` на `withInterceptors([...])` в `main.ts`, убрать `HTTP_INTERCEPTORS`-provider
- ⭕ **`@Service()`**: перевести 32 файла с `@Injectable({ providedIn: 'root' })` на `@Service()` (механическая замена, можно скриптом-подсказкой + ручная проверка)
- ⭕ **`resource()`/`httpResource()`**: поэтапно (не разом) перевести HTTP-ориентированные сервисы с ручного `subscribe()` — начать с самых простых read-only сценариев (`metrics-health.service`, `device-info.service`), затем сложные с ретраями/дебаунсом (`food-diary.service`, `food-catalogue.service`) в последнюю очередь
- ⭕ **Angular Aria**: подключить для новых/пересматриваемых ui-kit компонентов, начиная с самых слабых по a11y — `v-dropdown` (menu/listbox pattern), `v-expand` (accordion pattern), `v-modal` (dialog pattern) — не переписывать всё сразу, встраивать по мере доработки каждого компонента

### Группа 4 — опционально, без срочности
- ⭕ Оценить selectorless components для точечных wrapper/одноразовых компонентов (stable в v22, но выгода для этого проекта неочевидна — компонентов мало и они переиспользуемые)
- ⭕ Оценить `injectAsync()` вокруг тяжёлых зависимостей (`chart.js`) для доп. code-splitting
- ⭕ Присмотреться к WebMCP/Angular Agent Skills/MCP dev server — экспериментально, польза для solo-проекта не приоритет, но бесплатно и не мешает переоценить через пару релизов
- ⭕ Настроить или снести неиспользуемый ESLint (конфига нет, но зависимость висит) — не про Angular, но всплыло при аудите

## Источники
- [Angular v22 Release](https://angular.dev/events/v22)
- [Roadmap • Angular](https://angular.dev/roadmap)
- [Angular v22 Released — InfoQ](https://www.infoq.com/news/2026/08/angular-v22-released/)
- [What's New in Angular v22](https://blog.codewithahsan.dev/whats-new-angular-v22/)
- [Forms with signals — angular.dev](https://angular.dev/essentials/signal-forms)
- [Zoneless — angular.dev](https://angular.dev/guide/zoneless)
- [@Service vs @Injectable — ITNEXT](https://itnext.io/angular-22-service-vs-injectable-what-you-need-to-know-22d3e8c80f9c)

## Порядок переноса по разделам

Аудиторы разные — риск разный. Порядок переноса по числу зависимых пользователей:

1. **Метрики** — только я. Полигон для всего рискованного (zoneless, апгрейд ядра).
2. **Деньги** — пара человек.
3. **Настройки/навигация/общая инфраструктура** — по мере необходимости, не отдельным заходом.
4. **Еда** — несколько пользователей, трогаем последней, когда остальное уже обкатано.

Важный нюанс: не все пункты делимы по разделам.

- **Инфраструктурные (общие на весь проект, делаются один раз)**: `ng update` до 22, TypeScript 6.x, включение zoneless (`provideZonelessChangeDetection()` в `main.ts` — это один глобальный provider, не переключается по разделам), functional interceptor. Их нельзя внедрить "только для метрик" — они бьют по всему приложению сразу. Но именно раздел метрик (только свой трафик, наименьшая цена ошибки) — правильное место, чтобы **первым** пройти эти изменения вручную и убедиться, что ничего не сломалось, перед тем как доверить их деньгам и еде.
- **Модульные (реально делимы по разделам)**: Signal Forms, `resource()`/`httpResource()`, `@Service()`, доразметка `input()`/`output()`, Angular Aria — их можно и нужно катить раздел за разделом, начиная с метрик.

## Блок 1 — раздел «Метрики»: полное приведение к Angular 22

Аудит (2026-09-17) специально по файлам раздела: 4 компонента (`metric-card-grid`, `metric-chart-card`, `metrics-dashboard`, `metrics-health-dot`), 5 сервисов (`metrics.service`, `metrics-health.service`, `composite-metrics-settings.service`, `metrics-settings.service`, `metric-card-expansion.service`), общие типы/утилиты в `shared/metrics-*`.

### Уже соответствует — трогать не нужно
- ✅ (для справки) Все 4 компонента раздела уже на явном `ChangeDetectionStrategy.OnPush`
- ✅ (для справки) Легаси-декораторов (`@Input`/`@Output`/`@ViewChild`/`@HostListener`) в разделе нет
- ✅ (для справки) Angular Forms (Reactive/Template-driven) в разделе не используются — настройки идут через сигналы и uikit-компоненты напрямую, Signal Forms сюда мигрировать не с чего
- ✅ (для справки) `ngClass`/`ngStyle` в разделе не встречаются
- ✅ (для справки) `ResizeObserver`/`IntersectionObserver`/`effect()`-коллбэки в `metric-card-grid.ts` и `metric-chart-card.ts` уже пишут состояние через `signal.set()` — хорошая база для zoneless, без переписывания логики

### Инфраструктурные шаги — делать здесь первыми (полигон для всего проекта)
- ✅ `ng update @angular/core@22 @angular/cli@22`, TypeScript → 6.x, прогнать авто-миграции (сделано 2026-09-17 для всего проекта, включая метрики — build/tsc/vitest чистые, ждём ручной прогон экранов)
- ✅ Переписать `auth.interceptor.ts` на `HttpInterceptorFn` + `withInterceptors()` в `main.ts` (задействовано всеми HTTP-запросами метрик)
- ⭕ Включить `provideZonelessChangeDetection()`, убрать `zone.js` из `angular.json` polyfills и package.json
- Механизмы метрик, которые затрагивает zoneless (учесть при включении, Блок 5):
  - `ResizeObserver` в `metric-card-grid.ts`/`metric-chart-card.ts` (ресайз карточек/графиков)
  - `IntersectionObserver` в `metric-chart-card.ts` (`isVisible$$`, скролл дашборда)
  - `chartUpdateEffect` и `resetExpandedOnDisableEffect` в этих же файлах
  - WebSocket-поток `metricsBinaryFrames$` (`metrics.service.ts`, `metrics-health.service.ts`) — приход бинарных фреймов в реальном времени
  - Chart.js перерисовка/hover (`category-hover-highlight.ts`, `metrics-sync-crosshair.ts`)

### Модульные шаги — специфичные доработки раздела
- ✅ Перевести 5 сервисов раздела с `@Injectable({ providedIn: 'root' })` на `@Service()` (сделано для 4 реально существующих, см. «Блок 1» ниже)
- ✅ `metric-card-grid.ts`/`metric-chart-card.ts`: заменить constructor-инъекцию `ElementRef` на `inject(ElementRef)`
- ⭕ `metrics.service.ts` (~строка 287): одноразовый `POST /api/metrics/history` (`arraybuffer`, ручной `.subscribe({...})`) — кандидат на `httpResource()`/`resource()`. Внутри коллбэка сейчас нетривиальные побочные эффекty (merge точек, продвижение курсоров, уведомления, запись в кэш) — при миграции вынести их в `effect()`, реагирующий на статус ресурса, а не переносить как есть
- ✅ `metricsBinaryFrames$`-подписки (`metrics.service.ts`, `metrics-health.service.ts`) — оставить на RxJS: это continuous WebSocket-поток, а не request/response, под `resource()` не подходит по форме API
- ✅ Оценить `@defer` для `metric-chart-card` внутри `metrics-dashboard.html` (оценено, отказ — см. «Блок 1» ниже) — сейчас грузится сразу вместе с chart.js, тяжёлый компонент, потенциальный выигрыш по first paint дашборда
- ⭕ Angular Aria — отдельно не внедрять именно в метриках: expand/collapse панелей идёт через общий `ui-kit`-компонент `v-expand`, доработка попадёт туда одним заходом для всех разделов сразу

## Смена подхода: блоки по разделам, глобальное — в конец (24.10.2026)

Заменяет порядок исполнения. «Группы 0–4», «Порядок переноса по разделам» и «Блок 1» выше остаются как аудит и история; делать — по блокам ниже. Что из старого пункта устарело, помечено в «Уточнениях».

### Почему
- Цена ошибки разная: метрики — только админы, деньги — пара человек, еда — реальные пользователи.
- Глобальные шаги (zoneless, interceptor, общий ui-kit) нельзя откатить «только в одном разделе» — они бьют по всем сразу. Идут последними, когда разделы уже обкатаны.

### Принципы
- Блок = раздел. В блок входит всё, что меняет только файлы этого раздела.
- Общее (ui-kit, сервисы общего пользования, `main.ts`, `angular.json`) блоки не трогают — оно целиком в финальном блоке.
- Порядок: Метрики → Деньги → Настройки/auth/навигация/уведомления → Еда → Глобальный.
- Исполнение блока: правки → `tsc` + `vitest` + `ng build` → отметки в плане.

### Состояние на 24.10.2026
- ✅ `ng update` 21→22 закоммичен (`a45bee9`), Angular `22.1.7`, TS `6.0.3`.
- ✅ ui-kit: `Eager` закоммичен в сабмодуле (`d7f5728`), сабмодуль чистый на `release`. Пункт «20 файлов не закоммичены» выше устарел.
- Ветка `037-angular-ver-upgrade` на 27 коммитов впереди origin, не запушена.
- На npm: `@angular/core` 22.2.3, `@angular/aria` 22.2.4.
- `Eager` по разделам: метрики 0, деньги 0, настройки 2, auth 1, навигация 1, уведомления 1, еда 13, shared 3, ui-kit 20.

### Уточнения к старому плану (по факту кода)
- **История метрик не ложится на `httpResource()`.** Это цепочка последовательных батчей с продвижением курсоров после каждого и сохранением прогресса при сбое посередине; `resource` — один запрос, один результат. Остаётся RxJS. Пункт «history → httpResource» из Блока 1 выше снят. WS-потоки метрик остаются на RxJS, как и было.
- **Критерий для `subscribe` (24.10.2026).** Из 48 вызовов: ~25 мутации (create/update/delete в деньгах), ~17 потоки событий (WS, `connected$`, `router.events`, `mutationApplied$`, resize, `valueChanges`), 3–4 чтение GET, остальное — fire-and-forget. Цель — не «убрать `subscribe`», а убрать его там, где он остался по привычке («подписался + флаг загрузки»). RxJS остаётся там, где он по смыслу нужен.
  - Чтение по ключу (GET, зависит от сигналов) → `httpResource()` / `rxResource()`.
  - Поток, который лишь превращается в состояние (resize → `isMobile`, текущий роут) → `toSignal()`.
  - Мутация (POST/PUT/DELETE с обработкой результата) → `await firstValueFrom(...)` в `async`-обработчике; `resource` для записи не подходит.
  - Непрерывные потоки с побочным эффектом (WS-сообщения, `mutationApplied$`, `router.events`, `valueChanges`), батч-цепочки (история метрик), fire-and-forget (telemetry) → остаются на RxJS `subscribe`.
  - Каждое место решается отдельно, в блоке своего раздела (порядок и момент обновлений меняются).
- **Формы денег уже наполовину сигнальные.** Источник правды — сигналы, `ngModel` лишь мост (значение читается из сигнала, изменение пишется в сигнал). Контролы ui-kit (`v-input`, `v-dropdown`, `v-wheel-input`, `v-date-wheel-input`) — `ControlValueAccessor`. Signal Forms потребуют перевести эти 4 компонента на signal-интерфейс контрола — это общая часть, не раздельная.
- **`@Service()` и `provideCheckNoChangesConfig` есть в установленном 22.1.7** (проверено по типам). Второй — developer preview, только для dev-режима.
- **`@angular/aria` в зависимостях нет.** Его peer — `@angular/cdk` той же версии, а у нас `@angular/cdk` в `overrides` на 21.1.0 → перед Aria cdk нужно поднять.
- Для zoneless вместо россыпи дебаг-логов — `provideCheckNoChangesConfig({ exhaustive: true })`: dev-проверка ловит «состояние изменилось без уведомления Angular». Логи — только точечно (ResizeObserver, IntersectionObserver, приход WS-фрейма, перерисовка Chart.js), как временные, с общим эмодзи-префиксом для удаления одним поиском.
- `v-color-picker` без явной стратегии CD — в v22 это уже `OnPush` по умолчанию; миграция его не тронула.

### Блок 0 — подготовка
- ✅ Поднять Angular/CLI/build до актуального `22.2.x` (24.10.2026): `@angular/*` → `22.2.3`, `cli`/`build` → `22.2.4`, TS остался `6.0.3`; авто-миграций кода `ng update` не применил, изменились только `package.json` и `package-lock.json`. `tsc` (app, spec), `ng test` — 39 файлов / 447 тестов, `ng build --configuration dev` — чисто
- ✅ `@angular/cdk` в `overrides` поднят `21.1.0` → `22.2.4` (под Aria). cdk тянет только `ng2-charts@5.0.4` как peer, в коде проекта cdk не импортируется. Override — костыль: `ng2-charts@5` не объявляет поддержку cdk 22. Чистое решение — `ng2-charts@11` (peer `>=22`), это мажорный апгрейд графиков, отдельное решение, не часть Блока 0

### Блок 1 — Метрики
Малый по объёму: компоненты уже `OnPush`, форм и легаси-декораторов нет.
- ✅ Сервисы раздела: `@Injectable({ providedIn: 'root' })` → `@Service()` (`metrics`, `metrics-health`, `metrics-settings`, `metric-card-expansion`) — 24.10.2026
- ✅ `metric-card-grid` и `metric-chart-card`: конструкторная инъекция `ElementRef` → `inject()`, конструкторы удалены
- ✅ `metrics-dashboard.html`: `@let` для повторяющегося `isServiceExpanded(...)` в шапке (кнопка Dashboard и цикл по сервисам)
- ✅ `@defer` для карточек — **отказ**: маршрут метрик уже ленивый (`loadComponent`), всё содержимое страницы — карточки; `@defer` лишь сдвинул бы chart.js на один кадр, добавив мигание/сдвиг вёрстки ради раздела для админов. Карточки и так гейтятся `IntersectionObserver`
- ✅ `window:scroll` через `host` вместо ручных `addEventListener`/`removeEventListener` в `metrics-dashboard` — **отказ**: host-listener помечает компонент грязным на каждый scroll-event и перепроверяет большой шаблон; ручной слушатель пишет сигнал только при смене `scrollY > 0`, под zoneless это точнее
- ✅ `device-info` (resize → сигнал) — **перенесён в Блок 5**: сервис общий для всех разделов, не метрик
- ✅ `ResizeObserver`/`IntersectionObserver` и `ngOnInit`/`ngOnDestroy` в компонентах метрик оставлены: нужна синхронная начальная замеровка после вставки в DOM, замена на `afterNextRender` не даёт выигрыша
- ✅ Проверки: `tsc` (app, spec) 0 ошибок, `ng test` 39/447, `ng build --configuration dev` чисто; в живом приложении (`localhost:4200/metrics`, Chrome) прогнаны: дашборд, переключение сервиса (SCB4), раскрытие карточки (полноширинный график, кнопка «свернуть все»), прокрутка (карточки при появлении рисуются, тень sticky-шапки), перезагрузка (45/45 карточек нарисованы). Ошибок в консоли не поймано, но запись консоли стартует с первого вызова, поэтому ошибки при загрузке страницы этим прогоном не покрыты
### Блок 2 — Деньги
- ✅ Сервисы раздела на `@Service()` (`money`, `money-compute`); в `money.service` конструкторная инъекция (`HttpClient`, `SyncEngineService`) → `inject()`
- ✅ Мутации справочников (валюты, категории, организации, счета, активы — по 3 метода) → `async`/`Promise<boolean>` через один приватный хелпер `send()` с `firstValueFrom`; ~15 копий `pipe(map, catchError)` схлопнуты. Вызовы в формах и списках: `if (await …) savedOutput.emit()`, удаление — `void …`
- ✅ Транзакции и переводы (create/update/delete/transfer) — оптимистичные через sync engine, ничего асинхронного не возвращали (`of(true)`) → методы стали `void`, в `transaction-form` и `transactions-list` убраны `subscribe`
- ✅ Удалён мёртвый `requestResult$` (Subject, в нём только `next`, подписчиков во всём проекте нет) и закомментированный отладочный код в конструкторе `money.service`
- ✅ Начальный GET snapshot: `subscribe` → `async` `fetchSnapshot` с `firstValueFrom` и `try/catch`. `httpResource` — **отказ**: снапшот грузится императивно при каждом входе на экран, мёржится с очередью несохранённых транзакций и кэшем и раскладывается в 7 сигналов; ресурсу пришлось бы писать их через `effect`, это лишний слой
- ✅ Конструкторная инъекция `moneyService` → `inject()` в `category-form`, `organization-form`, `currency-form`, `account-form`
- ✅ `subscribe` в `transactions-list` (горячая клавиша N через `keyboardService.shortcut$`) оставлен: поток событий, с `takeUntilDestroyed`
- ✅ `ngClass`/`ngStyle`, `@Input`/`@Output`, `Eager`, `standalone: true` в разделе не встречаются — трогать нечего
- ⭕ Формы (12 файлов) — к Signal Forms готовы как есть (сигналы — источник правды, `ngModel` лишь мост); фактический перевод ждёт общих контролов ui-kit (Блок 5)
- ✅ Проверки: `tsc` (app, spec) 0 ошибок, `ng test` 39/447, `ng build --configuration dev` чисто. В браузере (`localhost:4200/money`) проверены загрузка snapshot (балансы, транзакции, три графика), вкладка Setup со списками, открытие и отмена формы «New Organization». Создание/изменение/удаление в браузере **не** проверялись: данные на экране похожи на реальные финансы

### Блок 3 — Настройки, auth, навигация, уведомления
- ✅ `Eager` → `OnPush`: `settings`, `dark-switch`, `auth-form`, `navigation`, `notifications` и корневой `app.component` (оболочка; весь шаблон на сигналах). `shared/components` (`toolbar-group`, `default-modal`, `form-modal`) — общие для всех разделов, остаются в Блоке 5
- ✅ **Выбор пункта меню — не механическая замена.** `navigation.service` писал `selected` в обычные поля общих объектов-кнопок из `subscribe` на роутер: при `OnPush` подсветка активного раздела перестала бы обновляться. Теперь `selected` вычисляется в `prepButtons()` из сигнала текущего роута (кнопки-конфиг не мутируются), а `RouterService` отдаёт `currentRoute$$` через `toSignal()` вместо `BehaviorSubject` + `subscribe`. Удалены неиспользуемые `NavigationService.currentRoute$$` и пустой `ngOnInit` в `navigation`
- ✅ `navigation.html`: `ngClass` → `[class]`, убраны `NgClass`; из `dark-switch` убран лишний `CommonModule`
- ✅ **Форма настроек разделов — на сигналах.** `FormGroup` из трёх булевых + `effect`, который писал в форму мимо сигналов (при `OnPush` откат после отказа сохранения и обновление из `settings$$` не перерисовались бы), заменены двумя `linkedSignal`: значение следует за сохранёнными настройками, при клике меняется сразу, при отказе сервера откатывается. Убраны `ReactiveFormsModule`, обёртка `<form>`, метод темы (в шаблоне `settingsService.setDarkTheme($event)`) и привязки `isDisabled` (контролы никогда не отключались)
- ✅ Сервисы раздела на `@Service()`: `auth`, `settings`, `navigation`, `notification`, `router`. Общие инфраструктурные — в Блоке 5
- ✅ `subscribe` по критерию: `auth.service` — `login`/`register` теперь `async` (`Promise<void>`, `firstValueFrom` ушёл из `auth-form`), `renew` — `async` с `try/catch` вместо `pipe(tap, catchError, throwError)` + `subscribe({ error: () => undefined })`; роутер — `toSignal()`
- ✅ `auth-form` остаётся на Reactive Forms: сигнальные статус и touched в `FormControl` v22 делают `OnPush` безопасным; перевод на Signal Forms — Блок 5
- ✅ Проверки: `tsc` (app, spec) 0 ошибок, `ng test` 39/447, `ng build --configuration dev` чисто. В браузере: тёмная тема в настройках (переключение туда-обратно, иконка в навигации меняется), снятие и возврат галочки «Дневник питания» (пункт меню исчезает и возвращается), подсветка активного пункта меню при переходах настройки → деньги → метрики, экран входа на `127.0.0.1:4200/auth` (оболочка выходит из «Загрузка...» в форму, переключатель «Войти/Зарегистрироваться», кнопка отправки включается по валидности формы). Отправка формы входа/регистрации и откат галочки при отказе сохранения в браузере **не** проверялись (нужны реальные учётные данные и обрыв сети)

### Блок 4 — Еда
Последним из разделов, самый рискованный (реальные пользователи).
- ✅ `Eager` → `OnPush` на 13 компонентах
- ✅ `diary-entry-edit-form`: `@Input`/`@Output` → `input()`/`output()`; `camera-preview`: `@ViewChild` → `viewChild()`
- ✅ `diary-entry-product-info`: убрать `standalone: true`
- ✅ `food-diary.html` и `food-product-picker.html`: `ngStyle`/`ngClass` → `[style.]`/`[class.]`
- ✅ Сервисы раздела на `@Service()` (`services/food/*`)
- ⭕ `subscribe` в еде — по критерию выше: `food-product-history-state` (запрос истории продукта) — кандидат на `resource`; WS-подписки (`food-diary`, `food-catalogue`, `food-sync-coordinator`, `food-stats`, `mutationApplied$`) остаются на RxJS; сложное с ретраями/дебаунсом не трогать без выгоды
- ⭕ Формы еды (5 файлов) — после Блока 2/5

### Блок 5 — Глобальный (в самом конце)
Всё, что нельзя разделить по разделам.
- ⭕ ui-kit: `Eager` → `OnPush` на 20 компонентах, `@HostListener` → `host: {}` (`v-modal`, `v-wheel-select`), `standalone: true` в `v-accordion` и `flip-animate`, `ngStyle` в `v-dropdown`
- ⭕ ui-kit: 4 контрола форм на signal-интерфейс контрола Signal Forms
- ⭕ Signal Forms: перевод форм всех разделов, затем удаление `FormsModule`/`ReactiveFormsModule`
- ✅ Functional interceptor: `auth.interceptor.ts` → `HttpInterceptorFn` + `withInterceptors()`
- ✅ Общие сервисы на `@Service()` (`network`, `telemetry`, `sync-engine`, `local-storage`, `indexed-db-cache`, `keyboard`, `photo-capture`, `chart-theme`)
- ⭕ Zoneless: `provideZonelessChangeDetection()`, убрать `zone.js` из polyfills и зависимостей, `provideCheckNoChangesConfig` в dev, точечные временные логи; обкатка на метриках, затем деньги, еда
- ⭕ Решить `withXhr()` → Fetch
- ⭕ Angular Aria для `v-dropdown`, `v-expand`, `v-modal` (после поднятия cdk)
- ⭕ Группа 4 выше (selectorless, `injectAsync`, ESLint) — по желанию

## Поправка про `@angular/cdk` (24.10.2026)

Заменяет утверждения про cdk в Блоке 0 выше.
- Было неверно: «`ng2-charts@5` не заявляет поддержку cdk 22, чистое решение — `ng2-charts@11`». Peer у `ng2-charts@5.0.4` — `@angular/cdk >=16.0.0`, cdk 22 подходит; апгрейд графиков не нужен.
- Проверено: cdk в проекте не нужен вообще. В `src`/`ui-kit`/конфигах нет ни одной ссылки; `ng2-charts` в рантайм-коде cdk не импортирует (упоминание только в `package.json` как peer и в schematics генерации). В изолированной копии с `overrides` без cdk (`npm install --omit=peer`) прошли `tsc`, 447 тестов и `ng build`.
- Override (появился 19.08.2026 при Angular 21.1.0) обходил конфликт: npm ставил свежий cdk 22 как peer `ng2-charts`, а ядро было 21. На Angular 22 конфликта нет.
- ✅ Блок `overrides` удалён из `package.json`. npm по-прежнему ставит cdk сам как peer `ng2-charts` (сейчас `22.2.4`), файл lock не изменился. Для Aria отдельная правка cdk не нужна.

## Блок 4 — Еда: выполнено (27.10.2026)

Дополняет «Блок 4 — Еда» выше. Пункты про `Eager`, декораторы, `standalone`, `ngStyle`/`ngClass` и `@Service()` закрыты; остаются `subscribe` и формы.

### Что сделано
- **13 компонентов на `OnPush`.** Перед заменой по каждому проверены обычные поля, которые меняются без сигнала. Найдены и переведены на сигналы: `isDeleteDayConfirmOpen` (`food-diary`), `isDeleteConfirmOpen` и `disablePanelsAnimationTemporarily` (`diary-entry-edit-form`), `maxDateIso` (`diary-nav-buttons`). В `bmi` поле `bmiSegmentsWidthFractions` — константа, считается при создании, `ngOnInit` удалён. Остальные компоненты уже читали только сигналы.
- **`diary-entry-edit-form` переписан на сигнальный вход.** `@Input` → `diaryEntryInput = input.required()`, `@Output` → `entryChangedOutput` (имя без опечатки и без префикса `on`). `ngOnChanges` удалён: `foodWeightInitial` стал `computed` от входа, а `id` записи больше не хранится в форме (контрол `id` убран) — берётся из `computed` `diaryEntryId`. Сравнение по значению важно: эффекты фокуса и сброса формы иначе перезапускались бы при каждом фоновом обновлении записи с сервера.
- **Значение контрола — не сигнал.** В v22 сигнальными стали `status`/`pristine`/`touched`, а `value` — нет. Шаблон `diary-entry-edit-form` показывал кнопки сброса и «г.» по `control.value !== null`; при `OnPush` программный сброс (через `setTimeout` из эффекта) не перерисовал бы их. Заменено на `toSignal(control.valueChanges)`. В `auth-form` и формах добавления/каталога шаблон читает только `valid`, там замена не нужна.
- **`camera-preview`**: `@ViewChild` → `viewChild()`. Остался опциональным (не `.required`): `<video>` и `<canvas>` рендерятся только в ветке живой камеры, при ошибке или готовом фото их нет, и обязательный запрос бросил бы исключение.
- **`ngStyle` → `[style]`** (`food-diary`), **`ngClass` → два `[class.*]`** с `hasSearchResults$$` (`food-product-picker`), **убран `standalone: true`** (`diary-entry-product-info`).
- **Сервисы еды на `@Service()`**: `food-diary`, `food-catalogue`, `food-stats`, `food-stats-insights`, `food-personal-kcals`, `food-settings`, `food-add-modal`, `food-sync-coordinator`, `food-product-history`, `food-product-history-state`. `FoodScreenModeService` остаётся `@Injectable()` — он провайден в `food-screen`, а не в корне.
- **`BaseFoodService` на `inject()`.** Четыре сервиса еды наследуют базу и передавали ей в конструкторе `HttpClient`, `LocalStorageService`, `NetworkService`, `SyncEngineService`. База теперь берёт их через `inject()`, у наследников конструктор без параметров и вызов `super()`, лишние импорты убраны. Декоратор с самой абстрактной базы снят: ему нечего регистрировать.

### Не сделано
- ⭕ `subscribe` в еде. Кандидат на `resource` — только `food-product-history-state` (запрос истории продукта с отменой предыдущего через `activeRequestSub`); остальное — WS и `mutationApplied$`, остаётся на RxJS. Нужен отдельный заход: отмена, порядок ответов и ограничение в 20 продуктов в `resource` выглядят иначе.
- ⭕ Формы еды (5 файлов) — Блок 5, после общих контролов ui-kit.

### Проверки
- ✅ `tsc` (app, spec) 0 ошибок, `ng test` 39 файлов / 450 тестов, `ng build --configuration dev` чисто.
- ⭕ В браузере раздел не прогонялся. Что стоит открыть руками: раскрытие записи дня и поля «Новый вес»/«Изменить на» (кнопка сброса и «г.» появляются и исчезают), сохранение и удаление записи, удаление всех записей дня, переход по датам и «сегодня», поиск продукта в окне добавления, камера (старт, снимок, «переснять»), графики статистики.

## Находки после ревью (v-review:claude, 28.10.2026)

Проверено: незакоммиченные правки Блока 4 в `megaapp-front` (бэкенд чистый). Уровень high. Плана-соответствие, дефекты и качество решения проверены тремя отдельными проходами; все пункты Блока 4 выполнены, регрессий не найдено.

### Баги
1. Условие «есть результаты поиска» продублировано в шаблоне пикера
   - **Класс:** B
   - **Важность:** мелочь, но стоит поправить
   - **Как сейчас работает:** при замене `ngClass` в `food-product-picker` добавлено вычисляемое `hasSearchResults$$`, и два новых `[class.pt-4]`/`[class.pb-4]` используют его. Пять соседних условий в том же шаблоне (`[class.mb-4]` дважды, `@if` на результаты, на кнопку создания продукта и на мобильный блок) по-прежнему считают `searchResults$$().length > 0` или `=== 0` вручную.
   - **Что не так:** одна и та же проверка записана в шести местах двумя способами. Если смысл «есть результаты» изменится (например, не считать архивные), правка пройдёт по новому вычисляемому, а старые условия останутся прежними, и разметка разойдётся.
   - **Как поправить:** использовать `hasSearchResults$$` во всех местах шаблона, где проверяется длина `searchResults$$`.
   - **Как будет работать после правки:** поведение то же, условие определено в одном месте.
   - **Объём правки:** малый — шесть замен в `food-product-picker.html`.
   - **Рекомендация:** чинить — класс B, правка малая

**Замечено рядом (не блокирует):** `diary-nav-buttons` обновляет `maxDateIso$$` и сразу открывает нативный выбор даты, поэтому при смене суток выбор откроется со старым `max` (старая логика, не регрессия); в `food-stats-charts.html` внутри `<canvas>` выводится `{{ weightChart$$() }}` и `{{ kcalsChart$$() }}` — похоже на заглушку зависимости шаблона от сигнала; комментарий к `entryChangedOutput` говорит «на сервере», хотя правки оптимистичные и событие приходит после локального применения.

## Чек-лист по находкам после ревью (v-review:claude, 28.10.2026)

Чек-лист по нашим основным правилам создания чек-листов и туду-листов.

- ✅ 1. Условие «есть результаты поиска» продублировано в шаблоне пикера

## Блок 5, первый заход: interceptor и общие сервисы (29.10.2026)

Дополняет «Блок 5 — Глобальный». Взят безопасный по объёму кусок: не требует ui-kit и не трогает change detection.

### Сделано
- ✅ `auth.interceptor.ts` → функциональный `authInterceptor` (`HttpInterceptorFn`); в `main.ts` `withInterceptors([authInterceptor])`, убраны `HTTP_INTERCEPTORS` и `withInterceptorsFromDi()`. `AuthService` теперь берётся через `inject()` на каждый запрос — к моменту запроса сервис всё равно создан, порядок создания прежний (см. комментарий про NG0200 в `telemetry.service`).
- ✅ Общие сервисы на `@Service()`: `network`, `telemetry`, `sync-engine`, `local-storage`, `indexed-db-cache`, `keyboard`, `photo-capture`, `chart-theme`, `device-info`. `TelemetryErrorHandler` остаётся `@Injectable()` — провайдится вручную в `main.ts`.
- ✅ `NetworkService`: конструкторная инъекция `NotificationService` → `inject()`. Компилятор не принимает `@Service` с параметрами конструктора (NG2028), а `tsc --noEmit` этого не ловит — только `ng build`/`ng test`.
- ✅ Убран `standalone: true` в `app/shared/directives/flip-animate.directive.ts`.
- ✅ Новый `auth.interceptor.spec.ts` (4 теста): заголовок `X-Client-ID`, 401 → `invalidateSession`, 401 от `/api/auth/session` не инвалидирует, другие статусы не инвалидируют.

### Остаётся в Блоке 5
- ⭕ ui-kit (отдельный репозиторий): `z-layer` и `accordion-group` всё ещё `providedIn: 'root'` (в плане не были названы), `Eager` ×21 + 3 в `shared/components`, `@HostListener`, `standalone: true` в `v-accordion` и `flip-animate`, `ngStyle` в `v-dropdown`.
- ⭕ Signal Forms, zoneless, `withXhr()` → Fetch, Aria, формы еды, `subscribe` в еде.

### Проверки
- ✅ `tsc` (app, spec) 0 ошибок, `ng test` 40 файлов / 452 теста, `ng build --configuration dev` чисто.
- ✅ В Chrome (`localhost:4200`, залогиненная сессия): метрики (дашборд, графики рисуются), деньги (балансы, транзакции, три графика; клавиша N открывает форму транзакции — `KeyboardService` работает; форма закрыта без сохранения), еда (серия, график веса, топ продуктов). Запросы `/api/auth/session`, `/api/settings/*`, `/api/ingest/telemetry` — 200 после перехода на функциональный interceptor, ошибок в консоли нет.
- ⚠️ `POST /api/metrics/history` на странице метрик вернул 502: бэкенд сам отвечает «Failed to load metrics history» (`megaapp-back/internal/metrics/http.go:72`), на ручные запросы без заголовка `X-Client-ID` и с ним отвечает одинаково (400). К interceptor отношения не имеет; графики показаны из локального кэша.
- ⭕ Не проверено в браузере: реальный 401 (разлогин по сессии), камера, загрузка фото.

## Актуальный статус плана (29.10.2026)

Сводка по всему документу: что из старых пунктов закрыто, что осталось. В старых секциях ⭕ → ✅ переставлены только у полностью выполненных пунктов (functional interceptor — «Группа 3», «Блок 1», «Блок 5»; общие сервисы на `@Service()` — «Блок 5»). Пункты, выполненные частично, там остались ⭕: остаток описан ниже. Секция «Блок 5, первый заход» выше — детали этого захода, а не отдельный блок.

### Закрыто
- ✅ `ng update` 21→22.2.x, TS 6.0.3, `@angular/cdk` override удалён (Блок 0 + поправка про cdk)
- ✅ Блоки 1–3 (Метрики, Деньги, Настройки/auth/навигация/уведомления) целиком
- ✅ Блок 4 (Еда): `OnPush`, `input()`/`output()`/`viewChild()`, `@Service()`, `BaseFoodService` на `inject()`
- ✅ Functional interceptor + `withInterceptors()`
- ✅ `@Service()` во всех сервисах `app` (в `src/app` не осталось `providedIn: 'root'`)
- ✅ Тесты на `@angular/build:unit-test` + Vitest, control flow на `@if`/`@for`/`@switch`, функциональные guards, 0 `NgModule`

### Закрыто частично (старый ⭕ остаётся, пока не доделан остаток)
- Группа 2, `Eager` → `OnPush` (стр. «Заменить авто-`Eager`»): в `app` сделано, остались 3 компонента в `shared/components` (`default-modal`, `form-modal`, `toolbar-group`) и 21 в `ui-kit`
- Группа 2, декораторы `@HostListener` (`v-modal`, `v-wheel-select`), `standalone: true` (`v-accordion`, `flip-animate` в ui-kit), `ngStyle` (`v-dropdown`): в `app` всё убрано, остаток только в `ui-kit`
- Группа 3, `@Service()` (32 файла): остались `z-layer` и `accordion-group` в `ui-kit`
- Группа 3, `resource()`/`httpResource()`: решено по месту — чтение GET на `async`/`firstValueFrom`, мутации так же, `toSignal()` для потоков; `httpResource` отвергнут для истории метрик и снапшота денег. Открыт только `food-product-history-state`

### Не начато
- ⭕ Zoneless (`provideZonelessChangeDetection()`, убрать `zone.js`, `provideCheckNoChangesConfig`)
- ⭕ Signal Forms (14 файлов с `FormsModule`/`ReactiveFormsModule`, 4 контрола ui-kit на signal-интерфейс)
- ⭕ `withXhr()` → Fetch (решение не принято)
- ⭕ Angular Aria (`v-dropdown`, `v-expand`, `v-modal`)
- ⭕ Группа 4: selectorless, `injectAsync`, ESLint без конфига

### Порядок на дальше
1. ui-kit (отдельный репозиторий): `Eager` → `OnPush`, остаток legacy, `@Service()` для двух сервисов
2. Signal Forms — после контролов ui-kit
3. Zoneless — последним, обкатка на метриках → деньги → еда
4. Aria, `withXhr()` → Fetch, Группа 4 — по желанию
