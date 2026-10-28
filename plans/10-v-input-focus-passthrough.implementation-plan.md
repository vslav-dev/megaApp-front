# V-Input Focus Passthrough — Implementation Plan

## Статус

- ✅ Реализовано.
- ⭕ Ручная проверка в браузере (чеклист ниже) не выполнена.

## Задача

- Клик по любой пустой зоне внутри `v-input` (паддинг обёртки, декоративный prefix/postfix) должен фокусировать реальный `<input>`/`<textarea>`, а не проваливаться в пустоту.
- Наведение мышью на эти зоны должно сразу показывать текстовый курсор (`cursor: text`), как будто там уже начинается поле.
- Интерактивные элементы внутри prefix/postfix (кнопки, иконки с собственным `(click)`) не должны терять свою логику и не должны непреднамеренно перехватывать фокус.
- Явно НЕ используется оборачивание в `<label>` — по требованию: в `v-input` семантически нет подписи-лейбла для этой цели, решение через JS.

## Подход

- `.input-wrapper` получает `(mousedown)` обработчик в `v-input.ts`.
- Логика: если инпут задизейблен — игнор; если `event.target` уже сам `<input>`/`<textarea>` — не трогать (не ломать нативную установку курсора по месту клика); если у события уже стоит `defaultPrevented` — игнор (kто-то из дочерних элементов явно отказался); иначе — `preventDefault()` + `inputEl.focus()`.
- Opt-out для кнопок/иконок в prefix/postfix — не новый флаг конфига, а уже существующая в кодовой базе конвенция: `(mousedown)="$event.preventDefault()"` на самой кнопке. Дочерний обработчик всегда выполняется раньше родительского (bubbling), поэтому к моменту, когда событие доходит до `.input-wrapper`, `event.defaultPrevented` уже корректно отражает этот отказ.
- `cursor: text` добавлен на `.input-wrapper` в CSS — паддинг и декоративные зоны сразу показывают текстовый курсор при наведении. Существующие модификаторы (`disabled` → `not-allowed`, `clickable-readonly` → `pointer`) имеют более высокую специфичность и продолжают побеждать корректно.
- `paddingX`/`paddingY` на `v-input` (сделано ранее) принимают либо число — наш `--unit-N`, либо строку — сырое CSS-значение (например `'1px'`), через `resolveCssUnitOrRawValue` в `ui-kit/types.ts`.

## Файлы реализации

- `src/ui-kit/components/v-input/v-input.ts` — `onWrapperMouseDown()`.
- `src/ui-kit/components/v-input/v-input.html` — `(mousedown)` на `.input-wrapper`.
- `src/ui-kit/components/v-input/v-input.css` — `cursor: text` на `.input-wrapper`.

## Чеклист реализации

- ✅ Добавить `onWrapperMouseDown()` в `v-input.ts`.
- ✅ Подключить `(mousedown)` на `.input-wrapper` в шаблоне.
- ✅ Добавить `cursor: text` на `.input-wrapper` в CSS.
- ✅ Проверить TypeScript и Angular template compilation (`tsc --noEmit`, `ng build`) — чисто.

## Чеклист ручной проверки в браузере

По одному представителю на каждый тип поведения, встречающийся в проде. Кликать не только по самому полю, но и по паддингу/декорациям вокруг него.

- ⭕ **Обычный инпут без prefix/postfix** — [metric-chart-card.html:24](src/app/components/metrics/metric-chart-card/metric-chart-card.html:24) (order на карточке метрики, режим редактирования Dashboard) или любой инпут порогов severity в [metrics-dashboard.html:200](src/app/components/metrics/metrics-dashboard/metrics-dashboard.html:200). Клик по паддингу вокруг цифр должен фокусировать поле.
- ⭕ **Декоративный postfix без обработчика клика** — [diary-entry-add-form.html:54](src/app/components/food/diary/diary-entry-add-form/diary-entry-add-form.html:54) (`г.` после веса). Раньше клик по "г." не давал фокуса — теперь должен.
- ⭕ **Ручной workaround "клик по prefix/postfix → focus()", уже существующий в коде** — валюта в [transaction-form.html:96-107](src/app/components/money/transactions-list/transaction-form/transaction-form.html:96) (`focusAmountInput()`), `max`/символ валюты в [expense-chart.html:15-20](src/app/components/money/expense-chart/expense-chart.html:15), `кг` в [body-weight.html:16](src/app/components/food/diary/body-weight/body-weight.html:16), `см` в [settings.html:67](src/app/components/settings/settings.html:67). Проверить, что нет двойного срабатывания/дёргания фокуса — новый обработчик и старый ручной клик должны мирно сосуществовать.
- ⭕ **Реальная кнопка в prefix/postfix с существующим `(mousedown)="$event.preventDefault()"`** — крестик-сброс в [diary-entry-edit-form.html:117-132](src/app/components/food/diary/diary-entry-edit-form/diary-entry-edit-form.html:117), кнопка переключения поиска и крестик очистки в [food-search.html:10-54](src/app/components/food/diary/food-search/food-search.html:10), крестик очистки в [v-dropdown.html:23-26](src/ui-kit/components/v-dropdown/v-dropdown.html:23) (любой `v-dropdown` с выбранным значением). Клик по самой кнопке должен работать как раньше и НЕ должен уводить/красть фокус; клик рядом с кнопкой — фокусирует инпут.
- ⭕ **Задизейбленный инпут с prefix/postfix** — invest-сумма (disabled) в [transaction-form.html:226-245](src/app/components/money/transactions-list/transaction-form/transaction-form.html:226), или `yMax` в [expense-chart.html:5-21](src/app/components/money/expense-chart/expense-chart.html:5) при `yearlyMode$$()`. Клик вокруг не должен фокусировать поле.
- ⭕ **`isAutoSubmitEnabled` инпут** — вес в [body-weight.html](src/app/components/food/diary/body-weight/body-weight.html:12), рост в [settings.html:52-70](src/app/components/settings/settings.html:52) (там ещё и `(onFocused)`/`(onBlurred)` завязаны на UI-состояние). Проверить, что countdown/submitting/success/error состояния не ломаются от нового способа фокусировки.
- ⭕ **`v-dropdown` (readonly + isClickable, открытие по фокусу)** — любой дропдаун в форме транзакции ([transaction-form.html](src/app/components/money/transactions-list/transaction-form/transaction-form.html)) или в Settings. Клик по паддингу вокруг текста должен открывать список (раньше требовалось попасть точно по тексту); клик по иконке очистки — только очищает, не открывает список.
- ⭕ **Textarea-режим** — описание в [catalogue-entry-edit-form.html:82-86](src/app/components/food/diary/catalogue-entry-edit-form/catalogue-entry-edit-form.html:82) или комментарий в [transaction-form.html:354-357](src/app/components/money/transactions-list/transaction-form/transaction-form.html:354). Клик по пустому месту сверху/снизу/сбоку от текста должен фокусировать textarea.
