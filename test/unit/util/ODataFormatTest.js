sap.ui.define([
  "sap/pc_lite/lite/util/ODataFormat"
], (ODataFormat) => {
  "use strict";

  // Подменяет Date только для вызова без аргументов (== "сейчас").
  function withNow (oFixed, fn) {
    const RealDate = window.Date;
    class FakeDate extends RealDate {
      constructor (...args) {
        if (args.length) { super(...args); } else { super(oFixed.getTime()); }
      }

      static now () { return oFixed.getTime(); }
    }
    window.Date = FakeDate;
    try {
      return fn();
    } finally {
      window.Date = RealDate;
    }
  }

  QUnit.module("util/ODataFormat#today");

  // [Fix FN-02] С UTC-форматтером восточнее UTC после полуночи был "вчера",
  // западнее UTC перед полуночью — "завтра". Оба края — в любом часовом поясе.
  QUnit.test("локальная дата сразу после полуночи", (assert) => {
    const sToday = withNow(new Date(2026, 8, 22, 0, 30, 0), () => ODataFormat.today());
    assert.strictEqual(sToday, "2026-09-22");
  });

  QUnit.test("локальная дата перед полуночью", (assert) => {
    const sToday = withNow(new Date(2026, 8, 22, 23, 30, 0), () => ODataFormat.today());
    assert.strictEqual(sToday, "2026-09-22");
  });

  QUnit.module("util/ODataFormat#toODataDate");

  QUnit.test("валидная дата — UTC-полночь (Edm.DateTime date-only)", (assert) => {
    const oDate = ODataFormat.toODataDate("2026-09-07");
    assert.strictEqual(oDate.getTime(), Date.UTC(2026, 8, 7));
  });

  QUnit.test("пустое значение — null, мусор и несуществующая дата — исключение", (assert) => {
    assert.strictEqual(ODataFormat.toODataDate(""), null);
    assert.throws(() => ODataFormat.toODataDate("31.02.2026"), /malformed date/);
    assert.throws(() => ODataFormat.toODataDate("2026-02-31"), /malformed date/, "strictParsing: 31 февраля");
  });

  QUnit.test("isValidDate", (assert) => {
    assert.ok(ODataFormat.isValidDate("2024-02-29"), "високосный год");
    assert.notOk(ODataFormat.isValidDate("2026-02-29"));
    assert.notOk(ODataFormat.isValidDate(""));
  });

  QUnit.module("util/ODataFormat#toODataTime");

  QUnit.test("валидное время и диапазоны", (assert) => {
    assert.strictEqual(ODataFormat.toODataTime("08:05:09"), "PT8H5M9S");
    assert.strictEqual(ODataFormat.toODataTime(""), null);
    assert.throws(() => ODataFormat.toODataTime("25:00:00"), /malformed time/);
    assert.throws(() => ODataFormat.toODataTime("10:60:00"), /malformed time/);
    assert.throws(() => ODataFormat.toODataTime("10:00"), /malformed time/);
    assert.ok(ODataFormat.isValidTime("23:59:59"));
    assert.notOk(ODataFormat.isValidTime("ab:cd:ef"));
  });
});
