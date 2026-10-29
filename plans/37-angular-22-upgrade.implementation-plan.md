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
- ✅ Заменить авто-`Eager` на осознанный `OnPush` во всех 43 компонентах (или наоборот — `Eager` там, где обоснованно, но по умолчанию — `OnPush`)
- ✅ Домигрировать `@Input()`/`@Output()`/`@ViewChild()`/`@HostListener()` (4 файла) на `input()`/`output()`/`viewChild()`/`host: {}` — готовые CLI-миграции
- ✅ Убрать избыточный явный `standalone: true` (4 файла)
- ✅ Заменить `ngClass`/`ngStyle` на `[class.]`/`[style.]` (по 2 файла)
- ⭕ Точечно применить новый шаблонный синтаксис v22 (spread/rest в шаблонных выражениях, exhaustive `@switch` с `@default never`, инлайн-стрелочные обработчики событий) — там, где реально упрощает код, не ради самого факта

### Группа 3 — глубокое выравнивание с философией (основной объём рефакторинга)
- ✅ **Zoneless**: включить `provideZonelessChangeDetection()`, убрать `zone.js` из `angular.json` polyfills и из package.json, пройти по всем 60 `effect()` и 49 `subscribe()` и убедиться, что запись состояния всегда идёт через `signal.set()/update()`, а не через мутацию plain-полей; отдельно смоук-тест графиков (chart.js callbacks) и `v-dropdown`/`v-wheel-select` (используют `subscribe()`/`@HostListener` вне сигнального графа)
- ✅ **Signal Forms**: перевести все ~15 файлов на `@angular/forms/signals` (`form()` + schema-валидация), убрать `ReactiveFormsModule`/`FormsModule`/`ngModel`/`FormBuilder` — один способ работы с формами вместо двух
- ✅ **Functional interceptor**: переписать `auth.interceptor.ts` на `HttpInterceptorFn`, заменить `withInterceptorsFromDi()` на `withInterceptors([...])` в `main.ts`, убрать `HTTP_INTERCEPTORS`-provider
- ✅ **`@Service()`**: перевести 32 файла с `@Injectable({ providedIn: 'root' })` на `@Service()` (механическая замена, можно скриптом-подсказкой + ручная проверка)
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
- ✅ Включить `provideZonelessChangeDetection()`, убрать `zone.js` из `angular.json` polyfills и package.json
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
- ✅ Формы (12 файлов) — к Signal Forms готовы как есть (сигналы — источник правды, `ngModel` лишь мост); фактический перевод ждёт общих контролов ui-kit (Блок 5)
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
- ✅ Формы еды (5 файлов) — после Блока 2/5

### Блок 5 — Глобальный (в самом конце)
Всё, что нельзя разделить по разделам.
- ✅ ui-kit: `Eager` → `OnPush` на 20 компонентах, `@HostListener` → `host: {}` (`v-modal`, `v-wheel-select`), `standalone: true` в `v-accordion` и `flip-animate`, `ngStyle` в `v-dropdown`
- ✅ ui-kit: 4 контрола форм на signal-интерфейс контрола Signal Forms
- ✅ Signal Forms: перевод форм всех разделов, затем удаление `FormsModule`/`ReactiveFormsModule`
- ✅ Functional interceptor: `auth.interceptor.ts` → `HttpInterceptorFn` + `withInterceptors()`
- ✅ Общие сервисы на `@Service()` (`network`, `telemetry`, `sync-engine`, `local-storage`, `indexed-db-cache`, `keyboard`, `photo-capture`, `chart-theme`)
- ✅ Zoneless: `provideZonelessChangeDetection()`, убрать `zone.js` из polyfills и зависимостей, `provideCheckNoChangesConfig` в dev, точечные временные логи; обкатка на метриках, затем деньги, еда
- ✅ Решить `withXhr()` → Fetch
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
- ✅ Формы еды (5 файлов) — Блок 5, после общих контролов ui-kit.

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
- ✅ ui-kit (отдельный репозиторий): `z-layer` и `accordion-group` всё ещё `providedIn: 'root'` (в плане не были названы), `Eager` ×21 + 3 в `shared/components`, `@HostListener`, `standalone: true` в `v-accordion` и `flip-animate`, `ngStyle` в `v-dropdown`.
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
- ✅ Zoneless (`provideZonelessChangeDetection()`, убрать `zone.js`, `provideCheckNoChangesConfig`)
- ✅ Signal Forms (14 файлов с `FormsModule`/`ReactiveFormsModule`, 4 контрола ui-kit на signal-интерфейс)
- ✅ `withXhr()` → Fetch (решение не принято)
- ⭕ Angular Aria (`v-dropdown`, `v-expand`, `v-modal`)
- ⭕ Группа 4: selectorless, `injectAsync`, ESLint без конфига

### Порядок на дальше
1. ui-kit (отдельный репозиторий): `Eager` → `OnPush`, остаток legacy, `@Service()` для двух сервисов
2. Signal Forms — после контролов ui-kit
3. Zoneless — последним, обкатка на метриках → деньги → еда
4. Aria, `withXhr()` → Fetch, Группа 4 — по желанию

## Блок 5, второй заход: ui-kit без legacy-синтаксиса (29.10.2026)

Дополняет предыдущую секцию. В «Группа 2» и «Группа 3» отмечены ✅: `@Input`/`@Output`/`@ViewChild`/`@HostListener`, `standalone: true`, `ngClass`/`ngStyle`, `@Service()` — в `src` их больше нет. `Eager` → `OnPush` остаётся ⭕ (в `app` сделано, остались ui-kit и `shared/components`).

