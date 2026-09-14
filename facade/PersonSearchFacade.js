sap.ui.define([
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/base/Log",
  "sap/pc_lite/lite/model/BackendConfig"
], (Filter, FilterOperator, Log, BackendConfig) => {
  "use strict";

  const DEBOUNCE_MS = 300;
  const MIN_QUERY_LEN = 3;
  const LOG_COMPONENT = "sap.pc_lite.lite.facade.PersonSearchFacade";
  // [Fix РЕАЛЬНЫЙ БАГ, аудит] $top всей популяции Persons, читаемой ОДНИМ
  // запросом на каждый ввод — раньше "200" литералом без объяснения. На
  // моке (несколько строк) не заметно; на реальном штате предприятия
  // (общий бэкенд с redux, полноценный HR-справочник) фамилия, сортирующаяся
  // алфавитно ПОСЛЕ этой границы, никогда не попадёт в ответ сервера — и
  // клиентский substring-фильтр ниже (_read) физически не увидит её вообще,
  // не "не найдёт по строке", а не получит на вход. Полноценное решение
  // (реальный full-text поиск на сервере вместо client-side substring)
  // требует серверной возможности, которой у MockServer 1.71 нет (см.
  // подробный комментарий класса ниже про tolower()/Contains) — здесь лишь
  // поднят потолок с явным именем и предупреждением, а не тихо оставлен
  // магическим числом. Если реальный активный штат превышает это значение —
  // нужен либо настоящий серверный поиск, либо постраничная догрузка по
  // мере ввода (см. suggested_fix в отчёте аудита), не только больший $top.
  const MAX_CANDIDATE_ROWS = 2000;

  /**
   * Debounced fuzzy person search against /Persons.
   *
   * [Fix Code-to-Data / HANA push-down] ActiveFrom (LE :date) фильтруется
   * ИСКЛЮЧИТЕЛЬНО на сервере — обычное сравнение с реальным значением,
   * без риска null-семантики, безопасный push-down.
   *
   * [Архитектурное решение] ActiveTo (nullable — "бессрочно активен")
   * НЕ фильтруется через `eq null` на сервере. Эмпирически проверено:
   * sap.ui.core.util.MockServer 1.71 возвращает [] на "ActiveTo eq null"
   * даже когда в данных реально лежит null — его $filter-парсер не умеет
   * сравнивать Edm.DateTime с null-литералом. Тот же класс дефекта
   * систематически встречается и в реальных SAP Gateway/CDS-сервисах:
   * наивная трансляция $filter в SQL WHERE через generated DPC_EXT нередко
   * эмиттит `= NULL` вместо `IS NULL` (ANSI SQL: `= NULL` никогда не
   * матчит), особенно для полей без явного `Nullable="false"` в metadata.
   * Полагаться на `eq null` для критичного для отображения условия (кого
   * показывать в поиске) — ненадёжный контракт вне зависимости от
   * конкретного бэкенда. ActiveTo поэтому читается через $select и
   * проверяется на границе, в _isActiveOn() — это НЕ повтор всего правила
   * (ActiveFrom остаётся авторитетно server-side), а точечная защита от
   * одной конкретной ненадёжной null-семантики.
   *
   * [Fix архитектурная консистентность] static-класс — как DictionaryFacade/
   * DeepEntityFacade, вместо синглтон-инстанса; вызовы у потребителей
   * (Main.controller.js, Component.js) не меняются — они уже обращались к
   * модулю как к статическому объекту (`PersonSearchFacade.search(...)`).
   */
  class PersonSearchFacade {
    /**
     * [Fix, аудит] Promise-based — как DictionaryFacade.load()/SubmitFacade.submit(),
     * а не callback: раньше был единственным callback-based фасадом в проекте
     * (и единственным местом в контроллере, вызванным не через .then()), хотя
     * ничто в дебаунсе этого не требует — обогнанный более новым запросом вызов
     * просто оставляет свой Promise вечно (и безвредно) неразрешённым, ровно
     * как раньше оставлял свой fnCallback невызванным.
     * @param {sap.ui.model.odata.v2.ODataModel} oModel
     * @param {string} sQuery
     * @param {string} [sCheckDate] ISO date (yyyy-MM-dd); if set, only persons active on this date are returned
     * @param {string} [sRole] debounce bucket key (e.g. "inspected"/"inspector")
     * @returns {Promise<{Pernr:string, Fullname:string}[]>}
     */
    // [Fix РЕАЛЬНЫЙ БАГ, аудит] _oLatestSeq[sKey] — счётчик "какой запуск
    // поиска по этой роли самый свежий". Раньше debounce (clearTimeout)
    // защищал только от ДВОЙНОГО запуска, ПОКА предыдущий таймер ещё не
    // истёк — но ничего не мешало ДВУМ уже реально ушедшим на сервер
    // read()-ам (для двух разных, всё более уточнённых, запросов) вернуться
    // из сети в ОБРАТНОМ порядке. На локальном MockServer без задержки сети
    // это не воспроизвести — но при реальном бэкенде (тот же общий бэк, что
    // и у redux) более старый (по вводу) запрос вполне может ответить позже
    // нового и затереть корректный список подсказкой по неправильному
    // человеку. Каждый search() увеличивает счётчик и запоминает СВОЙ номер
    // (iSeq); ответ применяется, только если он всё ещё самый свежий на
    // момент прихода (см. _read ниже) — тот же принцип "штамп + проверка
    // перед записью", что уже использует _bSubmitInFlight в Submit.js для
    // другого класса гонки (двойной сабмит).
    static search(oModel, sQuery, sCheckDate, sRole) {
      if (!oModel) {
        Log.error("PersonSearchFacade: ODataModel not provided", null, LOG_COMPONENT);
        return Promise.resolve([]);
      }

      const sKey = sRole || "default";
      clearTimeout(PersonSearchFacade._oTimers[sKey]);

      if (!sQuery || sQuery.length < MIN_QUERY_LEN) {
        // Пустой/слишком короткий ввод отменяет и любой ещё летящий по сети
        // запрос этой роли — инкремент счётчика делает его ответ, когда бы
        // он ни пришёл, автоматически устаревшим (см. _read).
        PersonSearchFacade._oLatestSeq[sKey] = (PersonSearchFacade._oLatestSeq[sKey] || 0) + 1;
        return Promise.resolve([]);
      }

      const iSeq = (PersonSearchFacade._oLatestSeq[sKey] = (PersonSearchFacade._oLatestSeq[sKey] || 0) + 1);
      return new Promise((resolve) => {
        PersonSearchFacade._oTimers[sKey] = setTimeout(
          () => PersonSearchFacade._read(oModel, sQuery, sCheckDate, sKey, iSeq, resolve), DEBOUNCE_MS);
      });
    }

    // [Fix, обнаружено на живом прогоне] Fio Contains sQuery раньше уходил
    // как server-side $filter — sap.ui.core.util.MockServer сравнивает
    // подстроку РЕГИСТРОЗАВИСИМО ("иван" не находил "Слесарь Сергей Иванов",
    // "Иванов" — находил). Filter({caseSensitive:false}) не спасает: ODataModel
    // заворачивает сравнение в tolower(...), а MockServer 1.71 такую функцию
    // в $filter не понимает вообще (сам HTTP-запрос падает). Реальный
    // SAP Gateway/HANA обычно регистронезависим по коллации CHAR-полей, но
    // полагаться на это (или на конкретное поведение MockServer) для
    // критичного для UX условия "нашёлся человек или нет" — тот же ненадёжный
    // контракт, что уже разобран для ActiveTo выше: текстовое совпадение
    // проверяется здесь, на границе, а не доверяется серверному $filter.
    static _read(oModel, sQuery, sCheckDate, sKey, iSeq, resolve) {
      const oActiveFilter = PersonSearchFacade._buildActiveOnFilter(sCheckDate);

      oModel.read(`/${BackendConfig.ENTITY_SETS.PERSONS}`, {
        filters: oActiveFilter ? [oActiveFilter] : [],
        urlParameters: {
          "$top": String(MAX_CANDIDATE_ROWS),
          "$select": "Pernr,Fio,ActiveFrom,ActiveTo",
          "$orderby": "Fio asc"
        },
        success: (oData) => {
          // [Fix РЕАЛЬНЫЙ БАГ, аудит] Если за время сетевого запроса пользователь
          // успел набрать ещё и запустился более новый search() для этой же
          // роли — iSeq уже не совпадает с текущим _oLatestSeq[sKey]. Этот
          // ответ отбрасывается целиком (resolve(null), не [] — см.
          // PersonSearch.js#onPersonLiveChange, где null отличают от
          // "реально пустой результат"), а не применяется поверх уже более
          // актуального списка подсказок.
          if (iSeq !== PersonSearchFacade._oLatestSeq[sKey]) { resolve(null); return; }

          const sQueryLower = sQuery.toLowerCase();
          const aRows = ((oData && oData.results) || [])
            .filter((r) => (r.Fio || "").toLowerCase().indexOf(sQueryLower) > -1)
            .filter((r) => PersonSearchFacade._isActiveOn(r, sCheckDate));
          // [MIGRATION_MAPPING.md, OPEN-3 — решено] Persons (redux) не несёт
          // OrgAssignment/Position, которые были в старой I_PersonSearch —
          // поля убраны из формы целиком, не запрашиваются здесь.
          //
          // [Fix регрессии] BaseInfo.fragment.xml/Main.controller.js ожидают
          // Fullname — Persons (redux) отдаёт Fio; маппинг делается здесь, на
          // границе, а не в двух потребителях.
          resolve(aRows.slice(0, 20).map((r) => ({ Pernr: r.Pernr, Fullname: r.Fio })));
        },
        error: (oError) => {
          if (iSeq !== PersonSearchFacade._oLatestSeq[sKey]) { resolve(null); return; }
          Log.error("PersonSearch read failed", oError.message, LOG_COMPONENT);
          resolve([]);
        }
      });
    }

    // ActiveFrom le :date — единственная часть диапазона активности, безопасно
    // выносимая в server-side $filter (обычное сравнение, без null-семантики).
    // ActiveTo проверяется отдельно в _isActiveOn(), см. класс-комментарий выше.
    static _buildActiveOnFilter(sCheckDate) {
      if (!sCheckDate) {
        return null;
      }
      const oDate = new Date(sCheckDate);
      if (isNaN(oDate.getTime())) {
        return null;
      }
      return new Filter("ActiveFrom", FilterOperator.LE, oDate);
    }

    // [Fix] Точечная проверка верхней границы диапазона активности — ActiveTo
    // null означает "бессрочно активен". Единственное место, разбирающее это
    // условие; ActiveFrom сюда не дублируется — та часть уже авторитетно
    // отфильтрована сервером через _buildActiveOnFilter.
    static _isActiveOn(oRow, sCheckDate) {
      if (!sCheckDate) {
        return true;
      }
      if (!oRow.ActiveTo) {
        return true;
      }
      const oCheckDate = new Date(sCheckDate);
      const oActiveTo = new Date(oRow.ActiveTo);
      return isNaN(oCheckDate.getTime()) || oActiveTo >= oCheckDate;
    }

    static clearCache() {
      Object.keys(PersonSearchFacade._oTimers).forEach((sKey) => clearTimeout(PersonSearchFacade._oTimers[sKey]));
      PersonSearchFacade._oTimers = {};
      PersonSearchFacade._oLatestSeq = {};
    }
  }

  PersonSearchFacade._oTimers = {};
  PersonSearchFacade._oLatestSeq = {};

  return PersonSearchFacade;
});
