# UI-Kit: единый `config`-объект → отдельные signal inputs — Implementation Plan

Заменяет черновик [XX-ui-kit-settings-single-input._implementation-plan.md](XX-ui-kit-settings-single-input._implementation-plan.md) (удалён, поглощён этим документом).

## Суть

Сейчас часть компонентов UI-Kit принимает настройки одним объектом `config: input<XConfig>({})`, слитым с `DEFAULT_X_CONFIG`. Переходим к одному `input()` на каждое свойство — идиоматичный для Angular вариант, уже частично принятый в проекте.

**Согласен с направлением.** Аргументы:
- Prettier не форматирует `[config]="{ ... }"` в шаблонах — известная боль, ради которой и был заведён черновик-предшественник.
- Направление уже наполовину реализовано в кодовой базе: `v-dropdown`, `v-icon`, `v-toast`, `v-tooltip`, `v-wheel-select`, `v-wheel-input`, `v-date-wheel-input`, `v-accordion` уже полностью на раздельных `input()`.
- Ридми `v-card` и `v-modal` уже описывают целевой плоский API (`borderRadius`, `padding` отдельными inputs) — а сам код этих компонентов всё ещё на `config`. То есть решение по факту уже принято раньше, просто не докручено до конца. Этот план — завершение уже начатого перехода, а не новая инициатива.
- Паттерн для вложенных конфигов (компонент оборачивает другой компонент UI-Kit) уже есть готовый: `v-dropdown` не принимает сырой `VInputConfig`, а прокидывает только нужные ему конкретные свойства `v-input` как свои плоские inputs. Это и есть образец для `v-toggle`.

## Жёсткое правило: без фоллбеков

Никакого совместимого/переходного периода. `config` input удаляется из компонента полностью и сразу, в том же присесте, что и добавление новых раздельных inputs — не остаётся рядом "на всякий случай", не читается как legacy-источник дефолтов, не за флагом. Никаких адаптеров/шимов, никакого дублирования API "и старое, и новое одновременно работает". Использования в app переписываются в этом же заходе, а не отдельным следующим этапом — после мержа UI-Kit не должно существовать ни одного `[config]=` в app и ни одного импорта удалённого `XConfig`-интерфейса. Конечное состояние выглядит так, будто раздельные inputs были в компоненте с самого начала.

Порядок "листовые → составные" в разделе "Риски" ниже — это только порядок правок файлов внутри одной работы (чтобы `tsc`/`ng build` давали осмысленные ошибки по ходу, а не свалку из 34 файлов сразу), а не поэтапный релиз с промежуточным совместимым состоянием.

## Текущее состояние

**На `config`-объекте (мигрировать):** `v-button`, `v-card`, `v-checkbox`, `v-color-picker`, `v-expand`, `v-input`, `v-modal`, `v-progress`, `v-slider`, `v-toggle`.

**Уже на отдельных inputs (эталон, только сверка порядка):** `v-dropdown`, `v-icon`, `v-toast`, `v-tooltip`, `v-wheel-select`, `v-wheel-input`, `v-date-wheel-input`, `v-accordion`.

**Масштаб использования в app:** 213 биндингов `[config]=` в 34 файлах шаблонов. Из них только 2 `.ts`-файла строят конфиг через computed-сигнал (`money-screen.ts`, `nutrition-summary.ts`) — остальные ~211 это инлайн-литерал `{ ... }` прямо в шаблоне, то есть ровно тот случай, что не форматируется Prettier.

**Вложенный конфиг:** `v-toggle` принимает `buttonConfig?: VButtonConfig` для прокидывания в свои внутренние `v-button`. Проверено по всем реальным использованиям `v-toggle` в app — `buttonConfig` нигде не передаётся, свойство мёртвое. Решение: не изобретать pass-through-свойства под него, просто убрать при миграции.

**Shorthand `padding` → `paddingX`/`paddingY`:** в `v-button`, `v-card`, `v-modal` есть общий `padding`, растягивающийся на обе оси, если ось не задана явно (`config.paddingX ?? config.padding ?? default`). При раздельных inputs логика переносится один в один: `paddingX() ?? padding() ?? default`, `paddingY() ?? padding() ?? default`. Поведение не меняется.

## Подход

