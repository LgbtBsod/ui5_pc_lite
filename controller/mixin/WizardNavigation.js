sap.ui.define([
  "sap/m/MessageToast",
  "sap/base/Log",
  "sap/pc_lite/lite/model/FormValidator",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/model/BusinessRules"
], (MessageToast, Log, FormValidator, WizardSteps, BusinessRules) => {
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
  // Страховочный таймаут снятия флага перехода (анимация slide ~0.3-0.5 с).
  const STEP_TRANSITION_TIMEOUT_MS = 1500;

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
        // [Fix RN-04] Прокрутка сбрасывается уже на "navigate" (до анимации), иначе
        // страница выезжала со старым смещением и "прыгала" к началу после слайда.
        oNavContainer.attachNavigate((oEvent) => this._resetStepScroll(oEvent.getParameter("to")));
        oNavContainer.attachAfterNavigate((oEvent) => {
          this._endStepTransition();
          const oPage = oEvent.getParameter("to");
          this._resetStepScroll(oPage);
          // [Fix RN-01] Фокус на заголовок — только при переходе, инициированном
          // пользователем: после сброса формы (модальный MessageBox "успех" ещё
          // открыт) на touch-устройствах Popup не возвращает фокус в диалог.
          const bSkip = this._bSkipStepFocus;
          this._bSkipStepFocus = false;
          if (!bSkip && !this._isFocusOutsideView()) { this._focusStepHeading(oPage); }
        });
      }
    },

    // tabindex="-1" — тот же приём, что и в любой доступной SPA-маршрутизации
    // (фокусируем программно через .focus(), но НЕ добавляем элемент в
    // обычный порядок обхода Tab) — sap.m.Text сам по себе не фокусируем и
    // не имеет публичного API для tabIndex, поэтому атрибут ставится прямо
    // на DOM-узел. findAggregatedObjects — штатный публичный метод
    // ManagedObject для поиска потомка по предикату, а не самодельный обход
    // дерева контролов.
    // [Fix RN-04] Каждый шаг открывается с начала, а не с позиции прошлого визита.
    // Page#scrollTo — no-op при enableScrolling=false (шаги 4-5), там прокручивается
    // CSS-контейнер .appWizardScrollArea — сбрасываем и его.
    _resetStepScroll (oPage) {
      if (!oPage) { return; }
      if (oPage.scrollTo) { oPage.scrollTo(0, 0); }
      const $Page = oPage.$();
      if ($Page.length) { $Page.find(".appWizardScrollArea").scrollTop(0); }
    },

    // [Fix RN-01] Фокус уже вне нашего view (например, внутри модального диалога) — не трогаем.
    _isFocusOutsideView () {
      const oAct = document.activeElement;
      const oViewDom = this.getView().getDomRef();
      return !!(oAct && oAct !== document.body && oViewDom && !oViewDom.contains(oAct));
    },

    _focusStepHeading (oPage) {
      const oHeading = oPage.findAggregatedObjects(true, (oCtrl) => oCtrl.hasStyleClass && oCtrl.hasStyleClass("appStepHeading"))[0];
      const oDom = oHeading && oHeading.getDomRef();
      if (oDom) {
        oDom.setAttribute("tabindex", "-1");
        // [Fix LIVE-01] preventScroll: иначе браузер прокручивал overflow:hidden
        // страницу на 16px вбок, чтобы "показать" заголовок, и вернуть её было нечем.
        oDom.focus({ preventScroll: true });
      }
    },

    // [Fix, реентерабельность] Флаг _bSyncingProgressNav игнорирует эхо от
    // наших же nextStep()/previousStep() (см. _syncProgressNav) — обрабатывается
    // только реальный тап пользователя по номеру шага в навигаторе.
    // [Fix FN-01/WZ-04/UX-01] Тап идёт через те же правила, что и кнопки:
    // скип "Барьеров" и гейтинг isStepComplete для КАЖДОГО промежуточного шага
    // при прыжке вперёд — остановка на первом незаполненном (его подсветка
    // остаётся, т.к. isStepComplete снимает сообщения предыдущих вызовов).
    _onProgressNavStepChanged (oEvent) {
      if (this._bSyncingProgressNav) { return; }
      const oView = this.getView();
      const iTapped = oEvent.getParameter("current");
      const iCurrent = oView.getModel("wizardModel").getProperty("/currentStep");
      // Во время анимации перехода тап игнорируется — навигатор (он уже сам
      // переключился на тапнутый номер) возвращаем к реальному шагу.
      if (this._bStepTransition || iTapped === iCurrent) {
        this._syncProgressNav(iCurrent);
        return;
      }
      const sDirection = iTapped > iCurrent ? "forward" : "back";
      let iTarget = iTapped;
      let bIncomplete = false;
      const aTextIssues = [];
      if (sDirection === "forward") {
        const bBarriersAllowed = BusinessRules.isBarriersAllowed(oView.getModel("formModel").getProperty("/PkLevel"));
        for (let iStep = iCurrent; iStep < iTapped; iStep++) {
          if (iStep === WizardSteps.BARRIERS && !bBarriersAllowed) { continue; }
          if (!FormValidator.isStepComplete(oView.getModel("formModel"), iStep, oView.getModel("checksModel"),
            oView.getModel("barriersModel"), this.getResourceBundle(), aTextIssues)) {
            iTarget = iStep;
            bIncomplete = true;
            break;
          }
        }
      }
      if (bIncomplete) {
        this._showStepIncomplete(aTextIssues);
      } else {
        iTarget = this._skipBarriersIfNeeded(iTarget, sDirection);
      }
      this._goToStep(iTarget, sDirection);
    },

    // [Fix FN-01] Навигатор двигается ровно до iStep от СВОЕГО текущего шага
    // (getCurrentStep), а не на дельту от wizardModel — после тапа навигатор
    // уже стоит на тапнутом номере, и дельта от модели дала бы пере-шаг.
    // nextStep() также расширяет "пройденную" часть (activeStep) при скипе 4->6.
    _syncProgressNav (iStep) {
      const oProgressNav = this.byId("progressNav");
      if (!oProgressNav) { return; }
      this._bSyncingProgressNav = true;
      try {
        for (let iGuard = STEP_PAGE_IDS.length; iGuard > 0 && oProgressNav.getCurrentStep() !== iStep; iGuard--) {
          if (oProgressNav.getCurrentStep() < iStep) { oProgressNav.nextStep(); } else { oProgressNav.previousStep(); }
        }
      } finally {
        this._bSyncingProgressNav = false;
      }
    },

    // [Поэтапный ввод] Единственное место, синхронизирующее разом:
    // wizardModel>/currentStep (гейтинг кнопок в footer, см. Main.view.xml),
    // WizardProgressNavigator, NavContainer (реально видимый экран) и кнопку
    // "Назад" шелла FLP. Работает для ЛЮБОГО прыжка (в т.ч. назад через
    // несколько шагов — например, к первому незаполненному шагу после
    // неудачного submit). sDirection необязателен — по умолчанию из номеров.
    // [Fix FN-01/WZ-01] backToPage в 1.71 молча ничего не делает, если
    // страницы нет в истории NavContainer (после скипа "Барьеров" или прыжка
    // по навигатору) — модель и экран расходились. История дублируется в
    // _aNavStack (номера шагов, верх = видимый шаг); страница не из истории
    // вставляется под текущую (insertPreviousPage) и достигается через back().
    _goToStep (iNewStep, sDirection) {
      const oNavContainer = this.byId("stepNav");
      const oPage = this.byId(STEP_PAGE_IDS[iNewStep - 1]);
      if (!oNavContainer || !oPage) { return; }
      const aStack = this._getNavStack();
      const iShownStep = aStack[aStack.length - 1];
      const sDir = sDirection || (iNewStep > iShownStep ? "forward" : "back");

      if (oNavContainer.getCurrentPage() !== oPage) {
        this._bSkipStepFocus = false; // [Fix RN-01] защитно: устаревший флаг от сброса формы
        this._startStepTransition(oNavContainer);
        if (sDir === "forward") {
          oNavContainer.to(oPage, "slide");
          aStack.push(iNewStep);
        } else if (aStack.lastIndexOf(iNewStep) > -1) {
          // [Fix WZ-09] Второй аргумент backToPage — backData, не имя анимации
          // (обратный переход всегда инвертирует прямой).
          oNavContainer.backToPage(oPage.getId());
          aStack.length = aStack.lastIndexOf(iNewStep) + 1;
        } else {
          oNavContainer.insertPreviousPage(oPage.getId(), "slide");
          oNavContainer.back();
          aStack[aStack.length - 1] = iNewStep;
        }
      } else {
        aStack[aStack.length - 1] = iNewStep;
      }

      this.getView().getModel("wizardModel").setProperty("/currentStep", iNewStep);
      this._syncProgressNav(iNewStep);
      this._updateShellBackNavigation(iNewStep);
    },

    // Зеркало истории NavContainer (у него нет публичного геттера всего стека).
    // Сбрасывается в Submit.js#_resetForm вместе с backToTop().
    _getNavStack () {
      if (!this._aNavStack) { this._aNavStack = [WizardSteps.WHEN]; }
      return this._aNavStack;
    },

    // [Fix WZ-08] Защита от двойного тапа во время анимации: второй тап по
    // "Далее" валидировал ещё невидимый шаг и ставил в очередь следующий
    // переход, а на шаге перед "Отправкой" попадал в "Отправить" (кнопки
    // меняются местами). Флаг снимается в afterNavigate; таймер — страховка,
    // чтобы wizard не "завис", если afterNavigate по какой-то причине не придёт.
    _startStepTransition (oNavContainer) {
      if (!oNavContainer.getDomRef()) { return; } // не отрисован — анимации и afterNavigate не будет
      this._bStepTransition = true;
      clearTimeout(this._iStepTransitionTimer);
      this._iStepTransitionTimer = setTimeout(() => this._endStepTransition(), STEP_TRANSITION_TIMEOUT_MS);
    },

    _endStepTransition () {
      this._bStepTransition = false;
      clearTimeout(this._iStepTransitionTimer);
      this._iStepTransitionTimer = null;
    },

    // [Fix WZ-07] В FLP стрелка "Назад" шелла по умолчанию уходит из
    // приложения с любого шага; со 2-го шага она ведёт на предыдущий шаг
    // wizard'а, на 1-м — поведение шелла по умолчанию (setBackNavigation()
    // без аргумента). Вне FLP сервиса нет — no-op (см. Main.controller.js#onInit).
    _updateShellBackNavigation (iStep) {
      if (!this._oShellUIService) { return; }
      if (!this._fnShellBack) { this._fnShellBack = () => this.onWizardBack(); }
      // [Fix RN-05] setBackNavigation в ushell 1.71 помечен @private — best-effort:
      // при его исчезновении/смене контракта стрелка просто ведёт себя по умолчанию.
      if (typeof this._oShellUIService.setBackNavigation !== "function") { return; }
      try {
        if (iStep > WizardSteps.WHEN) {
          this._oShellUIService.setBackNavigation(this._fnShellBack);
        } else {
          this._oShellUIService.setBackNavigation();
        }
      } catch (oErr) {
        Log.warning("ShellUIService.setBackNavigation failed", oErr && oErr.message, "sap.pc_lite.lite.controller.mixin.WizardNavigation");
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
      if (this._bStepTransition) { return; }
      const oView = this.getView();
      const iStep = oView.getModel("wizardModel").getProperty("/currentStep");
      const oFormModel = oView.getModel("formModel");
      const oChecksModel = oView.getModel("checksModel");
      const oBarriersModel = oView.getModel("barriersModel");

      // [Fix RS-04] Уходя с "Когда и где": иерархия должна соответствовать дате проверки
      // (повтор после сбоя прежнего перечитывания); ответ сам перепроверит выбранное место.
      if (iStep === WizardSteps.WHEN) { this._ensureLocationsAsOf(); }
      const aTextIssues = [];
      if (!FormValidator.isStepComplete(oFormModel, iStep, oChecksModel, oBarriersModel, this.getResourceBundle(), aTextIssues)) {
        this._showStepIncomplete(aTextIssues);
        return;
      }
      this._goToStep(this._skipBarriersIfNeeded(iStep + 1, "forward"), "forward");
    },

    // [Fix WZ-06/UX-07] Конкретная причина (нет строки с кодом, строки без кода,
    // один сотрудник в обеих ролях) вместо общего "заполните обязательные поля",
    // когда подсветка поля её не объясняет.
    _showStepIncomplete (aTextIssues) {
      MessageToast.show(aTextIssues && aTextIssues.length
        ? aTextIssues.join("\n")
        : this.getResourceBundle().getText("msgStepIncomplete"));
    },

    // [Поэтапный ввод, по просьбе] Возврат назад — без какой-либо проверки
    // FormValidator: смысл кнопки именно в том, чтобы поправить уже введённое,
    // блокировать её тем же гейтингом, что и "Далее", было бы противоречием.
    onWizardBack () {
      if (this._bStepTransition) { return; }
      const iStep = this.getView().getModel("wizardModel").getProperty("/currentStep");
      if (iStep <= WizardSteps.WHEN) { return; }
      this._goToStep(this._skipBarriersIfNeeded(iStep - 1, "back"), "back");
    }

  };
});
