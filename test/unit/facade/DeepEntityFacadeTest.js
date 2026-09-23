sap.ui.define([
  "sap/pc_lite/lite/facade/DeepEntityFacade"
], (DeepEntityFacade) => {
  "use strict";

  // [Fix Тестируемость, аудит] Первый юнит-тест в проекте (см. package.json —
  // до сих пор не было ни одного). facade/DeepEntityFacade.js#build выбран
  // не случайно — единственная логика в этом файле, которая берёт входные
  // данные формы и НАПРЯМУЮ строит OData deep-entity payload, отправляемый
  // на сервер: ошибка здесь — это неправильно сохранённая запись проверки
  // на реальном бэкенде, а не просто визуальный баг. build()/_collectRows()
  // не требуют sap.ui.core рантайма и живого View/Controller — только
  // duck-typed объекты {getData(), getProperty()}, поэтому тестируются без
  // бутстрапа компонента/вьюхи, штатными hand-written моками ниже.
  //
  // [Fix РЕАЛЬНЫЙ БАГ, аудит — регрессионный тест] Первый и главный кейс
  // здесь — ObservedPernr/ObserverPernr, а не ObservedPerner/ObserverPerner
  // (опечатка на одну букву, найденная и исправленная этим же аудитом,
  // см. model/metadata.xml) — без теста такая опечатка снова прошла бы
  // незамеченной при следующей правке этого файла.

  function makeFormModel (oData) {
    return { getData: () => oData };
  }

  // [Fix DRY] Единственный мок, читающий оба реально используемых пути —
  // "/items" (checksModel/barriersModel) и "/" (dictModel, откуда
  // DictionaryFacade.resolveText достаёт ._index) — ровно то подмножество
  // JSONModel#getProperty, которым в действительности пользуется build().
  function makeItemsModel (aItems) {
    return { getProperty: (sPath) => (sPath === "/items" ? aItems : undefined) };
  }

  function makeDictModel (oIndex) {
    return { getProperty: (sPath) => (sPath === "/" ? { _index: oIndex } : undefined) };
  }

  const oDictIndex = {
    PKLEVEL: { 2: "КПР-2" },
    TIMEZONE: { "UTC+4": "Ереван (UTC+4)" },
    PROFESSION: { ELECTRICIAN: "Электромонтёр" },
    CHECKS: { DOCUMENT_REVIEW: "Проверка документов" },
    BARRIERS: { SAFETY_FENCE: "Защитное ограждение" }
  };

  QUnit.module("facade/DeepEntityFacade#build");

  QUnit.test("маппит основные поля заголовка, включая ФИО/Табельный № (регрессия на опечатку Perner->Pernr)", (assert) => {
    const oForm = makeFormModel({
      PkLevel: "2",
      InspectedPernr: "00000001",
      InspectedFullname: "Иванов Иван",
      InspectorPernr: "00000003",
      InspectorFullname: "Петров Пётр",
      CheckDate: "2026-09-07",
      CheckTime: "10:00:00",
      TimeZone: "UTC+4",
      LocationUUID: "loc-1",
      LocationText: "Корпус А",
      Profession: "ELECTRICIAN",
      Equipment: "Пресс ПГ-100"
    });
    const oChecks = makeItemsModel([]);
    const oBarriers = makeItemsModel([]);
    const oDict = makeDictModel(oDictIndex);

    const oPayload = DeepEntityFacade.build(oForm, oChecks, oBarriers, oDict);

    assert.strictEqual(oPayload.LpcKey, "2", "LpcKey = PkLevel как есть, без трансляции шкалы");
    assert.strictEqual(oPayload.LpcText, "КПР-2", "LpcText резолвится через DictionaryFacade");
    // [РЕГРЕССИЯ] Эти два имени свойств — именно то, что было опечатано
    // ("ObservedPerner"/"ObserverPerner") и исправлено этим аудитом; тест
    // ловит, если опечатка когда-нибудь вернётся.
    assert.strictEqual(oPayload.ObservedPernr, "00000001", "ObservedPernr (не ObservedPerner) = InspectedPernr");
    assert.strictEqual(oPayload.ObserverPernr, "00000003", "ObserverPernr (не ObserverPerner) = InspectorPernr");
    assert.strictEqual(oPayload.ObservedFullname, "Иванов Иван", "Fullname — чистое ФИО (FN-06)");
    assert.strictEqual(oPayload.ObserverFullname, "Петров Пётр");
    assert.strictEqual(oPayload.TimezoneText, "Ереван (UTC+4)");
    assert.strictEqual(oPayload.LocationKey, "loc-1");
    assert.strictEqual(oPayload.LocationName, "Корпус А");
    assert.strictEqual(oPayload.ProfText, "Электромонтёр");
    assert.strictEqual(oPayload.Equipment, "Пресс ПГ-100");
  });

  QUnit.test("пустые/незаполненные поля не роняют build(), уходят пустой строкой", (assert) => {
    const oForm = makeFormModel({});
    const oPayload = DeepEntityFacade.build(oForm, makeItemsModel([]), makeItemsModel([]), makeDictModel(oDictIndex));

    assert.strictEqual(oPayload.LpcKey, "");
    assert.strictEqual(oPayload.LpcText, "", "неизвестный/пустой код резолвится в \"\", не в исключение");
    assert.strictEqual(oPayload.ObservedPernr, "");
    assert.strictEqual(oPayload.Equipment, "");
  });

  QUnit.test("build() без dictModel не падает — LpcText/ProfText/TimezoneText пустые", (assert) => {
    const oForm = makeFormModel({ PkLevel: "2" });
    const oPayload = DeepEntityFacade.build(oForm, makeItemsModel([]), makeItemsModel([]), null);
    assert.strictEqual(oPayload.LpcText, "", "DictionaryFacade.resolveText сам защищён от oDictModel=null");
  });

  QUnit.module("facade/DeepEntityFacade#build — to_Checks/to_Barriers");

  QUnit.test("строки без кода (черновые, ещё не заполненные) исключаются из payload", (assert) => {
    const aChecks = [
      { CheckCode: "DOCUMENT_REVIEW", CheckText: "x", Comment: "ok", Status: " ", NonConformityDescription: "d", NonConformityLocation: "l" },
      { CheckCode: "", CheckText: "", Comment: "", Status: "" } // черновая строка, код ещё не выбран
    ];
    const oPayload = DeepEntityFacade.build(
      makeFormModel({}), makeItemsModel(aChecks), makeItemsModel([]), makeDictModel(oDictIndex)
    );

    assert.strictEqual(oPayload.to_Checks.results.length, 1, "строка без кода не попадает в payload");
    const oRow = oPayload.to_Checks.results[0];
    assert.strictEqual(oRow.Code, "DOCUMENT_REVIEW");
    assert.strictEqual(oRow.Text, "Проверка документов", "Text резолвится тем же DictionaryFacade.resolveText, что и заголовок");
    assert.strictEqual(oRow.Result, " ", "Result = Status как есть (код \"Неудовлетворительно\" — единственный пробел, не пустая строка)");
    assert.strictEqual(oRow.NonConformityDescription, "d");
    assert.strictEqual(oRow.NonConformityLocation, "l");
  });

  QUnit.test("Comment/NonConformity* по умолчанию \"\", если отсутствуют на строке", (assert) => {
    const aBarriers = [{ BarrierCode: "SAFETY_FENCE" }];
    const oPayload = DeepEntityFacade.build(
      makeFormModel({}), makeItemsModel([]), makeItemsModel(aBarriers), makeDictModel(oDictIndex)
    );
    const oRow = oPayload.to_Barriers.results[0];
    assert.strictEqual(oRow.Comment, "");
    assert.strictEqual(oRow.Result, "");
    assert.strictEqual(oRow.NonConformityDescription, "");
    assert.strictEqual(oRow.NonConformityLocation, "");
  });

  QUnit.test("поля несоответствия уходят только при «Неудовлетворительно» (UX-09)", (assert) => {
    const aChecks = [
      // Неуд -> Уд: поля заблокированы, но текст остался в модели
      { CheckCode: "DOCUMENT_REVIEW", Status: "X", NonConformityDescription: "d", NonConformityLocation: "l" },
      { CheckCode: "DOCUMENT_REVIEW", Status: "", NonConformityDescription: "d2", NonConformityLocation: "l2" }
    ];
    const oPayload = DeepEntityFacade.build(
      makeFormModel({}), makeItemsModel(aChecks), makeItemsModel([]), makeDictModel(oDictIndex)
    );
    oPayload.to_Checks.results.forEach((oRow) => {
      assert.strictEqual(oRow.NonConformityDescription, "", `Result "${oRow.Result}": описание не отправляется`);
      assert.strictEqual(oRow.NonConformityLocation, "", `Result "${oRow.Result}": место не отправляется`);
    });
  });

  return {};
});
