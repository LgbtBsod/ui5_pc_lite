sap.ui.define([
  "sap/m/MessageBox",
  "sap/base/Log",
  "sap/pc_lite/lite/model/ModelsInit",
  "sap/pc_lite/lite/model/FormValidator",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/middleware/ErrorHandler",
  "sap/pc_lite/lite/facade/DeepEntityFacade",
  "sap/pc_lite/lite/facade/SubmitFacade"
], (MessageBox, Log, ModelsInit, FormValidator, WizardSteps, ErrorHandler, DeepEntityFacade, SubmitFacade) => {
  "use strict";

  // [Fix SRP, аудит] Один из шести миксинов Main.controller.js (см. верхний
  // комментарий контроллера) — здесь живёт финальная валидация, сборка
  // Deep Entity payload, сам сабмит и сброс формы после успеха. Чистая
  // реорганизация, без изменения поведения.
  const LOG_COMPONENT = "sap.pc_lite.lite.controller.mixin.Submit";
  // [Fix RV-06] Общий класс диалогов приложения (стили — css/style.css).
  const MSG_BOX_CLASS = "appMsgBox";

  return {

    // [Fix SOLID/SRP] Правила валидации (обязательные поля, минимум одной
    // проверки, лимиты длины) живут в FormValidator — сам список правил
    // растёт независимо от контроллера и тестируем без View/Controller
    // lifecycle. Контроллер только собирает сырые данные моделей и решает,
    // что делать с результатом (показать диалог / заблокировать сабмит).
    // [Fix "не изобретать велосипед", по запросу] validate() теперь ещё и
    // подсвечивает конкретные поля через MessageManager (см. FormValidator.js)
    // — на каком бы шаге они ни были. MessageBox здесь остаётся как краткое
    // итоговое уведомление, не как единственный источник детализации.
    // [Fix РЕАЛЬНЫЙ БАГ, аудит] validate() теперь возвращает ДВА раздельных
    // канала (см. подробный комментарий у FormValidator.validate) вместо
    // одного смешанного числа — msgValidationFailed показывается только когда
    // реально есть незаполненные поля (fieldCount) и подставляет ИХ число, а
    // не число вперемешку с "нет строк проверки"/"превышена длина"; textIssues
    // — уже готовые тексты именно этих причин, добавляются отдельными
    // строками того же MessageBox. Раньше при, например, одном превышении
    // длины комментария пользователь видел "Не заполнено обязательных полей: 1"
    // — фактически неверное сообщение (ни одно поле не было пустым).
    _validateBeforeSubmit () {
      const rb = this.getResourceBundle();
      const oView = this.getView();
      const oResult = FormValidator.validate(
        oView.getModel("formModel"),
        oView.getModel("checksModel"),
        oView.getModel("barriersModel"),
        rb
      );

      const aMessages = [];
      if (oResult.fieldCount > 0) {
        aMessages.push(rb.getText("msgValidationFailed", [oResult.fieldCount]));
      }
      aMessages.push(...oResult.textIssues);

      if (aMessages.length) {
        // [Fix WZ-05/UX-07] Подсветка — на других шагах: называем шаг первой
        // ошибки и открываем его после закрытия диалога (сводка read-only).
        const iStep = oResult.firstInvalidStep ? this._skipBarriersIfNeeded(oResult.firstInvalidStep, "back") : 0;
        const bJump = iStep > 0 && iStep !== oView.getModel("wizardModel").getProperty("/currentStep");
        if (bJump) {
          aMessages.push("", rb.getText("msgValGoToStep", [rb.getText(WizardSteps.titleKeyOf(iStep))]));
        }
        MessageBox.error(aMessages.join("\n"), {
          styleClass: MSG_BOX_CLASS,
          onClose: () => {
            if (bJump && !this._bDestroyed) { this._goToStep(iStep, "back"); }
          }
        });
        return false;
      }
      return true;
    },

    // [Fix] Двойной тап/клик по "Отправить" до ответа сервера запускал
    // create() дважды — на реальном бэке это создало бы два CheckRoot из
    // одной формы. Особенно вероятно на мобильном (двойной тап — обычное
    // дело для lite-приложения). Кнопка блокируется на время запроса.
    //
    // [Fix Robustness] DeepEntityFacade.build() -> ODataFormat.toODataTime()
    // осознанно бросает исключение на malformed-время — но раньше этот throw
    // ничем не перехватывался здесь: он всплывал бы из press-обработчика
    // необработанным, а _bSubmitInFlight/кнопка "Отправить" остались бы
    // заблокированы до перезагрузки страницы (_setSubmitBusy(true) просто не
    // достигался бы). try/catch на границе facade-вызова гарантирует, что
    // сбой сборки payload завершается тем же путём, что и сбой самого
    // запроса — пользовательским сообщением и разблокированной кнопкой.
    onSubmit () {
      // [Fix WZ-08] _bStepTransition: второй клик двойного клика по "Далее"
      // попадал в "Отправить" (та же позиция в footer) до показа сводки.
      if (this._bSubmitInFlight || this._bStepTransition) { return; }
      if (!this._validateBeforeSubmit()) { return; }

      const oView = this.getView();
      const rb = this.getResourceBundle();
      let oPayload;
      try {
        oPayload = DeepEntityFacade.build(
          oView.getModel("formModel"),
          oView.getModel("checksModel"),
          oView.getModel("barriersModel"),
          oView.getModel("dictionaryModel")
        );
      } catch (oErr) {
        Log.error("Deep Entity payload build failed", oErr && oErr.message, LOG_COMPONENT);
        MessageBox.error(rb.getText("msgErrGeneric"), { styleClass: MSG_BOX_CLASS });
        return;
      }

      Log.info(`Deep Entity submitted, checks=${oPayload.to_Checks.results.length}, barriers=${oPayload.to_Barriers.results.length}`, null, LOG_COMPONENT);

      this._setSubmitBusy(true);
      // [Fix архитектурная асимметрия] Запись теперь идёт через SubmitFacade,
      // как и все чтения — через DictionaryFacade/PersonSearchFacade.
      // Контроллер больше не обращается к oView.getModel().create(...)
      // напрямую (см. facade/SubmitFacade.js).
      // [Fix FN-12] После onExit (ушли с плитки до ответа) — только лог, без
      // диалогов поверх следующего приложения и без сброса мёртвого View.
      // [Fix] then(ok, fail), а не then().catch(): сбой уборки после УСПЕШНОГО
      // create больше не показывается как "Ошибка отправки" (риск повторной отправки).
      SubmitFacade.submit(oView.getModel(), oPayload).then((oCreated) => {
        const sDocId = oCreated && oCreated.DocId;
        if (this._bDestroyed) {
          Log.info(`Deep Entity created after view exit, DocId=${sDocId || "?"}`, null, LOG_COMPONENT);
          return;
        }
        this._setSubmitBusy(false);
        // [Fix UX-10] Номер созданного документа — единственная "квитанция"
        // (форма сразу сбрасывается); нет DocId в ответе (MockServer) — общий текст.
        MessageBox.success(sDocId ? rb.getText("msgSubmitSuccessDoc", [sDocId]) : rb.getText("msgSubmitSuccess"), { styleClass: MSG_BOX_CLASS });
        this._resetForm();
      }, (oErr) => {
        Log.error("Deep Entity submit failed", oErr, LOG_COMPONENT);
        if (this._bDestroyed) { return; }
        this._setSubmitBusy(false);
        MessageBox.error(rb.getText("msgSubmitError", [ErrorHandler.getMessage(oErr, rb)]), { styleClass: MSG_BOX_CLASS });
      }).catch((oErr) => {
        Log.error("Post-submit handling failed", oErr && oErr.message, LOG_COMPONENT);
      });
    },

    _setSubmitBusy (bBusy) {
      this._bSubmitInFlight = bBusy;
      const oBtn = this.byId("submitBtn");
      if (oBtn) { oBtn.setEnabled(!bBusy).setBusy(bBusy); }
    },

    // [Fix] Приложение — форма многократной регистрации проверок подряд;
    // без сброса после успешного сабмита следующая запись начиналась бы с
    // данными предыдущей (включая ФИО/Pernr/строки проверок) — риск случайно
    // отправить дубликат под другим человеком. ModelsInit — единственный
    // источник дефолтной формы моделей, переиспользуем его же здесь.
    // [Fix Memory/Performance] Раньше здесь вызывался ModelsInit.createAll()
    // целиком — 7 JSONModel-инстансов создавались и тут же 2 отбрасывались
    // (dictionaryModel/locationModel сброса не требуют, справочники не
    // меняются при сбросе формы). dataFor() отдаёт только сырые defaults для
    // фактически сбрасываемых моделей, без лишней аллокации.
    _resetForm () {
      if (this._bDestroyed) { return; }
      const oView = this.getView();
      const oFormModel = oView.getModel("formModel");
      const sOldDate = oFormModel.getProperty("/CheckDate");
      ["formModel", "checksModel", "barriersModel", "inspectedPersonModel", "inspectorPersonModel", "wizardModel"]
        .forEach((sName) => oView.getModel(sName).setData(ModelsInit.dataFor(sName)));
      // [Fix FN-04] Уровень КПР сброшен — "последний принятый" тоже.
      this._sPrevPkLevel = "";
      // Подсветка прошлой неудачной проверки не должна переживать сброс.
      FormValidator.clearMessages();
      // Ручные valueState (обработчики даты/времени и поиска сотрудника).
      ["checkDate", "checkTime", "inspectedInput", "inspectorInput"].forEach((sId) => {
        const oCtrl = this.byId(sId);
        if (oCtrl) { oCtrl.setValueState("None"); }
      });
      // [Fix FN-11] Новая запись — на сегодня: иерархия мест прошлой даты устарела.
      const sNewDate = oFormModel.getProperty("/CheckDate");
      if (sNewDate && sNewDate !== sOldDate) { this._reloadForCheckDate(sNewDate); }

      // [Fix UX] Без этого пользователь после успешного сабмита оставался бы
      // визуально на экране "Отправка" (данные уже сброшены, но NavContainer/
      // навигатор прогресса всё ещё показывают его текущим) — для формы
      // многократной регистрации подряд это означало бы каждый раз вручную
      // возвращаться к первому экрану. discardProgress() у
      // WizardProgressNavigator возвращает и его собственное состояние
      // (не только wizardModel>/currentStep выше) к первому шагу.
      // [Fix РЕАЛЬНЫЙ БАГ, аудит] byId() здесь и ниже теперь проверяются на
      // null тем же приёмом, что уже применяет сосед _setSubmitBusy() (`if
      // (oBtn)`) — раньше не были. Сценарий: FLP уничтожает Component/View,
      // пока create() ещё летит по сети (пользователь ушёл с плитки ДО
      // ответа сервера); byId() на уничтоженном View в SAPUI5 возвращает
      // undefined (id распривязаны при destroy), а .discardProgress()/
      // .backToPage() на undefined кидали TypeError. Этот throw происходил
      // ВНУТРИ .then() цепочки onSubmit, у которой уже есть свой .catch() —
      // TypeError тихо попадал в него и показывался пользователю как
      // "ошибка отправки" СРАЗУ ПОСЛЕ уже показанного MessageBox.success —
      // хотя сама отправка на сервер реально прошла успешно, только уборка
      // после неё упала на уже мёртвом View.
      const oProgressNav = this.byId("progressNav");
      const oStepNav = this.byId("stepNav");
      if (oProgressNav) { oProgressNav.discardProgress(1); }
      // [Fix WZ-09/FN-01] backToTop() вместо backToPage(first, "show"): строка
      // "show" уходила в backData, а не в анимацию. backToTop очищает всю
      // историю NavContainer, и её зеркало _aNavStack сбрасывается вместе с ней.
      // [Fix RN-01] afterNavigate не должен уводить фокус из открытого MessageBox.success;
      // флаг ставится только если переход реально будет (на первой странице события нет).
      this._bSkipStepFocus = !!oStepNav && oStepNav.getCurrentPage() !== this.byId(WizardSteps.STEP_PAGE_IDS[0]);
      if (oStepNav) { oStepNav.backToTop(); }
      this._aNavStack = [WizardSteps.WHEN];
      this._updateShellBackNavigation(WizardSteps.WHEN);

      // [Fix РЕАЛЬНЫЙ БАГ, аудит] _updateBarriersAllowed() здесь раньше
      // пересчитывал и перезаписывал formModel>/BarriersAllowed после
      // сброса формы (PkLevel сброшен в дефолт) — с видимостью секции
      // "Барьеры" на formatter.isBarriersAllowed (считает напрямую из
      // formModel>/PkLevel при каждом рендере, см. formatter.js) отдельного
      // хранимого флага, который здесь нужно было бы освежать, больше нет.
      this._updateFooterCount();
      this._autoDetectTimezone();

      // [Fix РЕАЛЬНЫЙ БАГ, аудит] Снимает флаг "есть несохранённые изменения"
      // у шелла FLP (см. подробное обоснование у Main.controller.js#
      // _initDirtyTracking) — форма только что сброшена в чистое состояние,
      // предупреждать о потере данных больше нечего. Намеренно ПОСЛЕ
      // _autoDetectTimezone() выше, а не до: тот вызов сам делает
      // setProperty на formModel>/TimeZone, что заново пометило бы форму
      // dirty=true, если бы порядок был обратным — слушатель propertyChange
      // остаётся подключённым между сбросами формы (это не onInit, где
      // слежение включается ПЕРВЫЙ раз), поэтому эта же programmatic-запись
      // видна ему точно так же, как обычная запись пользователя.
      this._setShellDirty(false);
    }

  };
});
