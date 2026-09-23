sap.ui.define([
  "sap/ui/core/ValueState",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/facade/PersonSearchFacade",
  "sap/pc_lite/lite/util/SearchText"
], (ValueState, EntityConfig, PersonSearchFacade, SearchText) => {
  "use strict";

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт поиск проверяемого/проверяющего
  // (Persons) по частичному ФИО и выбор из suggestionItems.
  return {

    // [Fix] Fullname у Input — свободный two-way текст; выбор из suggestionItems
    // (_onPersonSelected) — единственное место, где Pernr пишется вместе с
    // Fullname. Сброс Pernr на каждый keystroke гарантирует: Pernr непуст
    // только сразу после реального выбора из справочника (PernrRule в redux).
    onPersonLiveChange (oEvent) {
      const oInput = oEvent.getSource();
      const sVal = oEvent.getParameter("newValue") || oEvent.getParameter("value") || "";
      const sRole = oInput.data("role") || "inspected";
      // [Fix OCP, аудит] EntityConfig.ROLES вместо хардкодных тернарников по sRole.
      const oRoleCfg = EntityConfig.ROLES[sRole] || EntityConfig.ROLES.inspected;
      const oModel = this.getView().getModel(oRoleCfg.model);
      const oForm = this.getView().getModel("formModel");

      oForm.setProperty(`/${oRoleCfg.prefix}Pernr`, "");
      // [Fix SF-08] "Не найдено"/"Ошибка поиска" прошлого запроса снимается сразу.
      this._setPersonSearchState(oInput, ValueState.None, "");

      const sCheckDate = oForm.getProperty("/CheckDate");
      // [Fix РЕАЛЬНЫЙ БАГ, аудит] aItems === null — "этот ответ устарел, более
      // новый поиск уже в процессе" (см. PersonSearchFacade.search) — не пишем
      // его в модель и не показываем состояние по нему.
      PersonSearchFacade.search(this.getView().getModel(), sVal, sCheckDate, sRole)
        .then((aItems) => {
          if (!aItems) { return; }
          oModel.setProperty("/items", aItems);
          if (!aItems.length && PersonSearchFacade.isQueryLongEnough(sVal)) {
            this._setPersonSearchState(oInput, ValueState.Information, this.getResourceBundle().getText("msgPersonNotFound"));
          }
        })
        .catch(() => {
          oModel.setProperty("/items", []);
          this._setPersonSearchState(oInput, ValueState.Error, this.getResourceBundle().getText("msgPersonSearchFailed"));
        });
    },

    // [Fix UX-05, аудит] Ушли с поля, не выбрав подсказку: если среди уже
    // показанных подсказок ровно одна с тем же (нормализованным) ФИО — выбираем
    // её сами; иначе явно просим выбрать из списка (Pernr обязателен).
    onPersonChange (oEvent) {
      const oInput = oEvent.getSource();
      const oRoleCfg = EntityConfig.ROLES[oInput.data("role")] || EntityConfig.ROLES.inspected;
      const oForm = this.getView().getModel("formModel");
      const sNorm = SearchText.normalize(oInput.getValue());
      if (!sNorm || oForm.getProperty(`/${oRoleCfg.prefix}Pernr`)) { return; }

      const aExact = (this.getView().getModel(oRoleCfg.model).getProperty("/items") || [])
        .filter((p) => SearchText.normalize(p.Fullname) === sNorm);
      if (aExact.length === 1) {
        this._applyPerson(oRoleCfg.prefix, aExact[0].Pernr, aExact[0].Fullname);
        this._setPersonSearchState(oInput, ValueState.None, "");
      } else if (oInput.getValueState() === ValueState.None) {
        this._setPersonSearchState(oInput, ValueState.Warning, this.getResourceBundle().getText("msgPersonPickFromList"));
      }
    },

    onInspectedSelected (oEvent) {
      this._onPersonSelected(oEvent, "Inspected");
    },
    onInspectorSelected (oEvent) {
      this._onPersonSelected(oEvent, "Inspector");
    },

    _onPersonSelected (oEvent, sPrefix) {
      const oItem = oEvent.getParameter("selectedItem");
      if (!oItem) { return; }
      this._applyPerson(sPrefix, oItem.getKey(), oItem.getText());
      this._setPersonSearchState(oEvent.getSource(), ValueState.None, "");
    },

    // [Fix FN-06, аудит] В Fullname — ЧИСТОЕ ФИО, без "(Pernr)": оно уходит как
    // ObservedFullname/ObserverFullname (MaxLength=100), а табельный номер и
    // так показан отдельной строкой под полем (StepPeople.fragment.xml).
    _applyPerson (sPrefix, sPernr, sFullname) {
      const oF = this.getView().getModel("formModel");
      oF.setProperty(`/${sPrefix}Pernr`, sPernr);
      oF.setProperty(`/${sPrefix}Fullname`, sFullname);
    },

    _setPersonSearchState (oInput, sState, sText) {
      if (!oInput) { return; }
      oInput.setValueState(sState);
      oInput.setValueStateText(sText);
    }

  };
});