1. В каждом компоненте: `config = input<XConfig>({})` + `DEFAULT_X_CONFIG` → по одному `input<T>(default)` на свойство. Производные `xString$$` вычисления остаются как есть, просто читают новые inputs вместо `settings$$()`.
2. Удалить интерфейс `XConfig` и объект дефолтов, если больше нигде не переиспользуется (проверить, что `VButtonConfig` не тянется откуда-то ещё — сейчас только `v-toggle.buttonConfig`, который убираем).
3. Для компонентов-обёрток (`v-toggle` → `v-button`/`v-card`) — только явно используемые свойства становятся плоскими inputs самого `v-toggle` (по образцу `v-dropdown`), второго уровня вложенности не вводить.
4. Пройти все ~213 мест использования в app: `[config]="{ a: x, b: y }"` → `[a]="x" [b]="y"`; биндинги, совпадающие с новым дефолтом — не переносить.
5. Разобрать 2 computed-конфига в app (`money-screen.ts`, `nutrition-summary.ts`) — на месте решить: раздельные computed на каждое свойство или прямая биндинг-expression, что проще для конкретного случая.
6. Обновить секцию "Config API" в `readme.v-x.md` каждого компонента на плоский список Properties (по образцу уже готовых `v-card`/`v-modal`/`v-dropdown` ридми).
7. Добавить в корневой `README.md` UI-Kit раздел про конвенцию порядка свойств (ниже) — чтобы новые компоненты/свойства следовали тому же порядку.

## Конвенция порядка свойств (для корневого README)

Группы, в этом порядке, для секции Inputs любого компонента:

1. **Identity/kind** — `type`, `mode`, `name`
2. **Content** — `label`, `labelRight`, `placeholder`, `text`, `message`, `items`, `presets`, `valueList`, `value` (для read-only value-инпутов вроде `v-wheel-select`, не `model()`)
3. **State flags** — `isDisabled`, `isReadonly`, `isRequired`, `isClickable`, `isSelected`, `isMultiple`, `isOpen`, `isTextarea`, `isRange`, `isTouchMode`, `fill`, `noWrap`
4. **Validation** — `errorMessage`, `pattern`
5. **Layout/sizing** — `width`, `height`, `size`, `min`, `max`, `borderRadius`, `padding`, `paddingX`, `paddingY`, `gap`
6. **Visual/style** — `color`, `bgOpacity`, `textAlign`, `fontSize`, `fontWeight`, `trackColor`, `fillColor`, `barColor`, `thumbSize`, `thumbBorderRadius`
7. **Feature-блок в хвосте** — самодостаточный пучок связанных свойств одной фичи, всегда в самом конце, начинается со своего флага-включателя (пример: все `autoSubmit*` у `v-input`)

Мета-правило поверх групп: `input.required<T>()` всегда идут перед опциональными, независимо от группы. Внутри required- и optional-блоков — порядок групп как выше.

Нормализация: `padding` (shorthand) → `paddingX` → `paddingY` — везде в этом порядке (сейчас в кодовой базе разнобой: `v-card` так и делает, `v-button`/`v-modal` — нет).

## Целевой порядок свойств по компонентам

**v-button:** `type`, `isDisabled`, `isLabelHidden`, `width`, `borderRadius`, `padding`, `paddingX`, `paddingY`, `gap`, `bgOpacity`, `textAlign`, `color`

**v-card:** `isSelected`, `borderRadius`, `padding`, `paddingX`, `paddingY`, `minHeight`, `backgroundImageUrl`, `backgroundImageOpacity`

**v-checkbox:** `mode`, `isDisabled`, `labelPosition`, `size`, `borderRadius`, `gap`, `checkIconSize`, `switchWidth`, `switchHeight`, `switchPadding`, `thumbSize`

**v-color-picker:** `presets`, `swatchSize`, `gap`

**v-expand:** `isWithoutAnimation`, `padding`, `borderRadius`, `animationTimingFunction`

**v-input** (самый сложный, 20+ свойств — рабочий пример конвенции): `type`, `inputmode`, `name`, `label`, `labelRight`, `placeholder`, `isDisabled`, `isReadonly`, `isClickable`, `isTextarea`, `pattern`, `errorMessage`, `inputSize`, `borderRadius`, `paddingX`, `paddingY`, `rows`, `cols`, `fontSize`, `fontWeight`, `textAlign`, `isAutoSubmitEnabled`, `autoSubmitDelay`, `autoSubmitResult`, `autoSubmitResultFadeDuration`

