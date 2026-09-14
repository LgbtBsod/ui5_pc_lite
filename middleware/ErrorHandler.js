sap.ui.define([
  "sap/base/Log"
], (Log) => {
  "use strict";

  // [Fix SRP/дубли] Раньше create()-wrapper сам показывал MessageBox.error
  // (с захардкоженными RU-строками мимо i18n) И ВСЕГДА звал исходный error-
  // callback — а Main.controller.js#onSubmit тоже показывает MessageBox.error
  // в своём error-callback'е. Итог — два диалога подряд на каждый сбой
  // сабмита. ErrorHandler теперь только логирует (единая ответственность);
  // локализованный текст для UI собирает вызывающий код через getMessage(),
  // используя свой resource bundle — единственный источник UI-текста.
  class ErrorHandler {
    // [Fix архитектурного брака] Раньше install() переопределял
    // oODataModel.create/read напрямую на инстансе (monkey-patch ядра
    // ODataModel v2) — хрупко к любому изменению сигнатуры этих методов в
    // патче SAPUI5 и уже ловило продакшн-баг с потерей this-контекста (см.
    // историю). ODataModel v2 штатно эмиттит requestSent/requestCompleted/
    // requestFailed на КАЖДЫЙ read/create/update — это официальный extension
    // point для сквозного логирования, доступный в 1.71, не требующий
    // переопределения чужого кода.
    static install(oComponent) {
      const oODataModel = oComponent.getModel();
      if (!oODataModel) {
        return;
      }

      oODataModel.attachRequestCompleted((oEvent) => {
        const mParams = oEvent.getParameters();
        if (mParams.success === false) {
          return; // репортится через requestFailed ниже
        }
        Log.info(`OData ${mParams.method} success`, mParams.url);
      });

      oODataModel.attachRequestFailed((oEvent) => {
        const mParams = oEvent.getParameters();
        Log.error(`OData ${mParams.method} failed: ${ErrorHandler._statusKey(mParams.response)}`,
          mParams.response && mParams.response.responseText);
      });
    }

    static _statusKey(oResponse) {
      return (oResponse && oResponse.statusCode) || (oResponse && oResponse.message) || "unknown";
    }

    /**
     * Resolves a localized, HTTP-status-aware error message for display.
     * @param {object} oError raw OData error (statusCode/message/responseText)
     * @param {sap.base.i18n.ResourceBundle} rb caller's resource bundle (owns the actual UI text)
     * @returns {string}
     */
    static getMessage(oError, rb) {
      if (!oError) { return rb.getText("msgErrUnknown"); }
      if (oError.statusCode === 403) { return rb.getText("msgErrForbidden"); }
      if (oError.statusCode === 404) { return rb.getText("msgErrNotFound"); }
      if (oError.statusCode === 400) { return rb.getText("msgErrBadRequest"); }
      if (oError.statusCode >= 500) { return rb.getText("msgErrServer"); }
      return oError.message || rb.getText("msgErrGeneric");
    }
  }

  return ErrorHandler;
});
