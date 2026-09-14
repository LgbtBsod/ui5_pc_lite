sap.ui.define([
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/util/ODataFormat",
  "sap/pc_lite/lite/facade/DictionaryFacade"
], (EntityConfig, ODataFormat, DictionaryFacade) => {
  "use strict";

  /** Builds the CheckRoots deep-create payload (CHECKROOTS_CREATE_DEEP_ENTITY contract in redux). */
  // [Fix РЕАЛЬНЫЙ БАГ, аудит] Code->Text резолвится через DictionaryFacade.
  // resolveText() (единственный владелец формы dictionaryModel>/_index) —
  // раньше здесь была своя, чуть иначе написанная копия той же логики
  // (_resolveText), независимая от такой же копии в RowsAndAutoFill.js.
  // Обе точки теперь читают _index одним и тем же кодом.
  class DeepEntityFacade {
    /**
     * @param {sap.ui.model.json.JSONModel} oFormModel
     * @param {sap.ui.model.json.JSONModel} oChecksModel
     * @param {sap.ui.model.json.JSONModel} oBarriersModel
     * @param {sap.ui.model.json.JSONModel} oDictModel
     * @returns {object} OData deep-entity payload for POST /CheckRoots
     */
    static build(oFormModel, oChecksModel, oBarriersModel, oDictModel) {
      const oForm = oFormModel.getData();

      return {
        // [MIGRATION_MAPPING.md, OPEN-1 — resolved] PkLevels теперь общий
        // справочник с redux (см. model/PkLevels.json) — PkLevel это и есть
        // LpcKey, без трансляции шкалы.
        LpcKey: oForm.PkLevel || "",
        LpcText: DictionaryFacade.resolveText(oDictModel, "PKLEVEL", oForm.PkLevel),

        // [Fix РЕАЛЬНЫЙ БАГ, аудит] ObservedPernr/ObserverPernr — было
        // ObservedPerner/ObserverPerner (опечатка), см. подробное
        // обоснование у Property в model/metadata.xml.
        ObservedFullname: oForm.InspectedFullname || "",
        ObservedPernr: oForm.InspectedPernr || "",
        ObserverFullname: oForm.InspectorFullname || "",
        ObserverPernr: oForm.InspectorPernr || "",
        Date: ODataFormat.toODataDate(oForm.CheckDate),
        Time: ODataFormat.toODataTime(oForm.CheckTime),
        Timezone: oForm.TimeZone || "",
        TimezoneText: DictionaryFacade.resolveText(oDictModel, "TIMEZONE", oForm.TimeZone),
        LocationKey: oForm.LocationUUID || "",
        LocationName: oForm.LocationText || "",
        ProfKey: oForm.Profession || "",
        ProfText: DictionaryFacade.resolveText(oDictModel, "PROFESSION", oForm.Profession),
        Equipment: oForm.Equipment || "",
        to_Checks: { results: DeepEntityFacade._collectRows(oChecksModel, "Checks", oDictModel) },
        to_Barriers: { results: DeepEntityFacade._collectRows(oBarriersModel, "Barriers", oDictModel) }
      };
    }

    // [Fix] ZCL_CHECK_DPC_EXT делает CORRESPONDING-копию присланных полей без
    // серверного Code→Text lookup для CheckItem/Barrier (в отличие от корня,
    // где LpcText/TimezoneText/ProfText — тоже обязанность клиента) — не
    // резолвить Text здесь значило бы отправлять пустую колонку в таблице.
    static _collectRows(oModel, sType, oDictModel) {
      const oCfg = EntityConfig.TYPES[sType];
      const aItems = oModel.getProperty("/items") || [];
      return aItems
        .filter((r) => r[oCfg.codeProp])
        .map((r) => ({
          Code: r[oCfg.codeProp],
          Text: DictionaryFacade.resolveText(oDictModel, oCfg.dictType, r[oCfg.codeProp]),
          Comment: r.Comment || "",
          // [Fix, аудит] Убран мёртвый `|| r.Result` — ModelsInit.emptyRow
          // создаёт только `Status`, и ни один биндинг во фрагментах не
          // пишет `.Result` на строку; второй вариант никогда не был
          // реальным входом, только неочевидным пережитком именования.
          Result: r.Status || "",
          // [Поля несоответствия, по запросу] Отправляются всегда (как
          // Comment) — если результат не "Неудовлетворительно", поля были
          // недоступны для ввода на клиенте (см. ChecksTable/
          // BarriersTable.fragment.xml) и здесь просто пустые строки.
          NonConformityDescription: r.NonConformityDescription || "",
          NonConformityLocation: r.NonConformityLocation || ""
        }));
    }

  }

  return DeepEntityFacade;
});