**v-modal:** `deviceType`, `isOpen`, `isCloseButtonVisible`, `width`, `mobileWidth`, `desktopWidth`, `borderRadius`, `padding`, `paddingX`, `paddingY`

**v-progress:** `value`, `isShowValues`, `min`, `max`, `height`, `borderRadius`, `barGap`, `barColor`, `valueSuffix`

**v-slider:** `valueList`, `isDisabled`, `isRange`, `isTouchMode`, `min`, `max`, `height`, `borderRadius`, `thumbBorderRadius`, `thumbSize`, `touchAreaSize`, `minSpan`, `trackColor`, `fillColor`, `barStyle`

**v-toggle:** `isMultiple`, `isDisabled`, `fitContent`, `borderRadius`, `padding`, `gap`, `activeClass`, `inactiveClass` (`buttonConfig` — удалить, неиспользуемо)

### Сверка уже-плоских компонентов (реордер без смены API)

- **v-tooltip:** `text` (required) → `fill`, `noWrap`, `maxWidth` (было: `maxWidth`, `fill`, `noWrap`)
- **v-date-wheel-input:** `isDisabled`, `yearRange` (было: `yearRange`, `isDisabled`)
- **v-accordion:** `groupId`, `multiple` (было: `multiple`, `groupId`)
- **v-dropdown:** `mode`, `label`, `labelRight`, `placeholder`, `items`, `isDisabled`, `isRequired`, `errorMessage`, `minDropdownWidth`, `expandDirection` (было: `label`, `labelRight`, `placeholder`, `isDisabled`, `isRequired`, `errorMessage`, `items`, `minDropdownWidth`, `expandDirection`, `mode`)
- **v-toast, v-icon, v-wheel-select, v-wheel-input:** уже соответствуют конвенции, без изменений.

## Риски / нюансы

- Компонент за компонентом — после каждого проверять типизацию (`tsc --noEmit` / `ng build`) прежде чем переходить к использованиям в app, иначе ошибки об исчезнувшем `config` разлетятся по 34 файлам одновременно и станет тяжело отследить, какие из них — от текущего компонента, а какие — шум от ещё не тронутых.
- Мигрировать компоненты в порядке от "листовых" к "составным": сперва `v-button`, `v-card` (используются внутри `v-toggle`), `v-input` (используется внутри `v-dropdown`), затем `v-toggle`, `v-dropdown`.
- В шаблонах app при переносе инлайн-объектов проверять реальные значения — то, что сейчас передаётся как совпадающее с дефолтом (например `paddingX: 2` при дефолте 2), не переносить как отдельный биндинг.

## Статус

✅ Реализовано полностью. `ng build` чисто, код-ревью диффа (uikit submodule + app) багов не нашёл, финальный grep подтверждает 0 оставшихся `[config]=`/`config` в ui-kit/0 импортов `XConfig`.

## Чеклист реализации

- ✅ `v-button`: раздельные inputs, обновить `readme.v-button.md`
- ✅ `v-card`: раздельные inputs, обновить `readme.v-card.md` (уже описан плоским — сверить точное соответствие)
- ✅ `v-checkbox`: раздельные inputs, обновить `readme.v-checkbox.md`
- ✅ `v-color-picker`: раздельные inputs, обновить `readme.v-color-picker.md`
- ✅ `v-expand`: раздельные inputs, обновить `readme.v-expand.md`
- ✅ `v-input`: раздельные inputs, обновить `readme.v-input.md`
- ✅ `v-modal`: раздельные inputs, обновить `readme.v-modal.md` (уже описан плоским — сверить точное соответствие)
- ✅ `v-progress`: раздельные inputs, обновить `readme.v-progress.md`
- ✅ `v-slider`: раздельные inputs, обновить `readme.v-slider.md`
- ✅ `v-toggle`: раздельные inputs + удаление мёртвого `buttonConfig`, обновить `readme.v-toggle.md`
- ✅ Реордер: `v-tooltip`, `v-date-wheel-input`, `v-accordion`, `v-dropdown`
- ✅ Обновить все ~213 использований `[config]=` в app (34 файла)
- ✅ Разобрать `money-screen.ts` / `nutrition-summary.ts` computed-конфиги
- ✅ Добавить раздел "Property Ordering Convention" в корневой `README.md` UI-Kit
- ✅ Финальная проверка: `grep` по всей app на отсутствие оставшихся `[config]=` и импортов удалённых `XConfig`-интерфейсов
- ✅ `tsc --noEmit` / `ng build` без ошибок
