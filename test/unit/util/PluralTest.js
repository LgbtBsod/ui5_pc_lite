sap.ui.define([
  "sap/pc_lite/lite/util/Plural"
], (Plural) => {
  "use strict";

  QUnit.module("util/Plural");

  QUnit.test("русские формы: one/few/many (UX-15)", (assert) => {
    const mExpected = { 0: "many", 1: "one", 2: "few", 4: "few", 5: "many", 11: "many", 12: "many",
      14: "many", 21: "one", 22: "few", 25: "many", 101: "one", 111: "many", 112: "many", 122: "few" };
    Object.keys(mExpected).forEach((n) => {
      assert.strictEqual(Plural.category(Number(n), "ru"), mExpected[n], `ru ${n}`);
    });
  });

  QUnit.test("английские формы: one/many", (assert) => {
    assert.strictEqual(Plural.category(1, "en"), "one");
    assert.strictEqual(Plural.category(2, "en"), "many");
    assert.strictEqual(Plural.category(21, "en"), "many");
    assert.strictEqual(Plural.category(0, "en"), "many");
  });

  QUnit.test("getText выбирает ключ по правилу из самого бандла", (assert) => {
    const mTexts = { pluralRule: "ru", x_one: "{0} проверка", x_few: "{0} проверки", x_many: "{0} проверок" };
    const rb = { getText: (sKey, aArgs) => (mTexts[sKey] || sKey).replace("{0}", aArgs ? aArgs[0] : "{0}") };
    assert.strictEqual(Plural.getText(rb, "x", 1), "1 проверка");
    assert.strictEqual(Plural.getText(rb, "x", 3), "3 проверки");
    assert.strictEqual(Plural.getText(rb, "x", 21), "21 проверка");
    assert.strictEqual(Plural.getText(rb, "x", 11), "11 проверок");
  });
});
