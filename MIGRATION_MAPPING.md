# Миграция pc_lite (freestyle) со старой 3-сущностной модели на 4-сущностную (`redux`)

Статус: **мапинг составлен и применён, живой UI-код сверен и починен, OPEN-1
решён.** Остаётся открытым только OPEN-3 (продуктовое решение).

## OPEN-1 — РЕШЕНО

Справочники pc_lite (`model/*.json`) заменены на точную копию
`redux/serve_config.py REFERENCE_DATA` — один бэк, один набор кодов.
`PkLevel` теперь "0".."4" (было "PK-I".."PK-X"), `CheckTypes`/`BarrierTypes`/
`Professions`/`TimeZones`/`Persons`/`LocationHierarchy` — те же коды и тексты,
что в `redux`. `DeepEntityFacade.build()` передаёт `PkLevel` в `LpcKey` как
прямой passthrough (шкалы совпадают) и теперь также резолвит `LpcText`
(раньше не отправлялся вовсе, хотя `Common.Required=true` в `redux/annotation/
annotations.xml`).

Правило видимости барьеров вынесено в отдельный модуль
[`model/BusinessRules.js`](model/BusinessRules.js), зеркалирующий
`redux/serve_config.py BUSINESS_RULES.BARRIERS_HIDDEN_PK_LEVELS = ("", "0", "1")`
— старая рангово-пороговая логика по 10-уровневой шкале (`BARRIER_MIN_PK`)
удалена целиком, не адаптирована по частям.

## Регрессии, найденные и исправленные при сверке с живым кодом

Первый проход по фасадам/метаданным был сделан без чтения потребителей
(`Main.controller.js`, фрагменты, `ExcelTemplate.js`) — при сверке нашлись и
исправлены:

- **`DictionaryFacade` location-хелперы** — переименовал внутренний формат в
  `LocationUuid`/`LocationName`, но `LocationDialog.fragment.xml` и
  `Main.controller.js` (`onLocationRowSelect`, `_navigateLocationLevel`,
  `onBreadcrumbPress`) жёстко биндятся на `NodeID`/`NodeText`/`ParentNodeID`.
  Исправлено: сырые строки `LocationHierarchy` нормализуются в старый формат
  один раз, на границе (`_normalizeLocationRows`), внутренний контракт не менялся.
- **`PersonSearchFacade`** — `Persons` (redux) отдаёт `Fio`, но
  `BaseInfo.fragment.xml` (suggestionItems) и `Main.controller.js`
  (`_onPersonSelected`, `oItem.getText()`) ожидают `Fullname`. Исправлено —
  маппинг `Fio`→`Fullname` на границе в `PersonSearchFacade.search()`.
- **`EntityConfig.codeProp/textProp`** — переименовал в `Code`/`Text` "под
  redux", но это внутренний контракт `checksModel`/`barriersModel`, жёстко
  зашитый в `ChecksTable.fragment.xml`/`BarriersTable.fragment.xml`
  (`"{checksModel>CheckText}"`) и `ModelsInit.emptyRow`. Откачено обратно на
  `CheckCode`/`CheckText`/`BarrierCode`/`BarrierText` — перевод под OData-имена
  и так уже был на границе, в `DeepEntityFacade._collectRows`.
- **`ExcelTemplate._filterByPk`** — читал старые булевы `PkI..PkV`, которых
  больше нет (`CheckTypes`/`BarrierTypes` несут CSV `PkLevels`) — адаптирован
  на тот же `Contains`-подход, что и `DictionaryFacade.getFilteredForVh`.
- **`Main.controller.js#onSubmit`** — `/Z_Checks_HeaderSet` → `/CheckRoots`,
  `oPayload.Checks/.Barriers` → `oPayload.to_Checks.results/.to_Barriers.results`
  (заодно поправлен баг с `this` в error-колбэке — был не забинжен на
  контроллер).

**Не тронуто, подтверждено как мёртвый код** (не часть текущего UI-потока,
`Main.view.xml` их не использует): `components/PersonSelector`,
`components/FormHeader`, `components/ChecksTable`, весь `store/*`
(Redux-подобная архитектура, вытесненная нынешним `Main.controller.js` +
JSONModel-подходом). Не удалялось в рамках этого прохода — отдельное решение.

## Suggest не работал — найдено и исправлено

`sap.ui.core.util.MockServer` (standalone dev mode) не умеет корректно
сравнивать `LE`/`LT` на `Edm.DateTime` (подтверждено эмпирически: `GE`
работает, `LE`/`LT` — нет, независимо от границы сравнения). Старый
`PersonSearchFacade.buildDateFilters()` слал `ActiveFrom LE today` как
`$filter` — на MockServer это давало 0 строк всегда, как только передавалась
непустая дата (а `formModel.CheckDate` не пустая никогда, инициализируется
`ODataFormat.today()`). `PersonSearchFacade` переписан: диапазон
`ActiveFrom/ActiveTo` проверяется в JS после чтения по `Fio Contains` —
не зависит от того, умеет ли конкретный OData-провайдер (мок или реальный
Gateway) корректно фильтровать LE/LT по датам.

