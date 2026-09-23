sap.ui.define([], () => {
  "use strict";

  // Зеркало redux/serve_config.py BUSINESS_RULES.BARRIERS_HIDDEN_PK_LEVELS —
  // один бэк, одно правило (см. MIGRATION_MAPPING.md, OPEN-1 — решено).
  // Раньше здесь была рангово-пороговая проверка по старой 10-уровневой шкале
  // (PK-I..PK-X, настраиваемый BARRIER_MIN_PK) — несовместима с целевой
  // шкалой "0".."4", удалена целиком, а не адаптирована по частям.
  //
  // [Уточнение, аудит] Это КОПИЯ значения, не общий импорт (разные проекты,
  // разные рантаймы — Python-бэк vs UI5-клиент) — при расхождении с redux
  // ничего не упадёт и не предупредит, рассинхронизация пройдёт незамеченной.
  // Сверено на redux@aed576f2 (serve_config.py:247, класс BUSINESS_RULES):
  // значение там — ("", "0", "1"), совпадает с массивом ниже. При следующем
  // изменении этого правила в любом из двух проектов — обновить оба места
  // руками и актуализировать здесь хэш коммита redux, с которым сверялись.
  // [Fix SSOT — предупреждение, аудит] Тот же порог ("КПР-2 и выше") ЕЩЁ РАЗ
  // закодирован — на этот раз прозой, не числом — в трёх i18n-ключах всех 3
  // локалей: hintBarriers ("Барьеры отображаются при уровне КПР-2 и выше."),
  // hintPkIi ("Уровень КПР-2 и выше: раздел «Барьеры» активен.") и hintPkI
  // ("Уровень КПР-0/1: раздел «Барьеры» скрыт.") — см. RowsAndAutoFill.js#
  // onPkLevelChange, где именно эти ключи читаются как MessageToast. В
  // отличие от UNSATISFACTORY_RESULT_CODE ниже (та же копия-не-импорт
  // оговорка, но между ДВУМЯ ПРОЕКТАМИ на разных рантаймах, где общий
  // импорт физически невозможен), здесь копия — внутри ОДНОГО проекта, и
  // технически устранима: но перевод числа "1" в переведённую человеком
  // фразу на 3 языках через шаблонизацию ради одного массива из 3 элементов
  // — сложность, непропорциональная риску (порог не менялся с момента
  // введения и меняется, по опыту, реже, чем сам текст перевода). Оставлено
  // явным литералом с этим предупреждением, а не тихой копией без пометки —
  // при следующем изменении массива ниже проверить и все 3 i18n-ключа во
  // всех 3 файлах (i18n.properties/i18n_ru.properties/i18n_en.properties).
  const BARRIERS_HIDDEN_PK_LEVELS = ["", "0", "1"];

  // [Fix РЕАЛЬНЫЙ БАГ, по запросу — поля несоответствия] Код "Неудовлетворительно"
  // (см. model/CheckResults.json) — ОДИН ПРОБЕЛ, не пустая строка. Пустая
  // строка уже занята: ModelsInit.emptyRow даёт новой строке Status:"" по
  // умолчанию (никакой результат ещё не выбран) — если бы "Неудовлетворительно"
  // тоже кодировалось пустой строкой, "результат не выбран" и "выбрано
  // неудовлетворительно" были бы неразличимы в JS (оба "" === "" -> true,
  // оба !"" -> true). Ровно тот же баг уже был найден и исправлен в redux
  // (serve_config.py@aed576f2, RESULT_CODE_UNSATISFACTORY = " " — там из-за
  // него framework-валидация SmartField ошибочно считала явно выбранное
  // "Неудовлетворительно" незаполненным полем). Значение здесь — копия, не
  // общий импорт (см. тот же принцип и та же оговорка, что у
  // BARRIERS_HIDDEN_PK_LEVELS выше) — при следующем изменении сверить оба
  // места руками.
  const UNSATISFACTORY_RESULT_CODE = " ";

  class BusinessRules {
    /** @returns {boolean} whether the Barriers section should be shown for this PK level. */
    static isBarriersAllowed(sPkLevel) {
      return !!sPkLevel && BARRIERS_HIDDEN_PK_LEVELS.indexOf(sPkLevel) === -1;
    }

    /**
     * [Поля несоответствия, по запросу] "Описание несоответствия"/"Место
     * несоответствия" (см. EntityConfig.TYPES.*.nonConformity*) активны у
     * строки Checks/Barriers ровно когда её Результат — явно выбранное
     * "Неудовлетворительно", не когда результат просто ещё не выбран.
     * @returns {boolean}
     */
    static isUnsatisfactoryResult(sResultCode) {
      return sResultCode === UNSATISFACTORY_RESULT_CODE;
    }

    /**
     * [Fix UX-03/FN-05] Ввёл ли пользователь в строку что-то кроме кода:
     * комментарий, результат или поля несоответствия. Код сам по себе не в
     * счёт — авто-строки по КПР несут только его.
     * @returns {boolean}
     */
    static hasRowUserData(oRow) {
      if (!oRow) { return false; }
      return !!((oRow.Comment || "").trim() || (oRow.Status || "") !== "" ||
        (oRow.NonConformityDescription || "").trim() || (oRow.NonConformityLocation || "").trim());
    }

    /**
     * [Fix FN-05/UX-09] Единственный подсчёт строк, которые реально уйдут в
     * payload (с кодом, см. DeepEntityFacade._collectRows) — для footer и сводки.
     * @param {object[]} aRows @param {string} sCodeProp EntityConfig.TYPES.*.codeProp
     * @returns {number}
     */
    static countCodedRows(aRows, sCodeProp) {
      return (aRows || []).filter((r) => r && r[sCodeProp]).length;
    }
  }

  return BusinessRules;
});
