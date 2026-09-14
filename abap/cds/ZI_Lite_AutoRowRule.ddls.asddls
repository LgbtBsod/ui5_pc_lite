@AbapCatalog.sqlViewName: 'ZILTARULSQL'
@AbapCatalog.compiler.compareFilter: true
@AbapCatalog.preserveKey: true
@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Check (lite): auto-added row rule (PkLevel -> Type/Code)'

// Единственная CDS-вьюха этого сервиса без аналога в redux вообще — правило
// "при выборе уровня КПР X сразу добавить в таблицу строку типа Y с кодом
// Z" существует только у лайта (см. async-hugging-sparrow.md, план "B.
// Авто-добавление строк по уровню КПР"). Сегодня источник данных —
// pc_lite/model/AutoRowRules.json (мок), формой EntitySet выбранной
// намеренно, чтобы замена на настоящую таблицу была прозрачна для
// facade/DictionaryFacade.js (сигнатура чтения не меняется) — эта вьюха и
// есть та "настоящая таблица", см. ddic/tables.md.
//
// Точный бизнес-список правил ещё не финализирован заказчиком (см. план) —
// таблица ведётся через customizing (SM30 generated maintenance view), не
// хардкодится, тем же способом, что ZCHK_CTYPE/ZCHK_BTYPE и другие
// справочники в redux/abap/ddic/tables.md.
define view ZI_Lite_AutoRowRule
  as select from zchk_autorule as Rule
{
  key Rule.pk_level  as PkLevel,
  key Rule.row_type  as Type,
  key Rule.code      as Code
}
