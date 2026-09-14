sap.ui.define([], () => {
  "use strict";

  // [Архитектурное решение] Лайт и полная версия (redux) — ДВА раздельных
  // SEGW-сервиса на одних и тех же DB-таблицах (zchk_root/zchk_basic/
  // zchk_item/zchk_barr), не один общий ZCHECK_SRV. У полной версии —
  // draft/BOPF-контракт (ActiveUUID/DraftUUID, см. redux/localService/
  // metadata.xml). Лайту draft не нужен вообще (одна форма, один сабмит,
  // без edit-цикла) — совмещать его instant-create с draft-адресацией
  // полной версии сочли неоправданной сложностью. Технический контракт
  // ЭТОГО (простого) сервиса — единственное место, где имена жёстко
  // прописаны как литералы; потребители (facade/*, controller/Main.controller.js,
  // MockServerBootstrap.js) ссылаются на константы отсюда, не дублируют строки.
  //
  // [Для ABAP-разработки] Ожидаемое имя нового SEGW-проекта — ZCHECK_LITE_SRV
  // (отдельные DPC/MPC от ZCHECK_SRV; см. model/metadata.xml — CheckRoot без
  // draft-полей, простой Deep Entity Create). Runtime это имя нигде не
  // хардкодит — источник истины для реального URI см. ниже.
  //
  // [Уточнение, аудит] На момент этого комментария manifest.json
  // (sap.app.dataSources.mainService.uri) и fallback-константа в
  // MockServerBootstrap.js фактически указывают на "/sap/opu/odata/sap/
  // ZCHECK_SRV/" — имя ПОЛНОЙ (redux/draft) версии, а не ZCHECK_LITE_SRV
  // из абзаца выше. Это не опечатка и не путаница источников: реального
  // ZCHECK_LITE_SRV на бэкенде ещё не существует, поэтому URI сейчас —
  // осознанная заглушка (в связке с MockServer'ом реальный бэкенд вообще
  // не задействован, значение URI лишь формально валидно). Когда
  // ZCHECK_LITE_SRV будет создан на бэкенде, поменять URI нужно РОВНО в
  // одном месте — manifest.json (mainService.uri) — и, по желанию,
  // FALLBACK_ROOT_URI в MockServerBootstrap.js вслед за ним; здесь
  // менять нечего, эта строка — не источник истины для URI, см. ниже.
  //
  // Технический URI сервиса сюда НЕ вынесен — источник истины для него
  // manifest.json (sap.app.dataSources.mainService.uri), читается напрямую
  // оттуда в MockServerBootstrap.js. Дублировать его здесь как "ещё одну
  // константу" значило бы просто передвинуть тот же SSOT-баг в новое место.
  return {

    ENTITY_SETS: {
      CHECK_ROOTS: "CheckRoots",
      CHECK_ITEMS: "CheckItems",
      BARRIERS: "Barriers",
      PERSONS: "Persons",
      LOCATION_HIERARCHY: "LocationHierarchy",
      CHECK_TYPES: "CheckTypes",
      BARRIER_TYPES: "BarrierTypes",
      CHECK_RESULTS: "CheckResults",
      PK_LEVELS: "PkLevels",
      TIME_ZONES: "TimeZones",
      PROFESSIONS: "Professions",
      AUTO_ROW_RULES: "AutoRowRules"
    }
  };
});
