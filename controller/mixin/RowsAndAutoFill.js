sap.ui.define([
  "sap/ui/core/Item",
  "sap/m/MessageBox",
  "sap/m/MessageToast",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/model/ModelsInit",
  "sap/pc_lite/lite/model/BusinessRules",
  "sap/pc_lite/lite/facade/DictionaryFacade"
], (Item, MessageBox, MessageToast, EntityConfig, ModelsInit, BusinessRules, DictionaryFacade) => {
  "use strict";

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

    _deleteRow (sType, oListItem) {
      if (!oListItem) { return; }
      const oCfg = EntityConfig.TYPES[sType];
      const oTable = this.byId(oCfg.tableId);
      const iIdx = oTable.indexOfItem(oListItem);
      if (iIdx < 0) { return; }

      const oM = this.getView().getModel(oCfg.model);
      const a = oM.getProperty("/items");
      oM.setProperty("/items", [...a.slice(0, iIdx), ...a.slice(iIdx + 1)]);
      this._updateFooterCount();
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
        const iCount = (oView.getModel(oCfg.model).getProperty("/items") || []).length;
        if (iCount > 0) { aAcc.push(rb.getText(oCfg.footerCountKey, [iCount])); }
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

    // [Fix UX — молчаливая потеря данных] Понижение уровня КПР может сделать
    // ранее введённые строки проверок/барьеров недоступными (см.
    // _purgeInvalidRows) — они удаляются из моделей БЕЗ какого-либо сигнала
    // пользователю, кроме нейтрального "барьеры скрыты/показаны" тоста.
    // Обнаружено бизнес-тестированием: пользователь, заполнивший 2-3 строки
    // на КПР-4 и затем поменявший уровень (случайно или намеренно), терял их
    // без предупреждения — реальный риск потери введённых данных. Теперь
    // случай "что-то реально удалено" явно приоритетнее нейтральной подсказки
    // о видимости раздела и показывается через MessageBox.warning (требует
    // подтверждения), а не мимолётный MessageToast.
    // [Fix UX] Авто-добавление строк идёт ПОСЛЕ purge (не до): при переходе,
    // например, с КПР-3 на КПР-2 сперва вычищаются коды, недоступные на
    // новом уровне, и только затем добавляются дефолтные для КПР-2 — иначе
    // порядок был бы противоположным (добавили дефолт, тут же снесли, если
    // бы он не подходил новому уровню, что для текущих правил не случится,
    // но не гарантировано для будущих mock-данных).
    // [Fix OCP, аудит] Раньше вызывалось `_purgeInvalidRows("Checks")` и
    // `_purgeInvalidRows("Barriers")` двумя отдельными хардкодными строками
    // — тот же класс проблемы, что и у _updateFooterCount выше: гипотетический
    // третий тип строк никогда не попал бы под purge, если его забыли
    // дописать сюда третьей строкой. Object.keys(EntityConfig.TYPES) —
    // единственный источник списка типов, уже используемый остальными
    // generic-методами этого файла.
    onPkLevelChange () {
      const rb = this.getResourceBundle();
      const sPkLevel = this.getView().getModel("formModel").getProperty("/PkLevel");
      const bAllowed = BusinessRules.isBarriersAllowed(sPkLevel);
      const iTotalRemoved = Object.keys(EntityConfig.TYPES)
        .reduce((iSum, sType) => iSum + this._purgeInvalidRows(sType), 0);
      const iAdded = this._applyAutoRows(sPkLevel);

      // [Fix UX] Один сигнал пользователю за смену уровня, не три подряд —
      // потеря данных (purge) остаётся приоритетной и идёт через
      // MessageBox.warning (требует подтверждения), авто-добавление
      // дописывается туда же вторым предложением, а не отдельным тостом.
      // Без purge — авто-добавление важнее нейтральной подсказки о
      // видимости барьеров, поэтому подменяет её, когда есть что показать.
      if (iTotalRemoved > 0) {
        const sMsg = iAdded > 0
          ? `${rb.getText("msgRowsPurgedOnPkChange", [iTotalRemoved])} ${rb.getText("msgRowsAutoAdded", [iAdded])}`
          : rb.getText("msgRowsPurgedOnPkChange", [iTotalRemoved]);
        MessageBox.warning(sMsg);
      } else if (iAdded > 0) {
        MessageToast.show(rb.getText("msgRowsAutoAdded", [iAdded]));
      } else {
        MessageToast.show(bAllowed ? rb.getText("hintPkIi") : rb.getText("hintPkI"));
      }
    },

    // [Fix] Барьеры вроде SAFETY_FENCE несут PkLevels="0,1,2,3,4" в справочнике
    // (сам код валиден на любом уровне), но BusinessRules.isBarriersAllowed
    // прячет ВСЮ секцию "Барьеры" при уровне 0/1 — при рассинхроне этих двух
    // независимых правил строка, добавленная на уровне 2, переживала бы
    // понижение до 0/1 невидимо для пользователя (секция скрыта — удалить
    // нечем) и всё равно ушла бы в сабмит. Секционное правило теперь
    // авторитетно: если барьеры запрещены на текущем уровне — очищаем список
    // целиком, а не полагаемся на per-item PkLevels.
    // @returns {number} количество реально удалённых строк (для UX-сигнала вызывающему коду).
    _purgeInvalidRows (sType) {
      const oCfg = EntityConfig.TYPES[sType];
      const oView = this.getView();
      const oM = oView.getModel(oCfg.model);
      const oDictModel = oView.getModel("dictionaryModel");
      const sPkLevel = oView.getModel("formModel").getProperty("/PkLevel");

      const aItems = oM.getProperty("/items") || [];
      // [Fix OCP, аудит] oCfg.sectionGate вместо литерального `sType === "Barriers"`
      // — тип, для которого целая секция может быть скрыта на каком-то уровне
      // КПР, теперь определяется наличием sectionGate в EntityConfig.TYPES
      // (сейчас это только Barriers), а не именем, зашитым здесь.
      const bSectionForbidden = !!oCfg.sectionGate && !oCfg.sectionGate(sPkLevel);
      const aFiltered = bSectionForbidden ? [] : aItems.filter((r) => {
        const sCode = r[oCfg.codeProp];
        if (!sCode) { return true; }
        return DictionaryFacade.isCodeAvailableForPk(oDictModel, oCfg.dictType, sCode, sPkLevel);
      });

      const iRemoved = aItems.length - aFiltered.length;
      if (iRemoved > 0) {
        oM.setProperty("/items", aFiltered);
        this._updateFooterCount();
      }
      return iRemoved;
    },

    // [Механизм авто-добавления строк по КПР, см. MIGRATION_MAPPING.md/план]
    // Правило (какие Checks/Barriers добавлять на каком уровне) — целиком в
    // данных (AutoRowRules.json/DictionaryFacade.getAutoRowsForPk), не здесь;
    // контроллер только применяет уже готовый список. Идемпотентно — код,
    // уже присутствующий в таблице (добавленный вручную или на предыдущий
    // вызов), не дублируется, поэтому переключение КПР туда-обратно не
    // плодит строки.
    // @returns {number} количество реально добавленных строк (для UX-сигнала в onPkLevelChange).
    _applyAutoRows (sPkLevel) {
      const oView = this.getView();
      const oDictModel = oView.getModel("dictionaryModel");
      const aRules = DictionaryFacade.getAutoRowsForPk(oDictModel, sPkLevel);
      let iAdded = 0;

      aRules.forEach((oRule) => {
        const oCfg = EntityConfig.TYPES[oRule.Type];
        if (!oCfg) { return; }

        // Секционное правило (oCfg.sectionGate, см. EntityConfig.TYPES) авторитетно
        // (см. _purgeInvalidRows) — не добавляем строки для типа, у которого целая
        // секция скрыта на этом уровне КПР, даже если это по ошибке настроено в
        // AutoRowRules.json.
        if (oCfg.sectionGate && !oCfg.sectionGate(sPkLevel)) { return; }

        const oM = oView.getModel(oCfg.model);
        const aItems = oM.getProperty("/items") || [];
        const bAlreadyPresent = aItems.some((r) => r[oCfg.codeProp] === oRule.Code);
        if (bAlreadyPresent) { return; }

        // [Fix РЕАЛЬНЫЙ БАГ, аудит] DictionaryFacade.resolveText() — тот же
        // единственный accessor, что теперь использует и
        // DeepEntityFacade._collectRows, вместо независимо написанного здесь
        // `getProperty('/_index/${dictType}')` — раньше это было отдельное,
        // по-другому написанное чтение той же внутренней структуры
        // dictionaryModel>/_index, ничем не связанное со своим "близнецом".
        const oRow = ModelsInit.emptyRow(oRule.Type);
        oRow[oCfg.codeProp] = oRule.Code;
        oRow[oCfg.textProp] = DictionaryFacade.resolveText(oDictModel, oCfg.dictType, oRule.Code);
        oM.setProperty("/items", [...aItems, oRow]);
        iAdded++;
      });

      if (iAdded > 0) { this._updateFooterCount(); }
      return iAdded;
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
