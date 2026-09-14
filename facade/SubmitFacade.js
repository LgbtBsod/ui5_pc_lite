sap.ui.define([
  "sap/pc_lite/lite/model/BackendConfig"
], (BackendConfig) => {
  "use strict";

  // [Fix архитектурная асимметрия] Все чтения (справочники, поиск персон)
  // идут через DictionaryFacade/PersonSearchFacade — но запись раньше делалась
  // напрямую из Main.controller.js#onSubmit (oView.getModel().create(...)),
  // в обход слоя фасадов. SubmitFacade закрывает этот разрыв: контроллер
  // остаётся тонким (готовит модели, зовёт facade, реагирует на callback),
  // весь доступ к ODataModel — за фасадами, единообразно для чтения и записи.
  class SubmitFacade {
    /**
     * @param {sap.ui.model.odata.v2.ODataModel} oModel
     * @param {object} oPayload deep-entity payload built by DeepEntityFacade.build()
     * @returns {Promise<object>} resolves with the created entity data
     */
    static submit(oModel, oPayload) {
      return new Promise((resolve, reject) => {
        oModel.create(`/${BackendConfig.ENTITY_SETS.CHECK_ROOTS}`, oPayload, {
          success: resolve,
          error: reject
        });
      });
    }
  }

  return SubmitFacade;
});