### Сделано
- ✅ `@HostListener` → `host: {}`: `v-modal` (`document:keydown.escape`), `v-wheel-select` (`document:pointerdown`, `document:keydown.escape`).
- ✅ Конструкторная DI → `inject()` во всём ui-kit. Нашлось больше, чем в аудите: `v-dropdown`, `v-tooltip`, `v-wheel-select`, `backdrop.directive` (`@Optional`/`@Inject(PARENT_LAYER_ID)`), `v-input` (`@Optional() @Self() NgControl`), `flip-animate.directive` (ui-kit и `app/shared`), `progress-icon`. Опциональные токены — `inject(..., { optional: true })`; `v-tooltip` регистрирует слой в инициализаторе поля.
- ✅ `v-dropdown`: `ngStyle` → `[style]` (4 места), убран `CommonModule`.
- ✅ `standalone: true` убран в `v-accordion` и `flip-animate.directive` (ui-kit).
- ✅ `@Service()` для `ZLayerService` и `AccordionGroupService` — в `src` не осталось `providedIn: 'root'`.

### Осталось в Блоке 5
- ✅ `Eager` → `OnPush`: 21 компонент ui-kit + `default-modal`, `form-modal`, `toolbar-group`. Каждый требует проверки обычных полей, меняющихся без сигнала (как в Блоке 4).
- ⭕ 4 контрола ui-kit на signal-интерфейс → Signal Forms → zoneless → Aria → `withXhr()` → Группа 4.

### Проверки
- ✅ `tsc` (app, spec) 0 ошибок, `ng test` 40 файлов / 452 теста, `ng build --configuration dev` чисто; `grep` по `src` — ни `HostListener`, ни `standalone: true`, ни `ngStyle`, ни `providedIn: 'root'`, ни `@Optional`/`@Inject(`.
- ✅ В Chrome (`localhost:4200`): деньги — клавиша N открывает форму (`v-modal`, backdrop), выпадающий список счёта (`v-dropdown`, стиль позиции) выбирается, Escape закрывает форму; колесо года в поле даты (`v-wheel-select`) открывается и закрывается кликом вне; еда — окно добавления записи, поиск «шаурма» перестраивает сетку (`flipAnimate`), тултип «?» над графиками (`v-tooltip`), секции дневника (`v-accordion`). Данные не сохранялись.
- ⭕ Не проверено в браузере: `ui-progress-icon` (в формах записи еды, при пустом дне недоступен), консоль ошибок за время прогона (запись консоли начата только в конце, ошибок на тот момент нет).

## Блок 5, третий заход: `OnPush` в простых компонентах ui-kit (29.10.2026)

Продолжает пункт «Eager → OnPush» (⭕ в «Группе 2» и «Блоке 5» остаётся: часть компонентов ещё на `Eager`).

### Сделано
- ✅ `Eager` → `OnPush` на 10 компонентах: `v-button`, `v-card`, `v-chip`, `v-icon`, `v-progress`, `v-toggle`, `v-checkbox`, `v-toast`, `v-tooltip`, `ui-progress-icon`.
- Перед заменой прочитаны классы и шаблоны. Обычных полей, меняющихся без сигнала, нет: все входы — `input()`/`model()`, состояние — `signal`, шаблоны читают только сигналы и методы поверх сигналов. Ripple в `v-button` рисуется через `Renderer2` мимо шаблона. У `ui-progress-icon` `computed` читает атрибут `pieStyle` у элемента без сигнальных зависимостей — считается один раз, как и раньше (атрибут статический).
- Единственный риск для `v-toggle` — `items` как входной массив: проверено, во всех 6 местах использования это либо константа, либо `computed`/новый массив, на месте элементы не мутируются.

### Осталось на `Eager` (13 файлов)
- ✅ Сложные ui-kit: `v-input`, `v-dropdown`, `v-date-wheel-input` (контролы форм, `ControlValueAccessor`/`NgControl` — смотреть вместе с Signal Forms), `v-wheel-input`, `v-wheel-select`, `v-modal`, `v-slider`, `v-rolling-number`, `v-expand` и `v-accordion`.
- ✅ `app/shared/components`: `default-modal`, `form-modal`, `toolbar-group`.

### Проверки
- ✅ `tsc` (app, spec) 0 ошибок, `ng test` 40 файлов / 452 теста, `ng build --configuration dev` чисто.
- ✅ В Chrome (`localhost:4200`): деньги — переключатель Monthly/Yearly на графике расходов (`v-toggle` + `v-button`), возврат в Monthly; метрики — переключатель M/H/D (смена и возврат на H), панель настроек, переключатель «Синхронное наведение» (`v-checkbox` в режиме switch, иконка меняется, возврат в «вкл»), кнопка «Принудительно обновить метрики» → тост «Metrics refreshed» (`v-toast`); еда — переключатель «По калориям»/«По весу» перестраивает список с полосками (`v-progress`), тултип «?» (`v-tooltip`, проверен ранее на новой сборке).
- ⭕ Не проверено в браузере: `v-chip` (не встречается в шаблонах `app`), `ui-progress-icon` (в формах записи еды, при пустом дне недоступен), крестик закрытия в тосте, ошибок в консоли не поймано, но запись консоли стартует с первого вызова.

## Блок 5, четвёртый заход: `OnPush` в остальных компонентах, кроме контролов форм (29.10.2026)

Продолжает предыдущую секцию. Пункт «Eager → OnPush» (Группа 2, Блок 5) закрыт для всего, кроме четырёх компонентов — они ждут Signal Forms.

