sap.ui.define([
  "sap/pc_lite/lite/facade/PersonSearchFacade"
], (PersonSearchFacade) => {
  "use strict";

  // Мок ODataModel#read: запоминает вызовы, отвечает асинхронно заданными строками.
  function makeModel (aRows, oOpts) {
    const o = oOpts || {};
    const oModel = {
      aCalls: [],
      read (sPath, mParams) {
        oModel.aCalls.push({ path: sPath, params: mParams });
        setTimeout(() => {
          if (o.fail) { mParams.error({ message: "boom", statusCode: 500 }); return; }
          mParams.success({ results: aRows });
        }, 0);
      }
    };
    return oModel;
  }

  const aPersons = [
    { Pernr: "1", Fio: "Слесарь Сергей Иванов", ActiveTo: null },
    { Pernr: "2", Fio: "Иванов Иван", ActiveTo: null },
    { Pernr: "3", Fio: "Иванова Анна", ActiveTo: new Date(Date.UTC(2020, 0, 1)) },
    { Pernr: "4", Fio: "Семёнов Пётр", ActiveTo: null }
  ];

  QUnit.module("facade/PersonSearchFacade#search", {
    beforeEach: () => PersonSearchFacade.clearCache(),
    afterEach: () => PersonSearchFacade.clearCache()
  });

  QUnit.test("серверный search + $top, клиентский второй проход, ранжирование, ActiveTo", (assert) => {
    const oModel = makeModel(aPersons);
    return PersonSearchFacade.search(oModel, "  Иванов ", "2026-09-22", "t").then((aItems) => {
      const mUrl = oModel.aCalls[0].params.urlParameters;
      assert.strictEqual(mUrl.search, "иванов", "запрос обрезан и в нижнем регистре, уходит в custom query option search");
      assert.strictEqual(mUrl.$top, "100");
      assert.strictEqual(oModel.aCalls[0].params.filters.length, 1, "ActiveFrom le :date — server-side");
      assert.deepEqual(aItems.map((p) => p.Pernr), ["2", "1"], "Иванова (ActiveTo < даты) отсеяна; начало ФИО выше подстроки");
      assert.deepEqual(aItems[0], { Pernr: "2", Fullname: "Иванов Иван" });
    });
  });

  QUnit.test("ё/е и порядок слов", (assert) => {
    const oModel = makeModel(aPersons);
    return PersonSearchFacade.search(oModel, "петр семенов", "", "t").then((aItems) => {
      assert.deepEqual(aItems.map((p) => p.Pernr), ["4"]);
    });
  });

  QUnit.test("короткий запрос — [] без запроса на сервер", (assert) => {
    const oModel = makeModel(aPersons);
    return PersonSearchFacade.search(oModel, " ив ", "", "t").then((aItems) => {
      assert.deepEqual(aItems, []);
      assert.strictEqual(oModel.aCalls.length, 0);
    });
  });

  QUnit.test("уточнение неусечённого ответа берётся из кэша, без нового запроса", (assert) => {
    const oModel = makeModel(aPersons);
    return PersonSearchFacade.search(oModel, "иван", "", "t")
      .then(() => PersonSearchFacade.search(oModel, "иванов иван", "", "t"))
      .then((aItems) => {
        assert.strictEqual(oModel.aCalls.length, 1, "второй запрос не ушёл в сеть");
        assert.deepEqual(aItems.map((p) => p.Pernr), ["2", "3", "1"], "точное совпадение первым");
      });
  });

  QUnit.test("RS-01: ё/е не склеиваются в кэше — повтор с другой буквой идёт на сервер", (assert) => {
    const oModel = makeModel(aPersons);
    return PersonSearchFacade.search(oModel, "семёнов", "", "t")
      .then(() => PersonSearchFacade.search(oModel, "семенов", "", "t"))
      .then(() => {
        assert.strictEqual(oModel.aCalls.length, 2, "разные тексты — разные запросы");
        assert.strictEqual(oModel.aCalls[1].params.urlParameters.search, "семенов");
      });
  });

  QUnit.test("RS-01: пустой ответ не кэшируется", (assert) => {
    let bEmpty = true;
    const oModel = {
      aCalls: [],
      read (sPath, mParams) {
        oModel.aCalls.push(mParams.urlParameters.search);
        setTimeout(() => mParams.success({ results: bEmpty ? [] : aPersons }), 0);
      }
    };
    return PersonSearchFacade.search(oModel, "семенов", "", "t").then((aItems) => {
      assert.deepEqual(aItems, []);
      bEmpty = false;
      return PersonSearchFacade.search(oModel, "семенов", "", "t");
    }).then((aItems) => {
      assert.strictEqual(oModel.aCalls.length, 2, "0 строк не залипли в кэше");
      assert.deepEqual(aItems.map((p) => p.Pernr), ["4"]);
    });
  });

  QUnit.test("RS-02: поиск по табельному номеру (в т.ч. вместе с ФИО)", (assert) => {
    const oModel = makeModel([{ Pernr: "00000003", Fio: "Слесарь Сергей Иванов", ActiveTo: null }, { Pernr: "5", Fio: "Иванов Иван", ActiveTo: null }]);
    return PersonSearchFacade.search(oModel, "00000003", "", "t").then((aItems) => {
      assert.deepEqual(aItems.map((p) => p.Pernr), ["00000003"]);
      return PersonSearchFacade.search(oModel, "Иванов 0000", "", "t");
    }).then((aItems) => assert.deepEqual(aItems.map((p) => p.Pernr), ["00000003"]));
  });

  QUnit.test("другая дата проверки — отдельный запрос", (assert) => {
    const oModel = makeModel(aPersons);
    return PersonSearchFacade.search(oModel, "иван", "2026-09-22", "t")
      .then(() => PersonSearchFacade.search(oModel, "иванов", "2026-09-23", "t"))
      .then(() => assert.strictEqual(oModel.aCalls.length, 2));
  });

  QUnit.test("усечённый ($top) ответ не считается надмножеством", (assert) => {
    const aMany = [];
    for (let i = 0; i < 100; i++) { aMany.push({ Pernr: String(i), Fio: `Иванов ${i}`, ActiveTo: null }); }
    const oModel = makeModel(aMany);
    return PersonSearchFacade.search(oModel, "иван", "", "t")
      .then((aItems) => {
        assert.strictEqual(aItems.length, 20, "потолок подсказок");
        return PersonSearchFacade.search(oModel, "иванов 9", "", "t");
      })
      .then(() => assert.strictEqual(oModel.aCalls.length, 2, "уточнение ушло на сервер"));
  });

  QUnit.test("ошибка чтения — reject; отклонённый ответ не кэшируется", (assert) => {
    const oModel = makeModel(aPersons, { fail: true });
    return PersonSearchFacade.search(oModel, "иванов", "", "a").then(
      () => assert.ok(false, "должен быть reject"),
      () => PersonSearchFacade.search(oModel, "иванов", "", "a").catch(() => {
        assert.strictEqual(oModel.aCalls.length, 2, "повторный ввод снова идёт на сервер");
      }));
  });

  QUnit.test("ответ, пришедший после более нового ввода, резолвится null", (assert) => {
    let fnSuccess;
    const oModel = { read: (sPath, mParams) => { fnSuccess = mParams.success; } };
    const done = assert.async();
    const pOld = PersonSearchFacade.search(oModel, "иванов", "", "s");
    setTimeout(() => {
      // Запрос уже в сети — новый (короткий) ввод делает его устаревшим.
      PersonSearchFacade.search(oModel, "и", "", "s");
      fnSuccess({ results: aPersons });
      pOld.then((vResult) => {
        assert.strictEqual(vResult, null);
        done();
      });
    }, 350);
  });
});
