@AbapCatalog.sqlViewName: 'ZILTBASCSQL'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Check (lite): Basic data (push-down text resolution)'

// Аналог redux/abap/cds/ZI_CheckBasic.ddls.asddls, СУЖЕННЫЙ до полей,
// которые реально есть в pc_lite/model/metadata.xml (CheckRoot Basic-proxy
// свойства): без ObserverPosition/ObserverOrgunit/ObservedPosition/
// ObservedOrgunit/LocationText/ObserverIntegrationName/
// ObservedIntegrationName — pc_lite ни разу их не объявляет и не читает
// (см. CheckRoot EntityType в model/metadata.xml). Не копия "на всякий
// случай" — по прямому указанию заказчика ("вариант попроще без драфта,
// только на приём и словари"), лишние поля здесь были бы одной лишней
// колонкой в контракте без потребителя, тем самым риском рассинхрона.
//
// [Fix РЕАЛЬНЫЙ БАГ, найдено при аудите] ObserverFullname/ObservedFullname —
// coalesce из ТРЁХ источников (Pernr→Fio / *_integration_name / ручной
// текст), не из двух: см. подробное обоснование в redux/abap/ddic/
// tables.md у ZCHK_BASIC.OBSERVER_FULLNAME_MANUAL и redux/abap/cds/
// ZI_CheckBasic.ddls.asddls (та же правка внесена туда параллельно с этой
// вьюхой — порядок coalesce обязан совпадать в обеих). Это не "лайт-
// специфичная" правка: ZCHK_BASIC — общая таблица, баг был в схеме, а не в
// каком-то одном сервисе.
define view ZI_Lite_CheckBasic
  as select from zchk_basic as Basic

    left outer join zchk_pers as Observer
      on Basic.observer_pernr = Observer.pernr

    left outer join zchk_pers as Observed
      on Basic.observed_pernr = Observed.pernr

    left outer join zchk_pklvl as Pkl
      on Basic.lpc_key = Pkl.pk_level

    left outer join zchk_prof as Prof
      on Basic.prof_key = Prof.profession_code

    left outer join zchk_tzone as Tz
      on Basic.timezone = Tz.time_zone_code

    left outer join zchk_loch as Loc
      on Basic.location_key = Loc.location_uuid
{
  key Basic.root_id                                          as RootId,
      Basic.date                                              as Date,
      Basic.time                                              as Time,
      Basic.timezone                                          as Timezone,
      coalesce( Tz.time_zone_text, '' )                       as TimezoneText,
      Basic.equipment                                         as Equipment,
      Basic.location_key                                      as LocationKey,

      // [Basic-proxy] Тот же fallback-приоритет, что у ObserverFullname
      // ниже и у redux'овского ZI_CheckBasic: резолвленное по ключу имя
      // побеждает, если Loc найден; иначе — то, что реально сохранено
      // текстом (LOCATION_NAME — тот же денормализованный fallback-стобец,
      // не LOCATION_TEXT, который здесь не нужен — см. заголовок файла).
      coalesce( Loc.location_name, Basic.location_name, '' )  as LocationName,

      Basic.observer_pernr                                   as ObserverPernr,
      coalesce( Observer.fio, Basic.observer_integration_name, Basic.observer_fullname_manual, '' )
                                                                as ObserverFullname,

      Basic.observed_pernr                                   as ObservedPernr,
      coalesce( Observed.fio, Basic.observed_integration_name, Basic.observed_fullname_manual, '' )
                                                                as ObservedFullname,

      Basic.lpc_key                                           as LpcKey,
      coalesce( Pkl.pk_level_text, '' )                       as LpcText,

      Basic.prof_key                                          as ProfKey,
      coalesce( Prof.profession_text, '' )                    as ProfText,

      Basic.last_changed_at                                   as LastChangedAt
}
