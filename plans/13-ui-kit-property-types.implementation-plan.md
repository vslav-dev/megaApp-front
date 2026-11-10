# UI-Кит: качество типов свойств + отказ от enum — Implementation Plan

Продолжение [12-ui-kit-config-to-individual-inputs](12-ui-kit-config-to-individual-inputs.implementation-plan.md). Правило то же: без фоллбеков, без переходного периода — старое поведение удаляется в тот же момент, когда добавляется новое.

## Как развивались события

1. После перехода на раздельные `input()` (план 12) сделан code-review самих типов свойств UI-Кита — на стыке возможностей кита и реальных потребностей приложения. Отправная точка: у `v-input` уже был паттерн "либо шаг из шкалы юнитов, либо сырая CSS-строка" (`CssUnitOrRawValue`) только для отступов — встал вопрос, не стоит ли расширить его на весь кит.
2. По итогам обсуждения найдено 7 находок, часть из них требовала профессионального решения (не оставлять открытым списком вариантов), часть — явно отклонена пользователем. Действует общий принцип: если где-то в ките есть локальное самодельное решение чуть удобнее общего, но работающее только в одном компоненте — предпочтение общему, единообразному варианту, даже в ущерб локальному удобству.
3. Находки 1, 2, 3, 4, 6, 7 реализованы полностью: и в самом ките, и во всех местах использования в приложении. Находка 5 отклонена (не делаем).
4. По ходу реализации находки 7 (унификация enum / as-const-объект / голый string-union) возник следующий вопрос: раз `enum` в TypeScript в принципе считается устаревшей практикой — не перевести ли на `as const` вообще все enum'ы по всему фронтенду, а не только те несколько в ките, что были явно упомянуты в находке 7. Согласовано, добавлена находка 8, реализуется в этом же заходе.

## Находка 1 (главная) — юниты + сырой CSS везде ✅

Почти все настройки размера/отступов/закруглений принимали только число из жёсткого списка шагов (0, 1, 2 ... 128 → `--unit-N`). Расширили `CssUnitValue` → `CssUnitOrRawValue` (число-шаг или любая сырая CSS-строка) на все такие свойства во всех компонентах:

- ✅ v-button: `borderRadius`, `padding`, `paddingX`, `paddingY`, `gap`
- ✅ v-card: `borderRadius`, `padding`, `paddingX`, `paddingY`
- ✅ v-checkbox: `size`, `borderRadius`, `gap`, `checkIconSize`, `switchWidth`, `switchHeight`, `switchPadding`, `thumbSize`
- ✅ v-color-picker: `swatchSize`, `gap`
- ✅ v-expand: `padding`, `borderRadius`
- ✅ v-icon: `size`
- ✅ v-modal: `borderRadius`, `padding`, `paddingX`, `paddingY`
- ✅ v-progress: `height`, `borderRadius`, `barGap` (см. находку 4)
- ✅ v-toggle: `borderRadius`, `padding`, `gap`
- ✅ v-input: `borderRadius` (paddingX/paddingY уже были переведены раньше)
- ✅ v-slider: `borderRadius`, `thumbBorderRadius` (см. находку 3)

**Осознанное исключение**: v-slider `height` и `thumbSize` участвуют не только в CSS, но и в JS-математике позиционирования ползунка (`unitToPx`, расчёт `trackMargin`, конвертация позиции курсора в значение). Сырую CSS-строку («2rem», «50%») нельзя надёжно превратить в пиксели без обращения к DOM — оставлены на `CssUnitValue`. `touchAreaSize` в этой математике не участвует — переведён наравне с остальными.

## Находка 2 — bgOpacity → number ✅

`v-button.bgOpacity` был `'0' | '1' | \`0.${number}\`` (строка), у `v-card.backgroundImageOpacity` — обычный `number`. Прозрачность в CSS по своей природе число, а не текст — решение: `number` (0..1), по умолчанию `1`. Обновлены 3 места использования (`bgOpacity="0"` → `[bgOpacity]="0"`).

## Находка 3 — убрать 'full' у v-slider ✅

`thumbBorderRadius` принимал число-шаг или специальное слово `'full'` — единственный именной ярлык-исключение во всём ките. Убрано: `thumbBorderRadius: CssUnitOrRawValue`, дефолт `'50%'` (обычное CSS-значение вместо особого слова, доступно благодаря находке 1). В приложении `'full'` нигде явно не передавался — правка только внутри кита.

