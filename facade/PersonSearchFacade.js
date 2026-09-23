sap.ui.define([
  "sap/ui/model/Filter",
  "sap/ui/model/FilterOperator",
  "sap/base/Log",
  "sap/pc_lite/lite/model/BackendConfig",
  "sap/pc_lite/lite/util/SearchText"
], (Filter, FilterOperator, Log, BackendConfig, SearchText) => {
  "use strict";

  const DEBOUNCE_MS = 300;
  const MIN_QUERY_LEN = 3;
  const LOG_COMPONENT = "sap.pc_lite.lite.facade.PersonSearchFacade";
  // [Fix FN-07/PF-01/SF-07, аудит] Раньше на КАЖДУЮ паузу в вводе читались
  // первые 2000 сотрудников по алфавиту и фильтровались на клиенте — всё, что
  // сортируется после 2000-й строки, было ненаходимо в принципе. Теперь текст
  // уходит на сервер штатной custom query option Gateway "search" (SADL,
  // @Search.* на ZI_Person — см. abap/README.md), $top — лишь потолок ответа.
  const SERVER_TOP = 100;
  const MAX_SUGGESTIONS = 20;
  const CACHE_MAX_ENTRIES = 50;

  /**
   * Debounced person search against /Persons.
   *
   * [Fix Code-to-Data / HANA push-down] ActiveFrom (LE :date) фильтруется
   * на сервере — обычное сравнение с реальным значением, без null-семантики.
   *
   * [Архитектурное решение] ActiveTo (nullable — "бессрочно активен") НЕ
   * фильтруется через `eq null` на сервере: MockServer 1.71 возвращает [] на
   * "ActiveTo eq null", и тот же класс дефекта (`= NULL` вместо `IS NULL`)
   * встречается в generated DPC. ActiveTo проверяется на границе, в _isActiveOn().
   *
   * [Fix SF-02] Ответ сервера (search может быть fuzzy) ВСЕГДА проходит
   * второй, клиентский проход SearchText.matches (регистр, ё/е, порядок слов)
   * и ранжирование — финальный список предсказуем на любом бэкенде.
   */
  class PersonSearchFacade {
    /**
     * [Fix, аудит] Promise-based. Контракт результата:
     *  - массив {Pernr, Fullname} (возможно пустой) — актуальный ответ;
     *  - null — ответ устарел (по этой роли уже запущен более новый поиск);
     *  - reject — ошибка чтения (только для ещё актуального запроса).
     * Обогнанный debounce-вызов оставляет свой Promise неразрешённым (безвредно).
     * @param {sap.ui.model.odata.v2.ODataModel} oModel
     * @param {string} sQuery
     * @param {string} [sCheckDate] ISO date (yyyy-MM-dd); if set, only persons active on this date are returned
     * @param {string} [sRole] debounce bucket key (e.g. "inspected"/"inspector")
     * @returns {Promise<{Pernr:string, Fullname:string}[]|null>}
     */
    // [Fix РЕАЛЬНЫЙ БАГ, аудит] _oLatestSeq[sKey] — "какой запуск поиска по
    // этой роли самый свежий": два ушедших в сеть read() могут вернуться в
    // обратном порядке, применяется только ответ с актуальным iSeq.
    static search(oModel, sQuery, sCheckDate, sRole) {
      if (!oModel) {
        Log.error("PersonSearchFacade: ODataModel not provided", null, LOG_COMPONENT);
        return Promise.resolve([]);
      }

      const sKey = sRole || "default";
      clearTimeout(PersonSearchFacade._oTimers[sKey]);
      // Любой новый ввод (в т.ч. слишком короткий) делает ещё летящий ответ
      // этой роли устаревшим.
      const iSeq = (PersonSearchFacade._oLatestSeq[sKey] = (PersonSearchFacade._oLatestSeq[sKey] || 0) + 1);

      if (!PersonSearchFacade.isQueryLongEnough(sQuery)) {
        return Promise.resolve([]);
      }
      // [Fix RS-01] sNorm (с ё->е) — только для клиентского второго прохода;
      // кэш и дедупликация — по строке, которая реально уходит на сервер.
      const sNorm = SearchText.normalize(sQuery);
      const sSent = PersonSearchFacade._serverText(sQuery);

      // Кэш-хит (точный или надмножество от более короткого запроса) — без
      // сети и без debounce: подсказки при допечатывании появляются сразу.
      // [Fix RS-01] Кэш-хит с пустым итогом не "залипает": надмножество могло быть
      // неполным (fuzzy/ё) — тогда обычный (debounced) запрос на сервер.
      const oCached = PersonSearchFacade._findCached(sCheckDate || "", sSent);
      if (oCached) {
        const aCachedItems = PersonSearchFacade._finish(oCached.rows, sNorm);
        if (aCachedItems.length) { return Promise.resolve(aCachedItems); }
      }

      return new Promise((resolve, reject) => {
        PersonSearchFacade._oTimers[sKey] = setTimeout(() => {
          PersonSearchFacade._fetch(oModel, sSent, sCheckDate).then((oResult) => {
            resolve(iSeq === PersonSearchFacade._oLatestSeq[sKey] ? PersonSearchFacade._finish(oResult.rows, sNorm) : null);
          }, (oError) => {
            if (iSeq !== PersonSearchFacade._oLatestSeq[sKey]) { resolve(null); return; }
            reject(oError);
          });
        }, DEBOUNCE_MS);
      });
    }

    // Текст, уходящий на сервер: пробелы схлопнуты, нижний регистр, БЕЗ ё->е
    // (складывает ли ё/е сам сервер — не наше знание, см. abap/README.md).
    static _serverText(sQuery) {
      return String(sQuery == null ? "" : sQuery).replace(/\s+/g, " ").trim().toLowerCase();
    }

    /** @returns {boolean} whether the normalized query is long enough to search */
    static isQueryLongEnough(sQuery) {
      return SearchText.normalize(sQuery).length >= MIN_QUERY_LEN;
    }

    // Один запрос на (дата, отправляемый текст): одновременные/повторные
    // вызовы получают тот же Promise; отклонённый и пустой ответ удаляются из
    // кэша, чтобы следующий ввод повторил попытку.
    static _fetch(oModel, sSent, sCheckDate) {
      const sDateKey = sCheckDate || "";
      const sCacheKey = `${sDateKey}|${sSent}`;
      const oCache = PersonSearchFacade._oCache;
      const oExisting = oCache.get(sCacheKey);
      if (oExisting) {
        return oExisting.promise;
      }

      const oEntry = { date: sDateKey, query: sSent, result: null, promise: null };
      oEntry.promise = new Promise((resolve, reject) => {
        const oActiveFilter = PersonSearchFacade._buildActiveOnFilter(sCheckDate);
        oModel.read(`/${BackendConfig.ENTITY_SETS.PERSONS}`, {
          filters: oActiveFilter ? [oActiveFilter] : [],
          urlParameters: {
            "search": sSent,
            "$top": String(SERVER_TOP),
            "$select": "Pernr,Fio,ActiveTo"
          },
          success: (oData) => {
            const aRaw = (oData && oData.results) || [];
            const oResult = {
              rows: aRaw.filter((r) => PersonSearchFacade._isActiveOn(r, sCheckDate))
                .map((r) => ({ Pernr: r.Pernr, Fio: r.Fio || "" })),
              truncated: aRaw.length >= SERVER_TOP
            };
            if (oResult.truncated) {
              Log.warning(`Persons search "${sSent}" hit $top=${SERVER_TOP}; results may be incomplete`, null, LOG_COMPONENT);
            }
            oEntry.result = oResult;
            // [Fix RS-01] Пустой ответ не кэшируем (на нём же строились бы "надмножества").
            if (!oResult.rows.length && oCache.get(sCacheKey) === oEntry) { oCache.delete(sCacheKey); }
            resolve(oResult);
          },
          error: (oError) => {
            if (oCache.get(sCacheKey) === oEntry) { oCache.delete(sCacheKey); }
            Log.error("PersonSearch read failed", oError && oError.message, LOG_COMPONENT);
            reject(oError || new Error("Persons read failed"));
          }
        });
      });

      oCache.set(sCacheKey, oEntry);
      if (oCache.size > CACHE_MAX_ENTRIES) {
        oCache.delete(oCache.keys().next().value);
      }
      return oEntry.promise;
    }

    // Точное совпадение ключа или загруженный НЕусечённый (< $top строк) ответ
    // на более общий запрос той же даты: всё, что матчит новый запрос, матчит
    // и старый (SearchText.isRefinementOf), значит уже есть в его ответе.
    // Слова сравниваются по сырому (без ё->е) тексту: "семенов" не надмножество для "семёнов".
    static _findCached(sDateKey, sSent) {
      const oCache = PersonSearchFacade._oCache;
      const oExact = oCache.get(`${sDateKey}|${sSent}`);
      if (oExact && oExact.result) {
        return oExact.result;
      }
      let oFound = null;
      oCache.forEach((oEntry) => {
        if (!oFound && oEntry.result && !oEntry.result.truncated && oEntry.date === sDateKey &&
            PersonSearchFacade._isRawRefinement(sSent, oEntry.query)) {
          oFound = oEntry.result;
        }
      });
      return oFound;
    }

    // Каждое старое слово входит подстрокой в какое-то новое (без ё->е, только нижний регистр).
    static _isRawRefinement(sNew, sOld) {
      const aNew = sNew.split(" ");
      const aOld = sOld.split(" ").filter(Boolean);
      return aOld.length > 0 && aOld.every((o) => aNew.some((n) => n.indexOf(o) !== -1));
    }

    // Второй проход: нормализованное совпадение всех слов запроса по "ФИО табельный №"
    // (сервер ищет и по Pernr — [Fix RS-02]), затем ранжирование (точное -> начало ->
    // начала слов -> подстрока; совпадение только через Pernr — после ФИО) и потолок.
    // Fio -> Fullname маппится здесь, на границе (StepPeople.fragment.xml/PersonSearch.js ждут Fullname).
    static _finish(aRows, sNorm) {
      return (aRows || [])
        .filter((r) => SearchText.matches(`${r.Fio} ${r.Pernr || ""}`, sNorm))
        .map((r) => ({ row: r, rank: PersonSearchFacade._rank(r, sNorm) }))
        .sort((a, b) => (a.rank - b.rank) || a.row.Fio.localeCompare(b.row.Fio, "ru"))
        .slice(0, MAX_SUGGESTIONS)
        .map((o) => ({ Pernr: o.row.Pernr, Fullname: o.row.Fio }));
    }

    static _rank(oRow, sNorm) {
      if (SearchText.matches(oRow.Fio, sNorm)) { return SearchText.rank(oRow.Fio, sNorm); }
      return SearchText.normalize(oRow.Pernr).indexOf(sNorm) === 0 ? 4 : 5;
    }

    /**
     * [Fix FN-11/SF-04] Перепроверка уже выбранного сотрудника после смены даты проверки.
     * @returns {Promise<boolean|null>} активен ли на дату; null — проверить не удалось
     */
    static isPersonActiveOn(oModel, sPernr, sCheckDate) {
      if (!oModel || !sPernr || !sCheckDate) {
        return Promise.resolve(true);
      }
      return oModel.metadataLoaded().then(() => new Promise((resolve) => {
        oModel.read(oModel.createKey(`/${BackendConfig.ENTITY_SETS.PERSONS}`, { Pernr: sPernr }), {
          urlParameters: { "$select": "Pernr,ActiveFrom,ActiveTo" },
          success: (oRow) => {
            const oDate = new Date(sCheckDate);
            const bFromOk = !oRow || !oRow.ActiveFrom || isNaN(oDate.getTime()) || new Date(oRow.ActiveFrom) <= oDate;
            resolve(!!oRow && bFromOk && PersonSearchFacade._isActiveOn(oRow, sCheckDate));
          },
          error: (oError) => {
            if (oError && String(oError.statusCode) === "404") { resolve(false); return; }
            Log.warning("Person re-check failed", oError && oError.message, LOG_COMPONENT);
            resolve(null);
          }
        });
      }));
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
    // null означает "бессрочно активен".
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
      PersonSearchFacade._oCache = new Map();
    }
  }

  PersonSearchFacade.MIN_QUERY_LEN = MIN_QUERY_LEN;
  PersonSearchFacade._oTimers = {};
  PersonSearchFacade._oLatestSeq = {};
  // "<checkDate>|<normalized query>" -> {date, query, promise, result: {rows, truncated} | null}
  PersonSearchFacade._oCache = new Map();

  return PersonSearchFacade;
});