Заодно нашёл и поправил вторую причину той же цепочки: `ActiveFrom`/
`ActiveTo` были помечены `sap:filterable="false"` в обоих `metadata.xml`
(скопировано из `redux` не глядя) — `PersonSearchFacade` реально фильтрует
по ним, `redux`'овский F4 тоже (`Common.ValueListParameterFilterOnly` в
`annotations.xml`). Исправлено на `true` в обоих файлах.

## Архитектура: ES6-классы, мёртвый код удалён

`facade/*`, `util/*`, `middleware/ErrorHandler.js`, `model/ModelsInit.js`
переведены с `return { ... }`-объектов на `class` (статические методы) —
единый стиль с `redux/ext/util/*`. `EntityConfig.js`/`i18n` оставлены плоскими
данными (не поведение — классу тут нечего инкапсулировать, тот же паттерн,
что `redux/ext/util/Constants.js`).

Удалено как подтверждённо мёртвый код (не используется `Main.view.xml`,
проверено grep'ом по всему проекту): `components/*` (PersonSelector/
FormHeader/ChecksTable — вытеснены `Main.controller.js`), `store/*`
(Redux-подобный стор, тот же повод), `services/*` (`FormValidator`/
`CacheService` — не подключены нигде, ссылались на несуществующие поля).

Также поправлены 2 предупреждения в консоли: невалидный `visible` на
`<core:Fragment>` в `Main.view.xml` (не settable-свойство, framework его
просто игнорировал) и устаревший текст хинтов `hintBarriers`/`hintPkIi`/
`hintPkI` (ссылались на старую шкалу "Уровень КПР III").

## Верификация Фазы 3 (draft-skeleton)

Запущен `serve.py`, прогнан полный цикл вручную: Prepare → GET черновика по
составному ключу → Discard → повторный Prepare → Activate. Все шаги
отработали корректно (`IsActiveEntity`/`HasDraftEntity` меняются как ожидается,
`__metadata.uri` для активной записи не изменился ни на символ). Существующий
набор `tests/test_serve.py` (24 теста) проходит без изменений — zero regression
на non-draft путях подтверждён, а не просто заявлен.

## Сущности

| Было (`pc_lite/abap`, deprecated) | Стало (`redux/abap`) | Примечание |
|---|---|---|
| `Z_Checks_HeaderSet` | `CheckRoots` | Root теперь несёт Basic-proxy поля напрямую (см. ниже) — `CheckBasics` отдельно вызывать не нужно |
| `Z_CheckSet` | `CheckItems` (nav `to_Checks`) | |
| `Z_BarrierSet` | `Barriers` (nav `to_Barriers`) | |
| `I_Dictionary` (`DictType`=CHECKS/BARRIERS/PKLEVEL/TIMEZONE/PROFESSION/CONFIG) | `CheckTypes`, `BarrierTypes`, `PkLevels`, `TimeZones`, `Professions` — раздельные EntitySet'ы, без общего `DictType`-дискриминатора | `DictionaryFacade.js` грузит 5 запросов параллельно вместо одного `/I_Dictionary`, группирует локально в ту же форму `{CHECKS:[], BARRIERS:[], ...}` — остальной код (`getFilteredForVh` и т.д.) не меняется |
| `I_LocationHier` | `LocationHierarchy` | Поля: `NodeID`→`LocationUuid`, `ParentNodeID`→`ParentLocationUuid`, `NodeText`→`LocationName`, `NodePath` — эквивалента нет в `redux`, строится клиентом как и раньше (`_buildAllPaths`, уже есть) |
| `I_PersonSearch` | `Persons` | `Pernr`→`Pernr` (без изменений), `Fullname`→`Fio`, `BegDa`/`EndDa`→`ActiveFrom`/`ActiveTo` |

## Поля `CheckRoot` (замена `Z_Checks_HeaderType`)

| Было | Стало | Примечание |
|---|---|---|
| `HeaderUUID` | — | Не отправляется клиентом, генерируется бэком (`RootId`) |
| `InspectedPernr` | `ObservedPernr` | + доп. `ObservedFullname` теперь ОБЯЗАТЕЛЬНО отправлять текстом (в старой модели текст не хранился в Header вообще) — данные уже есть в `formModel.InspectedFullname`, просто раньше не уходили в payload. (Исправлена опечатка "ObservedPerner"→"ObservedPernr" — аудит, см. metadata.xml.) |
| `InspectorPernr` | `ObserverPernr` | + `ObserverFullname` — аналогично, из `formModel.InspectorFullname`. (Исправлена опечатка "ObserverPerner"→"ObserverPernr" — аудит, см. metadata.xml.) |
| `CheckDate` | `Date` | без изменений формата |
| `CheckTime` | `Time` | без изменений формата |
| `TimeZone` | `Timezone` (код) | + `TimezoneText` резолвится из `dictionaryModel._index.TIMEZONE` на сборке payload (аналогично Fullname) |
| `LocationUUID` | `LocationKey` | + `LocationName` — нужно подтвердить, какое поле `formModel` (`LocationText` vs `LocationPath`) хранит именно ИМЯ узла, а не breadcrumb-путь, прежде чем маппить |
| `PkLevel` | `LpcKey` | **см. OPEN-1 ниже** |
| `Profession` | `ProfKey` | + `ProfText` резолвится аналогично Timezone |
| `Equipment` | `Equipment` | без изменений |
| `BarriersAllowed` | — | **см. OPEN-1** — в `redux` это не поле payload'а, а серверное вычисление |

