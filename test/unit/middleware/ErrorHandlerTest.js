sap.ui.define([
  "sap/pc_lite/lite/middleware/ErrorHandler"
], (ErrorHandler) => {
  "use strict";

  // [Fix FN-08/UX-10] getMessage: текст бэкенда из тела ошибки и statusCode-
  // строка из $batch ("400"). rb — минимальный мок: getText возвращает ключ.
  const rb = { getText: (sKey) => sKey };

  QUnit.module("middleware/ErrorHandler#getMessage");

  QUnit.test("JSON-тело Gateway: error.message.value важнее статуса", (assert) => {
    const oErr = {
      statusCode: "400",
      message: "HTTP request failed",
      responseText: JSON.stringify({ error: { code: "Z/001", message: { lang: "ru", value: "Инспектор не может проверять сам себя" } } })
    };
    assert.strictEqual(ErrorHandler.getMessage(oErr, rb), "Инспектор не может проверять сам себя");
  });

  QUnit.test("errordetails добавляются без дублей основного текста", (assert) => {
    const oErr = {
      statusCode: 400,
      responseText: JSON.stringify({ error: {
        message: { value: "Ошибка A" },
        innererror: { errordetails: [{ message: "Ошибка A" }, { message: "Ошибка B" }, {}] }
      } })
    };
    assert.strictEqual(ErrorHandler.getMessage(oErr, rb), "Ошибка A\nОшибка B");
  });

  QUnit.test("XML-тело: берётся первый <message>", (assert) => {
    const sXml = "<?xml version=\"1.0\" encoding=\"utf-8\"?><error xmlns=\"http://schemas.microsoft.com/ado/2007/08/dataservices/metadata\">" +
      "<code>Z/002</code><message xml:lang=\"ru\">Код недоступен для уровня КПР</message></error>";
    assert.strictEqual(ErrorHandler.getMessage({ statusCode: "400", responseText: sXml }, rb), "Код недоступен для уровня КПР");
  });

  QUnit.test("статус-строка из $batch сопоставляется с i18n, если тела нет/оно не парсится", (assert) => {
    assert.strictEqual(ErrorHandler.getMessage({ statusCode: "400", responseText: "not json" }, rb), "msgErrBadRequest");
    assert.strictEqual(ErrorHandler.getMessage({ statusCode: "403" }, rb), "msgErrForbidden");
    assert.strictEqual(ErrorHandler.getMessage({ statusCode: "404" }, rb), "msgErrNotFound");
    assert.strictEqual(ErrorHandler.getMessage({ statusCode: "503" }, rb), "msgErrServer");
  });

  QUnit.test("без статуса и тела — message ошибки или общий текст", (assert) => {
    assert.strictEqual(ErrorHandler.getMessage(null, rb), "msgErrUnknown");
    assert.strictEqual(ErrorHandler.getMessage({ message: "boom" }, rb), "boom");
    assert.strictEqual(ErrorHandler.getMessage({}, rb), "msgErrGeneric");
  });
});
