sap.ui.define([
  "sap/m/MessageToast",
  "sap/pc_lite/lite/model/FormValidator",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/model/BusinessRules"
], (MessageToast, FormValidator, WizardSteps, BusinessRules) => {
  "use strict";

  // [Fix SRP, аудит] Один из шести миксинов, на которые был разобран
  // Main.controller.js (см. верхний комментарий контроллера) — здесь и
  // только здесь живёт переключение шагов wizard'а: WizardProgressNavigator
  // <-> NavContainer <-> wizardModel>/currentStep, включая скип шага
  // "Барьеры". Чистая реорганизация кода, без изменения поведения — методы
  // ниже дословно перенесены из Main.controller.js и подмешиваются в тот же
  // объект контроллера через Object.assign, так что вызовы this.byId/
  // this.getView()/this.getResourceBundle() и обращения к методам других
  // миксинов (например RowsAndAutoFill) работают как раньше.
  const STEP_PAGE_IDS = WizardSteps.STEP_PAGE_IDS;

  return {

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Раньше _goToStep переключал видимый экран
    // (NavContainer#to/backToPage) без КАКОГО-ЛИБО фокус-менеджмента —
    // фокус клавиатуры оставался на только что нажатой кнопке "Далее"/
    // "Назад" в footer (она не часть NavContainer'а, не скрывается и не
    // уничтожается переходом), а скринридер не получал вообще никакого
    // сигнала "экран сменился" — классический паттерн "route changed,
    // announced nothing" в SPA-навигации. Регистрируется один раз при
    // старте (см. вызов из Main.controller.js#onInit).
    // [Fix, живой тест] attachAfterNavigate на самом NavContainer, НЕ
    // attachAfterShow на Page — первая попытка (per-page "afterShow")
    // проверялась живьём и не сработала: у sap.m.NavContainer 1.71 нет
    // сгенерированного attachAfterShow (metadata.events страницы его не
    // объявляет), а прямая подписка через attachEvent("afterShow", ...)
    // тоже ни разу не выстрелила при реальном переходе onWizardNext() ->
    // to()/backToPage() (подтверждено: events=[] после ожидания анимации).
    // Проверка getMetadata().getAllEvents() у самого stepNav показала
    // реальный публичный контракт — "navigate"/"afterNavigate" НА
    // КОНТЕЙНЕРЕ, а не на странице; afterNavigate несёт параметр "to" —
    // именно показанную страницу, ОДИН обработчик на весь NavContainer
    // вместо по одному на каждую из 6 страниц.
    _initStepFocusAnnouncements () {
      const oNavContainer = this.byId("stepNav");
      if (oNavContainer) {
        oNavContainer.attachAfterNavigate((oEvent) => this._focusStepHeading(oEvent.getParameter("to")));
      }
    },

    // tabindex="-1" — тот же приём, что и в любой доступной SPA-маршрутизации
    // (фокусируем программно через .focus(), но НЕ добавляем элемент в
    // обычный порядок обхода Tab) — sap.m.Text сам по себе не фокусируем и
    // не имеет публичного API для tabIndex, поэтому атрибут ставится прямо
    // на DOM-узел. findAggregatedObjects — штатный публичный метод
    // ManagedObject для поиска потомка по предикату, а не самодельный обход
    // дерева контролов.
    _focusStepHeading (oPage) {
      const oHeading = oPage.findAggregatedObjects(true, (oCtrl) => oCtrl.hasStyleClass && oCtrl.hasStyleClass("appStepHeading"))[0];
      const oDom = oHeading && oHeading.getDomRef();
      if (oDom) {
        oDom.setAttribute("tabindex", "-1");
        oDom.focus();
      }
    },

    // [Fix, реентерабельность] nextStep()/previousStep(), вызванные ИЗ
    // _goToStep ниже, сами синхронно стреляют stepChanged — без флага это
    // событие возвращалось бы сюда же и запускало ВТОРОЙ, уже некорректный
    // _goToStep поверх ещё не завершившегося первого (обнаружено на живом
    // прогоне на скип-переходе с дистанцией 2: цепочка из наложившихся
    // вызовов уводила itemStep дальше, чем нужно). Флаг игнорирует именно
    // эхо от наших же вызовов — реальный тап пользователя по номеру шага в
    // навигаторе (единственный случай, когда флаг снят) по-прежнему обрабатывается.
    _onProgressNavStepChanged (oEvent) {
      if (this._bSyncingProgressNav) { return; }
      const iNewStep = oEvent.getParameter("current");
      const iOldStep = this.getView().getModel("wizardModel").getProperty("/currentStep");
      if (iNewStep === iOldStep) { return; }
      this._goToStep(iNewStep, iNewStep > iOldStep ? "forward" : "back", /* bSyncProgressNav */ false);
    },

    // [Поэтапный ввод] Единственное место, синхронизирующее три вещи разом:
    // wizardModel>/currentStep (гейтинг кнопок в footer, см. Main.view.xml),
    // WizardProgressNavigator (полоса прогресса) и NavContainer (реально
    // видимый экран). bSyncProgressNav=false — когда вызвано ИЗ события
    // самого навигатора (см. выше): он уже в нужном состоянии, повторный
    // nextStep()/previousStep() по нему был бы двойным шагом.
    //
    // [Fix, по просьбе — скип шага "Барьеры"] nextStep()/previousStep() у
    // WizardProgressNavigator двигают ровно на один шаг за вызов — при
    // скип-переходе (см. _skipBarriersIfNeeded) реальная дистанция может
    // быть 2 (4->6 или 6->4), отсюда цикл по iDelta, а не одиночный вызов.
    _goToStep (iNewStep, sDirection, bSyncProgressNav) {
      const oView = this.getView();
      const iOldStep = oView.getModel("wizardModel").getProperty("/currentStep");
      oView.getModel("wizardModel").setProperty("/currentStep", iNewStep);

      if (bSyncProgressNav !== false) {
        const oProgressNav = this.byId("progressNav");
        const iDelta = Math.abs(iNewStep - iOldStep) || 1;
        this._bSyncingProgressNav = true;
        for (let i = 0; i < iDelta; i++) {
          if (sDirection === "forward") { oProgressNav.nextStep(); } else { oProgressNav.previousStep(); }
        }
        this._bSyncingProgressNav = false;
      }

      const oNavContainer = this.byId("stepNav");
      const oPage = this.byId(STEP_PAGE_IDS[iNewStep - 1]);
      if (sDirection === "forward") {
        oNavContainer.to(oPage, "slide");
      } else {
        oNavContainer.backToPage(oPage.getId(), "slide");
      }
    },

    // [Fix UX, по просьбе] "Барьеры" — WizardSteps.BARRIERS. Когда для
    // текущего уровня КПР барьеры не показываются (BusinessRules.
    // isBarriersAllowed), он бы всё равно был структурно пуст (только
    // пояснение, см. BarriersTable.fragment.xml) — Далее/Назад перепрыгивают
    // его целиком, а не оставляют пустой промежуточный экран. Шаг остаётся в
    // NavContainer/навигаторе (не вырезан из структуры — та же осторожность,
    // что раньше при попытке динамически скрывать шаги sap.m.Wizard), но
    // пользователь на него не попадает через кнопки.
    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Считает напрямую через BusinessRules.
    // isBarriersAllowed(PkLevel) вместо чтения хранимого formModel>/
    // BarriersAllowed — раньше этот флаг был обязан быть актуальным по
    // соглашению (кто-то где-то должен был вызвать RowsAndAutoFill.js#
    // _updateBarriersAllowed после каждой записи PkLevel), нигде не
    // задокументированному и не защищённому. Теперь здесь читается сам
    // PkLevel и правило пересчитывается на месте — синхронизировать
    // нечего, потому что нечего хранить отдельно.
    _skipBarriersIfNeeded (iTargetStep, sDirection) {
      if (iTargetStep !== WizardSteps.BARRIERS) { return iTargetStep; }
      const bAllowed = BusinessRules.isBarriersAllowed(this.getView().getModel("formModel").getProperty("/PkLevel"));
      return bAllowed ? iTargetStep : (sDirection === "forward" ? iTargetStep + 1 : iTargetStep - 1);
    },

    // [Поэтапный ввод, по просьбе] Общая кнопка "Далее" в footer (не по одной
    // на каждый шаг) — текущий шаг читается из wizardModel>/currentStep, того
    // же значения, что показывает навигатор прогресса и что переключает
    // видимость содержимого шагов (см. Main.view.xml). Гейтинг —
    // FormValidator.isStepComplete (тот же REQUIRED_FIELDS, что и полная
    // проверка перед submit, см. Submit.js#_validateBeforeSubmit), без
    // дублирования списка обязательных полей. Финальная проверка перед
    // сабмитом остаётся отдельно и целиком — это только UX-подсказка "здесь
    // ещё рано идти дальше", не замена ей.
    // [Fix "не изобретать велосипед", по запросу] isStepComplete теперь ещё и
    // подсвечивает конкретные поля через MessageManager (см. FormValidator.js)
    // — тост ниже остаётся как быстрый общий сигнал "не всё готово", подсветка
    // полей даёт КОНКРЕТНО что именно.
    onWizardNext () {
      const oView = this.getView();
      const iStep = oView.getModel("wizardModel").getProperty("/currentStep");
      const oFormModel = oView.getModel("formModel");
      const oChecksModel = oView.getModel("checksModel");
      const oBarriersModel = oView.getModel("barriersModel");

      if (!FormValidator.isStepComplete(oFormModel, iStep, oChecksModel, oBarriersModel, this.getResourceBundle())) {
        MessageToast.show(this.getResourceBundle().getText("msgStepIncomplete"));
        return;
      }
      this._goToStep(this._skipBarriersIfNeeded(iStep + 1, "forward"), "forward");
    },

    // [Поэтапный ввод, по просьбе] Возврат назад — без какой-либо проверки
    // FormValidator: смысл кнопки именно в том, чтобы поправить уже введённое,
    // блокировать её тем же гейтингом, что и "Далее", было бы противоречием.
    onWizardBack () {
      const iStep = this.getView().getModel("wizardModel").getProperty("/currentStep");
      this._goToStep(this._skipBarriersIfNeeded(iStep - 1, "back"), "back");
    }

  };
});
