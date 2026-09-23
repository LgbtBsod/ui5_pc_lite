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
      // [Fix FN-08/UX-10] Бизнес-текст бэкенда (например, из
      // /iwbep/cx_mgw_busi_exception) — главное, что нужно пользователю,
      // чтобы понять, что исправить; раньше responseText не читался вовсе.
      const sBackendText = ErrorHandler._extractBackendMessage(oError.responseText);
      if (sBackendText) { return sBackendText; }
      // [Fix FN-08] В $batch (useBatch: true) statusCode части changeset'а —
      // строка ("400"), строгие === 400/403/404 не срабатывали.
      const iStatus = Number(oError.statusCode);
      if (iStatus === 403) { return rb.getText("msgErrForbidden"); }
      if (iStatus === 404) { return rb.getText("msgErrNotFound"); }
      if (iStatus === 400) { return rb.getText("msgErrBadRequest"); }
      if (iStatus >= 500) { return rb.getText("msgErrServer"); }
      return oError.message || rb.getText("msgErrGeneric");
    }

    /**
     * Extracts the Gateway error text from an OData V2 error body: JSON
     * error.message.value plus distinct innererror.errordetails[].message, or
     * the first message element of an XML error body. Never throws.
     * @param {string} sResponseText raw response body
     * @returns {string} the message text, or "" when none can be extracted
     */
    static _extractBackendMessage(sResponseText) {
      if (typeof sResponseText !== "string" || !sResponseText.trim()) { return ""; }
      try {
        if (sResponseText.trim().charAt(0) === "<") {
          const oDoc = new DOMParser().parseFromString(sResponseText, "application/xml");
          const oMsg = oDoc.getElementsByTagNameNS("*", "message")[0];
          return oMsg ? oMsg.textContent.trim() : "";
        }
        const oErr = (JSON.parse(sResponseText) || {}).error || {};
        const vMain = oErr.message;
        const aTexts = [typeof vMain === "string" ? vMain : (vMain && vMain.value)];
        const aDetails = (oErr.innererror && oErr.innererror.errordetails) || [];
        (Array.isArray(aDetails) ? aDetails : []).forEach((oDetail) => aTexts.push(oDetail && oDetail.message));
        return aTexts
          .map((s) => (typeof s === "string" ? s.trim() : ""))
          .filter((s, i, a) => s && a.indexOf(s) === i)
          .join("\n");
      } catch (e) {
        return "";
      }
    }
  }

  return ErrorHandler;
});
