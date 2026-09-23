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
  // [Fix VH-02/VH-03] Маркеры на <html> для css/style.css: "pclApp" — пока жив
  // хотя бы один экземпляр компонента (раскладка), "pclLight" — плюс светлая
  // тема (цвета Horizon). В *_dark/*_hcb/*_hcw и прочих темах цвета рисует сама
  // тема. Класс на <html>, а не на root view: попапы живут в static area.
  const APP_CLASS = "pclApp";
  const LIGHT_THEME_CLASS = "pclLight";
  const LIGHT_THEME_RE = /^sap_(fiori_3|horizon|belize|bluecrystal)$/;
  let iLiveInstances = 0;

  function syncThemeClass () {
    const sTheme = sap.ui.getCore().getConfiguration().getTheme();
    document.documentElement.classList.toggle(LIGHT_THEME_CLASS, iLiveInstances > 0 && LIGHT_THEME_RE.test(sTheme));
  }

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

      iLiveInstances += 1;
      document.documentElement.classList.add(APP_CLASS);
      syncThemeClass();
      sap.ui.getCore().attachThemeChanged(syncThemeClass);
    },

    exit (...args) {
      PersonSearchFacade.clearCache();
      sap.ui.getCore().detachThemeChanged(syncThemeClass);
      iLiveInstances = Math.max(0, iLiveInstances - 1);
      if (iLiveInstances === 0) {
        document.documentElement.classList.remove(APP_CLASS);
      }
      syncThemeClass();
      UIComponent.prototype.exit.apply(this, args);
    }
  });
});