## Находка 4 — barGap ✅

У `v-progress` высота и радиус были на шкале юнитов, а `barGap` — голое число-пиксели без всякой шкалы, без видимой причины для расхождения. Приведён к тому же виду, что соседи: `CssUnitOrRawValue`, дефолт `'1px'` (сохраняет прежний визуал — раньше `barGap=1` рендерился как 1px, а не как шаг шкалы).

## Находка 5 — отклонено пользователем, не делаем

Кнопка/карточка/модалка независимо содержат одинаковую маленькую формулу "общий отступ на обе стороны, если не задан отдельно". Формально копипаста в трёх местах — решено не считать проблемой, требующей правки.

## Находка 6 — типизированная форма/поверхность кнопки ✅

Вид кнопки (плоская/приподнятая/как ссылка/...) был просто текстом — именем CSS-класса (`class="v-flat"` и т.п.), разбросанным по ~117 местам в приложении. Опечатался в названии класса — кнопка молча выглядит не так, как задумано. Разобрано на две независимые оси:
- **форма/поверхность** — была нигде не типизирована, это и есть настоящий пробел;
- **цвет/интонация** (`v-primary`/`v-danger`/`v-accent`) — уже была последовательным паттерном "точная настройка цвета + класс-пресет" (как у `v-progress.barColor`, `v-slider.trackColor/fillColor`) — не трогали.

Реализовано:
- ✅ Новый экспорт в `v-button.ts`: `ButtonSurface` (as-const объект + производный тип, по образцу `DropdownMode`), значения: `default`, `flat`, `raised`, `link`, `hover`.
- ✅ Новые inputs на `VButton`: `surface` (дефолт `'default'`), `isLinkStatic` (`boolean`, дефолт `false`).
- ✅ Host-биндинги `[class.v-flat]`/`[class.v-raised]`/`[class.v-link]`/`[class.v-hover]` вычисляются из `surface()`, `[class.v-link-static]` — из `isLinkStatic()`.
- ✅ Пройдены все 117 использований `<v-button>` в 29 файлах приложения — статические и динамические (тернарники в шаблоне, без единого нового импорта в TS-коде компонентов). Цветовые классы не тронуты.
- ✅ `v-toggle`: `activeClass`/`inactiveClass` (голый текст) → `activeSurface`/`inactiveSurface` (`ButtonSurface`) + `activeColorClass`/`inactiveColorClass` (строка, только для цвета).
- ✅ Удалён мёртвый `ButtonStyle` enum из `ui-kit/types.ts`.

Выбор в пользу as-const объекта (а не `enum`) вместо новой настройки типа `IconName` был осознанным: в статичных местах (`surface="flat"`) не нужен вообще никакой импорт — обычная строка, которую Angular проверяет на этапе сборки. Импорт нужен только в динамических местах (меньшинство).

## Находка 7 — единый способ объявления именованных значений в UI-Ките ✅

В ките одновременно жили три разных способа задавать закрытый список значений: `enum` (`IconName`, `ProgressBarStyle`, `ddExpandDirection`, мёртвый `ButtonStyle`), as-const объект (только `DropdownMode` — то есть уже действующее правило проекта) и голый string-union без именованного объекта (`ModalDeviceType`, `VCheckboxMode`, `VCheckboxLabelPosition`). Приведено к одному виду — as-const объект + производный тип:

- ✅ `IconName` (v-icon.ts, ~90 значений)
- ✅ `ProgressBarStyle` (components/types.ts) — заодно значения стали строками `'flat'/'raised'/'inset'`, что упростило `barStyle$$` в v-slider (switch стал не нужен)
- ✅ `ddExpandDirection` (v-dropdown.ts)
- ✅ `VCheckboxMode`, `VCheckboxLabelPosition` (v-checkbox.ts)
- ✅ `ModalDeviceType` (v-modal.ts)

Проверено: ни один из этих типов не используется в приложении способом, чувствительным к enum-специфике (reverse mapping, `Object.values` и т.п.) — правки полностью локальны внутри кита.

## Находка 8 (новая) — отказ от enum по всему фронтенду

`enum` в TypeScript в целом считается устаревшей практикой: числовой enum без явных значений хрупок к реордерингу, и это единственная конструкция TS, которая генерирует реальный JS-объект в рантайме (а не стирается компилятором) — мешает трясению дерева, несовместима с "erasable syntax"-режимами новых раннеров. As-const объект работает всюду, где работал enum (`X.Y`, `typeof X`, литералы в шаблонах), без этих минусов — ровно то, что уже сделано находкой 7 внутри кита. Раз находка 7 уже начала эту работу — логично довести её до конца по всему фронтенду, а не только в ките.

