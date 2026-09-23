sap.ui.define([
  "sap/m/GroupHeaderListItem",
  "sap/m/StandardListItem",
  "sap/base/Log",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/facade/DictionaryFacade"
], (GroupHeaderListItem, StandardListItem, Log, EntityConfig, DictionaryFacade) => {
  "use strict";

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт диалог value-help для кодов
  // Checks/Barriers (DictValueHelp.fragment.xml): открытие, поиск/фильтрация,
  // выбор строки. Чистая реорганизация, без изменения поведения.
  //
  // [Fix "не изобретать велосипед", аудит] Список раньше строился вручную:
  // DictionaryFacade.getFilteredForVh/buildDisplayItems разворачивали
  // словарь в плоский массив "заголовок группы + элементы" в JS при каждом
  // открытии диалога и при каждом нажатии в поиске, а vhItemFactory
  // различал два вида строк по искусственному полю type — тот же паттерн,
  // что sap.m.List умеет из коробки через Sorter(group:true) +
  // groupHeaderFactory. Список теперь биндится ПРЯМО на dictionaryModel
  // (см. _bindVhList), сужается штатным sap.ui.model.Filter вместо ручной
  // пересборки массива — vhItemFactory и локальный filterVhGroups(), обе
  // ручные реализации того же самого, удалены целиком.
  //
  // [Fix "не изобретать велосипед", по запросу] Второй заход: сам Dialog +
  // SearchField + Cancel-кнопка заменены на sap.m.SelectDialog — штатный
  // контрол именно под "выбрать одно из фильтруемого/группируемого списка".
  // Он сам управляет полем поиска (событие liveChange), сам закрывается и
  // шлёт confirm с выбранным item по тапу (single-select — multiSelect не
  // задан, false по умолчанию), сам даёт Cancel. Контроллеру остаётся
  // только: что показать (bindItems с тем же Filter/Sorter, что и раньше)
  // и что сделать с результатом (onVhConfirm) — никакой ручной lifecycle-
  // логики диалога (open/close) для самого выбора уже не нужно, кроме
  // самого открытия. См. fragment/DictValueHelp.fragment.xml.
  const LOG_COMPONENT = "sap.pc_lite.lite.controller.mixin.DictionaryValueHelp";

  return {

    onCheckValueHelp (oEvent) {
      this._openDictVh("Checks", oEvent);
    },

    onBarrierValueHelp (oEvent) {
      this._openDictVh("Barriers", oEvent);
    },

    // [Fix SOLID/SRP] Раньше этот метод сам оркестрировал 4 модели
    // (formModel/dictionaryModel/vhModel + i18n) и знал детали фильтрации по
    // PkLevel — расширение диалога третьим типом VH требовало бы правки в
    // нескольких местах сразу. Сборка состояния теперь целиком в
    // DictionaryFacade.buildVhState(); контроллер только передаёт вход
    // (конфиг типа, событие, уровень КПР) и открывает диалог.
    _openDictVh (sTargetType, oEvent) {
      const oView = this.getView();
      const oCfg = EntityConfig.TYPES[sTargetType];
      const oDictModel = oView.getModel("dictionaryModel");
      const sPkLevel = oView.getModel("formModel").getProperty("/PkLevel");
      const iRowIndex = this._resolveRowIndex(oEvent.getSource().getBindingContext(oCfg.model));
      // [Fix OCP, аудит] Раньше — хардкодный тернарник по sTargetType, хотя
      // EntityConfig.TYPES[sTargetType] уже даёт всё остальное про тип;
      // titleKey теперь тоже часть этой карты (см. EntityConfig.js).
      const sTitle = this.getResourceBundle().getText(oCfg.titleKey);

      const oVhState = DictionaryFacade.buildVhState(oCfg, sTargetType, oDictModel, sPkLevel, iRowIndex, sTitle);
      oVhState.usedCodes = this._collectUsedCodes(oCfg, iRowIndex);
      oView.getModel("vhModel").setData(oVhState);

      this._getDialog("dictVhDialog", "sap.pc_lite.lite.fragment.DictValueHelp").then((oDlg) => {
        // [Fix SF-08] Текст пустого списка — от прошлого поиска не остаётся.
        oDlg.setNoDataText(this.getResourceBundle().getText("msgVhEmpty"));
        this._bindVhList(oCfg.dictType, sPkLevel);
        oDlg.open();
        // [SelectDialog] Поле поиска — приватная деталь контрола (нет
        // публичного метода "очистить поиск"), но SelectDialog сам сбрасывает
        // его на каждый open() — раньше это делал явный oSearch.setValue(""),
        // здесь такой код был бы обращением к недокументированному _oSearchField.
      });
    },

    // [Fix "не изобретать велосипед", аудит] Диалог — один и тот же для
    // Checks/Barriers (см. _getDialog, кэширует по id "dictVhDialog"),
    // поэтому агрегация items не может быть статическим XML-биндингом на
    // конкретный EntitySet ("/CHECKS" ИЛИ "/BARRIERS") — перепривязывается
    // здесь, под актуальный dictType, на каждое открытие. templateShareable:
    // false — SelectDialog сам владеет этим шаблоном и уничтожит СТАРЫЙ при
    // следующем bindItems (при переоткрытии диалога на другом типе/строке),
    // тот же класс проблемы, что уже решён для statusItemFactory
    // (RowsAndAutoFill.js) — там клонирование, здесь пересоздание с нуля,
    // но забота та же: не оставлять framework гадать, кто владеет шаблоном.
    // items — обычная forwarded-агрегация SelectDialog (проверено живьём:
    // bindItems/getBinding("items")/Sorter(group:true)+groupHeaderFactory/
    // Filter работают на нём буквально так же, как на голом sap.m.List).
    // Шаблон без press — выбор строки теперь идёт через событие confirm
    // самого SelectDialog (single-select list сам решает, что "тап = выбор"),
    // а не через press на отдельном StandardListItem, как раньше.
    _bindVhList (sDictType, sPkLevel) {
      const sAlreadyAdded = this.getResourceBundle().getText("vhAlreadyAdded");
      const oTemplate = new StandardListItem({
        title: "{dictionaryModel>Text}",
        description: "{dictionaryModel>Code}",
        // [Fix SF-10, аудит] Код уже есть в другой строке таблицы — помечаем,
        // но не прячем (повтор может быть осознанным, бизнес не запрещал).
        info: {
          parts: [{ path: "dictionaryModel>Code" }, { path: "vhModel>/usedCodes" }],
          formatter: (sCode, oUsed) => (oUsed && sCode && oUsed[sCode] ? sAlreadyAdded : "")
        }
      }).addStyleClass("appVhItem");

      // [Fix, живой тест] bindItems() — авто-сгенерированный алиас
      // bindAggregation("items", ...), но для FORWARDED-агрегации (items
      // здесь на самом деле проксируется во внутренний sap.m.List
      // SelectDialog'а) этот алиас не создаётся — подтверждено live-тестом
      // ("bindItems is not a function"). bindAggregation — универсальный
      // метод ManagedObject, работает для любой агрегации по имени
      // независимо от forwarding, им и пользуемся напрямую.
      this.byId("dictVhDialog").bindAggregation("items", {
        path: `dictionaryModel>/${sDictType}`,
        template: oTemplate,
        templateShareable: false,
        sorter: DictionaryFacade.buildVhSorter(),
        groupHeaderFactory: this._vhGroupHeaderFactory.bind(this),
        filters: DictionaryFacade.buildVhFilters(sPkLevel, "")
      });
    },

    // groupHeaderFactory — штатный коллбэк sap.m.List (и SelectDialog,
    // который internally как раз sap.m.List и использует) для
    // Sorter(group:true): вызывается один раз на каждое отличающееся
    // значение Category среди ОТФИЛЬТРОВАННЫХ строк, oGroup.key — это
    // значение. Число в скобках читает categoryCounts, который
    // buildCategoryCounts пересчитывает при каждом открытии диалога/
    // нажатии в поиске (см. onVhSearch) — тот же счётчик, что раньше
    // приходил готовым полем count в buildDisplayItems.
    //
    // [Fix РЕАЛЬНЫЙ БАГ, найдено независимым ревью] Раньше здесь было
    // getProperty(`/categoryCounts/${oGroup.key}`) — JSONModel#getProperty
    // разбирает путь ПО "/", а Category — обычный текст с бэкенда без
    // экранирования: категория со значением вроде "Оборудование/СИЗ" дала
    // бы путь "/categoryCounts/Оборудование/СИЗ", который getProperty
    // прочтёт как ВЛОЖЕННЫЙ путь (categoryCounts -> "Оборудование" ->
    // "СИЗ"), а не как один плоский ключ — тихо вернёт undefined, счётчик
    // в заголовке покажет 0 вместо реального числа. Сегодня безобидно
    // (в CheckTypes.json/BarrierTypes.json ни у одной категории нет "/"),
    // но именно поэтому не отловилось бы тестами. Читаем весь объект одним
    // getProperty("/categoryCounts") и берём ключ через obj[key] — никакого
    // разбора пути, "/" внутри названия категории уже не проблема.
    _vhGroupHeaderFactory (oGroup) {
      const oCounts = this.getView().getModel("vhModel").getProperty("/categoryCounts") || {};
      return new GroupHeaderListItem({ title: oGroup.key, count: oCounts[oGroup.key] || 0 }).addStyleClass("appVhGroupHeader");
    },

    // [Fix Fragile Spot] Индекс строки — последний сегмент binding-пути
    // JSONModel-агрегации ("/items/3" -> 3); это штатный способ SAPUI5 для
    // плоских list-биндингов, но раньше парсился inline без валидации —
    // при null-контексте или неожиданной форме пути (например если items
    // когда-нибудь станет вложенным путём) parseInt("NaN", 10) тихо утёк бы
    // в vhModel>/rowIndex и в onVhConfirm (`iRowIndex < 0`) пропустил бы
    // NaN как валидный. Явная валидация здесь ловит это на границе, с
    // логом вместо тихого игнора.
    _resolveRowIndex (oRowCtx) {
      if (!oRowCtx) {
        return -1;
      }
      const sLastSegment = oRowCtx.getPath().split("/").pop();
      const iIndex = parseInt(sLastSegment, 10);
      if (isNaN(iIndex)) {
        Log.warning(`_resolveRowIndex: unexpected binding path "${oRowCtx.getPath()}"`, null, LOG_COMPONENT);
        return -1;
      }
      return iIndex;
    },

    // {code: true} кодов, уже выбранных в ДРУГИХ строках целевой таблицы.
    _collectUsedCodes (oCfg, iRowIndex) {
      const aRows = this.getView().getModel(oCfg.model).getProperty("/items") || [];
      const oUsed = {};
      aRows.forEach((oRow, i) => {
        if (i !== iRowIndex && oRow[oCfg.codeProp]) { oUsed[oRow[oCfg.codeProp]] = true; }
      });
      return oUsed;
    },

    // [SelectDialog] liveChange даёт value (не newValue, как у голого
    // SearchField — другой контрол, другое имя параметра события).
    // [Fix SF-02/SF-08] Запрос обрезается (одни пробелы = без поиска), поиск
    // нормализован (DictionaryFacade/SearchText), пустой результат поиска —
    // свой текст ("ничего не найдено", а не "нет значений для уровня КПР").
    onVhSearch (oEvent) {
      const sQuery = (oEvent.getParameter("value") || "").trim();
      const oVhModel = this.getView().getModel("vhModel");
      const oDictModel = this.getView().getModel("dictionaryModel");
      const sDictType = oVhModel.getProperty("/dictType");
      const sPkLevel = this.getView().getModel("formModel").getProperty("/PkLevel");

      oVhModel.setProperty("/categoryCounts", DictionaryFacade.buildCategoryCounts(oDictModel, sDictType, sPkLevel, sQuery));
      const oDlg = this.byId("dictVhDialog");
      oDlg.setNoDataText(this.getResourceBundle().getText(sQuery ? "msgVhNoMatch" : "msgVhEmpty"));
      oDlg.getBinding("items").filter(DictionaryFacade.buildVhFilters(sPkLevel, sQuery));
    },

    // [SelectDialog] Раньше — press на самом StandardListItem, читал
    // oEvent.getSource() напрямую. confirm — событие самого диалога, а не
    // строки: выбранный item приходит параметром selectedItem (single-
    // select, см. fragment) — свой binding context он несёт точно так же.
    // Дальнейшая логика (куда записать код/текст) не изменилась. Закрывать
    // диалог явно не нужно — confirm у SelectDialog приходит УЖЕ после
    // того, как он сам закрылся.
    onVhConfirm (oEvent) {
      const oItem = oEvent.getParameter("selectedItem");
      const oCtx = oItem && oItem.getBindingContext("dictionaryModel");
      if (!oCtx) { return; }

      const sCode = oCtx.getProperty("Code");
      const sText = oCtx.getProperty("Text");
      const oVhModel = this.getView().getModel("vhModel");
      const sTargetType = oVhModel.getProperty("/targetType");
      const iRowIndex = oVhModel.getProperty("/rowIndex");

      if (!sCode || iRowIndex < 0) { return; }

      const oCfg = EntityConfig.TYPES[sTargetType];
      const oModel = this.getView().getModel(oCfg.model);
      const sPath = `/items/${iRowIndex}`;
      oModel.setProperty(`${sPath}/${oCfg.codeProp}`, sCode);
      oModel.setProperty(`${sPath}/${oCfg.textProp}`, sText);

      // [Fix РЕАЛЬНЫЙ БАГ, аудит] Первый выбор кода в новой строке роняет
      // фокус клавиатуры в <body> — см. подробное обоснование ниже у
      // _focusFilledCodeLink. Явно переносим фокус на теперь-видимую
      // ".appCellCodeLinkFilled" ссылку той же строки, а не полагаемся на
      // штатное восстановление фокуса sap.ui.core.Popup (оно рассчитано на
      // то, что элемент, с которого был открыт диалог, переживёт закрытие —
      // здесь же это плейсхолдер-Link, который как раз только что удалён
      // из DOM тем же самым обновлением модели).
      this._focusFilledCodeLink(oCfg, iRowIndex);
    },

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Ячейка кода — HBox с ДВУМЯ статичными Link
    // (заполненный/плейсхолдер, см. ChecksTable/BarriersTable.fragment.xml —
    // class-биндинг не работает в UI5 1.71, поэтому переключение через
    // visible, а не один Link с меняющимся текстом) плюс Icon. Пока строка
    // была пустой, фокус клавиатуры/скринридера стоял на ПЛЕЙСХОЛДЕР-Link
    // (единственный видимый фокусируемый элемент). onVhConfirm выше только
    // что записал код — плейсхолдер стал invisible=true и framework СНЁС
    // его из DOM целиком, а filled-Link стал visible и появился в DOM как
    // НОВЫЙ узел. sap.ui.core.Popup/Dialog пытается вернуть фокус на
    // элемент, с которого диалог был открыт — но тот элемент уже не в DOM,
    // восстановление молча не срабатывает, фокус проваливается в <body>
    // (подтверждено живым тестом). applyChanges() форсирует синхронный
    // рендер (setProperty сам по себе асинхронно ставит перерисовку в
    // очередь) — без него DOM ещё не содержал бы filled-Link на момент
    // поиска.
    _focusFilledCodeLink (oCfg, iRowIndex) {
      sap.ui.getCore().applyChanges();
      const oTable = this.byId(oCfg.tableId);
      const oRow = oTable && oTable.getItems()[iRowIndex];
      const oCell = oRow && oRow.getCells()[0];
      const aCellContent = (oCell && oCell.getItems && oCell.getItems()) || [];
      const oFilledLink = aCellContent.find((oCtrl) => oCtrl.hasStyleClass && oCtrl.hasStyleClass("appCellCodeLinkFilled"));
      if (oFilledLink) { oFilledLink.focus(); }
    },

    // [SelectDialog] cancel приходит уже ПОСЛЕ того, как диалог сам
    // закрылся (как и confirm) — раньше здесь был единственный явный
    // this.byId("dictVhDialog").close(), теперь он не нужен. Метод оставлен
    // (не удалён) как именованная точка входа для события cancel — на
    // случай, если у отмены появится своя логика (например сброс
    // промежуточного состояния поиска), не пришлось бы менять привязку в
    // fragment.
    onCloseDictVhDialog () {}

  };
});
