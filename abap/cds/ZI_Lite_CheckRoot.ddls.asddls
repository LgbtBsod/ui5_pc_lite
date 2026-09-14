@AbapCatalog.sqlViewName: 'ZILTROOTSQL'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Check (lite): Root (push-down text resolution, no draft)'

// Аналог redux/abap/cds/ZI_CheckRoot.ddls.asddls, но НАМНОГО проще —
// намеренно, по прямому указанию заказчика ("вариант попроще без драфта,
// только на приём и словари"), а не недосмотр:
//
//   - НЕТ union all active/draft (redux/abap/cds/ZI_CheckRoot.ddls.asddls,
//     строки ~250-280 — вторая копия всей проекции для draft-ветки) —
//     ZCHECK_LITE_SRV вообще не подключает draft/BOPF, см.
//     pc_lite/abap/README.md.
//   - НЕТ ChecksAmount/ChecksSuccess/BarriersAmount/BarriersSuccess/
//     SuccessRateChecks/SuccessRateBarriers/*Criticality/HasErrorChecks/
//     HasErrorBarriers/*ErrorBadgeHidden/HeaderKpiTitle/HeaderKpiSubtitle —
//     ни одного из этих полей нет в pc_lite/model/metadata.xml CheckRoot
//     (сверено построчно), они там и не нужны: у лайта нет object page/
//     списка "мои проверки", это форма из одного экрана на один сабмит —
//     эти агрегаты просто некому показывать.
//   - НЕТ композитного ETag через ZCL_CHECK_ROOT_ETAG_AMDP — не нужен: у
//     лайта нет PATCH ни на один дочерний entity set после создания
//     (facade/DeepEntityFacade.js делает ОДИН deep-create POST, дальше
//     объект больше не редактируется через OData вообще), а Root/Basic
//     пишутся ZCL_CHECK_LITE_DPC_EXT в ОДНОЙ транзакции с ОДНИМ и тем же
//     GET TIME STAMP — LastChangedAt Root'а и Basic'а физически совпадают
//     в момент создания, разойтись им неоткуда. Если лайту КОГДА-ЛИБО
//     потребуется независимый PATCH на CheckBasics (сейчас не требуется —
//     см. model/metadata.xml, EntitySet CheckRoots помечен
//     sap:updatable-path, но сам PATCH клиент не шлёт), этот пункт нужно
//     будет пересмотреть первым.
//
// Basic-proxy текстовые поля (LpcText/ProfText/TimezoneText/LocationName/
// Observer*/Observed*Fullname) — через association на ZI_Lite_CheckBasic
// (left outer join, не inner: строка обязана вернуться сразу после
// deep-create, до того как что-либо в Basic могло бы отсутствовать).
define view ZI_Lite_CheckRoot
  as select from zchk_root as Root

    left outer join ZI_Lite_CheckBasic as Basic
      on Root.root_id = Basic.RootId
{
  key Root.root_id                                            as RootId,
      Root.doc_id                                             as DocId,

      Basic.Date                                              as Date,
      Basic.Time                                               as Time,
      Basic.Timezone                                          as Timezone,
      Basic.TimezoneText                                      as TimezoneText,
      Basic.LocationKey                                       as LocationKey,
      Basic.LocationName                                      as LocationName,
      Basic.Equipment                                         as Equipment,
      Basic.ObserverFullname                                  as ObserverFullname,
      Basic.ObserverPernr                                     as ObserverPernr,
      Basic.ObservedFullname                                  as ObservedFullname,
      Basic.ObservedPernr                                     as ObservedPernr,
      Basic.LpcKey                                            as LpcKey,
      Basic.LpcText                                           as LpcText,
      Basic.ProfKey                                           as ProfKey,
      Basic.ProfText                                          as ProfText,

      Root.status                                             as Status,
      Root.this_is_integration_data                           as ThisIsIntegrationData,

      // [По запросу, зеркало pc_lite/model/metadata.xml Property Updatable]
      // Та же формула, что уже задокументирована и проверена в моке
      // (MockServerBootstrap.js#_normalizeDeepCreate) — интеграционные
      // записи нередактируемы, обычные да. sap:updatable-path="Updatable"
      // на EntitySet CheckRoots в metadata.xml на неё и указывает — pc_lite
      // сегодня кнопки "Редактировать" не имеет вообще (см. комментарий
      // там же), поле объявлено для честности контракта, не для текущего
      // потребления клиентом.
      @Semantics.booleanFlag: true
      case when Root.this_is_integration_data = abap_true then abap_false else abap_true end
                                                                    as Updatable,

      // [Hidden-флаги] Та же формула, что redux/abap/cds/ZI_CheckRoot.ddls.asddls
      // (переиспользуется общее бизнес-правило — см. pc_lite/model/
      // BusinessRules.js BARRIERS_HIDDEN_PK_LEVELS, зеркало
      // redux/serve_config.py). Клиент pc_lite вычисляет то же самое сам
      // (formatter.isBarriersAllowed/isBarriersHidden) до сабмита — эти
      // поля появляются в ответе POST уже ПОСЛЕ создания, для честности
      // контракта, а не потому что клиент их сегодня читает.
      @Semantics.booleanFlag: true
      case when coalesce( Basic.LpcKey, '' ) = ''
        then abap_true else abap_false
      end                                                          as ChecksHidden,

      @Semantics.booleanFlag: true
      case when coalesce( Basic.LpcKey, '' ) in ( '', '0', '1' )
        then abap_true else abap_false
      end                                                          as BarriersHidden,

      Root.last_changed_at                                        as LastChangedAt,
      Root.created_by                                             as CreatedBy,
      Root.created_at                                             as CreatedAt
}