### Сделано
- ✅ `Eager` → `OnPush` на 9 компонентах: `v-modal`, `v-wheel-select`, `v-wheel-input`, `v-expand`, `v-accordion`, `v-rolling-number` (ui-kit) и `default-modal`, `form-modal`, `toolbar-group` (`app/shared/components`).
- ✅ **`v-modal`: `zIndex` — обычное поле, не сигнал.** Его пишет `effect` при первом открытии, а читает host-биндинг `--v-modal-z-index`. Host-биндинги считаются в представлении родителя: при `OnPush` у родителя и без смены его входов значение могло остаться старым. Заменено на сигнал `zIndex$$`.
- Остальные восемь прочитаны целиком: состояние только в сигналах, шаблоны читают сигналы и методы поверх них. `v-rolling-number` шаблон без биндингов, всё через `effect` и движок (`RollingNumberEngine`), `OnPush` ему не мешает. `v-accordion`/`v-expand` держат позиции и открытость в сигналах (`isOpen()` читает сигнальный сервис), так что `computed` остаётся реактивным.

### Осталось на `Eager` (4 файла)
- ✅ `v-input`, `v-dropdown`, `v-date-wheel-input` — контролы форм (`NgControl`/`ControlValueAccessor`): значение живёт в `FormControl`, а не в сигнале, поэтому их `OnPush` делаем вместе с переводом на Signal Forms.
- ✅ `v-slider` (539 строк, состояние перетаскивания) — отдельный аудит.

### Проверки
- ✅ `tsc` (app, spec) 0 ошибок, `ng test` 40 файлов / 452 теста, `ng build --configuration dev` чисто.
- ✅ В Chrome (`localhost:4200`): деньги — форма транзакции (`form-modal` → `v-modal`: окно над затемнением, список счёта над окном, колесо года выбирает 2027 и значение попадает в поле даты, Escape закрывает), панель «Settings» (`v-expand`: раскрытие и сворачивание, шеврон), диалог удаления транзакции (`default-modal`, нажата «No», транзакция на месте); метрики — кнопка порога (`toolbar-group`: появляется поле «95%» и разделители, возврат выключен), значения в карточках отрисованы (`v-rolling-number`); еда — секция «Съедено…» раскрывается и сворачивается (`v-accordion` + `v-expand`).
- ⭕ Не проверено в браузере: `v-modal` внутри другого `v-modal` (вложенные слои), мобильный вариант (`deviceType = mobile`), переключение слоя при быстром открытии/закрытии.

## Блок 5, пятый заход: `OnPush` в контролах форм, якорное позиционирование `v-dropdown`, хвосты сервисов (29.10.2026)

Заменяет вывод четвёртого захода: контролы форм не обязаны ждать Signal Forms. Аудит показал, что значение у `v-input`, `v-dropdown`, `v-date-wheel-input` живёт в собственных сигналах (`ngControlValue$$`, `value$$`/`selectedValue$$`, `dateISO$$`), а `writeValue` и подписка на `valueChanges` только пишут в них. Пункт «Eager → OnPush» (Группа 2, Блок 5) закрыт для всего ui-kit.

### Сделано
- ✅ `Eager` → `OnPush` на `v-input`, `v-dropdown`, `v-date-wheel-input`, `v-slider`. В `v-slider` ширина дорожки уже сигнал `trackWidth$$` (его пишет `ResizeObserver`), от него зависят `computed`-позиции, так что план не требует правок.
- ✅ **Баг `v-dropdown`: список уезжал на поле ввода и закрывал набранный текст** (воспроизводился и на `Eager`, то есть не регрессия). Причина: список `position: fixed`, а координаты один раз измерялись в `setTimeout(0)` после фокуса. Раскладка в этот момент ещё двигалась (в форме транзакции плашки счетов схлопываются CSS-переходом, модалка перецентрируется), а позже координаты не обновлялись.
- ✅ Исправление в корне, не заплаткой: список привязан CSS-якорем (anchor positioning) к обёртке поля, у каждого экземпляра своё имя якоря. Позиция, ширина и сторона раскрытия (`expandDirection`) считаются браузером и следуют за полем при любых сдвигах, скролле и ресайзе. Удалены `setTimeout`, `getFixedContainingBlockRect`, `ElementRef`, пять сигналов и `computed` стилей списка; `minDropdownWidth` стал обычным `[style.min-width]`.
- ✅ `FoodScreenModeService` и `TelemetryErrorHandler`: `@Injectable()` → `@Service({ autoProvided: false })`. Оба подключаются вручную (`providers` в `food-screen`, `useClass` для `ErrorHandler`), в корень не попадают. `@Injectable` в проекте больше не используется.
- ✅ `DeviceInfoService`: ручная подписка на `resize` заменена на `toSignal(..., { requireSync: true })`, метод `setupResizeListener` удалён.

### Проверки
- ✅ `tsc` 0 ошибок, `ng test` 40 файлов / 452 теста, `ng build` чисто, ошибок в консоли нет.
- ✅ В Chrome: еда — диапазонный слайдер графиков (перетаскивание ручки, пресеты «1 год»/«3 месяца», стрелки с клавиатуры, подписи «От/До» и график обновляются), поиск в диалоге записи (`v-input`: ввод, кнопка очистки, ранжированная выдача); деньги — форма транзакции (выбор счёта и категории в `v-dropdown`, сумма с ArrowUp, переключение Expense/Income, колесо дня в `v-date-wheel-input`), список теперь стоит ровно под полем и сохраняет ширину, в том числе после сдвига раскладки; метрики — экран и вкладка Custom рендерятся.
- ⭕ Открытые вопросы: Signal Forms (14 файлов с `FormsModule`/`ReactiveFormsModule`), zoneless, `withXhr()` → Fetch, `food-product-history-state` как `resource`, Angular Aria, Группа 4.
- ⭕ Не проверено в браузере: `v-dropdown` в режиме `select` (в `app` не используется), `expandDirection = right` и `minDropdownWidth` (в `app` не заданы), якорное позиционирование в Safari/Firefox, реальный 401, камера, `ui-progress-icon`, `v-chip`, вложенные и мобильные модалки.

