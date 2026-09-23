sap.ui.define([
  "sap/ui/model/json/JSONModel",
  "sap/pc_lite/lite/model/FormValidator",
  "sap/pc_lite/lite/model/WizardSteps"
], (JSONModel, FormValidator, WizardSteps) => {
  "use strict";

  // rb-заглушка: ключ и параметры видны прямо в тексте — проверяем, КАКОЙ текст выбран.
  const rb = { getText: (sKey, aArgs) => (aArgs ? `${sKey}:${aArgs.join("|")}` : sKey) };

  function validForm () {
    return {
      InspectedPernr: "1", InspectedFullname: "И", InspectorPernr: "2", InspectorFullname: "П",
      CheckDate: "2026-09-07", CheckTime: "10:00:00", TimeZone: "UTC+3",
      PkLevel: "3", Profession: "P", LocationUUID: "u", LocationText: "L", Equipment: ""
    };
  }

  function messageTargets () {
    return sap.ui.getCore().getMessageManager().getMessageModel().getData().map((m) => m.getTarget());
  }

  QUnit.module("model/FormValidator", {
    afterEach: () => FormValidator.clearMessages()
  });

  QUnit.test("строка с данными, но без кода, блокирует шаг и сабмит (FN-05/UX-09)", (assert) => {
    const oForm = new JSONModel(validForm());
    const oChecks = new JSONModel({ items: [
      { CheckCode: "A", Comment: "", Status: "" },
      { CheckCode: "", Comment: "важный текст", Status: " ", NonConformityDescription: "d", NonConformityLocation: "l" },
      { CheckCode: "", Comment: "", Status: "" } // пустая черновая строка — не мешает
    ] });
    const oBarriers = new JSONModel({ items: [] });

    assert.notOk(FormValidator.isStepComplete(oForm, WizardSteps.CHECKS, oChecks, oBarriers, rb), "шаг не пройден");
    assert.ok(messageTargets().indexOf("/items/1/Comment") !== -1, "Message на Комментарий строки 2");
    assert.strictEqual(messageTargets().indexOf("/items/2/Comment"), -1, "пустая строка не подсвечена");

    const oResult = FormValidator.validate(oForm, oChecks, oBarriers, rb);
    assert.ok(oResult.textIssues.indexOf("msgValRowsWithoutCode:tabChecks|2") !== -1, "текст с номером строки");
  });

  QUnit.test("длины полей несоответствия проверяются только при «Неудовлетворительно» (UX-09)", (assert) => {
    const sLong = new Array(3002).join("x");
    const oChecks = new JSONModel({ items: [{ CheckCode: "A", Status: "X", NonConformityDescription: sLong }] });
    const oResult = FormValidator.validate(new JSONModel(validForm()), oChecks, new JSONModel({ items: [] }), rb);
    assert.deepEqual(oResult.textIssues, [], "скрытый текст при Уд не уходит в payload и не блокирует");

    oChecks.setProperty("/items/0/Status", " ");
    oChecks.setProperty("/items/0/NonConformityLocation", "l");
    const oResult2 = FormValidator.validate(new JSONModel(validForm()), oChecks, new JSONModel({ items: [] }), rb);
    assert.ok(oResult2.textIssues.some((s) => s.indexOf("msgValNonConformityDescriptionTooLong") === 0));
  });

  QUnit.test("ФИО набрано, но сотрудник не выбран — msgPersonPickFromList (UX-05)", (assert) => {
    const oData = validForm();
    oData.InspectedPernr = "";
    const oForm = new JSONModel(oData);
    FormValidator.isStepComplete(oForm, WizardSteps.PEOPLE, new JSONModel({ items: [] }), new JSONModel({ items: [] }), rb);
    const aMsgs = sap.ui.getCore().getMessageManager().getMessageModel().getData();
    assert.strictEqual(aMsgs.length, 1);
    assert.strictEqual(aMsgs[0].getMessage(), "msgPersonPickFromList");
  });

  QUnit.test("нераспознаваемая дата блокирует шаг «Когда и где» (FN-03)", (assert) => {
    const oData = validForm();
    oData.CheckDate = "2026-02-31";
    const bOk = FormValidator.isStepComplete(new JSONModel(oData), WizardSteps.WHEN,
      new JSONModel({ items: [] }), new JSONModel({ items: [] }), rb);
    assert.notOk(bOk);
    assert.ok(messageTargets().indexOf("/CheckDate") !== -1);
  });

  QUnit.test("clearMessages снимает подсветку этого модуля", (assert) => {
    const oData = validForm();
    oData.PkLevel = "";
    FormValidator.isStepComplete(new JSONModel(oData), WizardSteps.PROFESSION,
      new JSONModel({ items: [] }), new JSONModel({ items: [] }), rb);
    assert.ok(messageTargets().length > 0);
    FormValidator.clearMessages();
    assert.strictEqual(messageTargets().length, 0);
  });

  QUnit.test("один сотрудник в обеих ролях блокирует шаг «Участники» (FN-09)", (assert) => {
    const oData = validForm();
    oData.InspectorPernr = oData.InspectedPernr;
    const oForm = new JSONModel(oData);
    const aIssues = [];
    assert.notOk(FormValidator.isStepComplete(oForm, WizardSteps.PEOPLE,
      new JSONModel({ items: [] }), new JSONModel({ items: [] }), rb, aIssues));
    assert.deepEqual(aIssues, ["msgValSamePerson"], "причина — в тексте тоста");
    assert.deepEqual(messageTargets(), ["/InspectorFullname"]);

    FormValidator.clearMessagesForWrite(oForm, "/InspectorPernr", "9");
    assert.strictEqual(messageTargets().length, 0, "выбор другого сотрудника снимает подсветку");
  });

  QUnit.test("шаг «Проверки» без строки с кодом называет причину (WZ-06)", (assert) => {
    const aIssues = [];
    const bOk = FormValidator.isStepComplete(new JSONModel(validForm()), WizardSteps.CHECKS,
      new JSONModel({ items: [{ CheckCode: "", Comment: "", Status: "" }] }), new JSONModel({ items: [] }), rb, aIssues);
    assert.notOk(bOk);
    assert.deepEqual(aIssues, ["msgValMinCheck"]);
  });

  QUnit.test("validate возвращает первый шаг с ошибкой (WZ-05)", (assert) => {
    const oData = validForm();
    oData.PkLevel = "";
    const oChecks = new JSONModel({ items: [{ CheckCode: "A", Status: " ", NonConformityDescription: "", NonConformityLocation: "l" }] });
    const oResult = FormValidator.validate(new JSONModel(oData), oChecks, new JSONModel({ items: [] }), rb);
    assert.strictEqual(oResult.firstInvalidStep, WizardSteps.PROFESSION);

    const oOnlyLength = validForm();
    oOnlyLength.Equipment = new Array(200).join("x");
    const oResult2 = FormValidator.validate(new JSONModel(oOnlyLength),
      new JSONModel({ items: [{ CheckCode: "A", Status: "X" }] }), new JSONModel({ items: [] }), rb);
    assert.strictEqual(oResult2.textIssues.length, 1, "только превышение длины");
    assert.strictEqual(oResult2.firstInvalidStep, 0, "у лимитов длины шага нет");
  });

  QUnit.test("строка с кодом без выбранного результата — ошибка на Select, а не на полях несоответствия (RR-01)", (assert) => {
    const oChecks = new JSONModel({ items: [{ CheckCode: "A", Status: "" }, { CheckCode: "B", Status: "X" }, { CheckCode: "", Status: "" }] });
    const oResult = FormValidator.validate(new JSONModel(validForm()), oChecks, new JSONModel({ items: [] }), rb);
    assert.strictEqual(oResult.fieldCount, 1, "только строка A: с кодом и без результата");
    assert.strictEqual(oResult.firstInvalidStep, WizardSteps.CHECKS);
    const aTargets = sap.ui.getCore().getMessageManager().getMessageModel().getData().map((m) => m.target);
    assert.deepEqual(aTargets, ["/items/0/ResultMsg"], "цель — путь-приёмник, не /Status и не NonConformity*");

    FormValidator.clearMessages(oChecks);
    oChecks.setProperty("/items/0/Status", "X");
    assert.strictEqual(FormValidator.isStepComplete(new JSONModel(validForm()), WizardSteps.CHECKS, oChecks, new JSONModel({ items: [] }), rb), true,
      "после выбора результата шаг полон");
  });

  QUnit.test("подсветка снимается записью исправленного значения (FN-10/WZ-10/UX-08)", (assert) => {
    const oData = validForm();
    oData.InspectedPernr = "";
    oData.TimeZone = "";
    const oForm = new JSONModel(oData);
    const oChecks = new JSONModel({ items: [
      { CheckCode: "A", Status: " ", NonConformityDescription: "", NonConformityLocation: "l" },
      { CheckCode: "B", Status: " ", NonConformityDescription: "", NonConformityLocation: "l" }
    ] });
    FormValidator.validate(oForm, oChecks, new JSONModel({ items: [] }), rb);
    assert.deepEqual(messageTargets().sort(),
      ["/InspectedFullname", "/TimeZone", "/items/0/NonConformityDescription", "/items/1/NonConformityDescription"]);

    FormValidator.clearMessagesForWrite(oForm, "/InspectedFullname", "Иван");
    FormValidator.clearMessagesForWrite(oForm, "/InspectedPernr", "");
    assert.ok(messageTargets().indexOf("/InspectedFullname") !== -1, "набор ФИО и сброс Pernr не снимают");
    FormValidator.clearMessagesForWrite(oForm, "/InspectedPernr", "7");
    assert.strictEqual(messageTargets().indexOf("/InspectedFullname"), -1, "выбор сотрудника снимает");

    FormValidator.clearMessagesForWrite(oForm, "/TimeZone", "Europe/Moscow");
    assert.strictEqual(messageTargets().indexOf("/TimeZone"), -1);

    FormValidator.clearMessagesForWrite(oChecks, "/items/0/Status", "X");
    assert.strictEqual(messageTargets().indexOf("/items/0/NonConformityDescription"), -1, "смена результата снимает");

    const aOld = oChecks.getProperty("/items");
    FormValidator.clearMessagesForWrite(oChecks, "/items", aOld.concat([{ CheckCode: "" }]), aOld);
    assert.ok(messageTargets().indexOf("/items/1/NonConformityDescription") !== -1, "добавление в конец не трогает");
    FormValidator.clearMessagesForWrite(oChecks, "/items", aOld.slice(1), aOld);
    assert.deepEqual(messageTargets(), [], "удаление строки — индексы сдвинулись, снято всё по модели");
  });

  QUnit.test("setFieldError заменяет ошибку пути; пустая запись её не снимает, валидная — снимает (RS-03)", (assert) => {
    const oForm = new JSONModel(validForm());
    FormValidator.setFieldError(oForm, "/CheckDate", "bad date");
    FormValidator.setFieldError(oForm, "/CheckDate", "bad date");
    assert.deepEqual(messageTargets(), ["/CheckDate"], "одна ошибка на путь");

    FormValidator.clearMessagesForWrite(oForm, "/CheckDate", "");
    assert.deepEqual(messageTargets(), ["/CheckDate"], "запись пустого значения ошибку не снимает");
    FormValidator.clearMessagesForWrite(oForm, "/CheckDate", "2026-09-01");
    assert.deepEqual(messageTargets(), [], "валидное значение снимает");

    FormValidator.setFieldError(oForm, "/CheckTime", "bad time");
    FormValidator.clearFieldError(oForm, "/CheckTime");
    assert.deepEqual(messageTargets(), [], "clearFieldError снимает");
  });

  return {};
});
