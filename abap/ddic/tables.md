# Транспарентные таблицы (DDIC) под `pc_lite/abap/cds/*.ddls.asddls`

Тот же формат и уровень детализации, что `redux/abap/ddic/tables.md` (не
полные `.tabl`-описания — состав полей).

## Источник истины для общих таблиц — `redux/abap/ddic/tables.md`

`ZCHECK_LITE_SRV` (этот сервис) читает и пишет **те же физические таблицы**,
что `ZCHECK_SRV` (`redux/`) — `ZCHK_ROOT`/`ZCHK_BASIC`/`ZCHK_ITEM`/`ZCHK_BARR`
+ все справочники (`ZCHK_CTYPE`/`ZCHK_BTYPE`/`ZCHK_CRES`/`ZCHK_PKLVL`/
`ZCHK_TZONE`/`ZCHK_PROF`/`ZCHK_LOCH`/`ZCHK_PERS`). Этот файл их НЕ
дублирует — `redux/abap/ddic/tables.md` авторитетен для всех них, включая
две правки, добавленные туда в ходе этого же аудита и одинаково нужные
обоим сервисам:

- `ZCHK_BASIC.OBSERVER_FULLNAME_MANUAL`/`OBSERVED_FULLNAME_MANUAL` — третий,
  "ручной" источник ФИО (не Pernr-резолв, не интеграция) — без него
  `ZCL_CHECK_LITE_DPC_EXT` (как и обычный `ZCL_CHECK_DPC_EXT` до этой
  правки) молча роняет ФИО, введённое текстом без выбора через F4/поиск.
- `ZCHK_LOCH.EFFECTIVE_DATE` — as-of фильтр иерархии местоположений по дате
  проверки (см. `cds/ZI_Lite_LocationHierarchy`-раздел ниже — своей вьюхи у
  лайта для этого нет, переиспользуется `redux/abap/cds/
  ZI_LocationHierarchy.ddls.asddls`).

## Единственная таблица, принадлежащая ТОЛЬКО лайту

**ZCHK_AUTORULE** (правило авто-добавления строки по уровню КПР — customizing,
ведение через SM30 generated maintenance view, тем же способом, что
`ZCHK_CTYPE`/`ZCHK_PKLVL` и другие справочники в `redux/abap/ddic/tables.md`)

| Поле | Тип | Прим. |
|---|---|---|
| MANDT | CLNT(3) | |
| PK_LEVEL | CHAR(10) | Key, FK `ZCHK_PKLVL.PK_LEVEL` |
| ROW_TYPE | CHAR(10) | Key, `'Checks'` / `'Barriers'` — то же значение, что `pc_lite/model/EntityConfig.js#TYPES` ключ |
| CODE | CHAR(30) | Key, FK `ZCHK_CTYPE.CHECK_TYPE_CODE` или `ZCHK_BTYPE.BARRIER_TYPE_CODE` в зависимости от `ROW_TYPE` — гетерогенный FK, на уровне DDIC не проверяется декларативно (два разных родителя по одному ключу), проверка (если нужна) — в `ZCL_CHECK_LITE_DPC_EXT` при создании customizing-записи, не на чтении |

У redux этой концепции нет вообще — таблица физически могла бы жить в любом
общем пакете (в реальной системе Z-таблицы обычно не разносят по пакетам
вслед за git-репозиториями), граница `pc_lite/abap` vs `redux/abap` здесь —
только про то, какой git-репозиторий документирует/владеет описанием
объекта, не техническое требование ABAP-транспортной системы.

**Явно не переносится 1:1 из мока**: `pc_lite/model/AutoRowRules.json` —
seed-данные для локальной разработки (сейчас пустой/черновой набор — сам
бизнес-список правил ещё не финализирован, см. `async-hugging-sparrow.md`).
В реальной системе — customizing через SM30, не хардкод.