## Блок 5, шестой заход: zoneless, Fetch, формы денег без `FormsModule` (29.10.2026)

Закрывает пункты «Zoneless» и «`withXhr()` → Fetch» из «Блока 5» и «Актуального статуса». Для Signal Forms остаются реактивные формы (см. ниже): формы денег оказались не их кандидатами, а обычными сигналами с мостом `ngModel`.

### Zoneless
- ✅ Убраны `provideZoneChangeDetection()` из `main.ts`, полифилл `zone.js` из `angular.json`, зависимость `zone.js` из `package.json` и `package-lock.json`. Приложение собирается и стартует без зоны (`Zone` в окне не определён).
- ✅ Добавлен `provideCheckNoChangesConfig({ exhaustive: true })`: в dev-режиме после каждого тика проверяются все представления, как если бы они были `Eager`. Состояние, изменённое мимо сигналов, даёт NG0100 в консоли, а не молча не обновляется. Проход по еде, деньгам и метрикам ошибок не дал.
- ✅ Аудит зависимостей от зоны: `NgZone`/`fakeAsync`/`waitForAsync` в проекте не используются; `OnPush` уже везде (последним был `v-color-picker`, в v22 `OnPush` по умолчанию, теперь указан явно); таймеры и подписки пишут только в сигналы. Тесты (454) идут без зоны.
- ✅ **Потерянный канал ошибок.** В зоне исключение в таймере или другом внешнем колбэке попадало в `ErrorHandler`, без зоны оно доходит только до `window`. В `TelemetryService` добавлен слушатель `error` (операция `error.window`, имя из плана 36) рядом с уже существующим `unhandledrejection`. Подключать `provideBrowserGlobalErrorListeners()` не стали: он дублировал бы `unhandledrejection` через `ErrorHandler` и сменил бы операцию `error.unhandled_rejection`.
- ✅ **Утечка слушателей в `TelemetryService`.** Четыре слушателя `window`/`document` никогда не снимались; в тестах экземпляры из прошлых тестов продолжали реагировать на события (NG0205 «Injector has already been destroyed»). Теперь снимаются через `DestroyRef`; добавлены два теста на новые каналы.

### Fetch
- ✅ В v22 `HttpClient` по умолчанию использует Fetch, поэтому `withXhr()` просто убран из `main.ts` и пяти спеков. Прогресса загрузки и `reportProgress` в проекте нет, единственный нестандартный запрос (`responseType: 'arraybuffer'` для истории метрик) Fetch поддерживает.

### Формы денег без `FormsModule`
- ✅ **Вывод:** все 6 форм денег (счета, организации, валюты, категории, активы, транзакция) уже держали состояние в сигналах, а `[ngModel]` + `(ngModelChange)` был лишь мостом. Это не кандидаты на Signal Forms (у них нет валидаторов и `FormControl`), их выгодно упростить до двусторонней привязки.
- ✅ `v-wheel-input` и `v-date-wheel-input`: вместо `ControlValueAccessor` — модели `values` и `value` (ISO-дата). `v-dropdown`: вместо `ControlValueAccessor` и внутренней `FormGroup` — модель `value` (`string | null`) и внутренний `v-input` на `[value]`/`(valueChange)`. Внешнее изменение модели синхронизируется эффектом, эхо собственного значения (`knownValue`) отсеивается, как раньше отсеивал `NgModel`. Убраны `NG_VALUE_ACCESSOR`, `forwardRef`, `registerOnChange`/`registerOnTouched`, `ReactiveFormsModule`.
- ✅ 63 привязки `ngModel` в 6 шаблонах заменены на `[(value)]`; в случаях с побочными действиями (`onAccountChange`, `onAssetChange`, `onCategoryTypeChange`) — `[value]` + `(valueChange)`. `FormsModule` убран из 5 компонентов денег; `ngModel` в `app` больше нет.
- ✅ Обновлён `readme` у `v-dropdown`.

### Проверки
- ✅ `tsc` (app, spec) 0 ошибок, `ng test` 40 файлов / 454 теста, `ng build` чисто.
- ✅ В Chrome на отдельном dev-сервере без зоны (старый на :4200 держит прежние полифиллы): еда — слайдер, переключатель, поиск, история продукта; деньги — форма транзакции (счёт и категория через список, через плашку и через сброс при смене счёта, сумма, вкладка Transfer с двумя списками, колесо даты: стрелки, месяц, день), формы счёта (создание и редактирование с подстановкой подписей из значений), валюты и категории (смена типа, фильтр родителей), экран метрик и панель настроек; консоль без ошибок.
- ⭕ Не проверено в браузере: форма организации и актива (код тот же шаблон), смена месяца при выбранном 31-м числе (подрезка дня), отправка форм (создание и сохранение не нажимались, чтобы не менять данные).

