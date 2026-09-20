# ABAP-бэкенд для `ZCHECK_LITE_SRV` (classic Gateway OData V2, non-draft)

## Зачем отдельная папка, а не `redux/abap/*`

По прямому указанию заказчика: *"там [в `redux/abap`] версия для драфта, у
нас вариант попроще без драфта только на приём и словари"*. `redux/abap/*` —
референс, из которого сюда взято то, что применимо, и НЕ взято то, что
относится только к draft/BOPF-контуру полной версии. `redux/abap/README.md`
исторически утверждал обратное (единый сервис на оба фронтенда) — это было
предыдущим планом, обновлено параллельно с этой правкой (см. раздел
"[Обновлено]" в самом начале того файла) под текущее, актуальное решение:
**два сервиса, одни DB-таблицы**.

## Архитектура

```
pc_lite (SAPUI5 1.71, freestyle wizard)
   │  OData V2, /sap/opu/odata/sap/ZCHECK_LITE_SRV/
   ▼
ZCL_CHECK_LITE_DPC_EXT  ── единственный редефинированный метод:
   │                       CHECKROOTS_CREATE_DEEP_ENTITY
   │
   │  (ВСЁ остальное — Persons/LocationHierarchy/BarrierTypes/CheckTypes/
   │   CheckResults/PkLevels/TimeZones/Professions/AutoRowRules + GET на
   │   CheckRoots — Referenced Data Source, generic SADL-редирект,
   │   ноль кода в DPC_EXT; см. "Reference Data Source vs новые объекты")
   ▼
cds/*.ddls.asddls (pc_lite/abap)  ──┐
redux/abap/cds/*.ddls.asddls  ──────┤  ОБЩИЕ read-only справочники —
                                     │  переиспользуются как есть, не копии
                                     ▼
Транспарентные таблицы — ОБЩИЕ с ZCHECK_SRV (redux/abap/ddic/tables.md),
кроме ZCHK_AUTORULE (pc_lite/abap/ddic/tables.md — этот сервис единственный
владелец)
```

Никакого AMDP/составного ETag — не нужен, см. комментарий в начале
`cds/ZI_Lite_CheckRoot.ddls.asddls`.

## Reference Data Source vs новые объекты

SEGW-проект — НЕ единственный владелец CDS-вьюх, которые он использует; CDS
— глобальные repository-объекты, переиспользуемые между сервисами через
**Data Model → Reference → Data Source** (доступно с AS ABAP 7.50 — см.
официальную документацию, на которую ссылался заказчик, раздел "Referenced
Data Source"/SADL: генерация GET_ENTITY/GET_ENTITYSET для такой сущности
полностью автоматическая, ни строчки ABAP). Отсюда — таблица ниже: из 11
entity set'ов сервиса **9 не имеют здесь ни одного нового CDS-файла** —
`ZCHECK_LITE_SRV` в SEGW ссылается напрямую на уже существующие вьюхи
`redux/abap/cds/*`.

| EntitySet (`pc_lite/model/metadata.xml`) | CDS-источник | Новый файл? |
|---|---|---|
| `Persons` | `redux/abap/cds/ZI_Person.ddls.asddls` | Нет — reference as-is |
| `LocationHierarchy` | `redux/abap/cds/ZI_LocationHierarchy.ddls.asddls` | Нет, но вьюха расширена (`EffectiveDate` — см. ниже) |
| `BarrierTypes` | `redux/abap/cds/ZI_BarrierType.ddls.asddls` | Нет — reference as-is |
| `CheckTypes` | `redux/abap/cds/ZI_CheckType.ddls.asddls` | Нет — reference as-is |
| `CheckResults` | `redux/abap/cds/ZI_CheckResult.ddls.asddls` | Нет — reference as-is |
| `PkLevels` | `redux/abap/cds/ZI_PkLevel.ddls.asddls` | Нет — reference as-is |
| `TimeZones` | `redux/abap/cds/ZI_TimeZone.ddls.asddls` | Нет — reference as-is |
| `Professions` | `redux/abap/cds/ZI_Profession.ddls.asddls` | Нет — reference as-is |
| `AutoRowRules` | `cds/ZI_Lite_AutoRowRule.ddls.asddls` | **Да** — концепции нет в redux вообще |
| `CheckRoots` (GET) | `cds/ZI_Lite_CheckRoot.ddls.asddls` (+ `ZI_Lite_CheckBasic`) | **Да** — своя проекция, без draft/агрегатов/ETag |
| `CheckRoots` (deep CREATE) | `classes/ZCL_CHECK_LITE_DPC_EXT.clas.abap` | **Да** — процедурный ABAP, CDS не может каскадно создавать |
| `CheckItems`/`Barriers` (GET/CREATE/UPDATE/DELETE отдельно от `CheckRoots`) | — | Не реализовано — решено не реализовывать, см. "Решено: CheckItems/Barriers" ниже |

