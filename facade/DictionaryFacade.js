sap.ui.define([
  "sap/pc_lite/lite/model/BackendConfig",
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/ui/model/Sorter"
], (BackendConfig, Filter, FilterOperator, Sorter) => {
  "use strict";

  const ES = BackendConfig.ENTITY_SETS;

  // [Fix РЕАЛЬНЫЙ БАГ, по запросу] aFilters — четвёртый, опциональный параметр
  // (не менял существующую сигнатуру для остальных 7 вызовов в load() ниже,
  // которым фильтры не нужны) — реальный sap.ui.model.Filter[], уходящий как
  // $filter в сам HTTP-запрос, а не косметический urlParameters, который
  // MockServer/бэкенд может просто проигнорировать. Нужен ровно одному
  // потребителю — LocationHierarchy (see _buildLocationAsOfFilter) — тем же
  // приёмом, что уже применяет PersonSearchFacade.js#_read к ActiveFrom.
  function readEntitySet(oModel, sPath, oUrlParams, aFilters) {
    return new Promise((resolve, reject) => {
      const oParams = {
        success: (oData) => resolve((oData && oData.results) || []),
        error: reject
      };
      if (oUrlParams && Object.keys(oUrlParams).length) {
        oParams.urlParameters = oUrlParams;
      }
      if (aFilters && aFilters.length) {
        oParams.filters = aFilters;
      }
      oModel.read(sPath, oParams);
    });
  }

  /** Loads all reference-data dictionaries and the location hierarchy in one batch, once. */
  class DictionaryFacade {
    /**
     * @param {sap.ui.model.odata.v2.ODataModel} oModel
     * @param {sap.ui.model.json.JSONModel} oDictModel populated with {CHECKS, BARRIERS, STATUS, TIMEZONE, PKLEVEL, PROFESSION, _index}
     * @param {sap.ui.model.json.JSONModel} oLocModel populated with {items, lookupMap}
     * @param {string} [sCheckDate]
     * @returns {Promise<void>}
     */
    static load(oModel, oDictModel, oLocModel, sCheckDate) {
      // [Fix РЕАЛЬНЫЙ БАГ, по запросу] Раньше sCheckDate уходил как
      // urlParameters {checkDate: ...} — косметический, ничего не значащий
      // для MockServer 1.71 параметр (не $filter/$top/... системный query
      // option, ни один attachBefore-хук его не читал) — LocationHierarchy
      // читалась ВСЕЙ, без какого-либо влияния даты проверки на результат.
      // Теперь — настоящий server-side Filter (EffectiveDate le :checkDate),
      // тот же приём, что уже применяет PersonSearchFacade.js#
      // _buildActiveOnFilter к Persons.ActiveFrom (тот же класс задачи: одна
      // и та же ZCHK_LOCH-строка не может считаться и родительской, и
      // переименованной одновременно, актуальную версию решает дата).
      const oLocFilter = DictionaryFacade._buildLocationAsOfFilter(sCheckDate);

      // Раньше — один /I_Dictionary с DictType-дискриминатором. Целевая модель
      // (redux) не имеет общего справочника — 6 раздельных EntitySet, каждый
      // со своими именами code/text (см. MIGRATION_MAPPING.md).
      //
      // [Fix Roundtrip/Code-to-Data] $select ограничивает каждый запрос
      // только полями, реально используемыми _buildDictionary — раньше читался
      // весь EntitySet целиком (все поля), хотя используются 3-4 колонки.
      //
      // [Fix РЕАЛЬНЫЙ БАГ, аудит] Раньше Promise.all возвращал массив, который
      // разбирался ПОЗИЦИОННО в двух не связанных друг с другом местах —
      // `_buildDictionary([aChecks, aBarriers, ...])` (первые 6 элементов по
      // порядку объявления выше) и отдельно `aResults[6]`/`aResults[7]`
      // (LocationHierarchy/AutoRowRules) прямо здесь, по голым числовым
      // индексам. Вставка новой строки в этот список запросов где угодно,
      // кроме самого конца, молча сдвигала бы ВСЕ последующие индексы —
      // никакого исключения, просто одни данные читались бы под именем
      // других (например, AUTO_ROW_RULES оказался бы в aResults[6] вместо
      // LocationHierarchy). Массив запросов — теперь {key, promise} пары,
      // ключ читается по имени через oByKey ниже: порядок объявления запроса
      // в этом списке больше ни на что не влияет.
      const aQueries = [
        { key: "CHECKS", promise: readEntitySet(oModel, `/${ES.CHECK_TYPES}`, { "$select": "CheckTypeCode,CheckTypeText,Category,PkLevels" }) },
        { key: "BARRIERS", promise: readEntitySet(oModel, `/${ES.BARRIER_TYPES}`, { "$select": "BarrierTypeCode,BarrierTypeText,Category,PkLevels" }) },
        { key: "STATUS", promise: readEntitySet(oModel, `/${ES.CHECK_RESULTS}`, { "$select": "ResultCode,ResultText" }) },
        { key: "PKLEVEL", promise: readEntitySet(oModel, `/${ES.PK_LEVELS}`, { "$select": "PkLevel,PkLevelText" }) },
        { key: "TIMEZONE", promise: readEntitySet(oModel, `/${ES.TIME_ZONES}`, { "$select": "TimeZoneCode,TimeZoneText" }) },
        { key: "PROFESSION", promise: readEntitySet(oModel, `/${ES.PROFESSIONS}`, { "$select": "ProfessionCode,ProfessionText" }) },
        { key: "LOCATION", promise: readEntitySet(oModel, `/${ES.LOCATION_HIERARCHY}`, undefined, oLocFilter ? [oLocFilter] : undefined) },
        // [Механизм авто-добавления строк по КПР] Тот же батч, что и остальные
        // справочники — ни одного лишнего запроса ни при загрузке, ни при
        // смене уровня КПР (см. getAutoRowsForPk — чистый клиентский lookup
        // по уже загруженным данным).
        { key: "AUTO_ROW_RULES", promise: readEntitySet(oModel, `/${ES.AUTO_ROW_RULES}`, { "$select": "PkLevel,Type,Code" }) }
      ];

      return oModel.metadataLoaded().then(() => Promise.all(aQueries.map((q) => q.promise))).then((aResolved) => {
        const oByKey = {};
        aQueries.forEach((q, i) => { oByKey[q.key] = aResolved[i]; });

        const oDict = DictionaryFacade._buildDictionary(oByKey);
        oDict._index = DictionaryFacade._buildIndex(oDict);
        // Не заводится внутри _buildDictionary — это не "справочник кодов",
        // сгруппирован по уровню КПР, а не по Code, и не должен попасть под
        // общий цикл сортировки по Code/SortOrder там.
        oDict.AUTO_ROWS = DictionaryFacade._buildAutoRowIndex(oByKey.AUTO_ROW_RULES);
        oDictModel.setData(oDict);

        // [Fix РЕАЛЬНЫЙ БАГ, по запросу] Сервер уже отсеял строки, не
        // действующие на дату проверки (EffectiveDate le :checkDate, см.
        // _buildLocationAsOfFilter) — но этого недостаточно самого по себе:
        // одна и та же LocationCode может иметь НЕСКОЛЬКО строк, всё ещё
        // прошедших этот фильтр (например, площадка переименована дважды,
        // обе более ранние версии всё ещё <= дате проверки) — нужна именно
        // ПОСЛЕДНЯЯ из них, не все сразу. _latestPerLocationCode берёт
        // max(EffectiveDate) в каждой группе по LocationCode — до
        // нормализации в NodeID/NodeText, пока LocationCode/EffectiveDate
        // ещё есть на сырой строке (_normalizeLocationRows их не переносит).
        const aLocLatest = DictionaryFacade._latestPerLocationCode(oByKey.LOCATION);

        // [Fix регрессии] LocationHierarchy (redux) отдаёт LocationUuid/
        // LocationName/ParentLocationUuid — но locationModel,
        // LocationDialog.fragment.xml и Main.controller.js
        // (onLocationRowSelect, _navigateLocationLevel и т.д.) писаны под
        // NodeID/NodeText/ParentNodeID. Нормализуем здесь, на границе —
        // внутренний контракт locationModel не меняется.
        const aLocItems = DictionaryFacade._normalizeLocationRows(aLocLatest);
        const oLookupMap = DictionaryFacade._buildLookupMap(aLocItems);

        // [Fix "не изобретать велосипед", аудит] HasChildren проштамповывается
        // на сами элементы /items здесь же — LocationDialog теперь биндит
        // List НАПРЯМУЮ на locationModel>/items и сужает видимый уровень
        // штатным sap.ui.model.Filter (ParentNodeID) вместо пересчёта
        // отдельного производного /levelItems массива в JS на каждый клик
        // (см. LocationPicker.js). Это единственное поле, которого не было
        // в исходных данных с сервера (см. _buildLookupMap выше) и которое
        // нужно как обычное, бинduемое свойство строки, а не как отдельная
        // структура, до которой добираться через lookupMap на каждый рендер.
        aLocItems.forEach((n) => { n.HasChildren = oLookupMap[n.NodeID].hasChildren; });

        // [Fix YAGNI/Perf] Путь (LocationPath) больше не предвычисляется для
        // ВСЕХ узлов иерархии при каждой загрузке словарей (O(n*depth) впустую
        // для узлов, которые пользователь никогда не выберет) — вычисляется
        // лениво, только для реально выбранного узла, см. getPath().
        // [Fix РЕАЛЬНЫЙ БАГ, найдено при проверке поиска] setData(...) здесь
        // ЗАМЕНЯЕТ весь объект locationModel целиком, стирая currentParentId/
        // selectedNodeId/breadcrumbLinks/breadcrumbCurrentText/searchQuery —
        // все поля, которые ModelsInit.js завёл как начальные значения (и
        // которые LocationPicker.js читает и пишет через setProperty). На
        // практике почти незаметно — load() обычно успевает раньше первого
        // клика по полю "Местоположение", а _navigateLocationLevel
        // пересоздаёт эти поля заново при каждом открытии диалога — но если
        // диалог открыть/искать ДО того, как load() отработает (медленная
        // сеть, самый первый рендер), состояние навигации тихо обнулится
        // посреди работы. setProperty на /items и /lookupMap — точечное
        // обновление, соседние поля не трогает.
        oLocModel.setProperty("/items", aLocItems);
        oLocModel.setProperty("/lookupMap", oLookupMap);
      });
    }

    // [Fix РЕАЛЬНЫЙ БАГ, по запросу] Зеркалит PersonSearchFacade.js#
    // _buildActiveOnFilter один в один — та же задача (передать дату
    // проверки в условие фильтрации серверного $filter), то же поле
    // Edm.DateTime без null-семантики (EffectiveDate у каждой строки
    // ВСЕГДА заполнено, в отличие от Persons.ActiveTo), тот же оператор LE.
    // Единственное отличие — имя поля/сущности; вынесено отдельным методом,
    // а не заинлайнено в load(), ровно по той же причине, что и у
    // person-фасада: понятное, самостоятельно читаемое имя на месте вызова.
    static _buildLocationAsOfFilter(sCheckDate) {
      if (!sCheckDate) {
        return null;
      }
      const oDate = new Date(sCheckDate);
      if (isNaN(oDate.getTime())) {
        return null;
      }
      return new Filter("EffectiveDate", FilterOperator.LE, oDate);
    }

    // [Fix РЕАЛЬНЫЙ БАГ, по запросу] Группирует по LocationCode, оставляет
    // строку с max(EffectiveDate) в каждой группе — "последняя действующая
    // на дату проверки версия каждого узла" (сервер уже гарантировал через
    // _buildLocationAsOfFilter, что ни одна оставшаяся строка не действует
    // ПОЗЖЕ даты проверки; здесь — просто взять самую свежую ИЗ уже
    // допущенных). Строки без LocationCode (не должно случаться в реальных
    // данных, но не должно и тихо схлопывать их в одну "группу без кода") —
    // каждая получает собственный, уникальный по LocationUuid ключ, никогда
    // не совпадающий с другой такой же строкой.
    //
    // [Fix, честно о границах] Не решает реордеринг: если у переименованного
    // узла (новый LocationCode) появляются ДЕТИ уже после переименования, а
    // их ParentLocationUuid ссылается на СТАРЫЙ (проигравший здесь) UUID —
    // этот алгоритм молча оставит их без родителя в дереве. redux
    // (resolvers.py) для такого случая делает полноценный reparent; здесь —
    // сознательно более простая версия, покрывающая ровно переименование
    // листового узла (см. LOC-003 в model/LocationHierarchy.json) — если
    // сценарий с переименованием родительского узла станет реальным, эту
    // функцию придётся расширить.
    static _latestPerLocationCode(aRows) {
      const oByKey = {};
      (aRows || []).forEach((n) => {
        const sKey = n.LocationCode || `__nocode_${n.LocationUuid}`;
        const oExisting = oByKey[sKey];
        if (!oExisting || new Date(n.EffectiveDate) > new Date(oExisting.EffectiveDate)) {
          oByKey[sKey] = n;
        }
      });
      return Object.keys(oByKey).map((k) => oByKey[k]);
    }

    static _normalizeLocationRows(aFlat) {
      return aFlat.map((n) => ({
        NodeID: n.LocationUuid,
        ParentNodeID: n.ParentLocationUuid || "",
        NodeText: n.LocationName || "",
        // [Поиск по всей иерархии, по запросу] Раньше не переносился вовсе —
        // не нужен был для drill-down-навигации по ParentNodeID. Нужен для
        // buildLocationFilters(): в реальной жизни площадку узнают не только
        // по названию, но и по коду на табличке/в документах ("LOC-003").
        NodeCode: n.LocationCode || "",
        HierarchyLevel: n.Level
      }));
    }

    // Нормализует 6 раздельных EntitySet в ту же внутреннюю форму
    // {Code, Text, Category, PkLevels}, что раньше давал сгруппированный
    // /I_Dictionary — isCodeAvailableForPk/_buildIndex/buildVhFilters ниже
    // от этой нормализации не зависят и не меняются.
    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Принимает {key: aRows} lookup вместо
    // позиционного массива — см. подробное обоснование в load() выше.
    static _buildDictionary(oByKey) {
      const oDict = {
        CHECKS: oByKey.CHECKS.map((e) => ({ Code: e.CheckTypeCode, Text: e.CheckTypeText, Category: e.Category || "", PkLevels: e.PkLevels || "" })),
        BARRIERS: oByKey.BARRIERS.map((e) => ({ Code: e.BarrierTypeCode, Text: e.BarrierTypeText, Category: e.Category || "", PkLevels: e.PkLevels || "" })),
        STATUS: oByKey.STATUS.map((e) => ({ Code: e.ResultCode, Text: e.ResultText })),
        TIMEZONE: oByKey.TIMEZONE.map((e) => ({ Code: e.TimeZoneCode, Text: e.TimeZoneText })),
        PKLEVEL: oByKey.PKLEVEL.map((e, i) => ({ Code: e.PkLevel, Text: e.PkLevelText, SortOrder: i + 1 })),
        PROFESSION: oByKey.PROFESSION.map((e) => ({ Code: e.ProfessionCode, Text: e.ProfessionText }))
      };
      Object.keys(oDict).forEach((k) => {
        const bHasSortOrder = oDict[k].every((e) => e.SortOrder != null);
        oDict[k].sort((a, b) => bHasSortOrder ? a.SortOrder - b.SortOrder : (a.Code < b.Code ? -1 : 1));
      });
      return oDict;
    }

    static _buildIndex(oDict) {
      const oIdx = {};
      Object.keys(oDict).forEach((sType) => {
        if (sType.charAt(0) === "_") {
          return;
        }
        oIdx[sType] = {};
        oDict[sType].forEach((e) => { oIdx[sType][e.Code] = e.Text; });
      });
      return oIdx;
    }

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Единственный публичный accessor Code->Text
    // через _index — раньше "/_index/<TYPE>/<CODE>" был независимо
    // захардкожен в трёх местах (facade/DeepEntityFacade.js, controller/
    // mixin/RowsAndAutoFill.js, и Main.view.xml через multi-part binding),
    // каждое своим JS-идиомом, при том что _index — ВНУТРЕННЯЯ структура
    // _buildIndex выше, ничем не задокументированная как публичный контракт.
    // Смени _buildIndex форму хранения (например, на Map) — и все три места
    // пришлось бы чинить по отдельности, а пропущенное молча возвращало бы
    // undefined -> "" без единого исключения (getProperty на несуществующем
    // пути, || {}/|| "" глотает результат). Теперь только DeepEntityFacade
    // и RowsAndAutoFill идут через этот метод (biнding во View — за пределами
    // JS, отдельный, более низкий риск случай, см. formatter.dictText).
    // @returns {string} текст по коду в словаре sDictType, "" если не найден.
    static resolveText(oDictModel, sDictType, sCode) {
      if (!oDictModel || !sCode) {
        return "";
      }
      const oData = oDictModel.getProperty("/");
      const oIndex = oData && oData._index && oData._index[sDictType];
      return (oIndex && oIndex[sCode]) || "";
    }

    /** @returns {boolean} whether sCode is applicable at sPkLevel. */
    static isCodeAvailableForPk(oDictModel, sDictType, sCode, sPkLevel) {
      const aAll = oDictModel.getProperty(`/${sDictType}`) || [];
      const oEntry = aAll.find((e) => e.Code === sCode);
      return !!oEntry && DictionaryFacade._pkLevelsInclude(oEntry, sPkLevel);
    }

    // [DRY] CheckTypes/BarrierTypes.PkLevels несёт CSV допустимых уровней —
    // единственное место, разбирающее этот CSV (используется и
    // isCodeAvailableForPk, и Filter.test ниже — buildVhFilters/
    // buildCategoryCounts).
    static _pkLevelsInclude(oEntry, sPkLevel) {
      return (oEntry.PkLevels || "").split(",").indexOf(sPkLevel) !== -1;
    }

    // ===== Value-Help диалог (Checks/Barriers) — штатные Filter/Sorter =====

    /**
     * [Fix "не изобретать велосипед", аудит] Раньше — getFilteredForVh:
     * ручной JS-проход по всему массиву словаря + группировка в объект +
     * пересборка в плоский массив "заголовок+элементы" (buildDisplayItems)
     * при КАЖДОМ открытии диалога И при каждом нажатии в поиске. Список
     * Checks/Barriers теперь биндится НАПРЯМУЮ на dictionaryModel>/CHECKS
     * (или /BARRIERS) — сужается штатным ListBinding.filter(), группируется
     * штатным Sorter(group:true) (см. DictionaryValueHelp.js#_bindVhList).
     * PkLevels — CSV-строка ("1,2,3"), а не готовое множество, поэтому
     * Filter.test (не FilterOperator) — тот же _pkLevelsInclude, что и
     * isCodeAvailableForPk, обёрнутый в реальный sap.ui.model.Filter.
     *
     * [Fix РЕАЛЬНЫЙ БАГ, найдено независимым ревью] `test`-based Filter БЕЗ
     * caseSensitive проходит через FilterProcessor.normalizeFilterValue
     * ПЕРЕД тем, как значение попадёт в саму test-функцию (внутренняя
     * деталь sap/ui/model/FilterProcessor.js — guard там
     * `!oFilter.fnCompare || oFilter.bCaseSensitive !== undefined`
     * истинен всегда, когда задан только test без comparator/caseSensitive).
     * Значит sPkLevels ВНУТРИ test — это toUpperCase()+NFC-нормализованная
     * копия сырого PkLevels, а sPkLevel (второй аргумент, из замыкания)
     * никакой нормализации не проходит — тихий перекос с buildCategoryCounts
     * ниже, который вызывает тот же _pkLevelsInclude БЕЗ Filter вообще, на
     * сырых значениях. Сегодня безвреден (все PkLevel/PkLevels — цифры,
     * toUpperCase на них no-op), но именно поэтому опасен молча "на потом".
     * caseSensitive:true отключает нормализацию — test получает сырую
     * строку, как и предполагает _pkLevelsInclude.
     * @returns {sap.ui.model.Filter[]} для ListBinding#filter()
     */
    static buildVhFilters(sPkLevel, sQuery) {
      const aFilters = [
        new Filter({
          path: "PkLevels",
          caseSensitive: true,
          test: (sPkLevels) => DictionaryFacade._pkLevelsInclude({ PkLevels: sPkLevels }, sPkLevel)
        })
      ];
      if (sQuery) {
        // [Уточнение, независимое ревью] caseSensitive:false здесь БЕЗОПАСЕН
        // именно потому, что oDictModel — JSONModel: фильтрация идёт через
        // ClientListBinding/FilterProcessor целиком в памяти браузера, без
        // единого OData-запроса. Это НЕ тот же случай, что уже пойман в
        // facade/PersonSearchFacade.js — там та же пара
        // FilterOperator.Contains + caseSensitive:false ломала сам HTTP-
        // запрос (ODataModel заворачивает сравнение в tolower(...), которую
        // MockServer 1.71 не понимает и роняет запрос целиком). Здесь
        // сервера в цепочке нет вообще — сравнивать не с чем.
        aFilters.push(new Filter({
          filters: [
            new Filter({ path: "Text", operator: FilterOperator.Contains, value1: sQuery, caseSensitive: false }),
            new Filter({ path: "Code", operator: FilterOperator.Contains, value1: sQuery, caseSensitive: false })
          ],
          and: false
        }));
      }
      return aFilters;
    }

    /** @returns {sap.ui.model.Sorter} группировка по Category — коробочные группы sap.m.List. */
    static buildVhSorter() {
      return new Sorter("Category", false, /* bGroup */ true);
    }

    /**
     * Счётчик элементов в каждой категории ПОСЛЕ применения тех же условий,
     * что buildVhFilters — только для текста в заголовке группы
     * ("Персонал (2)"), сам список эти числа не строит (это делает
     * groupHeaderFactory, см. DictionaryValueHelp.js). Условие видимости
     * здесь зеркалит buildVhFilters нарочно поэлементно (не переиспользует
     * sap.ui.model.Filter — считать через реальный ListBinding ради одних
     * только чисел избыточно), а не потому что это второй источник истины:
     * "видим по PkLevel" — та же _pkLevelsInclude, "видим по поиску" — та же
     * семантика FilterOperator.Contains/caseSensitive:false, один case-fold.
     */
    static buildCategoryCounts(oDictModel, sDictType, sPkLevel, sQuery) {
      const aAll = oDictModel.getProperty(`/${sDictType}`) || [];
      const sQueryLower = (sQuery || "").toLowerCase();
      const oCounts = {};
      aAll.forEach((e) => {
        if (!DictionaryFacade._pkLevelsInclude(e, sPkLevel)) { return; }
        if (sQueryLower &&
            (e.Text || "").toLowerCase().indexOf(sQueryLower) === -1 &&
            (e.Code || "").toLowerCase().indexOf(sQueryLower) === -1) { return; }
        const sCat = e.Category || "";
        oCounts[sCat] = (oCounts[sCat] || 0) + 1;
      });
      return oCounts;
    }

    // ===== Авто-добавление строк по уровню КПР =====

    /** @returns {object} {PkLevel: [{Type, Code}, ...]} — сгруппировано один раз при загрузке. */
    static _buildAutoRowIndex(aRules) {
      const oIndex = {};
      (aRules || []).forEach((e) => {
        if (!oIndex[e.PkLevel]) { oIndex[e.PkLevel] = []; }
        oIndex[e.PkLevel].push({ Type: e.Type, Code: e.Code });
      });
      return oIndex;
    }

    /**
     * Строки (Checks/Barriers), которые нужно авто-добавить при выборе
     * данного уровня КПР — чистый клиентский lookup, без сетевых запросов
     * (данные загружены один раз, см. load()).
     * @returns {Array<{Type: string, Code: string}>}
     */
    static getAutoRowsForPk(oDictModel, sPkLevel) {
      return (oDictModel.getProperty("/AUTO_ROWS") || {})[sPkLevel] || [];
    }

    // hasChildren предвычисляется здесь (O(n), один проход при загрузке), а не
    // пересчитывается через aFlat.some(...) на каждый узел при каждом рендере
    // уровня. Работает на нормализованной форме {NodeID, ParentNodeID,
    // NodeText} — см. _normalizeLocationRows; не переименовывать обратно на
    // LocationUuid/LocationName без правки Main.controller.js/LocationDialog.
    static _buildLookupMap(aFlat) {
      const oMap = {};
      aFlat.forEach((n) => {
        oMap[n.NodeID] = { name: n.NodeText || "", parentId: n.ParentNodeID || "", hasChildren: false };
      });
      aFlat.forEach((n) => {
        if (n.ParentNodeID && oMap[n.ParentNodeID]) {
          oMap[n.ParentNodeID].hasChildren = true;
        }
      });
      return oMap;
    }

    // [DRY/Grown Spot] Единственный обход родительской цепочки — раньше
    // _buildAllPaths (эйджерно, для ВСЕХ узлов при каждой загрузке словарей)
    // и getBreadcrumbPath дублировали один и тот же while-цикл. getPath()
    // и getBreadcrumbPath() теперь оба построены поверх _walkUp().
    static _walkUp(sNodeId, oLookupMap) {
      const aChain = [];
      let sCurId = sNodeId;
      let iDepth = 0;
      while (sCurId && oLookupMap[sCurId] && iDepth < 20) {
        aChain.unshift({ NodeID: sCurId, NodeText: oLookupMap[sCurId].name });
        sCurId = oLookupMap[sCurId].parentId;
        iDepth++;
      }
      return aChain;
    }

    /**
     * [Fix YAGNI/Perf] Путь до узла, вычисленный лениво по запросу — не
     * предвычисляется для всей иерархии при загрузке словарей (см. load()).
     * @returns {string} "Root / Child / Leaf"
     */
    static getPath(sNodeId, oLookupMap) {
      return DictionaryFacade._walkUp(sNodeId, oLookupMap).map((n) => n.NodeText).join(" / ");
    }

    /**
     * [Поиск по всей иерархии, по запросу] Путь до РОДИТЕЛЯ узла (сам узел
     * исключён — его имя уже показано отдельно, как основной текст строки).
     * Нужен только при активном глобальном поиске (см. LocationDialog.
     * fragment.xml/appLocationPath) — вне поиска все видимые строки и так на
     * одном уровне, путь избыточен рядом с хлебными крошками сверху диалога.
     * @returns {string} "Площадка №7 / Цех сборки" или "" для узла верхнего уровня
     */
    static getParentPath(sNodeId, oLookupMap) {
      return DictionaryFacade._walkUp(sNodeId, oLookupMap).slice(0, -1).map((n) => n.NodeText).join(" / ");
    }

    // ===== Drill-down навигация по иерархии (вместо TreeTable) =====

    /**
     * [Fix "не изобретать велосипед", аудит] Раньше — getChildren/filterLevel:
     * ручной JS .filter()/.map() по всему плоскому массиву при каждом
     * клике "вглубь"/каждой букве в поиске, результат клался в отдельную
     * производную модельную ветку locationModel>/levelItems, на которую и
     * биндился List. List теперь биндится НАПРЯМУЮ на locationModel>/items
     * (тот же массив, что и раньше, просто без промежуточного levelItems) —
     * сужается штатным ListBinding.filter() (см. LocationPicker.js). Порядок
     * внутри уровня — тот же, что уже был (исходный порядок /items,
     * Sorter намеренно не добавлен — не менять порядок без явного запроса).
     *
     * [Fix РЕАЛЬНЫЙ БАГ, по запросу] Раньше ParentNodeID EQ sParentId стоял
     * безусловно, а текстовый фильтр только ДОБАВЛЯЛСЯ к нему (AND) — поиск
     * реально сужал только текущий уровень, а не искал по всей иерархии.
     * Бесполезно для узла, о котором пользователь не знает путь заранее
     * (ровно то, ради чего вообще есть строка поиска) — особенно с тех пор,
     * как в справочнике появились площадки с 3-уровневой вложенностью (см.
     * model/LocationHierarchy.json). Теперь: пустой запрос — обычная
     * level-scoped навигация (как раньше), непустой — глобальный поиск по
     * ВСЕЙ locationModel>/items (ParentNodeID вообще не участвует), по имени
     * ИЛИ коду. LocationPicker.js#_navigateLocationLevel сбрасывает поле
     * поиска при каждом переходе по уровню — сценарий "искать, найти,
     * выбрать" и "листать дерево" не смешиваются в рамках одного действия.
     * @returns {sap.ui.model.Filter[]} для ListBinding#filter()
     */
    static buildLocationFilters(sParentId, sQuery) {
      if (sQuery) {
        // [Уточнение, независимое ревью] caseSensitive:false безопасен — см.
        // идентичный комментарий у buildVhFilters выше: oLocModel тоже
        // JSONModel, фильтр не уходит на сервер (в отличие от
        // PersonSearchFacade.js, где та же комбинация ломала OData-запрос).
        return [
          new Filter({
            and: false,
            filters: [
              new Filter({ path: "NodeText", operator: FilterOperator.Contains, value1: sQuery, caseSensitive: false }),
              new Filter({ path: "NodeCode", operator: FilterOperator.Contains, value1: sQuery, caseSensitive: false })
            ]
          })
        ];
      }
      return [
        new Filter({ path: "ParentNodeID", operator: FilterOperator.EQ, value1: sParentId || "" })
      ];
    }

    static getBreadcrumbPath(sNodeId, oLookupMap) {
      return DictionaryFacade._walkUp(sNodeId, oLookupMap);
    }

    /**
     * [Fix SOLID/SRP] Собирает весь vhModel-payload одним вызовом — раньше
     * Main.controller.js#_openDictVh сам оркестрировал 4 модели (formModel/
     * dictionaryModel/vhModel + i18n) и знал детали фильтрации по PkLevel.
     * Контроллер теперь только передаёт вход и записывает готовый результат.
     * displayItems здесь больше нет (см. buildVhFilters/buildVhSorter выше —
     * список биндится напрямую на dictionaryModel), вместо него —
     * categoryCounts для заголовков групп (groupHeaderFactory).
     * @returns {object} vhModel data: {dictType, dialogTitle, categoryCounts, targetType, rowIndex}
     */
    static buildVhState(oCfg, sTargetType, oDictModel, sPkLevel, iRowIndex, sDialogTitle) {
      return {
        dictType: oCfg.dictType,
        dialogTitle: sDialogTitle,
        categoryCounts: DictionaryFacade.buildCategoryCounts(oDictModel, oCfg.dictType, sPkLevel, ""),
        targetType: sTargetType,
        rowIndex: iRowIndex
      };
    }
  }

  return DictionaryFacade;
});
