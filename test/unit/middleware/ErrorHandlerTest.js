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

  QUnit.test("без ошибки — msgErrUnknown; нет статуса (сеть/таймаут) — msgErrNetwork, не сырой message", (assert) => {
    assert.strictEqual(ErrorHandler.getMessage(null, rb), "msgErrUnknown");
    assert.strictEqual(ErrorHandler.getMessage({ message: "HTTP request failed" }, rb), "msgErrNetwork");
    assert.strictEqual(ErrorHandler.getMessage({ statusCode: 0 }, rb), "msgErrNetwork");
    assert.strictEqual(ErrorHandler.getMessage({}, rb), "msgErrNetwork");
  });

  QUnit.test("прочие статусы (401/409/429) — msgErrGeneric, message ошибки не показывается", (assert) => {
    [401, "409", 412, 429].forEach((vStatus) => {
      assert.strictEqual(ErrorHandler.getMessage({ statusCode: vStatus, message: "HTTP request failed" }, rb), "msgErrGeneric");
    });
  });

  QUnit.test("5xx с JSON-телом — msgErrServer, текст бэкенда не показывается", (assert) => {
    const oErr = {
      statusCode: "500",
      responseText: JSON.stringify({ error: { message: { value: "In the context of Data Services an unknown internal server error occurred" } } })
    };
    assert.strictEqual(ErrorHandler.getMessage(oErr, rb), "msgErrServer");
  });

  QUnit.test("errordetails: только severity error/без severity, без /IWBEP/-кодов", (assert) => {
    const oErr = {
      statusCode: 400,
      responseText: JSON.stringify({ error: {
        message: { value: "Бизнес-ошибка" },
        innererror: { errordetails: [
          { code: "/IWBEP/CX_MGW_BUSI_EXCEPTION", message: "An exception was raised.", severity: "error" },
          { code: "Z/001", message: "Деталь", severity: "error" },
          { code: "Z/002", message: "Без severity" },
          { code: "Z/003", message: "Предупреждение", severity: "warning" },
          { code: "Z/004", message: "Инфо", severity: "info" }
        ] }
      } })
    };
    assert.strictEqual(ErrorHandler.getMessage(oErr, rb), "Бизнес-ошибка\nДеталь\nБез severity");
  });
});
