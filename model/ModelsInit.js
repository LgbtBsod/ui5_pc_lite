sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/util/ODataFormat"
], (JSONModel, EntityConfig, WizardSteps, ODataFormat) => {
  "use strict";

  // [Fix Performance/Memory] Раньше _resetForm() в Main.controller.js звал
  // ModelsInit.createAll() целиком (7 JSONModel-инстансов), а использовал
  // только 5 — dictionaryModel/locationModel/constraintsModel/vhModel
  // выбрасывались сразу после создания. DEFAULTS хранит только сырые
  // POJO-данные (без JSONModel-обёртки) — createAll() строит из них модели
  // для Component#init (нужны все), а сброс конкретной модели (dataFor())
  // не аллоцирует лишние JSONModel-инстансы.
  function buildFormDefaults() {
    return {
      InspectedPernr: "",
      InspectedFullname: "",
      InspectorPernr: "",
      InspectorFullname: "",
      CheckDate: ODataFormat.today(),
      CheckTime: ODataFormat.now(),
      TimeZone: "",
      LocationUUID: "",
      LocationText: "",
      LocationPath: "",
      PkLevel: "",
      // [Fix РЕАЛЬНЫЙ БАГ, аудит] BarriersAllowed убран из formModel — раньше
      // это был хранимый флаг, который RowsAndAutoFill.js обязан был не
      // забыть пересчитать при каждой смене PkLevel (3 отдельных вызова в
      // 3 файлах, ничем не защищённых от рассинхрона). Видимость секции
      // "Барьеры" теперь считается НАПРЯМУЮ из PkLevel через formatter.
      // isBarriersAllowed/isBarriersHidden (см. model/formatter.js) при
      // каждом рендере — хранить и синхронизировать отдельное поле незачем.
      Profession: "",
      Equipment: ""
    };
  }

  function buildDataDefaults() {
    return {
      dictionaryModel: { CHECKS: [], BARRIERS: [], STATUS: [], TIMEZONE: [], PKLEVEL: [], PROFESSION: [], _index: {}, AUTO_ROWS: {} },
      // [Fix "не изобретать велосипед", аудит] levelItems убран — LocationDialog
      // теперь биндит List напрямую на /items и сужает штатным
      // sap.ui.model.Filter (см. facade/DictionaryFacade.js#buildLocationFilters,
      // controller/mixin/LocationPicker.js) вместо отдельной производной ветки,
      // которую раньше вручную пересобирал getChildren/filterLevel.
      locationModel: {
        items: [], lookupMap: {}, currentParentId: "",
        selectedNodeId: "", breadcrumbLinks: [], breadcrumbCurrentText: ""
      },
      inspectedPersonModel: { items: [] },
      inspectorPersonModel: { items: [] },
      formModel: buildFormDefaults(),
      checksModel: { items: [] },
      barriersModel: { items: [] },
      // [SSOT] Единственный держатель констрейнтов (maxLength/формат даты-
      // времени) — фрагменты биндятся сюда вместо хардкода литералов, см.
      // EntityConfig.CONSTRAINTS.
      constraintsModel: EntityConfig.CONSTRAINTS,
      // [Fix "не изобретать велосипед", аудит] displayItems убран — DictValueHelp
      // теперь биндит List напрямую на dictionaryModel (см. DictionaryValueHelp.js
      // #_bindVhList) вместо отдельного плоского массива "заголовок+элементы",
      // который раньше вручную строил buildDisplayItems. categoryCounts — то,
      // чем реально пользуется groupHeaderFactory (числа в заголовках групп).
      vhModel: { dictType: "", dialogTitle: "", categoryCounts: {}, targetType: "", rowIndex: -1 },
      // [Поэтапный ввод] currentStep — какой экран NavContainer сейчас виден
      // (см. Main.controller.js#_goToStep/_onProgressNavStepChanged);
      // totalSteps — [Fix SSOT, аудит] то же WizardSteps.TOTAL_STEPS, что
      // задаёт WizardProgressNavigator в onInit, а не отдельный литерал "6" в
      // Main.view.xml. Оба поля переживают _resetForm (setData этим же
      // объектом) — сброс формы не должен занулять totalSteps.
      wizardModel: { currentStep: 1, totalSteps: WizardSteps.TOTAL_STEPS }
    };
  }

  class ModelsInit {
    /** @returns {Object<string, sap.ui.model.json.JSONModel>} named models for Component#setModel. */
    static createAll() {
      const oDefaults = buildDataDefaults();
      const oModels = {};
      Object.keys(oDefaults).forEach((sKey) => {
        oModels[sKey] = new JSONModel(oDefaults[sKey]);
      });
      return oModels;
    }

    /**
     * Default (blank) data for a single named model — used to reset an
     * existing model in place (setData) without allocating unused JSONModel
     * instances for models that aren't being reset.
     * @param {string} sModelName
     * @returns {object}
     */
    static dataFor(sModelName) {
      return buildDataDefaults()[sModelName];
    }

    /** @returns {object} a blank row shaped for checksModel/barriersModel (see EntityConfig.TYPES). */
    static emptyRow(sType) {
      const oCfg = EntityConfig.TYPES[sType];
      return {
        [oCfg.codeProp]: "",
        [oCfg.textProp]: "",
        Comment: "",
        Status: "",
        // [Поля несоответствия, по запросу] Имя ОДНО и то же у Checks и
        // Barriers (как Comment/Status выше) — в отличие от codeProp/
        // textProp, тип строки эти два поля не различает, поэтому не часть
        // EntityConfig.TYPES. Активны (enabled) только когда Status —
        // BusinessRules.isUnsatisfactoryResult (см. ChecksTable/
        // BarriersTable.fragment.xml), но существуют на строке всегда —
        // не зависит от того, когда именно пользователь выберет результат.
        NonConformityDescription: "",
        NonConformityLocation: ""
      };
    }
  }

  return ModelsInit;
});