### Что остаётся
- ✅ Signal Forms только для реальных реактивных форм: `auth-form`, `body-weight`, `diary-entry-add-form`, `diary-entry-edit-form`, `catalogue-entry-edit-form`, `diary-nav-buttons` (календарь). Нужен перевод `v-input` с `ControlValueAccessor`/`NgControl` на модель и собственные валидаторы (`range`, `bodyWeight`) на `validate()`.
- ⭕ `food-product-history-state` как `resource`, Angular Aria, Группа 4 (selectorless, `injectAsync`, ESLint).
- ⭕ Реальный 401, камера, `ui-progress-icon`, `v-chip`, вложенные и мобильные модалки.

## Блок 5, седьмой заход: Signal Forms для реактивных форм (29.10.2026)

Закрывает «Что остаётся» первого пункта шестого захода. В `src` не осталось импортов `@angular/forms` (только `@angular/forms/signals`): ни `FormGroup`/`FormControl`, ни `ControlValueAccessor`, ни `NgControl`, ни `FormsModule`/`ReactiveFormsModule`.

### Сделано
- ✅ **`v-input` — контрол Signal Forms** (`FormValueControl<string>`): состояние только в модели `value`; вход `errors` (показывается первое сообщение после ввода пользователя), вход `invalid` (блокирует автосохранение), выход `touch` на blur. Убраны `NgControl`, `ControlValueAccessor`, зеркальный `ngControlValue$$`, вход `pattern` (нигде не использовался). Внешняя смена значения (подстановка, сброс формы) узнаётся эффектом по `knownValue`, как в `v-dropdown`: ошибка скрывается и автосохранение не отправляет подставленное значение.
- ✅ **Ошибка, найденная на проверке: устаревшая валидность в автосохранении.** `invalid` приходит из поля после следующей отрисовки и в момент ввода описывает предыдущее значение. Верное значение после неверного промежуточного («7» → «70») не запускало бы автосохранение веса, а неверное могло его запустить. Проверка `handleChange` перенесена в `afterNextRender`; тест воспроизводит случай и падает без исправления.
- ✅ Формы на `form()` + `[formField]` + `[formRoot]`, отправка через `submission.action` (отправка идёт только для валидной формы, `submitting()` заменяет ручные `disable()`/`enable()` и флаг): `auth-form`, `body-weight` (вес и рост), `diary-entry-add-form`, `diary-entry-edit-form`, `catalogue-entry-edit-form`. Валидаторы: `required`, `minLength`, `maxLength`, `pattern`, собственные `weightExpression`, `negativeResult` и `maxAmount` (предел числа в строке). Сообщения теперь у валидаторов (`message`), `ERROR_MESSAGES` в `validators.ts` сведён к `required` и общему «Ошибка». Мёртвые `rangeValidator` и `weightValidator` (на `AbstractControl`, нигде не использовались) удалены вместе со своими тестами.
- ✅ Календарь в `diary-nav-buttons` не форма: `FormControl` и эффект синхронизации заменены на `[value]="selectedDayIso$$()"`.
- ✅ Общая `isEmptyOrPositiveWholeAmount` в `amount-expression.ts` для полей веса.
- ✅ README `v-input` и `v-modal` обновлены.

### Изменения поведения (замечены при переносе)
- Ошибка пароля и логина в `auth-form` показывается после ввода, а не после ухода с поля (теперь так же, как у всех остальных `v-input`).
- Ошибка шаблона веса показывает текст «ХХ.Х или ХХ» вместо общего «Ошибка» (константа была в коде, но не использовалась).
- Кнопка сброса и суффикс «г.» в форме правки записи пропадают, когда поле очищено вручную (раньше после ручной очистки оставались, потому что пустая строка не равна `null`).
- Пустая форма добавления/правки по Enter как и раньше отправляется без доп. проверок; новая защита не добавлялась.

### Проверки
- ✅ `tsc` 0 ошибок, `ng test` 42 файла / 453 теста (новые: `v-input.spec` — модель, ошибка после ввода, сброс внешним значением, автосохранение после неверной цифры, без автосохранения для неверного и подставленного значения; `auth-form.spec` — кнопка, сообщение, отказ для неверной формы, вход, сброс, переход), `ng build` чисто.
- ✅ В Chrome (dev-сервер без зоны): вес (ошибки «ХХ.Х или ХХ» и «Обязательное поле»), модалка роста (подстановка 180, ошибка «XXX»), добавление записи («80*2» даёт 29.1% сразу, «0» — ошибка и блок кнопки), форма продукта (подстановка значений, 2000 ккал — ошибка, 250 и «9,5» — валидно), правка записи (взаимоисключение полей, черновик в счётчиках, «-500» — ошибка, сброс), календарь (значение скрытого поля следует за выбранным днём). Консоль без ошибок.
- ✅ Дочищено в браузере с реальным сохранением (локальные данные, разрешено): запись дневника — добавление по Enter, правка (+50 г, форма сбросилась), удаление с подтверждением; вес — автосохранение «7» → «70» (POST body-weight 201); рост — 180 → 181 → 180 (шкала ИМТ пересчиталась); продукт — калории 250 → 251 → 250 (тост «Продукт обновлён»); транзакция — создание, правка суммы, удаление (баланс счёта менялся на каждом шаге и вернулся); организация — создание и переименование; счёт — создание с организацией, валютой и типом, переименование.
- ✅ Дочищено на следующем проходе: удаление тестовых счёта и организации (с подтверждением), форма актива (создание со счётом «Крипта», подстановка при правке, режим «Suspended» с датами, обновление, удаление), подрезка дня в колесе даты (31.Oct → месяц Sep даёт 30.Sep). Тестовые данные убраны, консоль без ошибок.
- ⭕ Не проверено: создание нового продукта (генерация ИИ), форма входа в браузере (авторизованного пользователя редиректит; покрыта тестом), мобильная вёрстка модалок.