Помимо двух `enum`, пропущенных находкой 7 внутри самого кита, нашлось 19 в приложении:

### UI-Кит (пропущено находкой 7)

- ✅ `VInputAutoSubmitResult` (v-input-auto-submit.ts) — числовой enum без явных значений (`Success`, `Error`) → as-const со строковыми значениями (`'success'`, `'error'`)
- ✅ `VInputAutoSubmitState` (v-input-auto-submit.ts) — числовой enum (`Idle`, `Countdown`, `Submitting`, `Success`, `Error`) → as-const со строковыми значениями

### app/shared/types.ts (уже строковые enum, механическая правка)

- ✅ `WebSocketMessageType` — 19 мест вида `type: WebSocketMessageType.PING` (позиция типа в WS-интерфейсах-сообщениях) переведены на `type: typeof WebSocketMessageType.PING` — **не** на голый строковый литерал `'PING'` (см. ниже "Исправленная ошибка")
- ✅ `KeyOfUserSettings`
- ✅ `HistoryEntryAction`
- ✅ `SymbolPosition`
- ✅ `CategoryType`
- ✅ `AccountKind`
- ✅ `AssetType`
- ✅ `TransactionKind` — `InvestAssetTrade.kind: TransactionKind.INVEST_BUY | TransactionKind.INVEST_SELL` (позиция типа) переведён на `typeof TransactionKind.INVEST_BUY | typeof TransactionKind.INVEST_SELL`.

### Исправленная ошибка: голые строковые литералы вместо `typeof Объект.Свойство`

Первая версия правки для этих 20 мест (19 в `WebSocketMessageType` + 1 в `TransactionKind`) заменяла позицию типа на голый строковый литерал (`type: 'PING'`). Это в точности та проблема, которую as-const должен был устранить: значение задвоено вручную отдельно от объекта-константы, и при переименовании строки в объекте тип интерфейса молча перестаёт совпадать — никакой защиты от опечаток/переименования не остаётся, разве что чуть более быстрый доступ. Справедливо раскритиковано пользователем.

**Правильный вид**: `type: typeof WebSocketMessageType.PING;` — TypeScript-конструкция `typeof Объект.Свойство` в позиции типа берёт литеральный тип прямо из значения свойства as-const объекта. Если значение в объекте изменится, тип автоматически изменится вместе с ним — single source of truth сохраняется, как и было с `enum`.

### Остальные места приложения (уже строковые enum, механическая правка)

- ✅ `MoneyTab` (money-screen.ts)
- ✅ `FormMode` (catalogue-entry-edit-form.ts)
- ✅ `NutrientType` (nutrition-summary.ts)
- ✅ `FormLabels`, `FormErrors` (body-weight.ts)
- ✅ `MenuPlace` (navigation.service.ts)
- ✅ `AuthSessionState` (auth.service.ts)
- ✅ `SyncOperationType` (sync-queue.service.ts)
- ✅ `ModalState` (food-add-modal.service.ts)
- ✅ `ModalEvent` (food-add-modal.service.ts) — числовой enum без явных значений, использован как ключ mapped-типа (`[event in ModalEvent]?: ModalState`) и как вычисляемые ключи объекта (`[ModalEvent.OPEN]: ModalState.SEARCH`). Придуманы явные строковые значения (совпадают с именами ключей), mapped-тип и вычисляемые ключи продолжают работать без изменений.

### Найденный по ходу правки баг типов (не связан напрямую с enum, всплыл после конвертации)

`transaction-form.ts.isPersistedInvestKind()` строил массив `[TransactionKind.INVEST_BUY, TransactionKind.INVEST_SELL, TransactionKind.INVEST_DIVIDEND].includes(kind)` — с обычным enum TS выводил тип массива как весь `TransactionKind`, с as-const объектом тип сузился до трёх конкретных литералов, и `.includes(kind: TransactionKind)` перестал собираться. Исправлено на явную цепочку `===` (как в соседних местах кодовой базы) — проще и без ловушек с выводом типов.

### Верификация ✅

- ✅ Grep-проверка: ноль оставшихся `enum` во всём `src/` (кроме `node_modules`).
- ✅ `ng build` — прошёл чисто.
