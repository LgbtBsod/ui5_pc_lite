sap.ui.define([
  "sap/ui/core/util/MockServer",
  "sap/base/Log",
  "sap/pc_lite/lite/model/BackendConfig",
  "sap/pc_lite/lite/util/SearchText"
], (MockServer, Log, BackendConfig, SearchText) => {
  "use strict";

  // Fallback — только если manifest.json не удалось прочитать (см. _readRootUri).
  // Источник истины для URI — manifest.json/sap.app.dataSources.mainService.uri,
  // не эта константа.
  const FALLBACK_ROOT_URI = "/sap/opu/odata/sap/ZCHECK_SRV/";

  /** Bootstraps sap.ui.core.util.MockServer for standalone/dev runs; no-ops inside a real FLP. */
  class MockServerBootstrap {

    // [Fix] async — index.html обязан дождаться start() перед созданием
    // ComponentContainer, иначе первый OData-запрос уйдёт до того, как
    // MockServer начнёт перехватывать XHR.
    static start () {
      if (MockServerBootstrap._isFlp()) {
        Log.info("MockServer skipped — Fiori Launchpad detected (real OData)");
        return Promise.resolve(null);
      }

      if (MockServerBootstrap._oMockServer) {
        return Promise.resolve(MockServerBootstrap._oMockServer);
      }

      return MockServerBootstrap._readRootUri().then((sRootUri) => {
        const sModulePath = sap.ui.require.toUrl("sap/pc_lite/lite/model");

        // Штатный sap.ui.core.util.MockServer уже нативно поддерживает
        // $filter/$orderby/$top/$skip/$select и $batch — самописный парсер
        // (EnhancedMockServer) удалён как чистое дублирование ядра фреймворка.
        const oMockServer = new MockServer({ rootUri: sRootUri });
        oMockServer.simulate(`${sModulePath}/metadata.xml`, {
          sMockdataBaseUrl: sModulePath,
          bGenerateMissingMockData: false
        });

        const sCheckRoots = BackendConfig.ENTITY_SETS.CHECK_ROOTS;
        oMockServer.attachBefore("POST",
          (oEvent) => MockServerBootstrap._normalizeDeepCreate(oEvent, sCheckRoots), sCheckRoots);
        // [Fix, потеря данных] _normalizeDeepCreate вырезает to_Checks/
        // to_Barriers из тела запроса (штатный MockServer не умеет создавать
        // вложенные nav-коллекции из плоского JSON) — но без этого afterHook
        // вырезанные строки просто ПРОПАДАЛИ насовсем, ни разу не попадая
        // в CheckItems/Barriers. Обнаружено только явной перепроверкой
        // to_Checks/to_Barriers ПОСЛЕ create() — раньше проверялись только
        // корневые поля и сам факт успешного ответа.
        oMockServer.attachAfter("POST",
          (oEvent) => MockServerBootstrap._persistDeepChildren(oEvent, sCheckRoots), sCheckRoots);

        // [Fix FN-07] Эмуляция SADL-поиска Persons (ФИО/табельный, любой порядок
        // слов): штатный search MockServer 1.71 = startswith(Pernr), имена не
        // находились. Переопределён приватный метод — допустимо только потому,
        // что UI5 зафиксирован на 1.71.84, а файл — dev-only.
        const sPersons = BackendConfig.ENTITY_SETS.PERSONS;
        const fnOrigSearch = oMockServer._recursiveOdataQuerySearch.bind(oMockServer);
        oMockServer._recursiveOdataQuerySearch = (aData, sQuery, sFocus, sEntitySet) => (sEntitySet === sPersons
          ? aData.filter((r) => SearchText.matches(`${r.Fio || ""} ${r.Pernr || ""}`, sQuery))
          : fnOrigSearch(aData, sQuery, sFocus, sEntitySet));

        oMockServer.start();
        Log.info(`Standard MockServer started for ${sRootUri} (standalone/dev mode)`);
        MockServerBootstrap._oMockServer = oMockServer;
        return oMockServer;
      });
    }

    static stop () {
      if (MockServerBootstrap._oMockServer) {
        MockServerBootstrap._oMockServer.stop();
        Log.info("MockServer stopped");
      }
    }

    static destroy () {
      if (MockServerBootstrap._oMockServer) {
        MockServerBootstrap._oMockServer.stop();
        MockServerBootstrap._oMockServer.destroy();
        MockServerBootstrap._oMockServer = null;
        Log.info("MockServer destroyed");
      }
    }

    static _isFlp () {
      try {
        return !!(window.sap && window.sap.ushell && window.sap.ushell.Container);
      } catch (e) {
        return false;
      }
    }

    // [Fix SSOT] Раньше sRootUri был захардкожен здесь ВТОРОЙ раз, независимо
    // от manifest.json/sap.app.dataSources.mainService.uri — тот же URI в двух
    // местах, ничем не связанных. manifest.json читается как единственный
    // источник истины; жёсткая копия — только fallback на случай сбоя fetch
    // (этот код работает до того, как Component вообще создан — не можем
    // спросить this.getManifestEntry(...)).
    static _readRootUri () {
      return fetch("manifest.json")
        .then((r) => r.json())
        .then((oManifest) => {
          const sUri = oManifest["sap.app"] && oManifest["sap.app"].dataSources
            && oManifest["sap.app"].dataSources.mainService
            && oManifest["sap.app"].dataSources.mainService.uri;
          return sUri || FALLBACK_ROOT_URI;
        })
        .catch((e) => {
          Log.warning(`manifest.json read failed, using fallback root URI: ${e}`, null, "sap.pc_lite.lite.MockServerBootstrap");
          return FALLBACK_ROOT_URI;
        });
    }

    static _normalizeDeepCreate (oEvent, sCheckRoots) {
      const oXhr = oEvent.getParameter("oXhr");
      if (!oXhr || !oXhr.url || oXhr.url.indexOf(sCheckRoots) === -1) { return; }
      try {
        const oBody = JSON.parse(oXhr.requestBody || "{}");
        const oFlat = {};
        Object.keys(oBody).forEach((k) => {
          if (k !== "to_Checks" && k !== "to_Barriers") { oFlat[k] = oBody[k]; }
        });
        if (!oFlat.RootId) { oFlat.RootId = `GEN-${Date.now()}`; }
        // [По запросу] Зеркало redux/resolvers.py:345 (out["Updatable"] = not
        // out["ThisIsIntegrationData"]) — см. подробный комментарий у Property
        // Updatable в model/metadata.xml. pc_lite сам никогда не шлёт
        // ThisIsIntegrationData (у него нет сценария "запись от интеграции" —
        // это инструмент прямого ручного ввода) — по умолчанию false, как и
        // сделал бы redux для обычной, не интеграционной записи. Отсюда
        // Updatable у ЛЮБОЙ записи, созданной pc_lite, всегда true — ровно
        // то же значение, что получила бы такая же запись, введи её тот же
        // человек через redux напрямую.
        oFlat.ThisIsIntegrationData = oFlat.ThisIsIntegrationData || false;
        oFlat.Updatable = !oFlat.ThisIsIntegrationData;
        // [Fix, потеря данных] Вырезанные to_Checks/to_Barriers не выбрасываем —
        // сохраняем на самом oXhr (тот же объект живёт до attachAfter в рамках
        // одного запроса), чтобы _persistDeepChildren создал их отдельно после
        // того, как штатный MockServer создаст плоский Root.
        oXhr.__pendingChildren = {
          rootId: oFlat.RootId,
          checks: (oBody.to_Checks && oBody.to_Checks.results) || [],
          barriers: (oBody.to_Barriers && oBody.to_Barriers.results) || []
        };
        oXhr.requestBody = JSON.stringify(oFlat);
      } catch (e) {
        Log.warning(`Deep Entity POST normalize failed: ${e}`, null, "sap.pc_lite.lite.MockServerBootstrap");
      }
    }

    // [Fix, потеря данных] Без этого шага строки Checks/Barriers, вырезанные
    // _normalizeDeepCreate из тела запроса, пропадали насовсем — ни разу не
    // попадая в CheckItems/Barriers. getEntitySetData/setEntitySetData —
    // публичный API MockServer для чтения/записи его внутреннего mockdata,
    // не велосипед.
    static _persistDeepChildren (oEvent, sCheckRoots) {
      const oXhr = oEvent.getParameter("oXhr");
      const oPending = oXhr && oXhr.__pendingChildren;
      if (!oPending) { return; }

      const oMockServer = MockServerBootstrap._oMockServer;
      const nowIso = new Date().toISOString();

      MockServerBootstrap._appendChildRows(
        oMockServer, BackendConfig.ENTITY_SETS.CHECK_ITEMS, oPending.checks, oPending.rootId, "ItemId", "CI", nowIso);
      MockServerBootstrap._appendChildRows(
        oMockServer, BackendConfig.ENTITY_SETS.BARRIERS, oPending.barriers, oPending.rootId, "BarrierId", "BI", nowIso);

      delete oXhr.__pendingChildren;
    }

    // [DRY] Checks/Barriers персистятся идентично (составной ключ RootId +
    // собственный сгенерированный Id) — единственное различие: имя entity
    // set и имя id-поля. Раньше это было два почти одинаковых блока.
    static _appendChildRows (oMockServer, sEntitySet, aRows, sRootId, sIdField, sIdPrefix, sNowIso) {
      if (!aRows.length) { return; }
      const aExisting = oMockServer.getEntitySetData(sEntitySet) || [];
      aRows.forEach((oRow, i) => {
        aExisting.push({
          ...oRow,
          RootId: sRootId,
          [sIdField]: `${sRootId}-${sIdPrefix}-${i}`,
          LastChangedAt: sNowIso
        });
      });
      oMockServer.setEntitySetData(sEntitySet, aExisting);
    }
  }

  MockServerBootstrap._oMockServer = null;

  return MockServerBootstrap;
});
