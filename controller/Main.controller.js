sap.ui.define([
  "sap/ui/core/mvc/Controller",
  "sap/ui/core/Fragment",
  "sap/m/MessageBox",
  "sap/m/BusyDialog",
  "sap/base/Log",
  "sap/pc_lite/lite/model/formatter",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/model/FormValidator",
  "sap/pc_lite/lite/facade/DictionaryFacade",
  "sap/pc_lite/lite/controller/mixin/WizardNavigation",
  "sap/pc_lite/lite/controller/mixin/DictionaryValueHelp",
  "sap/pc_lite/lite/controller/mixin/LocationPicker",
  "sap/pc_lite/lite/controller/mixin/PersonSearch",
  "sap/pc_lite/lite/controller/mixin/RowsAndAutoFill",
  "sap/pc_lite/lite/controller/mixin/Submit"
], (Controller, Fragment, MessageBox, BusyDialog, Log,
             formatter, WizardSteps, FormValidator, DictionaryFacade,
             WizardNavigation, DictionaryValueHelp, LocationPicker, PersonSearch, RowsAndAutoFill, Submit) => {
  "use strict";

  // [Fix] sap/base/Log.error/warning/info принимают sComponent как ПРОСТУЮ
  // строку (третий аргумент), а не объект. Log.getLogger(...) в 1.71 не
  // возвращает логер с методами .error/.warning — раньше сюда передавался
  // сам объект Logger вместо строки, что писало в лог непредсказуемый
  // component-филд вместо "sap.pc_lite.lite.controller.Main" и ломало
  // фильтрацию логов по компоненту в Support Assistant/консоли.
  const LOG_COMPONENT = "sap.pc_lite.lite.controller.Main";

  // [Fix SRP, аудит] Main.controller.js разобран на 6 миксинов по зоне
  // ответственности (controller/mixin/*.js), каждый — отдельный ES-модуль с
  // объектом методов, подмешиваемый сюда через Object.assign, а не единый
  // ~830-строчный файл со всей логикой формы:
  //   - WizardNavigation    — шаги wizard'а (NavContainer/ProgressNavigator/скип "Барьеры")
  //   - DictionaryValueHelp — диалог выбора кода Checks/Barriers
  //   - LocationPicker      — диалог выбора расположения (drill-down иерархии)
  //   - PersonSearch        — поиск/выбор проверяемого и проверяющего
  //   - RowsAndAutoFill     — строки Checks/Barriers: добавление/удаление/авто-добавление по КПР
  //   - Submit              — финальная валидация, сборка payload, сабмит, сброс формы
  // Это ЧИСТАЯ реорганизация — методы перенесены дословно, поведение не
  // менялось (см. audit-отчёт, SRP/файл-разрастание). Здесь, в ядре
  // контроллера, остаётся только то, что не принадлежит ни одной из этих
  // зон: lifecycle (onInit/onExit), общая инфраструктура, которой пользуются
  // сразу несколько миксинов (getResourceBundle/_getDialog), и загрузка
  // справочников при старте. Методы миксинов обращаются друг к другу и к
  // этим общим через this (например RowsAndAutoFill#onPkLevelChange зовёт
  // this._updateFooterCount, определённый в том же миксине, а Submit#
  // _resetForm — this._autoDetectTimezone, определённый здесь) — это работает,
  // потому что все они в итоге лежат на одном и том же объекте-прототипе
  // контроллера, а не потому что миксины физически видят друг друга.
  return Controller.extend("sap.pc_lite.lite.controller.Main", Object.assign({

    formatter,

    onInit () {
      this._oDialogs = {};
      this._bDestroyed = false;
      this._bShellDirty = false;
      this._syncBrowserTabTitle();
      this._initShellIntegration();
      this._loadDictionaries();
      // [Fix "не изобретать велосипед", по запросу] Регистрация моделей как
      // MessageProcessor — разовая, на весь app-lifetime (см.
      // FormValidator.js#registerProcessors) — без неё Message#target ни на
      // что не резолвится, valueState на полях не проставляется (проверено
      // живьём). formModel/checksModel/barriersModel переживают _resetForm
      // (setData на том же инстансе модели, не пересоздание) — регистрация
      // остаётся в силе и после сброса формы.
      FormValidator.registerProcessors(
        this.getView().getModel("formModel"),
        this.getView().getModel("checksModel"),
        this.getView().getModel("barriersModel")
      );
      // [Fix Memory] Делегат хранится на инстансе, а не только на View —
      // onExit явно снимает его через removeEventDelegate. View обычно
      // уничтожается вместе с контроллером, но при повторном использовании
      // одного View-инстанса (например, тестовый harness/повторный onInit)
      // непарный addEventDelegate накапливал бы дублирующиеся подписки.
      // [Fix, аудит] Стрелочная функция вместо .bind(this) — единственное
      // место в файле, где this сохранялось так, а не лексическим захватом
      // стрелки (как везде рядом, например .then() в _loadDictionaries).
      this._oFooterCountDelegate = { onAfterShowing: () => this._updateFooterCount() };
      this.getView().addEventDelegate(this._oFooterCountDelegate);

      // [Поэтапный ввод] WizardProgressNavigator — самостоятельный контрол
      // (не требует sap.m.Wizard/WizardStep, см. Main.view.xml) — заголовки
      // шагов задаются императивно здесь, а не биндингом: stepTitles — это
      // property (обычный массив строк), не aggregation, и нужен уже
      // переведённый текст из ResourceBundle.
      const rb = this.getResourceBundle();
      const oProgressNav = this.byId("progressNav");
      oProgressNav.setStepCount(WizardSteps.STEP_PAGE_IDS.length);
      // [Fix SSOT, аудит] Заголовки выводятся из STEP_PAGE_IDS через
      // STEP_TITLE_KEYS (pageId -> i18n-ключ, см. model/WizardSteps.js) —
      // раньше был независимый литеральный массив из 6 rb.getText(...) в
      // своём порядке, никак не связанном со STEP_PAGE_IDS.
      oProgressNav.setStepTitles(
        WizardSteps.STEP_PAGE_IDS.map((sPageId) => rb.getText(WizardSteps.STEP_TITLE_KEYS[sPageId]))
      );
      // Тап по уже открытому (пройденному) номеру шага в навигаторе — тот же
      // путь синхронизации NavContainer, что и наши кнопки "Далее"/"Назад"
      // (см. WizardNavigation.js#_goToStep), просто с направлением,
      // вычисленным по разнице шагов. wizardModel>/totalSteps (для гейтинга
      // Далее/Отправить в Main.view.xml) уже пришло из ModelsInit со
      // значением WizardSteps.TOTAL_STEPS — тот же источник, что и
      // setStepCount() выше, повторно здесь не задаём.
      oProgressNav.attachStepChanged(this._onProgressNavStepChanged, this);

      // [Fix РЕАЛЬНЫЙ БАГ, аудит] _initStepFocusAnnouncements определён в
      // WizardNavigation.js (см. верхний комментарий) — вызов через this, не
      // прямой импорт, тот же паттерн, что уже применён к
      // _updateBarriersAllowed выше по коду этого файла. Регистрирует
      // фокус-менеджмент смены шага один раз при старте — без него смена
      // экрана wizard'а никак не сигналилась ни фокусом, ни скринридером.
      this._initStepFocusAnnouncements();
    },

    // [Fix Clean Code] document.* — единственная прямая DOM-манипуляция во
    // всём контроллере, изолирована в один явно поименованный метод, а не
    // инлайн-вызов внутри onInit. index.html <title> — статический русский
    // текст, не следит за языком i18n-бандла (sap-language=EN рендерит форму
    // по-английски, а заголовок вкладки браузера оставался бы русским);
    // SAPUI5 не предоставляет абстракцию над document.title, поэтому прямой
    // DOM-вызов здесь неизбежен, но ограничен единственной точкой входа.
    _syncBrowserTabTitle () {
      document.title = this.getResourceBundle().getText("appTitle");
    },

    // Тот же защитный паттерн присутствия ushell.Container, что и в
    // MockServerBootstrap.js#_isFlp: вне FLP (standalone index.html) его нет.
    _getUshellContainer () {
      const oUshell = window.sap && window.sap.ushell;
      return (oUshell && oUshell.Container) || null;
    },

    // [Fix VH-08] В FLP заголовок приложения уже в шелл-баре — свой header
    // страницы дублировал его (две строки на телефоне). Standalone — остаётся.
    // [Fix WZ-07] ShellUIService (manifest sap.ui5/services, optional) нужен
    // для setBackNavigation — стрелка шелла ведёт на предыдущий шаг wizard'а
    // (WizardNavigation.js#_updateShellBackNavigation). Вне FLP промис
    // отклоняется — это штатно, сервиса просто нет.
    _initShellIntegration () {
      const bInFlp = !!this._getUshellContainer();
      this.byId("page").setShowHeader(!bInFlp);
      if (!bInFlp) { return; }
      this.getOwnerComponent().getService("ShellUIService").then((oService) => {
        if (this._bDestroyed) { return; }
        this._oShellUIService = oService;
        this._updateShellBackNavigation(this.getView().getModel("wizardModel").getProperty("/currentStep"));
      }, (oErr) => {
        Log.warning("ShellUIService unavailable", oErr && oErr.message, LOG_COMPONENT);
      });
    },

    onExit () {
      // [Fix FN-12] Асинхронные продолжения (загрузка справочников, submit,
      // ShellUIService) проверяют этот флаг и не трогают уничтоженный View.
      this._bDestroyed = true;
      clearTimeout(this._iStepTransitionTimer);
      // [Fix FN-12, FLP] Dirty-флаг Container глобален на всю FLP-сессию —
      // снимаем, чтобы не достался следующему приложению. Back-навигацию
      // шелл сбрасывает сам при смене приложения (вызов от уже неактивного
      // компонента он лишь отклонит с warning) — здесь только отпускаем ссылку.
      this._setShellDirty(false);
      this._oShellUIService = null;

      // [Fix утечка ресурсов, аудит] Симметрично registerProcessors в onInit —
      // см. подробное обоснование у FormValidator.unregisterProcessors.
      FormValidator.unregisterProcessors(
        this.getView().getModel("formModel"),
        this.getView().getModel("checksModel"),
        this.getView().getModel("barriersModel")
      );

      // [Fix утечка памяти] Диалоги, загруженные через Fragment.load()
      // (_getDialog), явно destroy()-ятся здесь — без этого они переживали бы
      // Main.controller и держали бы свои биндинги/event-handlers в памяти.
      Object.keys(this._oDialogs || {}).forEach((sKey) => {
        if (this._oDialogs[sKey]) {
          this._oDialogs[sKey].then((oDlg) => oDlg.destroy());
        }
      });
      this._oDialogs = null;

      // [Fix Memory] Снимаем делегат, поставленный в onInit — симметрично
      // addEventDelegate, во избежание висящей ссылки this._oFooterCountDelegate
      // -> контроллер после уничтожения View.
      if (this._oFooterCountDelegate) {
        this.getView().removeEventDelegate(this._oFooterCountDelegate);
        this._oFooterCountDelegate = null;
      }

      // [Fix Memory, аудит] Симметрично _initDirtyTracking (см. _loadDictionaries).
      this._stopDirtyTracking();

      // [Fix утечка ресурсов, аудит] См. подробное обоснование у
      // _loadDictionaries — BusyDialog, открытый там, не привязан к DOM
      // этого View и не уничтожается сам вместе с ним. Если справочники ещё
      // не успели загрузиться (или упасть с ошибкой) к моменту ухода с
      // плитки, this._oLoadingBusy всё ещё указывает на живой, открытый
      // диалог — уничтожаем его здесь явно, а не оставляем блокировать
      // экран до того, как устаревший Promise сам разрешится.
      if (this._oLoadingBusy) {
        this._oLoadingBusy.destroy();
        this._oLoadingBusy = null;
      }
      // [Fix DRY] PersonSearchFacade.clearCache() — теперь только в
      // Component#exit (единственный владелец жизненного цикла синглтон-
      // таймеров на весь app-lifetime); дублирующий вызов здесь убран.
    },

    _autoDetectTimezone () {
      try {
        const sTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const aTz = this.getView().getModel("dictionaryModel").getProperty("/TIMEZONE") || [];

        // [Fix, аудит] .find() вместо .filter()[0] — тот же идиом, что уже
        // использует DictionaryFacade.isCodeAvailableForPk для точно той же
        // задачи "первое совпадение", вместо накопления и отбрасывания
        // промежуточного массива.
        let oMatch = aTz.find((e) => e.Code === sTz || (e.Text || "").indexOf(sTz) > -1);

        if (!oMatch && sTz && sTz.indexOf("/") > -1) {
          const sCity = sTz.split("/")[1].replace(/_/g, " ");
          oMatch = aTz.find((e) => (e.Text || "").indexOf(sCity) > -1);
        }

        // [Fix FN-14] Удалён fallback по "UTC+NN": коды справочника — IANA-имена,
        // он не совпадал никогда. Нет совпадения — поле пустое, выбор вручную.

        if (oMatch) {
          this.getView().getModel("formModel").setProperty("/TimeZone", oMatch.Code);
        }
      } catch (e) {
        // Intl недоступен — не критично для работы формы (TimeZone остаётся
        // пустым, пользователь выбирает вручную), но залогировано, а не
        // проглочено молча — иначе диагностировать регрессию в проде нечем.
        Log.warning("Timezone auto-detect skipped", e && e.message, LOG_COMPONENT);
      }
    },

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Многошаговый визард копит существенный ввод
    // (поиск людей, строки проверок/барьеров, даты, местоположение) поперёк
    // нескольких экранов, но ни разу не сообщал шеллу FLP о несохранённых
    // изменениях — manifest.json объявляет sap.fiori.archeType="transactional"
    // и реальный inbound (Intent-createChecks), то есть это НАСТОЯЩЕЕ
    // FLP-приложение, а не автономная страница, и именно для transactional-
    // приложений шелл поддерживает штатный "у вас есть несохранённые
    // изменения, всё равно уйти?" через Container.setDirtyFlag. Без
    // этого пользователь, ушедший с плитки на середине заполнения (кнопка
    // "Домой", другая плитка), терял всё введённое без единого
    // предупреждения. Отдельная забота от намеренного отсутствия backend-
    // draft/resume у pc_lite (см. верхний комментарий проекта) — это только
    // подключение к УЖЕ существующему нативному диалогу шелла, не
    // добавление своего собственного цикла черновиков.
    //
    // [Fix WZ-02/UX-04/PF-04] Раньше — getServiceAsync("ShellUIService"):
    // такого Container-сервиса нет (и у ShellUIService нет setDirtyFlag), флаг
    // не ставился никогда, а на каждое нажатие клавиши — reject + warning.
    // Штатный API — синхронный sap.ushell.Container.setDirtyFlag; значение
    // кэшируется, в шелл уходят только переходы false<->true. Вне FLP — no-op.
    _setShellDirty (bDirty) {
      if (this._bShellDirty === bDirty) { return; }
      this._bShellDirty = bDirty;
      const oContainer = this._getUshellContainer();
      if (oContainer && typeof oContainer.setDirtyFlag === "function") {
        oContainer.setDirtyFlag(bDirty);
      }
    },

    // [Fix, живой тест] Оборачивает setProperty трёх моделей формы напрямую,
    // а НЕ подписывается на событие "propertyChange" — первая попытка
    // (attachPropertyChange) проверялась живьём и не сработала: у
    // sap.ui.model.json.JSONModel в этой версии setProperty вызывает
    // this.checkUpdate(...) (пересчёт активных БИНДИНГОВ), а не
    // firePropertyChange на самой модели — событие "propertyChange" здесь
    // просто ни разу не стреляет на прямой setProperty (подтверждено
    // инспекцией минифицированного исходника setProperty и живым тестом:
    // attachPropertyChange + setProperty -> обработчик не вызван).
    // Оборачивание setProperty перехватывает ЛЮБУЮ запись в эти 3 модели
    // одинаково — что через прямой контроллерный вызов, что через
    // двустороннюю XML-привязку (DatePicker/ComboBox/TextArea и т.д. сами
    // вызывают тот же oModel.setProperty внутри себя при вводе) — единая
    // точка перехвата вместо попытки отдельно слушать каждый из ~15
    // конкретных input-контролов формы. Обёртка — на ИНСТАНСЕ модели (не на
    // JSONModel.prototype), поэтому не затрагивает dictionaryModel/
    // locationModel и другие модели вне этих трёх.
    _initDirtyTracking () {
      // [Fix FN-12/FN-13] Не ставить обёртки повторно (retry загрузки) и
      // после onExit (там они уже сняты _stopDirtyTracking).
      if (this._aDirtyTrackedModels || this._bDestroyed) { return; }
      const oView = this.getView();
      this._aDirtyTrackedModels = ["formModel", "checksModel", "barriersModel"]
        .map((sName) => oView.getModel(sName));
      this._aDirtyTrackedModels.forEach((oM) => {
        const fnOriginal = oM.setProperty.bind(oM);
        oM.__pcLiteOrigSetProperty = fnOriginal;
        oM.setProperty = (...args) => {
          const bResult = fnOriginal(...args);
          this._setShellDirty(true);
          return bResult;
        };
      });
    },

    // [Fix Memory, аудит] Симметрично _initDirtyTracking — возвращает
    // оригинальный setProperty при уничтожении контроллера (см. onExit),
    // тем же приёмом, что уже применён к _oFooterCountDelegate.
    _stopDirtyTracking () {
      if (this._aDirtyTrackedModels) {
        this._aDirtyTrackedModels.forEach((oM) => {
          if (oM.__pcLiteOrigSetProperty) {
            oM.setProperty = oM.__pcLiteOrigSetProperty;
            delete oM.__pcLiteOrigSetProperty;
          }
        });
        this._aDirtyTrackedModels = null;
      }
    },

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] BusyDialog теперь хранится на this._oLoadingBusy,
    // не только в локальной переменной — раньше onExit() не имел к нему
    // доступа вообще. sap.m.BusyDialog рендерится в статическую UIArea (не в
    // DOM этого View) и блокирует ВЕСЬ вьюпорт целиком, независимо от того,
    // жив ли ещё View/Controller, который его открыл. Сценарий: пользователь
    // открывает плитку pc_lite в FLP, _loadDictionaries() открывает диалог и
    // запускает чтение справочников; ДО того как оно завершится, пользователь
    // уходит на другую плитку/домой — FLP уничтожает Component/View/Controller,
    // onExit срабатывает. Раньше onExit ничего не знал про oBusy (он жил
    // только в замыкании .then()/.catch()) — диалог оставался открытым и
    // блокировал ЧТО БЫ FLP ни показал следующим, пока не-к-чему-уже-
    // относящийся Promise когда-нибудь сам не разрешится и не вызовет
    // oBusy.destroy() из своего устаревшего замыкания. Теперь onExit явно
    // уничтожает его, если сеть ещё не ответила к моменту ухода (см. ниже).
    _loadDictionaries () {
      const oView = this.getView();
      const rb = this.getResourceBundle();
      const oBusy = new BusyDialog({ text: rb.getText("msgLoadingDict") });
      this._oLoadingBusy = oBusy;
      oBusy.open();
      const sCheckDate = oView.getModel("formModel").getProperty("/CheckDate");
      DictionaryFacade.load(
        oView.getModel(), oView.getModel("dictionaryModel"),
        oView.getModel("locationModel"), sCheckDate
      ).then(() => {
        if (this._bDestroyed) { return; }
        oBusy.destroy();
        this._oLoadingBusy = null;
        // [Fix LIVE-03] Тост "Справочники загружены…" при каждом старте убран —
        // технический шум для пользователя; сообщается только ошибка.
        this._autoDetectTimezone();
        // [Fix РЕАЛЬНЫЙ БАГ, аудит] Вызов _updateBarriersAllowed() здесь
        // раньше был нужен, чтобы пересчитать и ЗАПИСАТЬ formModel>/
        // BarriersAllowed после загрузки справочников — с переходом
        // видимости секции "Барьеры" на formatter.isBarriersAllowed
        // (см. formatter.js), считающий значение НАПРЯМУЮ из formModel>/
        // PkLevel при каждом рендере, отдельно хранимого флага, который
        // нужно было бы здесь освежать, больше не существует.
        //
        // [Fix РЕАЛЬНЫЙ БАГ, аудит] Слежение за "грязностью" формы
        // подключается ЗДЕСЬ, ПОСЛЕ _autoDetectTimezone() выше — иначе
        // автоопределение таймзоны (одна programmatic-запись при загрузке,
        // не действие пользователя) само пометило бы форму как "есть
        // несохранённые изменения" ещё до того, как пользователь вообще
        // что-то тронул.
        this._initDirtyTracking();
      }).catch((oErr) => {
        if (this._bDestroyed) { return; }
        oBusy.destroy();
        this._oLoadingBusy = null;
        Log.error("Dictionary load failed", oErr && oErr.message, LOG_COMPONENT);
        this._showDictionaryLoadError(oErr);
      });
    },

    // [Fix FN-13/UX-13] Раньше — техническое "Метаданные не загрузились: …"
    // без выхода: пустые справочники до перезагрузки плитки. Теперь понятный
    // текст + "Повторить" (перезапуск загрузки), тех. детали — под ссылкой.
    // emphasizedAction в 1.71 нет — фокус на "Повторить" через initialFocus.
    _showDictionaryLoadError (oErr) {
      const rb = this.getResourceBundle();
      const sRetry = rb.getText("btnRetry");
      MessageBox.error(rb.getText("msgDictLoadFailed"), {
        details: oErr && oErr.message ? oErr.message : String(oErr || ""),
        actions: [sRetry, MessageBox.Action.CLOSE],
        initialFocus: sRetry,
        onClose: (sAction) => {
          if (sAction === sRetry && !this._bDestroyed) { this._loadDictionaries(); }
        }
      });
    },

    getResourceBundle () {
      return this.getOwnerComponent().getModel("i18n").getResourceBundle();
    },

    _getDialog (sId, sFragmentName) {
      if (!this._oDialogs[sId]) {
        this._oDialogs[sId] = Fragment.load({
          id: this.getView().getId(),
          name: sFragmentName,
          controller: this
        }).then((oDlg) => {
          this.getView().addDependent(oDlg);
          return oDlg;
        });
      }
      return this._oDialogs[sId];
    }

  }, WizardNavigation, DictionaryValueHelp, LocationPicker, PersonSearch, RowsAndAutoFill, Submit));
});