`@Search.*`/`Consumption.filter` аннотации на переиспользуемых вьюхах уже
интерпретируются SADL (подтверждено официальной документацией — см. "Что
проверено по документации" ниже) НЕЗАВИСИМО от того, классический ли это
Gateway-сервис через Referenced Data Source или "чистый" `@OData.publish` —
т.е. `Fio`/`LocationName` full-text search и `EffectiveDate`-фильтр у
лайта заработают без единой новой аннотации сверх тех, что уже стоят в
`redux/abap/cds/*` (плюс одна новая — `EffectiveDate`, добавлена этой
правкой).

## Решено: CheckItems/Barriers — только через deep-entity, флага на них нет

Было открытым вопросом ("нужны ли CheckItems/Barriers как read/update entity
sets"), закрыто прямым решением по проекту: **флага на `CheckRoots`
достаточно, на дочерних нодах (`CheckItems`/`Barriers`) флага нет**. Живой
клиент (`facade/DeepEntityFacade.js`) и так никогда не вызывал `CREATE`/
`UPDATE`/`DELETE` на них отдельно — строки уходят единственным deep-create
POST'ом на `CheckRoots` через `to_Checks`/`to_Barriers` (этот канал —
`NavigationProperty sap:creatable="true"` на `CheckRoot` — не тронут, он и
есть единственный путь записи для этих сущностей).

Применено в `model/metadata.xml`: `CheckItems`/`Barriers`
`sap:creatable="false" sap:updatable="false" sap:deletable="false"` (было
`"true"` у всех трёх без единого подтверждённого вызова). Важный нюанс,
из-за которого нельзя было просто удалить атрибуты: в classic Gateway
`sap:creatable`/`updatable`/`deletable` по умолчанию (без явного указания)
— **`"true"`**, не `"false"` — отсутствие атрибута НЕ закрывает
возможность, нужно явное `"false"`.

Соответствующих `checkitems_create_entity`/`_update_entity`/
`barriers_create_entity`/`_update_entity` в `ZCL_CHECK_LITE_DPC_EXT` поэтому
не будет — они были бы декоративным кодом без потребителя (тот же принцип,
по которому в этом классе нет `ZCL_CHECK_LITE_MPC_EXT`, см. заголовок
класса).

## Что найдено и исправлено при аудите (не гипотетически — с доказательствами)

1. **`ObserverFullname`/`ObservedFullname` — реальный, уже раз найденный
   баг**, не гипотеза. `redux/backend/resolvers.py#resolve_check_basic`
   документирует и живым тестом доказывает ("confirmed live: a raw PATCH
   with only ObservedFullname set returns 204... but the very next GET
   already shows ''"), что у поля есть ТРЕТИЙ легитимный источник — текст,
   введённый без выбора через F4 — который до этой правки было физически
   некуда сохранить ни в `ZCHK_BASIC` (нет колонки), ни, соответственно, в
   `ZI_CheckBasic`/`ZI_Lite_CheckBasic` (coalesce из двух источников вместо
   трёх). Симптом одинаковый что для draft-версии, что для лайта —
   `CORRESPONDING zchk_basic( ls_deep-to_basic )` в обоих DPC_EXT молча
   роняет эти два поля. Исправлено на ВСЕХ уровнях разом: DDIC
   (`redux/abap/ddic/tables.md`), CDS (`ZI_CheckBasic`/`ZI_Lite_CheckBasic`,
   3-уровневый coalesce, порядок приоритета — как в уже проверенном
   резолвере мока), ABAP (явное присвоение после `CORRESPONDING`/`ASSIGN
   COMPONENT` в обоих DPC_EXT).
2. **`ZCHK_LOCH.EffectiveDate`** отсутствовал в DDIC/CDS вовсе — задача из
   этого же диалога ("поиск местоположений... как поиск людей"), уже
   реализованная на клиенте (`facade/DictionaryFacade.js`) и в моке
   (`model/LocationHierarchy.json`) ранее в этой сессии, но не имевшая
   соответствующего backend-контракта до этой правки. Добавлено в общую
   вьюху `redux/abap/cds/ZI_LocationHierarchy.ddls.asddls` (не копия) с
   `@Consumption.filter` — см. `redux/abap/ddic/tables.md`.
3. **Несостыковка клиент/контракт — решено.** `pc_lite/model/FormValidator.js`
   (`REQUIRED_FIELDS`) требовал непустой `InspectedPernr`/`InspectorPernr`,
   а `$metadata` объявлял мандаторным только `ObserverFullname`/
   `ObservedFullname` (не `*Pernr`) — контрактно достаточно было прислать
   голый текст без выбора из справочника, хотя клиент такое состояние и не
   допускал. Прямое решение по проекту: **выбор из справочника обязателен**
   — контракт приведён в соответствие с уже действующим поведением клиента.
   Изменено: `ObserverPernr`/`ObservedPernr` теперь тоже `Nullable="false"`
   в `model/metadata.xml`; `ZCL_CHECK_LITE_DPC_EXT=>VALIDATE_REQUIRED_FIELDS`
   проверяет `*_pernr` (было — `*_pernr` ИЛИ ручной текст, теперь только
   `*_pernr`, см. класс). `*_fullname_manual`/coalesce-инфраструктура из
   пункта 1 не удалена — она остаётся полезной как отображаемое имя и
   защитой в глубину на случай сырого HTTP-вызова в обход UI (тот же принцип
   "клиентская валидация — подсказка, не гарантия", уже принятый в
   `redux/abap/README.md`), просто больше не участвует в решении "принять
   строку или отклонить" — это теперь целиком на `*_pernr`.
   Сообщение валидатора на клиенте (`i18n_ru.properties`,
   `msgValInspected`/`msgValInspector`) по-прежнему общее ("Укажите
   проверяемого"/"Укажите проверяющего") и не поясняет, что введённого
   текста недостаточно — это отдельная, самостоятельная UX-полировка,
   не блокирующая ничего из решённого здесь.
4. **`redux/abap/README.md`** утверждал единую сервисную топологию,
   противоречащую и текущему `pc_lite/model/metadata.xml`/
   `model/BackendConfig.js` (которые уже явно проектируют отдельный
   `ZCHECK_LITE_SRV` с собственными классами), и прямому указанию заказчика
   в этом диалоге — обновлено.

## Что проверено по официальной документации (не по памяти)

По ссылке заказчика (`help.sap.com`, ABAP Programming Model for SAP Fiori,
NW 7.50 SPS17) и последующему поиску:

- **Referenced Data Source в SEGW** — с AS ABAP 7.50 SEGW умеет
  ссылаться на существующую CDS-вьюху как источник данных сущности; runtime
  для read-операций генерируется автоматически на базе SADL, DPC_EXT в этом
  случае не нужен вообще, если исходный GET_ENTITYSET не переопределяется
  (источник: SAP Learning "Referencing a Data Source"/сообщество —
  подтверждено независимо двумя источниками, WebFetch на сам help.sap.com
  не работает для этой конкретной страницы — SPA без серверного рендеринга,
  подтверждено дважды, обойдено через Browser pane/поиск).
- **`@Search.searchable`/`@Search.defaultSearchElement`/
  `@Search.fuzzinessThreshold`** — "Evaluation Runtime (Engine): Interpreted
  by Enterprise Search **and SADL**" (дословно с
  `.../38baf2fc3a8e4ed887b29de738296fa9.html`) — т.е. эти аннотации в
  `ZI_Person`/`ZI_LocationHierarchy` НЕ декоративны для классического
  Gateway-сервиса через Referenced Data Source (первая гипотеза при
  начале этого аудита была обратной — что они относятся только к
  Enterprise Search/`@OData.publish`-пути — перепроверено по документации
  и ОПРОВЕРГНУТО до того, как попасть в этот отчёт).
- **`@Consumption.filter`** — "Evaluation Runtime (Engine): SADL —
  Translates the following CDS annotations into the corresponding OData
  annotations" (`.../d60c0bf6798a481fb7412bc89934cb8a.html`) — тоже SADL,
  тоже применимо к Referenced Data Source, не только к `@OData.publish`.
- **`@ObjectModel.createEnabled`/`updateEnabled`/`deleteEnabled`** —
  тоже SADL-домен, НО в этом сервисе не используются вовсе: единственная
  create-операция (`CheckRoots` deep-create) — процедурный
  `CHECKROOTS_CREATE_DEEP_ENTITY`, который эти аннотации не заменяют и не
  учитывает (объявление сущности creatable/updatable в classic Gateway
  идёт через `sap:creatable`/`sap:updatable` на `EntitySet` в
  `metadata.xml`, не через `@ObjectModel.*` — это разные механизмы одного
  и того же СМЫСЛА в двух разных рантаймах, RAP/`@OData.publish` vs
  classic Gateway; смешивать их в один сервис некорректно и здесь не
  делается).

## Известные компромиссы (сознательно не решены здесь)

- Нет server-side проверки, что `Code` на `CheckItem`/`Barrier` реально
  принадлежит списку, допустимому для выбранного `LpcKey` (та же CSV-PkLevels
  проблема, что и в `redux/abap/README.md`, "Известные компромиссы") — на
  клиенте фильтруется, на сервере — нет; сюда не перенесено, т.к. не было
  и в референсе.
- `AutoRowRule` не валидируется на предмет "код действительно существует в
  CheckTypes/BarrierTypes" (гетерогенный FK, см. `ddic/tables.md`) — точный
  список правил ещё не финализирован заказчиком, откладывать эту проверку
  до финализации разумнее, чем валидировать пустой/черновой набор.
- Требования к обязательным полям (`validate_required_fields`) продублированы
  между ABAP (сервер) и `pc_lite/model/FormValidator.js` (клиент) — тот же
  класс дублирования, что уже описан и принят как компромисс в
  `redux/abap/README.md` ("подсказка клиенту... не гарантия для сырого
  HTTP-клиента").

## Что дальше

Как и `redux/abap/*` — это спецификация и примеры классов, не транспортный
пакет. Не хватает: `.tabl`-описаний DDIC, generated maintenance view для
`ZCHK_AUTORULE`, PFCG-роли, активации `/sap/opu/odata/sap/ZCHECK_LITE_SRV/`
в SICF и `/IWFND/MAINT_SERVICE`, полных сгенерированных SEGW-стабов, ABAP
Unit тестов на `ZCL_CHECK_LITE_DPC_EXT` (по образцу `redux/tests/
test_serve.py`, суженному до create-only матрицы: readonly-поля здесь не
актуальны — на create их и не пришлют осмысленно, — required-fields
(включая новую проверку `*_pernr` вместо `*_fullname_manual`),
conflict-of-interest, ObserverFullname/ObservedFullname 3-tier fallback).
