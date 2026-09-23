sap.ui.define([
  "sap/ui/core/Item",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/base/Log",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/model/ModelsInit",
  "sap/pc_lite/lite/model/BusinessRules",
  "sap/pc_lite/lite/model/FormValidator",
  "sap/pc_lite/lite/facade/DictionaryFacade",
  "sap/pc_lite/lite/util/Plural"
], (Item, MessageBox, MessageToast, Log, EntityConfig, ModelsInit, BusinessRules, FormValidator, DictionaryFacade, Plural) => {
  "use strict";

  const LOG_COMPONENT = "sap.pc_lite.lite.controller.mixin.RowsAndAutoFill";
  // [Fix SF-11] Пропущенные правила AutoRowRules логируются один раз, не на каждую смену КПР.
  const oLoggedSkippedRules = new Set();

  // [Fix FN-04/SF-01] ЕДИНЫЙ чистый предикат "строка остаётся на уровне sPkLevel" —
  // им пользуются и пробный прогон (подтверждение), и реальная чистка.
  // Секционное правило (sectionGate) авторитетно: запрещённая секция очищается
  // целиком, иначе строка на скрытом шаге ушла бы в сабмит невидимой.
  function isRowKeptAtPk (oCfg, oRow, sPkLevel, oDictModel) {
    if (oCfg.sectionGate && !oCfg.sectionGate(sPkLevel)) { return false; }
    const sCode = oRow[oCfg.codeProp];
    return !sCode || DictionaryFacade.isCodeAvailableForPk(oDictModel, oCfg.dictType, sCode, sPkLevel);
  }

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт всё вокруг строк Checks/Barriers:
  // ручное добавление/удаление, авто-добавление по уровню КПР, чистка строк,
  // ставших недоступными при смене уровня, и счётчик в footer. Чистая
  // реорганизация, без изменения поведения.
  return {

    onAddCheckRow () { this._addRow("Checks"); },
    onAddBarrierRow () { this._addRow("Barriers"); },
    onChecksDelete (oEvent) { this._deleteRow("Checks", oEvent.getParameter("listItem")); },
    onBarriersDelete (oEvent) { this._deleteRow("Barriers", oEvent.getParameter("listItem")); },

    // [Fix, аудит] Спред вместо slice()+push/splice — тот же приём, что уже
    // используется в этом файле (_navigateLocationLevel в LocationPicker.js,
    // сборка breadcrumbs), а не третий отдельный идиом на самые часто
    // дёргаемые пользователем пути (каждый тап "Добавить"/смахивание
    // "Удалить").
    _addRow (sType) {
      const oCfg = EntityConfig.TYPES[sType];
      const oM = this.getView().getModel(oCfg.model);
      oM.setProperty("/items", [...oM.getProperty("/items"), ModelsInit.emptyRow(sType)]);
      this._updateFooterCount();
    },

    // [Fix UX-03] Строку с данными пользователя (комментарий, результат, поля
    // несоответствия) — только после подтверждения (фокус на "Отмена");
    // пустую или авто-строку с одним кодом — одним тапом, как раньше.
    _deleteRow (sType, oListItem) {
      if (!oListItem) { return; }
      const oCfg = EntityConfig.TYPES[sType];
      const oTable = this.byId(oCfg.tableId);
      const iIdx = oTable.indexOfItem(oListItem);
      if (iIdx < 0) { return; }

      const oM = this.getView().getModel(oCfg.model);
      const oRow = (oM.getProperty("/items") || [])[iIdx];
      // Удаляем по ссылке на строку, а не по индексу: пока открыт диалог, индекс мог устареть.
      const fnDelete = () => {
        const a = oM.getProperty("/items") || [];
        const i = a.indexOf(oRow);
        if (i < 0) { return; }
        oM.setProperty("/items", [...a.slice(0, i), ...a.slice(i + 1)]);
        // Подсветка ошибок привязана к индексам строк — после сдвига она указывала бы на чужую строку.
        FormValidator.clearMessages(oM);
        this._updateFooterCount();
      };

      if (!BusinessRules.hasRowUserData(oRow)) {
        fnDelete();
        return;
      }
      MessageBox.confirm(this.getResourceBundle().getText("msgConfirmDeleteRow"), {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        initialFocus: MessageBox.Action.CANCEL,
        onClose: (sAction) => {
          if (sAction === MessageBox.Action.OK && !this._bDestroyed) { fnDelete(); }
        }
      });
    },

    // [Fix OCP, аудит] Раньше здесь были захардкожены буквально "Checks"/
    // "Barriers" (имена моделей и i18n-ключи footerCountChecks/
    // footerCountBarriers инлайн) — единственное место в этом файле, не
    // читавшее EntityConfig.TYPES дженерик, хотя все соседние методы уже так
    // делают (см. комментарий у footerCountKey в EntityConfig.js). Гипотетический
    // третий тип строк, заведённый только через generic-методы, раньше молча
    // не попал бы в счётчик footer вообще — теперь попадёт автоматически.
    _updateFooterCount () {
      const rb = this.getResourceBundle();
      const oView = this.getView();

      const aParts = Object.keys(EntityConfig.TYPES).reduce((aAcc, sType) => {
        const oCfg = EntityConfig.TYPES[sType];
        // [Fix FN-05] Только строки с кодом — ровно то, что уйдёт в payload.
        const iCount = BusinessRules.countCodedRows(oView.getModel(oCfg.model).getProperty("/items"), oCfg.codeProp);
        // [Fix UX-15] "1 проверка / 3 проверки / 5 проверок", а не "1 проверок".
        if (iCount > 0) { aAcc.push(Plural.getText(rb, oCfg.footerCountKey, iCount)); }
        return aAcc;
      }, []);
      const sText = aParts.join(" · ");

      // [Fix Dead Code, по запросу] Раньше здесь же писалось ещё и
      // wizardModel>/countsSummary — для отдельного <Text> на шаге "Отправка",
      // дублировавшего то же самое под карточкой сводки. Количество проверок/
      // барьеров теперь строки ВНУТРИ самой сводки (checksModel>/items.length/
      // barriersModel>/items.length напрямую в Main.view.xml), второй,
      // отдельно считаемый текст для того же экрана стал не нужен.
      const oStatus = oView.byId("footerStatus");
      if (oStatus) {
        oStatus.setVisible(aParts.length > 0);
        oStatus.setText(sText);
      }
    },

    // [Fix FN-04/WZ-03/UX-02/SF-01] Смена уровня КПР (Select.change). Раньше
    // строки удалялись СРАЗУ, а MessageBox.warning лишь сообщал о потере. Теперь:
    // пробный прогон чистки; если что-то удалится — confirm (фокус на "Отмена");
    // "Отмена" возвращает прежний уровень. Порядок применения: чистка, затем
    // авто-строки нового уровня. this._sPrevPkLevel — последний принятый уровень.
    onPkLevelChange () {
      const oFormModel = this.getView().getModel("formModel");
      const sPkLevel = oFormModel.getProperty("/PkLevel") || "";
      const sPrev = this._sPrevPkLevel || "";
      // Пустой выбор — переходное состояние, не повод что-либо чистить.
      if (!sPkLevel || sPkLevel === sPrev) { return; }

      const iToRemove = this._computePurge(sPkLevel).reduce((iSum, oPlan) => iSum + oPlan.iRemoved, 0);
      if (iToRemove === 0) {
        this._commitPkLevel(sPkLevel);
        return;
      }

      MessageBox.confirm(this.getResourceBundle().getText("msgConfirmPkChangePurge", [iToRemove]), {
        actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
        // 1.71: emphasizedAction нет (он с 1.75) — безопасный выбор через initialFocus.
        initialFocus: MessageBox.Action.CANCEL,
        onClose: (sAction) => {
          if (this._bDestroyed) { return; }
          if (sAction !== MessageBox.Action.OK) {
            // Программная запись не вызывает Select.change — повторного цикла нет.
            oFormModel.setProperty("/PkLevel", sPrev);
          } else if (oFormModel.getProperty("/PkLevel") === sPkLevel) {
            this._commitPkLevel(sPkLevel);
          }
        }
      });
    },

    // Применяет принятый уровень: чистка (тот же предикат, что и пробный
    // прогон, пересчитан на момент применения), авто-строки, один сигнал.
    _commitPkLevel (sPkLevel) {
      const rb = this.getResourceBundle();
      const iRemoved = this._computePurge(sPkLevel).reduce((iSum, oPlan) => {
        if (oPlan.iRemoved > 0) {
          oPlan.oModel.setProperty("/items", oPlan.aKept);
          FormValidator.clearMessages(oPlan.oModel);
        }
        return iSum + oPlan.iRemoved;
      }, 0);
      const iAdded = this._applyAutoRows(sPkLevel);
      this._sPrevPkLevel = sPkLevel;
      this._updateFooterCount();

      // Удаление уже подтверждено в диалоге — здесь только короткий итог.
      const aMsg = [];
      if (iRemoved > 0) { aMsg.push(rb.getText("msgRowsPurgedOnPkChange", [iRemoved])); }
      if (iAdded > 0) { aMsg.push(rb.getText("msgRowsAutoAdded", [iAdded])); }
      if (!aMsg.length) {
        aMsg.push(BusinessRules.isBarriersAllowed(sPkLevel) ? rb.getText("hintPkIi") : rb.getText("hintPkI"));
      }
      MessageToast.show(aMsg.join(" "));
    },

    /**
     * Пробный прогон чистки для всех типов строк (EntityConfig.TYPES) — без записи в модели.
     * @returns {{oModel: sap.ui.model.json.JSONModel, aKept: object[], iRemoved: number}[]}
     */
    _computePurge (sPkLevel) {
      const oView = this.getView();
      const oDictModel = oView.getModel("dictionaryModel");
      return Object.keys(EntityConfig.TYPES).map((sType) => {
        const oCfg = EntityConfig.TYPES[sType];
        const oModel = oView.getModel(oCfg.model);
        const aItems = oModel.getProperty("/items") || [];
        const aKept = aItems.filter((r) => isRowKeptAtPk(oCfg, r, sPkLevel, oDictModel));
        return { oModel, aKept, iRemoved: aItems.length - aKept.length };
      });
    },

    // [Механизм авто-добавления строк по КПР] Правила — целиком в данных
    // (AutoRowRules.json/DictionaryFacade.getAutoRowsForPk). Идемпотентно: код,
    // уже присутствующий в таблице, не дублируется.
    // [Fix SF-11] Правило с неизвестным кодом или кодом, недоступным на этом
    // уровне, пропускается (лог один раз) — иначе пустая/недопустимая строка
    // проходила валидацию. [Fix PF-06] Одна запись /items на модель, а не на
    // правило; footer обновляет вызывающий (_commitPkLevel).
    // @returns {number} количество реально добавленных строк.
    _applyAutoRows (sPkLevel) {
      const oView = this.getView();
      const oDictModel = oView.getModel("dictionaryModel");
      const mNewRows = {};

      DictionaryFacade.getAutoRowsForPk(oDictModel, sPkLevel).forEach((oRule) => {
        const oCfg = EntityConfig.TYPES[oRule.Type];
        if (!oCfg) { return; }
        if (oCfg.sectionGate && !oCfg.sectionGate(sPkLevel)) { return; }

        const sText = DictionaryFacade.resolveText(oDictModel, oCfg.dictType, oRule.Code);
        if (!sText || !DictionaryFacade.isCodeAvailableForPk(oDictModel, oCfg.dictType, oRule.Code, sPkLevel)) {
          const sRuleKey = `${sPkLevel}/${oRule.Type}/${oRule.Code}`;
          if (!oLoggedSkippedRules.has(sRuleKey)) {
            oLoggedSkippedRules.add(sRuleKey);
            Log.warning(`AutoRowRule skipped: ${oRule.Type}/${oRule.Code} unknown or not valid for PK ${sPkLevel}`, null, LOG_COMPONENT);
          }
          return;
        }

        const aQueued = mNewRows[oRule.Type] || (mNewRows[oRule.Type] = []);
        const aItems = oView.getModel(oCfg.model).getProperty("/items") || [];
        const fnSameCode = (r) => r[oCfg.codeProp] === oRule.Code;
        if (aItems.some(fnSameCode) || aQueued.some(fnSameCode)) { return; }

        const oRow = ModelsInit.emptyRow(oRule.Type);
        oRow[oCfg.codeProp] = oRule.Code;
        oRow[oCfg.textProp] = sText;
        aQueued.push(oRow);
      });

      return Object.keys(mNewRows).reduce((iAdded, sType) => {
        const aNew = mNewRows[sType];
        if (!aNew.length) { return iAdded; }
        const oM = oView.getModel(EntityConfig.TYPES[sType].model);
        oM.setProperty("/items", [...(oM.getProperty("/items") || []), ...aNew]);
        return iAdded + aNew.length;
      }, 0);
    },

    // [Fix Memory/Perf] Фабрика для items ComboBox'а "Результат" в
    // ChecksTable/BarriersTable.fragment.xml — этот ComboBox сам находится
    // внутри шаблона строки Table (шаблон в шаблоне); items+templateShareable
    // на вложенном биндинге не всегда переживает клонирование внешнего
    // ColumnListItem-шаблона в SAPUI5 1.71 ("template ... neither was marked
    // with templateShareable:true nor false" в консоли). Фабрика создаёт Item
    // заново на каждый вызов вместо клонирования общего шаблона — та же
    // забота о владении шаблоном, что и в DictionaryValueHelp.js#_bindVhList
    // (там — templateShareable:false на пересоздаваемом шаблоне верхнего
    // уровня, здесь — фабрика на вложенном), полностью убирает
    // двусмысленность вложенного клонирования.
    statusItemFactory (sId, oCtx) {
      return new Item(sId, {
        key: "{dictionaryModel>Code}",
        text: "{dictionaryModel>Text}"
      });
    }

  };
});
