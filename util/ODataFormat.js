sap.ui.define([
  "sap/ui/core/format/DateFormat",
  "sap/pc_lite/lite/model/EntityConfig"
], (DateFormat, EntityConfig) => {
  "use strict";

  // [SSOT] Паттерны — EntityConfig.CONSTRAINTS, тот же источник, на который
  // биндятся DatePicker/TimePicker (valueFormat) во фрагментах через
  // constraintsModel — не две независимые строки "yyyy-MM-dd"/"HH:mm:ss".
  // [Fix FN-03] strictParsing: "2026-02-31" — null, а не тихий перенос на 03.03.
  const oDateFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.DateValueFormat, UTC: true, strictParsing: true });
  // [Fix FN-02] today() — по ЛОКАЛЬНОМУ календарю: с UTC:true восточнее UTC
  // (Владивосток до 10:00) по умолчанию подставлялось вчерашнее число.
  const oLocalDateFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.DateValueFormat });
  const oTimeFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.TimeValueFormat });
  const TIME_RE = /^(\d{1,2}):(\d{2}):(\d{2})$/;

  class ODataFormat {
    static today() {
      return oLocalDateFmt.format(new Date());
    }

    static now() {
      return oTimeFmt.format(new Date());
    }

    /** @returns {boolean} non-empty value in DateValueFormat that is a real calendar date */
    static isValidDate(sValue) {
      return !!sValue && !!oDateFmt.parse(String(sValue));
    }

    /** @returns {boolean} non-empty HH:mm:ss value with h 0-23, m/s 0-59 */
    static isValidTime(sValue) {
      const aM = TIME_RE.exec(String(sValue || ""));
      return !!aM && +aM[1] <= 23 && +aM[2] <= 59 && +aM[3] <= 59;
    }

    // ODataModel v2 работает в JSON-режиме (manifest.json: "json": true) —
    // Edm.DateTime сериализуется из нативного JS Date без ручной сборки
    // строки "/Date(ms)/". Парсинг делегирован стандартному DateFormat;
    // UTC-полночь — каноническое date-only представление Edm.DateTime.
    // [Fix FN-03] Непарсящееся значение — исключение (как у toODataTime),
    // а не тихий Date:null в payload; Submit.onSubmit ловит ошибки build().
    static toODataDate(sValue) {
      if (!sValue) {
        return null;
      }
      const oDate = oDateFmt.parse(String(sValue));
      if (!oDate) {
        throw new Error(`ODataFormat.toODataDate: malformed date value "${sValue}", expected ${EntityConfig.CONSTRAINTS.DateValueFormat}`);
      }
      return oDate;
    }

    // Edm.Time в OData V2 — каноническое ISO-8601 duration-представление,
    // это штатный wire-формат протокола, а не самописный велосипед.
    // [Fix FN-03] Проверяются и диапазоны (25:99:00 раньше уходил как PT25H99M0S).
    static toODataTime(sValue) {
      if (!sValue) {
        return null;
      }
      if (!ODataFormat.isValidTime(sValue)) {
        throw new Error(`ODataFormat.toODataTime: malformed time value "${sValue}", expected HH:mm:ss`);
      }
      const [h, m, s] = String(sValue).split(":").map((p) => parseInt(p, 10));
      return `PT${h}H${m}M${s}S`;
    }
  }

  return ODataFormat;
});
