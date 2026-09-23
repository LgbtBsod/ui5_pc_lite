sap.ui.define([
  "test/unit/facade/DeepEntityFacadeTest",
  "test/unit/middleware/ErrorHandlerTest",
  "test/unit/model/BusinessRulesTest",
  "test/unit/model/FormValidatorTest",
  "test/unit/controller/RowsAndAutoFillTest",
  "test/unit/facade/PersonSearchFacadeTest",
  "test/unit/facade/DictionaryFacadeSearchTest",
  "test/unit/util/SearchTextTest",
  "test/unit/util/ODataFormatTest",
  "test/unit/util/PluralTest"
  // [Fix Тестируемость, аудит] Единственное место, перечисляющее набор
  // тестов для unitTests.qunit.html/testsuite.qunit.html — новый модуль
  // тестов подключается сюда же одной строкой.
], () => {
  "use strict";
});
