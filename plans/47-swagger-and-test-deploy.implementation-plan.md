# Swagger только на тесте + возврат тестового деплоя — фронтенд (парный план)

Основной план бэкенда: [47-swagger-and-test-deploy.implementation-plan.md](../../megaapp-back/plans/47-swagger-and-test-deploy.implementation-plan.md).

## Описание

- Во фронте Swagger не нужен. Нужен только тестовый деплой фронта, чтобы `test.vslav.dev` отдавал и фронт, и API с документацией.

## Как было

- `deploy-test.yml` удалён в `1091e6e` (18.08.2026), остался `deploy-prod.yml` (`release` → `/var/www/megaapp`).
- Конфигурация сборки `test` в `angular.json` и `environment.test.ts` на месте.

## Решение

- Возвращён `deploy-test.yml`: `develop` → `npm run build -- --configuration=test` → `/var/www/megatest`.
- Тот же шаблон, что у `deploy-prod.yml` (отдельный файл, без общего reusable-воркфлоу: прод-воркфлоу в репозитории тоже самодостаточный).
- Серверная часть (каталог `/var/www/megatest`, nginx `test.vslav.dev`) — в основном плане бэкенда.

## Чеклист

- ✅ `deploy-test.yml` во фронте

## Общий воркфлоу деплоя (28.10.2026)

Заменяет решение выше «отдельный файл без общего воркфлоу»: ревью показало, что `deploy-test.yml` повторяет `deploy-prod.yml` с заменой трёх значений, а у воркфлоу снова два потребителя.

- Сборка и выкладка вынесены в `build-and-deploy.yml` с параметрами «ветка / конфигурация / каталог / коммит». Как в бэке (`deploy-backend.yml`) и как было до 18.08.2026.
- `deploy-prod.yml` и `deploy-test.yml` — тонкие обёртки: триггер, группа `concurrency`, три значения, секреты. Группы `deploy-prod` и `deploy-test` остались в обёртках.
- Риск: `deploy-prod.yml` теперь передаёт секреты `HOST`/`USER`/`SSH_KEY` явно из контекста вызывающего, как в бэке и как раньше во фронте. Если эти секреты лежат только в окружении `VPS_31`, а не на уровне репозитория, прод-выкладка получит пустые значения. В GitHub Actions не проверялось, первый прогон смотреть глазами.

### Чеклист

- ✅ `build-and-deploy.yml`, тонкие `deploy-prod.yml` и `deploy-test.yml`
