sap.ui.define([
  "sap/pc_lite/lite/facade/DictionaryFacade"
], (DictionaryFacade) => {
  "use strict";

  function makeDictModel (oData) {
    return { getProperty: (sPath) => oData[sPath.replace(/^\//, "")] };
  }

  QUnit.module("facade/DictionaryFacade — нормализованный поиск");

  QUnit.test("SearchKey у местоположений и value-help", (assert) => {
    const aLoc = DictionaryFacade._normalizeLocationRows([
      { LocationUuid: "u1", LocationCode: "LOC-003", LocationName: "Цех «Сборки»", ParentLocationUuid: "" }
    ]);
    assert.strictEqual(aLoc[0].SearchKey, "цех «сборки» loc-003");
    assert.notOk("HierarchyLevel" in aLoc[0], "мёртвое поле убрано");

    const oEntry = DictionaryFacade._vhEntry("DOC", "Проверка Документов", { Category: "A", PkLevels: "1,2" });
    assert.strictEqual(oEntry.SearchKey, "проверка документов doc");
  });

  QUnit.test("test-фильтр: слова в любом порядке, запрос из пробелов — навигация по уровню", (assert) => {
    const aSearch = DictionaryFacade.buildLocationFilters("p1", "  сборки   ЦЕХ ");
    assert.strictEqual(aSearch.length, 1);
    assert.strictEqual(aSearch[0].sPath, "SearchKey");
    assert.ok(aSearch[0].fnTest("цех сборки loc-003"));
    assert.notOk(aSearch[0].fnTest("цех покраски loc-004"));

    const aLevel = DictionaryFacade.buildLocationFilters("p1", "   ");
    assert.strictEqual(aLevel[0].sPath, "ParentNodeID", "пробелы — не поиск");
  });

  QUnit.test("buildCategoryCounts считает по той же нормализации", (assert) => {
    const oDict = makeDictModel({
      CHECKS: [
        DictionaryFacade._vhEntry("A1", "Осмотр ёмкости", { Category: "X", PkLevels: "2" }),
        DictionaryFacade._vhEntry("A2", "Осмотр крана", { Category: "X", PkLevels: "2" }),
        DictionaryFacade._vhEntry("B1", "Емкость — документы", { Category: "Y", PkLevels: "3" })
      ]
    });
    assert.deepEqual(DictionaryFacade.buildCategoryCounts(oDict, "CHECKS", "2", "емкост осмотр"), { X: 1 });
    assert.deepEqual(DictionaryFacade.buildCategoryCounts(oDict, "CHECKS", "2", " "), { X: 2 });
  });

  QUnit.module("facade/DictionaryFacade#loadLocations");

  QUnit.test("ответ для более старой даты не затирает более новый", (assert) => {
    const aPending = [];
    const oModel = {
      metadataLoaded: () => Promise.resolve(),
      read: (sPath, mParams) => aPending.push(mParams)
    };
    const oStore = {};
    const oLocModel = { setProperty: (sPath, v) => { oStore[sPath] = v; } };
    const row = (sName) => [{ LocationUuid: sName, LocationCode: sName, LocationName: sName, ParentLocationUuid: "", EffectiveDate: new Date(0) }];

    const pOld = DictionaryFacade.loadLocations(oModel, oLocModel, "2026-01-01");
    const pNew = DictionaryFacade.loadLocations(oModel, oLocModel, "2026-09-01");
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      assert.strictEqual(aPending.length, 2);
      assert.strictEqual(aPending[0].urlParameters.$select, "LocationUuid,LocationCode,LocationName,ParentLocationUuid,EffectiveDate");
      aPending[1].success({ results: row("NEW") });
      aPending[0].success({ results: row("OLD") });
      return Promise.all([pOld, pNew]);
    }).then(([bOld, bNew]) => {
      assert.strictEqual(bOld, false, "устаревший ответ отброшен");
      assert.strictEqual(bNew, true);
      assert.strictEqual(oStore["/items"][0].NodeID, "NEW");
      assert.ok(oStore["/lookupMap"].NEW, "lookupMap из того же ответа");
    });
  });
});
