sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/pc_lite/lite/controller/mixin/RowsAndAutoFill"
], (JSONModel, RowsAndAutoFill) => {
  "use strict";

  // Миксин — обычный объект; для чистых методов достаточно this.getView().getModel().
  function makeContext (aChecks, aBarriers) {
    const mModels = {
      checksModel: new JSONModel({ items: aChecks }),
      barriersModel: new JSONModel({ items: aBarriers }),
      dictionaryModel: new JSONModel({
        CHECKS: [{ Code: "A", PkLevels: "2,3" }, { Code: "B", PkLevels: "3" }, { Code: "NOTEXT", PkLevels: "2" }],
        BARRIERS: [{ Code: "F", PkLevels: "0,1,2,3,4" }],
        _index: { CHECKS: { A: "Проверка A", B: "Проверка B" }, BARRIERS: { F: "Ограждение" } },
        AUTO_ROWS: {
          2: [
            { Type: "Checks", Code: "A" },
            { Type: "Checks", Code: "A" },
            { Type: "Checks", Code: "B" }, // недоступен на КПР-2
            { Type: "Checks", Code: "ZZZ" }, // нет в справочнике
            { Type: "Checks", Code: "NOTEXT" }, // нет текста
            { Type: "Barriers", Code: "F" }
          ],
          1: [{ Type: "Barriers", Code: "F" }] // секция барьеров на КПР-1 запрещена
        }
      })
    };
    return Object.assign({}, RowsAndAutoFill, { getView: () => ({ getModel: (sName) => mModels[sName] }), mModels });
  }

  QUnit.module("controller/mixin/RowsAndAutoFill");

  QUnit.test("_computePurge — пробный прогон без записи в модели (FN-04)", (assert) => {
    const aChecks = [{ CheckCode: "A", Comment: "x" }, { CheckCode: "B" }, { CheckCode: "", Comment: "без кода" }];
    const aBarriers = [{ BarrierCode: "F" }, { BarrierCode: "" }];
    const oCtx = makeContext(aChecks, aBarriers);

    const aPlanTo3 = oCtx._computePurge("3");
    assert.deepEqual(aPlanTo3.map((p) => p.iRemoved), [0, 0], "на КПР-3 всё допустимо");

    const aPlanTo2 = oCtx._computePurge("2");
    assert.deepEqual(aPlanTo2.map((p) => p.iRemoved), [1, 0], "B недоступен на КПР-2");

    const aPlanTo1 = oCtx._computePurge("1");
    assert.deepEqual(aPlanTo1.map((p) => p.iRemoved), [2, 2], "A и B удалятся, барьеры — вся секция");
    assert.deepEqual(aPlanTo1[0].aKept, [aChecks[2]], "строка без кода остаётся (её ловит валидация)");
    assert.strictEqual(oCtx.mModels.checksModel.getProperty("/items").length, 3, "модель не тронута");
    assert.strictEqual(oCtx.mModels.barriersModel.getProperty("/items").length, 2, "модель не тронута");
  });

  QUnit.test("_applyAutoRows — пропуск неизвестных/недопустимых кодов, без дублей (SF-11/PF-06)", (assert) => {
    const oCtx = makeContext([], []);
    assert.strictEqual(oCtx._applyAutoRows("2"), 2, "A и F; B/ZZZ/NOTEXT пропущены, дубль A схлопнут");
    const aChecks = oCtx.mModels.checksModel.getProperty("/items");
    assert.strictEqual(aChecks.length, 1);
    assert.strictEqual(aChecks[0].CheckCode, "A");
    assert.strictEqual(aChecks[0].CheckText, "Проверка A");
    assert.strictEqual(oCtx.mModels.barriersModel.getProperty("/items")[0].BarrierText, "Ограждение");

    assert.strictEqual(oCtx._applyAutoRows("2"), 0, "идемпотентно");
    assert.strictEqual(oCtx._applyAutoRows("1"), 0, "запрещённая секция не пополняется");
  });

  return {};
});