### Решение: Angular Aria исключён (29.10.2026)
Доступность (a11y) в приложении не используется и не планируется, поэтому пакет `@angular/aria` не ставится, а все прежние пункты про Aria в этом плане (⭕ «Angular Aria (`v-dropdown`, `v-expand`, `v-modal`)» и упоминания в сводках) считаются отменёнными, а не отложенными.

### Что остаётся
- ⭕ `food-product-history-state` как `resource`, Группа 4 (selectorless, `injectAsync`, ESLint).
- ⭕ Реальный 401, камера, `ui-progress-icon`, `v-chip`, вложенные и мобильные модалки.

## Решения по `resource` и Группе 4 (29.10.2026)

Заменяет открытые вопросы из «Что остаётся» выше. Код в этом заходе не менялся.

### Что закрыто по факту (проверено поиском по `src`)
- В `src` нет `ChangeDetectionStrategy.Eager`, `providedIn: 'root'`, `@HostListener`, `standalone: true`, `ngStyle`. Старые ⭕ про остатки ui-kit и `shared/components` (OnPush, `z-layer`, `accordion-group`, контролы форм, `v-slider`) и про формы еды переставлены в ✅ выше.

### `resource` не применяется (решение)
- `food-product-history-state`: по типам Angular 22.2.3 в состоянии `loading` значение ресурса `undefined`, а в `error` оно теряется. Сервису нужно обратное: при добавлении/удалении продукта до ответа остаются прежние записи (иначе график калорий мигает), при фоновом сбое прежние записи сохраняются без ошибки, при обычном сбое — очистка и сообщение. Различие «фоновая/обычная загрузка» ресурс не знает. Чтобы воспроизвести это, пришлось бы хранить последнее удачное значение отдельно и вычислять смысл ошибки по предыдущему статусу — сложнее текущих ~25 строк с одной подпиской.
- `metrics.service`: это не «состояние от параметров», а команда с прогрессом: несколько пакетов подряд, слияние точек и продвижение курсоров на каждом пакете, пауза после сбоя, отложенное повторение, уведомления. `resource` здесь не подходит.
- Остальные подписки (WS, `mutationApplied$`) остаются на RxJS, как и решено раньше. Пункт «`resource()`/`httpResource()`» в Группе 3 закрыт как «оценено, не применяется».

### Группа 4 (рекомендация; окончательное решение за пользователем)
- `injectAsync()` — не нужен: он лениво подгружает только сервисы, а `chart.js` уже лежит в ленивом чанке (общий для маршрутов денег, еды и метрик), в начальную загрузку не входит.
- selectorless — не применять: приложение с ~50 переиспользуемыми компонентами, выгода (нет `selector`, нет `imports` в шаблонах) мала, а переписывание затрагивает почти все шаблоны.
- WebMCP/Agent Skills — пропущено.
- ESLint — решение отложено по просьбе пользователя.

### Что остаётся
- ⭕ ESLint: настроить или снести (обсудить).

## ESLint: решено настроить (29.10.2026)

Заменяет «настроить или снести» выше. Форматирование не входит: за него отвечают Prettier и расширение в редакторе; ESLint нужен как защита от ошибок и «дыр» в типах.

### Сделано
- ✅ Поставлены `angular-eslint` и `typescript-eslint`; неиспользуемые `@html-eslint/*` удалены (шаблоны Angular разбирает парсер `angular-eslint`).
- ✅ Конфиг (flat config): `recommendedTypeChecked` из typescript-eslint, `tsRecommended` и `templateRecommended` из angular-eslint, `prefer-signals`. Правило про префикс `on` у outputs выключено — в ui-kit это принятая конвенция имён. Правила доступности не подключены: a11y в приложении не используется.
- ✅ Скрипт `lint` в package.json.

### Базовая линия (373 замечания, 303 файла, ошибок разбора нет)
- Дыры в типах (`any` и производные `no-unsafe-*`) — около 280, сосредоточены в ~35 файлах: формы транзакций, декораторы `exhaust-request`/`measure-time`, `chart-config`, `food-diary`, `balances-chart`, `accounts-list`, `navigation`. Часть растёт из нетипизированных `viewChildren`/колбэков графиков.
- Реальные риски: `no-floating-promises` (8), `no-misused-promises` (2), `require-await` (7), `unbound-method` (4), `prefer-promise-reject-errors` (14), `no-unused-vars` (8).
- Косметика с автоисправлением: `no-unnecessary-type-assertion` (18), `prefer-const` (3).
- Тесты и `testing/` дают 47 замечаний.

### Что остаётся
- ⭕ Разобрать базовую линию: сначала риски, затем `any` по файлам, затем автоисправления.
- ⭕ Решить, подключать ли `lint` к коммиту/CI после того, как счётчик станет нулевым.

