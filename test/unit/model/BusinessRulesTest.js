sap.ui.define([
  "sap/pc_lite/lite/model/BusinessRules"
], (BusinessRules) => {
  "use strict";

  QUnit.module("model/BusinessRules — строки Checks/Barriers");

  QUnit.test("hasRowUserData: код сам по себе не данные пользователя (UX-03)", (assert) => {
    assert.notOk(BusinessRules.hasRowUserData(null));
    assert.notOk(BusinessRules.hasRowUserData({ CheckCode: "A", CheckText: "a", Comment: "", Status: "" }), "авто-строка с одним кодом");
    assert.notOk(BusinessRules.hasRowUserData({ Comment: "   " }), "комментарий из пробелов");
    assert.ok(BusinessRules.hasRowUserData({ Comment: "есть" }));
    assert.ok(BusinessRules.hasRowUserData({ Status: "X" }), "Удовлетворительно");
    assert.ok(BusinessRules.hasRowUserData({ Status: " " }), "Неудовлетворительно — код из одного пробела");
    assert.ok(BusinessRules.hasRowUserData({ NonConformityDescription: "d" }));
    assert.ok(BusinessRules.hasRowUserData({ NonConformityLocation: "l" }));
  });

  QUnit.test("countCodedRows: только строки с кодом (FN-05)", (assert) => {
    assert.strictEqual(BusinessRules.countCodedRows(undefined, "CheckCode"), 0);
    assert.strictEqual(BusinessRules.countCodedRows([
      { CheckCode: "A" }, { CheckCode: "" }, { CheckCode: "B", Comment: "x" }, { Comment: "без кода" }
    ], "CheckCode"), 2);
  });

  return {};
});
