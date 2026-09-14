sap.ui.define([
  "sap/ui/core/format/DateFormat",
  "sap/pc_lite/lite/model/EntityConfig"
], (DateFormat, EntityConfig) => {
  "use strict";

  // [SSOT] Паттерны — EntityConfig.CONSTRAINTS, тот же источник, на который
  // биндятся DatePicker/TimePicker (valueFormat) во фрагментах через
  // constraintsModel — не две независимые строки "yyyy-MM-dd"/"HH:mm:ss".
  const oDateFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.DateValueFormat, UTC: true });
  const oTimeFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.TimeValueFormat });

  class ODataFormat {
    static today() {
      return oDateFmt.format(new Date());
    }

    static now() {
      return oTimeFmt.format(new Date());
    }

    // ODataModel v2 работает в JSON-режиме (manifest.json: "json": true) —
    // Edm.DateTime сериализуется из нативного JS Date без ручной сборки
    // строки "/Date(ms)/". Парсинг делегирован стандартному DateFormat.
    static toODataDate(sValue) {
      if (!sValue) {
        return null;
      }
      return oDateFmt.parse(sValue);
    }

    // Edm.Time в OData V2 — каноническое ISO-8601 duration-представление,
    // это штатный wire-формат протокола, а не самописный велосипед.
    // [Fix] Раньше при < 3 частях m/s молча подставлялись нулями без лога —
    // TimePicker всегда отдаёт HH:mm:ss, но метод статический и вызываемый
    // извне; явная валидация формата ловит будущее неверное использование.
    static toODataTime(sValue) {
      if (!sValue) {
        return null;
      }
      const aParts = String(sValue).split(":");
      if (aParts.length !== 3 || aParts.some((p) => isNaN(parseInt(p, 10)))) {
        throw new Error(`ODataFormat.toODataTime: malformed time value "${sValue}", expected HH:mm:ss`);
      }
      const [h, m, s] = aParts.map((p) => parseInt(p, 10));
      return `PT${h}H${m}M${s}S`;
    }
  }

  return ODataFormat;
});