### Выходы ui-kit без префикса `on` (29.10.2026)
Заменяет решение выше «правило про префикс `on` выключено»: пользователь решил следовать рекомендациям команды Angular. Правило `no-output-on-prefix` включено обратно, 16 выходов ui-kit переименованы по правилу проекта (имя действия + `Output`): нажатие, закрытие, открытие, изменение, фокус, потеря фокуса, Enter, автосохранение, удаление, клик по карточке, выбор в списке и другие. Обновлены все 146 использований в шаблонах (43 файла), тест `v-input` и README компонентов.
- ✅ Переименование выходов, правило включено, замечаний `no-output-on-prefix` — 0.
- ✅ `tsc` (app и spec) без ошибок, `ng build` чистый, 453 теста проходят. Все привязанные в шаблонах имена выходов проверены поиском: у каждого есть объявление.
- Заметка: Angular не считает ошибкой привязку `(имя)` к несуществующему выходу — это тихо превращается в DOM-событие. Поэтому полнота переименования проверена поиском остатков, а не только сборкой.
- ⭕ Изменения затрагивают отдельный репозиторий ui-kit: при коммите сначала ui-kit, затем front с обновлённым указателем сабмодуля.

## Очистка замечаний ESLint — Блок 6 (29.10.2026)

Решение пользователя: чинить всё найденное внутри плана 37 (часть перехода на Angular 22). Порядок: риски → дыры в типах → мелочи. Прокликивание в браузере — только для изменений, которые могут сломать поведение; для остальных достаточно типов, тестов и сборки.

Принятый подход по группам:
- Реальные риски — исправить по существу: не потерять ошибки асинхронных вызовов, не терять `this`, отклонять промисы с `Error`, убрать лишний `async`.
- Дыры в типах — типизировать источники (`catch` с `unknown`, типы колбэков графиков, типизированные ссылки на элементы), а не отключать правила.
- Тесты и `testing/` — правила `no-unsafe-*` выключить через переопределение в конфиге (моки и фейки).
- Мелочи — удалить мёртвое, автоисправления, пустые интерфейсы заменить алиасами.

### Чек-лист
- ✅ Конфиг: ослабить `no-unsafe-*` для тестов
- ✅ Риски: забытые и «не туда переданные» промисы (13 мест)
- ✅ Риски: `unbound-method`, `reject` не с `Error`, `async` без `await`, `no-base-to-string`
- ✅ Типы: `any` и `no-unsafe-*` по файлам (около 35 файлов) — кроме четырёх неиспользуемых декораторов
- ✅ Мелочи: неиспользуемое, `prefer-const`, пустые интерфейсы, `inject()`, `OnDestroy`, `readonly` у сигнала, лишние приведения типов
- ✅ Итог (закрыт ниже, в «Декораторы»): `eslint` без замечаний — осталось 53 замечания в четырёх декораторах `shared/decorators/*`, которые нигде не используются (решение за пользователем: удалить вместе со своими тестами или типизировать)
- ✅ `tsc` (app и spec), 458 тестов, `ng build` зелёные

### Результат блока (29.10.2026)
373 замечания → 53 (все в неиспользуемых декораторах). Что сделано по существу:
- Промисы: явный `void` там, где функция сама обрабатывает ошибки; `ngOnInit`/`ngAfterViewInit` перестали быть `async` (Angular не ждёт их результат).
- Ошибки: отклонённые промисы теперь всегда `Error`. Для неудачных синхронных операций введён класс ошибки с кодом ответа и телом и функция, достающая текст ошибки сервера; форма продукта использует её вместо обращения к `any`. Тесты на оба добавлены.
- Типы: один типизированный разбор «деталей транзакции» вместо пяти копий в компонентах денег; `detailsJSON` и справочник продуктов получили реальные типы; запросы синхронизации стали обобщёнными по типу ответа (приведение ответа к ожидаемому типу — в одном месте); значения тултипа графика баланса вынесены в одну функцию; корень многих `any` — запись `inject(ElementRef<HTMLElement>)`, которая на самом деле возвращает `ElementRef<any>`, исправлена везде.
- Отключено осознанно: `require-await` (асинхронный API сервисов — контракт, вызывающие ждут результат и ловят ошибки).
- Браузер (свой dev-сервер): деньги — форма транзакции открывается и закрывается, тултип графика баланса показывает значения; еда — открытие модалок, форма редактирования продукта, ошибка «имя уже существует» от реального бэкенда доходит до экрана; ошибок в консоли, кроме ожидаемой записи этой самой проверки, нет.
- Побочная находка: все четыре декоратора из `shared/decorators` (`LogExecutionTime`, `ExhaustRequest`, `CachedRequest`, `Throttled`) не используются нигде, кроме собственных тестов. (Поправка ниже: это неверно для `exhaustRequest`.)

### Декораторы: итог (29.10.2026)
Поправка к находке выше: поиск шёл по имени с другой регистром, и `exhaustRequest` на самом деле используется в трёх сервисах (статистика еды, персональные калории, каталог — четыре метода). Остальные действительно нигде не использовались.
- ✅ Удалены вместе с тестами: `cached`, `throttled`, `LogExecutionTime` (у него тестов не было) и `exhaustRequestObs` (вариант для Observable, только в собственных тестах). Вернуть при необходимости можно из git.
- ✅ `exhaustRequest` оставлен и типизирован обобщённо по аргументам и результату вместо `any`; поведение то же. Тесты на него сохранены.
- ✅ `eslint .` — 0 замечаний, `tsc` (app и spec), 450 тестов (стало меньше из-за удалённых тестов мёртвого кода), `ng build` зелёные.
- ⭕ Коммит блока 6 (сначала ui-kit, затем front с указателем сабмодуля, патч-версия) и решение, подключать ли `lint` к коммиту/CI.
- ⭕ Реальный 401, камера, `ui-progress-icon`, `v-chip`, вложенные и мобильные модалки — в браузере не проверяются, оставлено.

