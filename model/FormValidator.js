sap.ui.define([
  "sap/ui/core/message/Message",
  "sap/ui/core/library",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/model/BusinessRules",
  "sap/pc_lite/lite/util/ODataFormat"
], (Message, coreLibrary, EntityConfig, WizardSteps, BusinessRules, ODataFormat) => {
  "use strict";

  const MessageType = coreLibrary.MessageType;

  // [Fix "не изобретать велосипед", по запросу] Раньше validate() возвращал
  // массив ГОТОВЫХ текстовых строк, а _validateBeforeSubmit (Submit.js)
  // склеивал их в ОДИН MessageBox.error — пользователь видел общий текст
  // ("Заполните обязательные поля: Проверяемый, Дата проверки, ...") и сам
  // должен был найти нужные поля на нужных шагах. Теперь — штатный
  // sap.ui.core.message.Message + sap.ui.core.message.MessageManager:
  // Message с target на конкретный путь модели автоматически даёт
  // valueState="Error"/valueStateText прямо на связанном контроле (Input/
  // ComboBox/DatePicker/TextArea — работает одинаково что для value, что
  // для selectedKey, проверено живьём), без единой ручной строчки
  // "найти control и вызвать setValueState" в контроллере. MessageBox
  // остаётся только как краткое итоговое уведомление ("что-то не
  // заполнено, смотрите отмеченные шаги"), не как единственный источник
  // информации об ошибке.
  //
  // 4-й элемент — путь, на который naводится Message (относительно
  // formModel). НЕ всегда совпадает с самим ПРОВЕРЯЕМЫМ полем: например
  // InspectedPernr — внутреннее поле (обнуляется на каждый keystroke, см.
  // PersonSearch.js#onPersonLiveChange), которое ни один Input не биндит
  // напрямую как value — визуально это поле показывает InspectedFullname
  // (см. StepPeople.fragment.xml), значит и подсветка ошибки должна целиться
  // в InspectedFullname, иначе valueState просто не на чем было бы
  // показаться. То же для LocationUUID -> LocationText (Input показывает
  // текст, не UUID, см. StepWhenWhere.fragment.xml).
  //
  // 3-й элемент — номер шага wizard'а (см. model/WizardSteps.js) — как и
  // раньше, используется только isStepComplete() ниже (гейтинг кнопки
  // "Далее" по шагу).
  const REQUIRED_FIELDS = [
    ["InspectedPernr", "msgValInspected", WizardSteps.PEOPLE, "/InspectedFullname"],
    ["InspectorPernr", "msgValInspector", WizardSteps.PEOPLE, "/InspectorFullname"],
    ["CheckDate", "msgValCheckDate", WizardSteps.WHEN, "/CheckDate"],
    ["CheckTime", "msgValCheckTime", WizardSteps.WHEN, "/CheckTime"],
    ["TimeZone", "msgValTimeZone", WizardSteps.WHEN, "/TimeZone"],
    ["PkLevel", "msgValPkLevel", WizardSteps.PROFESSION, "/PkLevel"],
    ["Profession", "msgValProfession", WizardSteps.PROFESSION, "/Profession"],
    ["LocationUUID", "msgValLocation", WizardSteps.WHEN, "/LocationText"]
  ];

  // Шаги wizard'а без полей formModel в REQUIRED_FIELDS: WizardSteps.CHECKS
  // "Проверки" — валиден только при наличии хотя бы одной строки с кодом (то
  // же правило, что msgValMinCheck ниже); WizardSteps.BARRIERS — то же самое,
  // но необязателен целиком, если BusinessRules.isBarriersAllowed — false
  // (тогда шаг всё равно пропускается навигацией, см. WizardNavigation.js).
  const MIN_CHECK_ROWS_STEP = WizardSteps.CHECKS;
  const MIN_BARRIER_ROWS_STEP = WizardSteps.BARRIERS;

  // [SSOT] Единственное место, держащее СПИСОК активных Message-объектов,
  // добавленных ИМЕННО этим модулем — validate()/isStepComplete() каждый раз
  // сначала снимают ровно эти (не трогая гипотетические чужие сообщения в
  // MessageManager, которых в этом приложении больше ниоткуда не бывает, но
  // принцип "снимай только своё" правильный сам по себе) и пересчитывают
  // заново с нуля. MessageManager не различает "устарело"/"актуально" сам —
  // Message, однажды добавленный, висит на valueState контрола, пока его не
  // снимут явно (проверено живьём: смена значения поля НЕ сбрасывает
  // valueState автоматически) — это наша забота, не платформы.
  // [Fix FN-10/WZ-10/UX-08] Элемент: { msg, processor, triggers } — triggers:
  // пути модели, запись НЕпустого значения в которые снимает сообщение
  // (см. clearMessagesForWrite). Для ФИО это Pernr, а не набираемый текст.
  let aActiveMessages = [];

  function removeEntries (fnMatch) {
    const aRemove = aActiveMessages.filter(fnMatch);
    if (!aRemove.length) { return; }
    aActiveMessages = aActiveMessages.filter((e) => aRemove.indexOf(e) === -1);
    sap.ui.getCore().getMessageManager().removeMessages(aRemove.map((e) => e.msg));
  }

  function clearActiveMessages () {
    removeEntries(() => true);
  }

  function addMessage (oProcessor, sPath, sText, aTriggers) {
    aActiveMessages.push({
      msg: new Message({
        target: sPath,
        type: MessageType.Error,
        message: sText,
        processor: oProcessor
      }),
      processor: oProcessor,
      triggers: aTriggers || [sPath]
    });
  }

  function publishMessages () {
    const aNew = aActiveMessages.filter((e) => !e.published);
    aNew.forEach((e) => { e.published = true; });
    if (aNew.length) {
      sap.ui.getCore().getMessageManager().addMessages(aNew.map((e) => e.msg));
    }
  }

  // Строки только дописаны в конец (кнопка "Добавить", авто-строки) — индексы
  // прежних строк, а значит и их подсветка, остались верными.
  function isAppendOnly (aOld, aNew) {
    return Array.isArray(aOld) && Array.isArray(aNew) && aNew.length >= aOld.length &&
      aOld.every((r, i) => r === aNew[i]);
  }

  // [Fix UX-05] Pernr пуст, а ФИО введено текстом — человек не выбран из
  // подсказок: говорим именно это, а не "укажите проверяемого".
  const PERSON_PICK_PROPS = ["InspectedPernr", "InspectorPernr"];

  // Обязательные поля из aFields: Message на target-путь (снимается записью
  // самого поля: Pernr, LocationUUID, ...); @returns номера шагов пустых полей.
  function checkRequiredFields (oFormModel, oForm, aFields, rb) {
    const aSteps = [];
    aFields.forEach(([sProp, sMsgKey, iStep, sTargetPath]) => {
      if (oForm[sProp]) { return; }
      const bTypedNotPicked = PERSON_PICK_PROPS.indexOf(sProp) !== -1 && !!oForm[sTargetPath.slice(1)];
      addMessage(oFormModel, sTargetPath, rb.getText(bTypedNotPicked ? "msgPersonPickFromList" : sMsgKey), [`/${sProp}`]);
      aSteps.push(iStep);
    });
    return aSteps;
  }

  // [Fix FN-09] Бэкенд (validate_no_conflict_of_interest) отклоняет запись, где
  // проверяющий = проверяемый; ловим это на шаге "Участники", а не 400 на сабмите.
  // @returns {boolean} true — совпадают (Message на поле проверяющего)
  function checkSamePerson (oFormModel, oForm, rb) {
    if (!oForm.InspectedPernr || oForm.InspectedPernr !== oForm.InspectorPernr) { return false; }
    addMessage(oFormModel, "/InspectorFullname", rb.getText("msgValSamePerson"), ["/InspectedPernr", "/InspectorPernr"]);
    return true;
  }

  // [Fix FN-03] Заполненные, но нераспознаваемые дата/время (шаг "Когда и где").
  function collectDateTimeIssues (oForm, rb) {
    const aIssues = [];
    if (oForm.CheckDate && !ODataFormat.isValidDate(oForm.CheckDate)) {
      aIssues.push({ path: "/CheckDate", text: rb.getText("msgCheckDateInvalid") });
    }
    if (oForm.CheckTime && !ODataFormat.isValidTime(oForm.CheckTime)) {
      aIssues.push({ path: "/CheckTime", text: rb.getText("msgCheckTimeInvalid") });
    }
    return aIssues;
  }

  // [Fix FN-05/UX-09] Строка с данными пользователя, но без кода, в payload не
  // попадёт (DeepEntityFacade._collectRows) — блокируем, а не теряем молча.
  // У ячейки кода (Link) нет valueState, поэтому Message — на Комментарий строки.
  // @returns {number[]} индексы таких строк
  function findCodelessRows (aRows, oCfg) {
    const aIdx = [];
    (aRows || []).forEach((r, i) => {
      if (!r[oCfg.codeProp] && BusinessRules.hasRowUserData(r)) { aIdx.push(i); }
    });
    return aIdx;
  }

  function codelessRowsText (aIdx, oCfg, rb) {
    return rb.getText("msgValRowsWithoutCode", [rb.getText(oCfg.sectionKey), aIdx.map((i) => i + 1).join(", ")]);
  }

  function flagCodelessRows (oModel, aRows, oCfg, rb) {
    const aIdx = findCodelessRows(aRows, oCfg);
    aIdx.forEach((i) => addMessage(oModel, `/items/${i}/Comment`, rb.getText("msgValRowCodeMissing"), [`/items/${i}/${oCfg.codeProp}`]));
    return aIdx;
  }

  // [Поля несоответствия, по запросу] Общая проверка для checksModel и
  // barriersModel — строка, явно помеченная BusinessRules.isUnsatisfactoryResult,
  // обязана нести описание и место несоответствия. Не трогает строки, у
  // которых ещё не выбран код (симметрично _hasAnyCheckRow — черновая,
  // никогда не тронутая пользователем строка не в счёт).
  // triggers: смена Результата тоже снимает подсветку (поле перестаёт быть обязательным).
  function collectNonConformityIssues (aRows, oCfg, rb) {
    const aIssues = [];
    (aRows || []).forEach((r, i) => {
      if (!r[oCfg.codeProp] || !BusinessRules.isUnsatisfactoryResult(r.Status)) { return; }
      [["NonConformityDescription", "msgValNonConformityDescription"], ["NonConformityLocation", "msgValNonConformityLocation"]]
        .forEach(([sProp, sMsgKey]) => {
          if (r[sProp]) { return; }
          const sPath = `/items/${i}/${sProp}`;
          aIssues.push({ path: sPath, text: rb.getText(sMsgKey), triggers: [sPath, `/items/${i}/Status`] });
        });
    });
    return aIssues;
  }

  function flagNonConformityIssues (oModel, aRows, oCfg, rb) {
    const aIssues = collectNonConformityIssues(aRows, oCfg, rb);
    aIssues.forEach((oIssue) => addMessage(oModel, oIssue.path, oIssue.text, oIssue.triggers));
    return aIssues.length;
  }

  class FormValidator {
    // [Fix "не изобретать велосипед", по запросу] Каждая JSONModel, чьи
    // пути используются как Message#target, должна быть один раз
    // зарегистрирована как MessageProcessor — иначе target ни на что не
    // резолвится и valueState не проставляется (проверено живьём). Вызывается
    // один раз при старте приложения (см. Main.controller.js#onInit), не на
    // каждую валидацию.
    static registerProcessors (oFormModel, oChecksModel, oBarriersModel) {
      const oMM = sap.ui.getCore().getMessageManager();
      oMM.registerMessageProcessor(oFormModel);
      oMM.registerMessageProcessor(oChecksModel);
      oMM.registerMessageProcessor(oBarriersModel);
    }

    // [Fix утечка ресурсов, аудит] Симметричный counterpart к
    // registerProcessors — раньше отсутствовал вовсе, а Main.controller.js#
    // onExit его не вызывал, хотя onInit регистрирует все три модели как
    // MessageProcessor безусловно. В обычном браузерном табе это неважно
    // (вся страница выгружается целиком вместе с MessageManager), но
    // приложение задумано как экран внутри Fiori Launchpad (см. верхний
    // комментарий проекта) — там уход с этого приложения на другое
    // уничтожает Component/View/Controller, но НЕ перезагружает страницу
    // целиком, а sap.ui.getCore().getMessageManager() — синглтон на весь
    // сеанс FLP. Без явной отмены регистрации оставшиеся ссылки на
    // formModel/checksModel/barriersModel (уже уничтоженные вместе с
    // Controller) держались бы MessageManager сколько угодно долго —
    // классическая утечка при повторных open/close этого приложения внутри
    // одной сессии FLP. clearActiveMessages() — тоже отсюда: снимать
    // Message с процессора, который вот-вот перестанет быть
    // зарегистрированным, уже бессмысленно после unregister.
    static unregisterProcessors (oFormModel, oChecksModel, oBarriersModel) {
      clearActiveMessages();
      const oMM = sap.ui.getCore().getMessageManager();
      oMM.unregisterMessageProcessor(oFormModel);
      oMM.unregisterMessageProcessor(oChecksModel);
      oMM.unregisterMessageProcessor(oBarriersModel);
    }

    /**
     * Полная проверка перед сабмитом: обязательные поля (с подсветкой
     * конкретных контролов через MessageManager), поля несоответствия на
     * строках с результатом "Неудовлетворительно", минимум одна строка
     * проверки, и длины Equipment/Comment/полей несоответствия против
     * EntityConfig.CONSTRAINTS — тот же SSOT-лимит, на который биндится
     * constraintsModel во фрагментах (maxLength у Input/TextArea). Тот
     * UI-лимит защищает только ввод через сам control, но не является
     * границей доверия — значение в JSONModel можно получить длиннее лимита
     * в обход UI, поэтому граница проверяется здесь ещё раз, на входе в
     * payload-сборку.
     *
     * [Fix РЕАЛЬНЫЙ БАГ, аудит] Раньше все проверки — "поле не заполнено",
     * "нет ни одной строки проверки", "текст длиннее лимита" — сваливались в
     * ОДНО число, которое затем подставлялось в msgValidationFailed
     * ("Не заполнено обязательных полей: {N}"). Формально неверно сразу в
     * двух случаях: (1) "нет строк проверки"/"текст длиннее лимита" — это не
     * "поле не заполнено", а другая проблема с другим текстом, у части из
     * них уже БЫЛИ готовые i18n-ключи (msgValMinCheck/msgValEquipmentTooLong/
     * msgValCommentTooLong), которые из-за этого ни разу не читались нигде в
     * коде — мёртвые ключи; (2) число в скобках могло вообще не совпадать с
     * тем, что реально не так, если сработала хотя бы одна из "неполевых"
     * причин. Теперь два раздельных канала: fieldCount — только реальные
     * "поле не заполнено" случаи (у каждого уже есть персональный Message с
     * target, см. addMessage выше, и msgValidationFailed остаётся дословно
     * верным описанием именно этого числа); textIssues — готовые, уже
     * переведённые строки для всего остального, что либо не привязывается к
     * одному контролу (нет строк проверки — Table не имеет valueState) либо
     * является "длина превышена" (осознанно без personal target — см.
     * прежнее обоснование ниже, актуально по-прежнему). Submit.js склеивает
     * оба канала в один MessageBox, но текст теперь описывает именно то, что
     * произошло, а не всегда "не заполнено".
     *
     * Длины полей и "нет строк проверки" — то, что НЕ получает персонального
     * target: длины — защита от обхода UI, а не сценарий, который реальный
     * пользователь встретит через форму (maxLength уже не даёт ввести больше
     * символов); "нет строк проверки" — у sap.m.Table нет valueState-контрола,
     * на который можно было бы навести Message. Оба остаются в текстовом
     * msgBox-канале (textIssues), не как выдуманное число в fieldCount.
     *
     * @param {sap.ui.model.json.JSONModel} oFormModel
     * @param {sap.ui.model.json.JSONModel} oChecksModel
     * @param {sap.ui.model.json.JSONModel} oBarriersModel
     * @param {sap.base.i18n.ResourceBundle} rb
     * @returns {{fieldCount: number, textIssues: string[], firstInvalidStep: number}}
     *   fieldCount — сколько обязательных полей не заполнено (0 — все заполнены);
     *   textIssues — готовые тексты остальных проблем (нет строк проверки,
     *   превышены лимиты длины); форма валидна, когда оба пусты/равны нулю.
     *   firstInvalidStep — [Fix WZ-05/UX-07] шаг первой ошибки с подсветкой
     *   (0 — таких нет; лимиты длины шага не дают).
     */
    static validate (oFormModel, oChecksModel, oBarriersModel, rb) {
      clearActiveMessages();

      const oForm = oFormModel.getData();
      const aChecks = oChecksModel.getProperty("/items") || [];
      const aBarriers = oBarriersModel.getProperty("/items") || [];
      const aTextIssues = [];
      const aInvalidSteps = checkRequiredFields(oFormModel, oForm, REQUIRED_FIELDS, rb);
      let iFieldCount = aInvalidSteps.length;

      collectDateTimeIssues(oForm, rb).forEach((oIssue) => {
        addMessage(oFormModel, oIssue.path, oIssue.text);
        aTextIssues.push(oIssue.text);
        aInvalidSteps.push(WizardSteps.WHEN);
      });

      if (checkSamePerson(oFormModel, oForm, rb)) {
        aTextIssues.push(rb.getText("msgValSamePerson"));
        aInvalidSteps.push(WizardSteps.PEOPLE);
      }

      if (!FormValidator._hasAnyCheckRow(aChecks)) {
        aTextIssues.push(rb.getText("msgValMinCheck"));
        aInvalidSteps.push(MIN_CHECK_ROWS_STEP);
      }

      [[oChecksModel, aChecks, EntityConfig.TYPES.Checks, MIN_CHECK_ROWS_STEP],
        [oBarriersModel, aBarriers, EntityConfig.TYPES.Barriers, MIN_BARRIER_ROWS_STEP]]
        .forEach(([oModel, aRows, oCfg, iStep]) => {
          const aIdx = flagCodelessRows(oModel, aRows, oCfg, rb);
          if (aIdx.length) {
            aTextIssues.push(codelessRowsText(aIdx, oCfg, rb));
            aInvalidSteps.push(iStep);
          }
          const iNcIssues = flagNonConformityIssues(oModel, aRows, oCfg, rb);
          if (iNcIssues) {
            iFieldCount += iNcIssues;
            aInvalidSteps.push(iStep);
          }
        });

      const iEquipMax = EntityConfig.CONSTRAINTS.EquipmentMaxLength;
      if ((oForm.Equipment || "").length > iEquipMax) {
        aTextIssues.push(rb.getText("msgValEquipmentTooLong", [iEquipMax]));
      }

      // [Fix РЕАЛЬНЫЙ БАГ, аудит] Та же граница доверия, что уже применена
      // к Equipment/Comment/полям несоответствия — maxLength на самом
      // Input (см. StepWhenWhere.fragment.xml) не даёт ввести больше
      // символов ЧЕРЕЗ UI, но не является границей доверия сама по себе;
      // значение в JSONModel можно получить длиннее лимита в обход UI.
      // Раньше LocationText было единственным свободно редактируемым полем
      // формы вообще без такой перепроверки.
      const iLocNameMax = EntityConfig.CONSTRAINTS.LocationNameMaxLength;
      if ((oForm.LocationText || "").length > iLocNameMax) {
        aTextIssues.push(rb.getText("msgValLocationTooLong", [iLocNameMax]));
      }

      const iCommentMax = EntityConfig.CONSTRAINTS.CommentMaxLength;
      if (aChecks.concat(aBarriers).some((r) => (r.Comment || "").length > iCommentMax)) {
        aTextIssues.push(rb.getText("msgValCommentTooLong", [iCommentMax]));
      }

      const iDescMax = EntityConfig.CONSTRAINTS.NonConformityDescriptionMaxLength;
      const iLocMax = EntityConfig.CONSTRAINTS.NonConformityLocationMaxLength;
      // [Fix UX-09] Как и в payload (DeepEntityFacade._collectRows): поля
      // несоответствия уходят только при "Неудовлетворительно" — проверяем их же.
      const aAllRows = aChecks.concat(aBarriers).filter((r) => BusinessRules.isUnsatisfactoryResult(r.Status));
      if (aAllRows.some((r) => (r.NonConformityDescription || "").length > iDescMax)) {
        aTextIssues.push(rb.getText("msgValNonConformityDescriptionTooLong", [iDescMax]));
      }
      if (aAllRows.some((r) => (r.NonConformityLocation || "").length > iLocMax)) {
        aTextIssues.push(rb.getText("msgValNonConformityLocationTooLong", [iLocMax]));
      }

      publishMessages();
      return {
        fieldCount: iFieldCount,
        textIssues: aTextIssues,
        firstInvalidStep: aInvalidSteps.length ? Math.min(...aInvalidSteps) : 0
      };
    }

    /**
     * Лёгкая проверка "можно ли идти дальше" для одного шага wizard'а — как
     * и validate(), подсвечивает конкретные поля ЭТОГО шага через
     * MessageManager (см. addMessage выше), но масштаб — только текущий шаг,
     * не вся форма разом.
     * @param {sap.ui.model.json.JSONModel} oFormModel
     * @param {number} iStep — номер шага (см. WizardSteps/REQUIRED_FIELDS выше)
     * @param {sap.ui.model.json.JSONModel} oChecksModel
     * @param {sap.ui.model.json.JSONModel} oBarriersModel
     * @param {sap.base.i18n.ResourceBundle} rb
     * @param {string[]} [aTextIssues] — [Fix WZ-06/UX-07] сюда добавляются тексты
     *   проблем, которые не видны подсветкой поля (нет строки с кодом, строки без
     *   кода, один и тот же сотрудник) — для тоста вместо общего msgStepIncomplete.
     * @returns {boolean}
     */
    static isStepComplete (oFormModel, iStep, oChecksModel, oBarriersModel, rb, aTextIssues) {
      clearActiveMessages();

      const oForm = oFormModel.getData();
      const aIssues = aTextIssues || [];
      const aStepFields = REQUIRED_FIELDS.filter(([, , iFieldStep]) => iFieldStep === iStep);
      let bOk = checkRequiredFields(oFormModel, oForm, aStepFields, rb).length === 0;

      if (iStep === WizardSteps.WHEN) {
        collectDateTimeIssues(oForm, rb).forEach((oIssue) => {
          addMessage(oFormModel, oIssue.path, oIssue.text);
          bOk = false;
        });
      }

      if (iStep === WizardSteps.PEOPLE && checkSamePerson(oFormModel, oForm, rb)) {
        aIssues.push(rb.getText("msgValSamePerson"));
        bOk = false;
      }

      if (iStep === MIN_CHECK_ROWS_STEP && !FormValidator._hasAnyCheckRow(oChecksModel.getProperty("/items"))) {
        aIssues.push(rb.getText("msgValMinCheck"));
        bOk = false;
      }

      [[MIN_CHECK_ROWS_STEP, oChecksModel, EntityConfig.TYPES.Checks],
        [MIN_BARRIER_ROWS_STEP, oBarriersModel, EntityConfig.TYPES.Barriers]]
        .filter(([iRowsStep]) => iRowsStep === iStep)
        .forEach(([, oModel, oCfg]) => {
          const aRows = oModel.getProperty("/items") || [];
          const aIdx = flagCodelessRows(oModel, aRows, oCfg, rb);
          if (aIdx.length) {
            aIssues.push(codelessRowsText(aIdx, oCfg, rb));
            bOk = false;
          }
          if (flagNonConformityIssues(oModel, aRows, oCfg, rb)) { bOk = false; }
        });

      publishMessages();
      return bOk;
    }

    // [Fix FN-05/UX-03] Снимает подсветку этого модуля (Message с target по
    // индексу строки) — после удаления/чистки строк индексы сдвигаются, и
    // старая подсветка указала бы на чужую строку. oModel — только его сообщения.
    static clearMessages (oModel) {
      removeEntries((e) => !oModel || e.processor === oModel);
    }

    /**
     * [Fix FN-10/WZ-10/UX-08] Вызывается на каждую запись в модель формы/строк
     * (обёртка setProperty, Main.controller.js#_initDirtyTracking): снимает
     * подсветку, которую эта запись исправила, не дожидаясь "Далее".
     * Пустое значение не снимает (сброс Pernr на каждое нажатие клавиши).
     * /items заменён не дописыванием в конец — индексы сдвинулись, снимаем всё по модели.
     * @param {sap.ui.model.json.JSONModel} oModel
     * @param {string} sPath абсолютный путь (oModel.resolve)
     * @param {any} vValue записанное значение
     * @param {any} [vOldValue] прежнее значение (нужно только для "/items")
     */
    static clearMessagesForWrite (oModel, sPath, vValue, vOldValue) {
      if (!aActiveMessages.length || !sPath) { return; }
      if (sPath === "/items") {
        if (!isAppendOnly(vOldValue, vValue)) { removeEntries((e) => e.processor === oModel); }
        return;
      }
      if (vValue === "" || vValue === null || vValue === undefined) { return; }
      removeEntries((e) => e.processor === oModel && e.triggers.indexOf(sPath) !== -1);
    }

    // [Fix DRY, аудит] Единственное место, проверяющее "есть ли хотя бы одна
    // валидная строка проверки" — раньше этот же предикат был написан дважды
    // (validate() и isStepComplete()) дословно, с той лишь разницей, что
    // здесь на входе может не быть массива вовсе (шаг ещё не заполнялся).
    static _hasAnyCheckRow (aChecks) {
      return (aChecks || []).some((r) => r[EntityConfig.TYPES.Checks.codeProp]);
    }
  }

  return FormValidator;
});