## Поля `CheckItem`/`Barrier` (замена `Z_CheckType`/`Z_BarrierType`)

| Было | Стало |
|---|---|
| `CheckCode` / `BarrierCode` | `Code` |
| `Comment` | `Comment` (MaxLength поднят с 500 до 2000 по запросу бизнеса — синхронизировано и в redux/localService/metadata.xml, см. abap/ddic/tables.md) |
| `Status` ("1"/"0") | `Result` ("X"/"") — **см. OPEN-2** |
| `NonConformityDescription`/`NonConformityLocation` | `NonConformityDescription`/`NonConformityLocation` — новые поля (описание/место несоответствия), синхронизированы и в redux/localService/metadata.xml + abap/ddic/tables.md; redux пока не показывает их в своём собственном UI (object page) — это отдельная задача, здесь только контракт данных |

---

## OPEN-1: несовместимость шкалы уровней КПР

Старая модель: `PkLevel` — строки вида `"PK-I"`..`"PK-X"` (10 уровней,
`PK_FIELD_MAP` в `DictionaryFacade.js`), видимость барьеров решает
конфигурируемый порог `BARRIER_MIN_PK` (сравнение по рангу).

Новая модель (`redux`): `LpcKey` — судя по `Constants.js
TRANSIENT_UX_RULES`/CDS `ZI_CheckRoot`, значения `""`/`"0"`/`"1"`/... —
**другая шкала**, и правило видимости барьеров зашито как явное перечисление
кодов (`BARRIERS_HIDDEN_PK_LEVELS: ["", "0", "1"]`), не как сравнение рангов
с настраиваемым порогом.

Это две разные бизнес-модели одного понятия, а не просто разные имена одного
и того же кода. **Нужно решение**: либо реальный справочник `PkLevels` на
бэке кодируется той же 10-уровневой шкалой (тогда правило видимости барьеров
в CDS нужно переписать под сравнение рангов, а не enum), либо продуктовое
решение — какая шкала действующая, и старая переносится/выбрасывается.
Код (`EntityConfig.js`/facade) не трогаю, пока это не решено — иначе задача
"видимость барьеров" тихо сменит бизнес-смысл.

## ~~OPEN-2~~ — снято, не было расхождением

Перепроверено по факту в `model/I_Dictionary.json`: `DictType="STATUS"`
уже хранит `Code="X"`→"Удовлетворительно" / `Code=""`→"Не удовлетворительно" —
та же конвенция, что `Result` в `redux`. Ярлык `sap:label="Статус (1/0)"` в
старом `ZCHECK_SRV_metadata.xml` был неточным, реальные данные — `X`/`""`.
Механический rename, без семантического решения.

---

## OPEN-3 — РЕШЕНО: `OrgAssignment`/`Position` вырезаны

Продуктовое решение: не расширять `ZI_Person`/CDS ради двух read-only полей,
которые нужны были только для разрешения неоднозначности среди тёзок в
пикере. Поля убраны целиком: `BaseInfo.fragment.xml` (2 пары Label+Text),
`Main.controller.js#_onPersonSelected` (lookup по `oPerson.OrgAssignment/
Position` удалён), `ModelsInit.js` formModel (4 поля), i18n (`lblInspectedOrg/
Pos`, `lblInspectorOrg/Pos`) во всех 3 локалях. `PersonSearchFacade` их и не
запрашивал ($select без них уже) — правка только на стороне формы/модели.

Если позже понадобится разрешать тёзок — проще добавить это через
`$select`-friendly поле на `Person` (например, единый `Detail`-текст), чем
восстанавливать два отдельных read-only столбца.

## OPEN-1 (доп.): `PkLevels` в `CheckTypes`/`BarrierTypes` — временная заглушка

CSV `PkLevels` в моках ниже собран из старых `PkI..PkV` флагов **в старой
шкале** (`"PK-I,PK-II,..."`) — placeholder до решения по OPEN-1. Если шкала
поменяется, эти CSV нужно пересобрать.

## Что уже можно делать без ожидания решений

- `pc_lite/model/metadata.xml` — переписан под новую схему (см. коммит).
- Реструктуризация `DictionaryFacade.js` под 5 раздельных EntitySet вместо
  одного `I_Dictionary` — механическая правка, бизнес-логику `getFilteredForVh`
  не трогает.
- `manifest.json` — привести `uri` к единому регистру с `redux`.
