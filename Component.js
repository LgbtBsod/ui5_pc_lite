sap.ui.define([
  "sap/ui/core/UIComponent",
  "sap/ui/model/json/JSONModel",
  "sap/pc_lite/lite/model/ModelsInit",
  "sap/pc_lite/lite/facade/PersonSearchFacade",
  "sap/pc_lite/lite/middleware/ErrorHandler"
], (UIComponent, JSONModel, ModelsInit, PersonSearchFacade, ErrorHandler) => {
  "use strict";

  // [Fix РЕАЛЬНЫЙ БАГ, аудит] "sap.pc_lite.lite" — было "app": непространственный
  // sap.app.id, при котором ВЕСЬ AMD-namespace приложения регистрировался
  // как "app/...". Внутри standalone index.html это работало без проблем —
  // риск был именно в реальной FLP-сессии: sap.ui.loader — общий на всю
  // страницу реестр модулей, и любое ДРУГОЕ Z-приложение в том же каталоге,
  // тоже не переименовавшее id со сгенерированного по умолчанию значения
  // (частый недосмотр — этот же проект таким и был), зарегистрировало бы
  // СВОИ модули под тем же префиксом "app/..." — тихая коллизия/подмена
  // модулей между независимыми приложениями в одной FLP-сессии, которую
  // никогда не воспроизвести тестированием pc_lite в одиночку через
  // standalone index.html. Redux (сосед по этому же каталогу/бэкенду) уже
  // использует правильный namespace "sap.pc_lite.check" — "sap.pc_lite.lite"
  // держит ту же схему именования, отличаясь только последним сегментом.
  return UIComponent.extend("sap.pc_lite.lite.Component", {

    metadata: {
      manifest: "json"
    },

    init (...args) {
      UIComponent.prototype.init.apply(this, args);

      const oAllModels = ModelsInit.createAll();
      Object.keys(oAllModels).forEach((sKey) => {
        this.setModel(oAllModels[sKey], sKey || undefined);
      });

      // [Fix race] ErrorHandler теперь статическая AMD-зависимость (см. define
      // выше), не sap.ui.require(...) с колбэком — раньше между Component#init
      // и асинхронной загрузкой ErrorHandler было окно, в котором ранний OData-
      // запрос (если бы такой появился на уровне Component) остался бы без
      // логирования сбоя.
      ErrorHandler.install(this);
    },

    exit (...args) {
      PersonSearchFacade.clearCache();
      UIComponent.prototype.exit.apply(this, args);
    }
  });
});