## Курс команды Angular: пакет 1 правил и флагов (29.10.2026)
Итог коммита блока 6: закоммичено в ui-kit и front, решение по `lint` в CI/коммит-хук — не подключать (пользователь не хочет удлинять деплой; правило в корневом `AGENTS.md` — прогонять проверки после правок).

Источники курса: официальные страницы angular.dev (roadmap, best-practices для LLM, style guide). Направление: signals везде, zoneless и `OnPush` по умолчанию, `host` вместо `@HostBinding`/`@HostListener`, `@Service`, `model()`, Signal Forms, `resource`, без `CommonModule`, `NgOptimizedImage`, доступность (AXE/WCAG AA).

Что включено сейчас (без `no-developer-preview` — пользователь хочет пробовать developer preview):
- Правила `angular-eslint` (TS): защита от возврата легаси — `prefer-service-decorator`, `prefer-host-metadata-property`, `prefer-output-readonly`, `prefer-output-emitter-ref`, `prefer-signal-model`, `no-forward-ref`, `no-uncalled-signals`, `computed-must-return`, `reactive-context-must-read-signal`, `no-implicit-take-until-destroyed`, `no-async-lifecycle-method`, `no-lifecycle-call`, `no-pipe-impure`, `no-queries-metadata-property`, `no-duplicates-in-metadata-arrays`, `use-injectable-provided-in`, `no-attribute-decorator`, `consistent-component-styles`, `relative-url-prefix`.
- `typescript-eslint`: `prefer-readonly` и `explicit-member-accessibility` (явный модификатор у всех членов, включая конструктор — как в правилах пользователя).
- Шаблоны: `prefer-at-empty`, `prefer-at-else`, `prefer-contextual-for-variables`, `prefer-template-literal`, `require-switch-default`, `button-has-type`.
- `tsconfig`: `useDefineForClassFields: true` (совпадает с ES2022 и гайдом команды; 0 ошибок компиляции при включении).

Что пришлось менять по существу:
- `v-wheel-select`: пара вход+выход заменена на `model` (родитель `v-wheel-input` хранит значение как есть, поведение то же).
- `v-tooltip`: «вычисляемый» z-index читал неизменяемое число — стал обычным полем; `progress-icon`: два `computed`, читавших атрибут элемента (не сигнал), стали обычными полями.
- Переключатели с исчерпывающей проверкой (`@default never`): состояние модалки еды вынесено в `@let`, потому что вызов сигнала TypeScript не сужает; добавлен явный пустой `@case` для закрытого состояния.
- `@if (пусто)` + `@for` и пара `@if`/`@if (!...)` заменены на `@empty` и `@else`; пустые конструкторы в маркерных директивах `progress-icon` удалены.

Найдено и не тронуто:
- Два разных файла директивы `flipAnimate`: в `src/app/shared/directives` (используется) и в `src/ui-kit/directives` (нигде не импортируется). Решение за пользователем: удалить копию в ui-kit или перевести приложение на неё.
- Явный `OnPush` (72 места): команда считает его лишним с v22, но правило `prefer-on-push-component-change-detection` в рекомендованном наборе его требует — не трогаем.
- Остальные кандидаты отложены: пакет 2 (доступность, `prefer-ngsrc`, `no-non-null-assertion`) и флаги `noUncheckedIndexedAccess` (229 ошибок), `exactOptionalPropertyTypes` (18).

### Чек-лист
- ✅ Правила пакета 1 в `eslint.config.mjs`, `useDefineForClassFields`
- ✅ Замечания исправлены (56 → 0)
- ✅ `eslint` 0 замечаний, `tsc` (app и spec), 450 тестов, `ng build` зелёные
- ✅ Живая проверка `v-wheel-select`, `progress-icon`, тултипа и модалок еды после `useDefineForClassFields` — выполнена, см. раздел ниже

## Дубль flipAnimate, явный OnPush, проверка в браузере (29.10.2026)
Происхождение дубля `flipAnimate`: директиву написали в приложении (сентябрь 2025), в марте 2026 её скопировали в ui-kit уже с исправлением — отмена анимации после завершения (иначе `fill: both` навсегда оставляет элемент в конечном состоянии). Приложение на копию ui-kit не перевели, копии разошлись.
- ✅ Общая директива живёт в ui-kit рядом с `shadow` и `backdrop` (у неё нет зависимостей от приложения); копия в приложении удалена, список выбора продукта импортирует её из ui-kit.
- ✅ Явный `OnPush` убран из 72 компонентов вместе с импортом (в Angular 22 он по умолчанию, `Default` переименован в `Eager`); правило `prefer-on-push-component-change-detection` выключено с пояснением в конфиге.
- ✅ `eslint` 0 замечаний, `tsc` (app и spec), 450 тестов, `ng build` зелёные.

### Проверка в браузере (свой dev-сервер, реальный бэкенд, данные не менялись)
- ✅ Еда: экран и колонки статистики, модалка добавления, поиск с вводом (директива из ui-kit: после анимации не осталось незавершённых анимаций, скрытых карточек нет), форма добавления с `progress-icon`, форма редактирования продукта, закрытие по Escape, тултип справки (у экземпляров разные z-index).
- ✅ Деньги: диаграммы, форма транзакции (колесо выбора месяца меняет дату, вкладки Расход/Доход/Перевод), вкладки настройки/категорий/активов, архивные счета.
- ✅ Метрики: дашборд открывается.
- ✅ Ошибок в консоли нет (кроме информационного сообщения про HMR и `@defer`).
- ⭕ Не проверено: мобильная раскладка навигации (окно не уменьшилось через инструмент), режим инвестиций в форме транзакции, пустые состояния списков (в данных везде есть записи).
