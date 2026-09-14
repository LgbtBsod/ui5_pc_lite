sap.ui.define([
  "sap/pc_lite/lite/facade/DictionaryFacade"
], (DictionaryFacade) => {
  "use strict";

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт диалог выбора расположения
  // (LocationDialog.fragment.xml): drill-down по иерархии, поиск на уровне,
  // хлебные крошки, выбор узла. Чистая реорганизация, без изменения
  // поведения.
  //
  // [Fix "не изобретать велосипед", аудит] Список раньше держал ОТДЕЛЬНУЮ
  // производную ветку locationModel>/levelItems — DictionaryFacade.getChildren
  // (фильтр по ParentNodeID) + filterLevel (фильтр по тексту поиска)
  // пересобирали её вручную в JS на каждый клик "вглубь"/каждую букву в
  // поиске. Список (см. LocationDialog.fragment.xml) биндится ПРЯМО на
  // locationModel>/items (тот же плоский массив, что грузится один раз) —
  // сужается штатным sap.ui.model.Filter через ListBinding#filter(),
  // levelItems/getChildren/filterLevel не нужны и удалены.
  return {

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Тот же приём, что уже применяет PersonSearch.js#
    // onPersonLiveChange для ФИО/Pernr — formModel>/LocationText остаётся
    // обычным двусторонним Input (не valueHelpOnly), значит пользователь
    // физически может отредактировать текст руками ПОСЛЕ выбора из диалога.
    // Без сброса LocationUUID/LocationPath здесь payload уходил бы с валидным
    // UUID, указывающим на СОВСЕМ ДРУГОЕ место, чем то, что реально написано
    // в LocationText — рассинхрон, у которого нет шанса быть замеченным
    // (FormValidator проверяет только "UUID не пуст", не его соответствие
    // тексту). Сброс на каждый keystroke гарантирует: LocationUUID непуст
    // только сразу после реального выбора из диалога, как и Pernr для ФИО.
    onLocationTextLiveChange () {
      const oF = this.getView().getModel("formModel");
      oF.setProperty("/LocationUUID", "");
      oF.setProperty("/LocationPath", "");
    },

    onLocationValueHelp () {
      this._getDialog("locationDialog", "sap.pc_lite.lite.fragment.LocationDialog").then((oDlg) => {
        oDlg.open();

        const oLocModel = this.getView().getModel("locationModel");
        const sSelectedId = this.getView().getModel("formModel").getProperty("/LocationUUID");
        const oLookupMap = oLocModel.getProperty("/lookupMap") || {};
        const sParentId = (sSelectedId && oLookupMap[sSelectedId]) ? oLookupMap[sSelectedId].parentId : "";

        this._navigateLocationLevel(sParentId);
        oLocModel.setProperty("/selectedNodeId", sSelectedId || "");
      });
    },

    _navigateLocationLevel (sParentId) {
      const oLocModel = this.getView().getModel("locationModel");
      const oLookupMap = oLocModel.getProperty("/lookupMap") || {};

      oLocModel.setProperty("/currentParentId", sParentId);
      oLocModel.setProperty("/selectedNodeId", "");
      this.byId("locationList").getBinding("items").filter(DictionaryFacade.buildLocationFilters(sParentId, ""));

      const aCrumbs = [
        { NodeID: "", NodeText: this.getResourceBundle().getText("lblLocationRoot") },
        ...(sParentId ? DictionaryFacade.getBreadcrumbPath(sParentId, oLookupMap) : [])
      ];
      oLocModel.setProperty("/breadcrumbLinks", aCrumbs.slice(0, -1));
      oLocModel.setProperty("/breadcrumbCurrentText", aCrumbs[aCrumbs.length - 1].NodeText);

      const oSearch = this.byId("locSearch");
      if (oSearch) { oSearch.setValue(""); }
    },

    onLocSearch (oEvent) {
      const q = oEvent.getParameter("newValue") || "";
      const sParentId = this.getView().getModel("locationModel").getProperty("/currentParentId");
      this.byId("locationList").getBinding("items").filter(DictionaryFacade.buildLocationFilters(sParentId, q));
    },

    onLocationRowSelect (oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("locationModel");
      this.getView().getModel("locationModel").setProperty("/selectedNodeId", oCtx.getProperty("NodeID"));
    },

    onLocationRowNavigate (oEvent) {
      const oCtx = oEvent.getSource().getBindingContext("locationModel");
      this._navigateLocationLevel(oCtx.getProperty("NodeID"));
    },

    onBreadcrumbPress (oEvent) {
      const sNodeId = oEvent.getSource().data("nodeId") || "";
      this._navigateLocationLevel(sNodeId);
    },

    onLocationChooseCurrentLevel () {
      const oLocModel = this.getView().getModel("locationModel");
      const sNodeId = oLocModel.getProperty("/selectedNodeId");
      if (!sNodeId) { return; }
      const oLookupMap = oLocModel.getProperty("/lookupMap") || {};
      this._selectLocation(sNodeId, (oLookupMap[sNodeId] || {}).name || "");
    },

    // [Fix YAGNI/Perf] LocationPath вычисляется здесь лениво, только для
    // выбранного узла (DictionaryFacade.getPath) — вместо чтения из
    // предвычисленной на загрузке карты путей по ВСЕМ узлам иерархии.
    _selectLocation (sNodeId, sNodeText) {
      const oLocModel = this.getView().getModel("locationModel");
      const oLookupMap = oLocModel.getProperty("/lookupMap") || {};
      const oF = this.getView().getModel("formModel");
      oF.setProperty("/LocationUUID", sNodeId);
      oF.setProperty("/LocationText", sNodeText);
      oF.setProperty("/LocationPath", DictionaryFacade.getPath(sNodeId, oLookupMap));
      this.byId("locationDialog").close();
    },

    onCloseLocationDialog () {
      this.byId("locationDialog").close();
    }

  };
});
