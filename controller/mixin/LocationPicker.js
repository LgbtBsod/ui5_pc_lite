sap.ui.define([
  "sap/ui/Device",
  "sap/ui/core/ValueState",
  "sap/m/MessageToast",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/facade/DictionaryFacade",
  "sap/pc_lite/lite/facade/PersonSearchFacade"
], (Device, ValueState, MessageToast, EntityConfig, DictionaryFacade, PersonSearchFacade) => {
  "use strict";

  // [Fix PF-05] Поиск в диалоге фильтрует/перерисовывает список — не на
  // каждую букву, а после короткой паузы (пустой запрос — сразу).
  const LOC_SEARCH_DEBOUNCE_MS = 200;

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт диалог выбора расположения
  // (LocationDialog.fragment.xml): drill-down по иерархии, поиск,
  // хлебные крошки, выбор узла, а также реакция шага 1 на смену даты/времени
  // проверки (дата определяет действующую версию иерархии).
  //
  // [Fix "не изобретать велосипед", аудит] Список биндится ПРЯМО на
  // locationModel>/items (плоский массив иерархии) и сужается штатным
  // sap.ui.model.Filter через ListBinding#filter().
  return {

    onLocationValueHelp () {
      this._getDialog("locationDialog", "sap.pc_lite.lite.fragment.LocationDialog").then((oDlg) => {
        // [Fix VH-16] На телефоне — во весь экран, как SelectDialog value-help.
        oDlg.setStretch(Device.system.phone);
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

      // Отложенный поиск не должен сработать ПОСЛЕ перехода и вернуть старый запрос.
      this._clearLocSearchTimer();
      oLocModel.setProperty("/currentParentId", sParentId);
      oLocModel.setProperty("/selectedNodeId", "");
      // [Поиск по всей иерархии, по запросу] Переход по уровню (клик по
      // папке, хлебной крошке или открытие диалога) всегда выходит из
      // режима поиска — навигация по дереву и глобальный поиск не смешиваются
      // в рамках одного действия, см. buildLocationFilters.
      oLocModel.setProperty("/searchQuery", "");
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

    // [Fix SF-02/PF-05] Запрос обрезается (одни пробелы = обычная навигация по
    // уровню), фильтр применяется с задержкой LOC_SEARCH_DEBOUNCE_MS.
    onLocSearch (oEvent) {
      const q = (oEvent.getParameter("newValue") || "").trim();
      this._clearLocSearchTimer();
      if (!q) {
        this._applyLocSearch("");
        return;
      }
      this._iLocSearchTimer = setTimeout(() => {
        this._iLocSearchTimer = null;
        this._applyLocSearch(q);
      }, LOC_SEARCH_DEBOUNCE_MS);
    },

    _applyLocSearch (q) {
      const oLocModel = this.getView().getModel("locationModel");
      const oList = this.byId("locationList");
      if (!oLocModel || !oList) { return; }
      const bWasSearching = !!oLocModel.getProperty("/searchQuery");
      const sSelectedId = oLocModel.getProperty("/selectedNodeId");
      const oLookupMap = oLocModel.getProperty("/lookupMap") || {};

      // [Fix SF-09, аудит] Поиск очищен, а выбранный в результатах узел лежит
      // на другом уровне: переходим к его уровню, чтобы выбор (и кнопка
      // "Выбрать") не остались невидимыми.
      if (!q && bWasSearching && sSelectedId && oLookupMap[sSelectedId]) {
        this._navigateLocationLevel(oLookupMap[sSelectedId].parentId);
        oLocModel.setProperty("/selectedNodeId", sSelectedId);
        return;
      }
      // [Поиск по всей иерархии, по запросу] searchQuery в модель — индикатор
      // "поиск активен" (путь под найденными строками, текст пустого списка).
      oLocModel.setProperty("/searchQuery", q);
      oList.getBinding("items").filter(DictionaryFacade.buildLocationFilters(oLocModel.getProperty("/currentParentId"), q));
    },

    _clearLocSearchTimer () {
      if (this._iLocSearchTimer) {
        clearTimeout(this._iLocSearchTimer);
        this._iLocSearchTimer = null;
      }
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
    // выбранного узла (DictionaryFacade.getPath).
    _selectLocation (sNodeId, sNodeText) {
      const oLocModel = this.getView().getModel("locationModel");
      const oLookupMap = oLocModel.getProperty("/lookupMap") || {};
      const oF = this.getView().getModel("formModel");
      this._clearLocSearchTimer();
      oF.setProperty("/LocationUUID", sNodeId);
      oF.setProperty("/LocationText", sNodeText);
      oF.setProperty("/LocationPath", DictionaryFacade.getPath(sNodeId, oLookupMap));
      this.byId("locationDialog").close();
    },

    onCloseLocationDialog () {
      this._clearLocSearchTimer();
      this.byId("locationDialog").close();
    },

    // ===== Дата/время проверки (StepWhenWhere.fragment.xml) =====

    // [Fix FN-03/SF-06, аудит] Нераспознанная дата раньше молча уходила в
    // модель ("31.02.2026"), отключая фильтры по дате и давая Date:null в
    // payload. Теперь: Error на поле + пустое значение в модели, так что
    // обязательное поле не пропустит шаг. [Fix FN-11/SF-04] Новая валидная
    // дата — перечитать иерархию и перепроверить выбранное на эту дату.
    onCheckDateChange (oEvent) {
      const oPicker = oEvent.getSource();
      const oForm = this.getView().getModel("formModel");
      if (oEvent.getParameter("valid") === false) {
        this._setPickerState(oPicker, ValueState.Error, this.getResourceBundle().getText("msgCheckDateInvalid"));
        oForm.setProperty("/CheckDate", "");
        return;
      }
      this._setPickerState(oPicker, ValueState.None, "");
      const sDate = oForm.getProperty("/CheckDate");
      if (sDate) {
        this._reloadForCheckDate(sDate);
      }
    },

    onCheckTimeChange (oEvent) {
      const oPicker = oEvent.getSource();
      if (oEvent.getParameter("valid") === false) {
        this._setPickerState(oPicker, ValueState.Error, this.getResourceBundle().getText("msgCheckTimeInvalid"));
        this.getView().getModel("formModel").setProperty("/CheckTime", "");
        return;
      }
      this._setPickerState(oPicker, ValueState.None, "");
    },

    _setPickerState (oPicker, sState, sText) {
      oPicker.setValueState(sState);
      oPicker.setValueStateText(sText);
    },

    /**
     * Приводит данные, зависящие от даты проверки, к дате sDate: иерархия
     * местоположений (только она, не все справочники), выбранное
     * местоположение, подсказки и выбранные сотрудники.
     */
    _reloadForCheckDate (sDate) {
      const oView = this.getView();
      const oForm = oView.getModel("formModel");
      const oLocModel = oView.getModel("locationModel");
      const sLocUuid = oForm.getProperty("/LocationUUID");
      const oOldNode = (oLocModel.getProperty("/items") || []).find((n) => n.NodeID === sLocUuid);
      const sLocCode = oOldNode ? oOldNode.NodeCode : "";

      // Подсказки прошлой даты могли включать уже неактивных сотрудников.
      Object.keys(EntityConfig.ROLES).forEach((sRole) => {
        oView.getModel(EntityConfig.ROLES[sRole].model).setProperty("/items", []);
      });

      this._setLocationBusy(1);
      DictionaryFacade.loadLocations(oView.getModel(), oLocModel, sDate).then((bApplied) => {
        this._setLocationBusy(-1);
        if (bApplied && this._isViewAlive() && oForm.getProperty("/CheckDate") === sDate) {
          this._revalidateLocation(sLocUuid, sLocCode);
        }
      }).catch(() => {
        this._setLocationBusy(-1);
        if (this._isViewAlive()) {
          MessageToast.show(this.getResourceBundle().getText("msgLocReloadFailed"));
        }
      });

      this._revalidatePersons(sDate);
    },

    // Узел не действует на новую дату: та же площадка (LocationCode) в
    // действующей версии — подставляем её, иначе сбрасываем выбор.
    _revalidateLocation (sLocUuid, sLocCode) {
      const oForm = this.getView().getModel("formModel");
      const oLocModel = this.getView().getModel("locationModel");
      if (!sLocUuid || oForm.getProperty("/LocationUUID") !== sLocUuid) { return; }
      const oLookupMap = oLocModel.getProperty("/lookupMap") || {};
      const rb = this.getResourceBundle();

      if (oLookupMap[sLocUuid]) {
        const sPath = DictionaryFacade.getPath(sLocUuid, oLookupMap);
        if (oForm.getProperty("/LocationPath") !== sPath) { oForm.setProperty("/LocationPath", sPath); }
        return;
      }
      const oSame = sLocCode && (oLocModel.getProperty("/items") || []).find((n) => n.NodeCode === sLocCode);
      if (oSame) {
        oForm.setProperty("/LocationUUID", oSame.NodeID);
        oForm.setProperty("/LocationText", oSame.NodeText);
        oForm.setProperty("/LocationPath", DictionaryFacade.getPath(oSame.NodeID, oLookupMap));
        MessageToast.show(rb.getText("msgLocationRemapped"));
      } else {
        oForm.setProperty("/LocationUUID", "");
        oForm.setProperty("/LocationText", "");
        oForm.setProperty("/LocationPath", "");
        MessageToast.show(rb.getText("msgLocationNotActiveOnDate"));
      }
    },

    // Выбранный сотрудник, не активный на новую дату, сбрасывается (Pernr
    // обязателен — шаг "Участники" попросит выбрать заново). null от фасада
    // (сеть/сервер недоступны) — выбор не трогаем.
    _revalidatePersons (sDate) {
      const oView = this.getView();
      const oForm = oView.getModel("formModel");
      Object.keys(EntityConfig.ROLES).forEach((sRole) => {
        const sPrefix = EntityConfig.ROLES[sRole].prefix;
        const sPernr = oForm.getProperty(`/${sPrefix}Pernr`);
        if (!sPernr) { return; }
        PersonSearchFacade.isPersonActiveOn(oView.getModel(), sPernr, sDate).then((bActive) => {
          if (bActive !== false || !this._isViewAlive() ||
              oForm.getProperty("/CheckDate") !== sDate || oForm.getProperty(`/${sPrefix}Pernr`) !== sPernr) { return; }
          oForm.setProperty(`/${sPrefix}Pernr`, "");
          oForm.setProperty(`/${sPrefix}Fullname`, "");
          const rb = this.getResourceBundle();
          MessageToast.show(rb.getText("msgPersonNotActiveOnDate", [rb.getText(`lbl${sPrefix}`)]));
        });
      });
    },

    _setLocationBusy (iDelta) {
      this._iLocReloadPending = Math.max(0, (this._iLocReloadPending || 0) + iDelta);
      const oInput = this._isViewAlive() && this.byId("locationInput");
      if (oInput) { oInput.setBusy(this._iLocReloadPending > 0); }
    },

    // Ответы сети могут прийти после ухода с плитки (_bDestroyed ставит
    // Main.controller.js#onExit; bIsDestroyed — на случай иного порядка).
    _isViewAlive () {
      const oView = this.getView();
      return !this._bDestroyed && !!oView && !oView.bIsDestroyed;
    }

  };
});
