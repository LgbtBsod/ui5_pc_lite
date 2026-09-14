sap.ui.define([
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/facade/PersonSearchFacade"
], (EntityConfig, PersonSearchFacade) => {
  "use strict";

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт поиск проверяемого/проверяющего
  // (Persons) по частичному ФИО и выбор из suggestionItems. Чистая
  // реорганизация, без изменения поведения.
  return {

    // [Fix] Fullname у Input — свободный two-way текст; выбор из suggestionItems
    // (_onPersonSelected) — единственное место, где Pernr пишется вместе с
    // Fullname. Без сброса здесь правка текста ПОСЛЕ ранее сделанного выбора
    // оставляла бы старый Pernr рядом с новым, не подтверждённым текстом —
    // Submit.js#_validateBeforeSubmit не поймал бы рассинхрон (Pernr ведь не
    // пустой). Сброс на каждый keystroke гарантирует: Pernr непуст только
    // сразу после реального выбора из справочника (тот же принцип, что
    // PernrRule в redux).
    onPersonLiveChange (oEvent) {
      const sVal = oEvent.getParameter("newValue") || oEvent.getParameter("value") || "";
      const sRole = oEvent.getSource().data("role") || "inspected";
      // [Fix OCP, аудит] EntityConfig.ROLES вместо пары хардкодных тернарников
      // по sRole — та же карта-как-точка-расширения, что уже используется для
      // Checks/Barriers (EntityConfig.TYPES).
      const oRoleCfg = EntityConfig.ROLES[sRole] || EntityConfig.ROLES.inspected;
      const oModel = this.getView().getModel(oRoleCfg.model);

      this.getView().getModel("formModel").setProperty(`/${oRoleCfg.prefix}Pernr`, "");

      const sCheckDate = this.getView().getModel("formModel").getProperty("/CheckDate");
      // [Fix РЕАЛЬНЫЙ БАГ, аудит] aItems === null — не "результатов нет", а
      // "этот ответ устарел, более новый поиск уже в процессе" (см.
      // PersonSearchFacade.js#_read — резолвится null именно в этом случае).
      // Игнорируем такой ответ целиком, а не пишем null в модель (список
      // suggestionItems ожидает массив) и не затираем им уже более
      // актуальные подсказки, применённые более новым, быстрее ответившим
      // запросом.
      PersonSearchFacade.search(this.getView().getModel(), sVal, sCheckDate, sRole)
        .then((aItems) => { if (aItems) { oModel.setProperty("/items", aItems); } });
    },

    onInspectedSelected (oEvent) {
      this._onPersonSelected(oEvent, "Inspected");
    },
    onInspectorSelected (oEvent) {
      this._onPersonSelected(oEvent, "Inspector");
    },
    // [MIGRATION_MAPPING.md, OPEN-3 — решено, вырезано] Persons (redux) не
    // несёт OrgAssignment/Position — эти поля убраны из формы и модели
    // целиком, а не оставлены пустыми "на будущее".
    _onPersonSelected (oEvent, sPrefix) {
      const oItem = oEvent.getParameter("selectedItem");
      if (!oItem) { return; }
      const sPernr = oItem.getKey();
      const sFullname = oItem.getText();
      const oF = this.getView().getModel("formModel");
      oF.setProperty(`/${sPrefix}Pernr`, sPernr);
      oF.setProperty(`/${sPrefix}Fullname`, `${sFullname} (${sPernr})`);
    }

  };
});
