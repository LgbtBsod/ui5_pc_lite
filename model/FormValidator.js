sap.ui.define([
  "sap/ui/core/message/Message",
  "sap/ui/core/library",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/model/WizardSteps",
  "sap/pc_lite/lite/model/BusinessRules"
], (Message, coreLibrary, EntityConfig, WizardSteps, BusinessRules) => {
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
  let aActiveMessages = [];

  function clearActiveMessages () {
    if (!aActiveMessages.length) { return; }
    sap.ui.getCore().getMessageManager().removeMessages(aActiveMessages);
    aActiveMessages = [];
  }

  function addMessage (oProcessor, sPath, sText) {
    aActiveMessages.push(new Message({
      target: sPath,
      type: MessageType.Error,
      message: sText,
      processor: oProcessor
    }));
  }

  // [Поля несоответствия, по запросу] Общая проверка для checksModel и
  // barriersModel — строка, явно помеченная BusinessRules.isUnsatisfactoryResult,
  // обязана нести описание и место несоответствия. Не трогает строки, у
  // которых ещё не выбран код (симметрично _hasAnyCheckRow — черновая,
  // никогда не тронутая пользователем строка не в счёт).
  function collectNonConformityIssues (aRows, oCfg, rb) {
    const aIssues = [];
    (aRows || []).forEach((r, i) => {
      if (!r[oCfg.codeProp] || !BusinessRules.isUnsatisfactoryResult(r.Status)) { return; }
      if (!r.NonConformityDescription) {
        aIssues.push({ path: `/items/${i}/NonConformityDescription`, text: rb.getText("msgValNonConformityDescription") });
      }
      if (!r.NonConformityLocation) {
        aIssues.push({ path: `/items/${i}/NonConformityLocation`, text: rb.getText("msgValNonConformityLocation") });
      }
    });
    return aIssues;
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
     * @returns {{fieldCount: number, textIssues: string[]}} fieldCount — сколько
     *   обязательных полей не заполнено (0 — все заполнены); textIssues — готовые
     *   тексты остальных проблем (нет строк проверки, превышены лимиты длины);
     *   форма валидна, когда оба пусты/равны нулю.
     */
    static validate (oFormModel, oChecksModel, oBarriersModel, rb) {
      clearActiveMessages();

      const oForm = oFormModel.getData();
      const aChecks = oChecksModel.getProperty("/items") || [];
      const aBarriers = oBarriersModel.getProperty("/items") || [];
      let iFieldCount = 0;
      const aTextIssues = [];

      REQUIRED_FIELDS.forEach(([sProp, sMsgKey, , sTargetPath]) => {
        if (!oForm[sProp]) {
          addMessage(oFormModel, sTargetPath, rb.getText(sMsgKey));
          iFieldCount++;
        }
      });

      if (!FormValidator._hasAnyCheckRow(aChecks)) {
        aTextIssues.push(rb.getText("msgValMinCheck"));
      }

      collectNonConformityIssues(aChecks, EntityConfig.TYPES.Checks, rb).forEach((oIssue) => {
        addMessage(oChecksModel, oIssue.path, oIssue.text);
        iFieldCount++;
      });
      collectNonConformityIssues(aBarriers, EntityConfig.TYPES.Barriers, rb).forEach((oIssue) => {
        addMessage(oBarriersModel, oIssue.path, oIssue.text);
        iFieldCount++;
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
      const aAllRows = aChecks.concat(aBarriers);
      if (aAllRows.some((r) => (r.NonConformityDescription || "").length > iDescMax)) {
        aTextIssues.push(rb.getText("msgValNonConformityDescriptionTooLong", [iDescMax]));
      }
      if (aAllRows.some((r) => (r.NonConformityLocation || "").length > iLocMax)) {
        aTextIssues.push(rb.getText("msgValNonConformityLocationTooLong", [iLocMax]));
      }

      if (aActiveMessages.length) {
        sap.ui.getCore().getMessageManager().addMessages(aActiveMessages);
      }
      return { fieldCount: iFieldCount, textIssues: aTextIssues };
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
     * @returns {boolean}
     */
    static isStepComplete (oFormModel, iStep, oChecksModel, oBarriersModel, rb) {
      clearActiveMessages();

      const oForm = oFormModel.getData();
      const aStepFields = REQUIRED_FIELDS.filter(([, , iFieldStep]) => iFieldStep === iStep);
      let bOk = true;

      aStepFields.forEach(([sProp, sMsgKey, , sTargetPath]) => {
        if (!oForm[sProp]) {
          addMessage(oFormModel, sTargetPath, rb.getText(sMsgKey));
          bOk = false;
        }
      });

      if (iStep === MIN_CHECK_ROWS_STEP) {
        const aChecks = oChecksModel.getProperty("/items") || [];
        if (!FormValidator._hasAnyCheckRow(aChecks)) { bOk = false; }
        collectNonConformityIssues(aChecks, EntityConfig.TYPES.Checks, rb).forEach((oIssue) => {
          addMessage(oChecksModel, oIssue.path, oIssue.text);
          bOk = false;
        });
      }

      if (iStep === MIN_BARRIER_ROWS_STEP) {
        const aBarriers = oBarriersModel.getProperty("/items") || [];
        collectNonConformityIssues(aBarriers, EntityConfig.TYPES.Barriers, rb).forEach((oIssue) => {
          addMessage(oBarriersModel, oIssue.path, oIssue.text);
          bOk = false;
        });
      }

      if (aActiveMessages.length) {
        sap.ui.getCore().getMessageManager().addMessages(aActiveMessages);
      }
      return bOk;
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
