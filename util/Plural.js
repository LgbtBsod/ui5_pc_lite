sap.ui.define([], () => {
  "use strict";

  // [Fix UX-15] Числа в тексте ("1 проверка", "3 проверки", "5 проверок").
  // Один шаблон "{0} проверок" давал "1 проверок"/"21 проверок". Формы — ключи
  // <base>_one/_few/_many во всех i18n-файлах; правило выбора формы задаёт сам
  // файл перевода (ключ pluralRule), а не язык сессии: при откате на файл по
  // умолчанию (русский) должно работать русское правило.
  class Plural {
    /**
     * Категория CLDR: ru — one/few/many; остальные (en) — one/many.
     * @param {number} iCount
     * @param {string} sRule "ru" | "en"
     * @returns {"one"|"few"|"many"}
     */
    static category(iCount, sRule) {
      const n = Math.abs(Math.trunc(Number(iCount) || 0));
      if (sRule !== "ru") { return n === 1 ? "one" : "many"; }
      const n10 = n % 10;
      const n100 = n % 100;
      if (n10 === 1 && n100 !== 11) { return "one"; }
      if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) { return "few"; }
      return "many";
    }

    /**
     * @param {sap.base.i18n.ResourceBundle} rb
     * @param {string} sBaseKey ключ без суффикса (_one/_few/_many)
     * @param {number} iCount подставляется как {0}
     * @returns {string}
     */
    static getText(rb, sBaseKey, iCount) {
      return rb.getText(`${sBaseKey}_${Plural.category(iCount, rb.getText("pluralRule"))}`, [iCount]);
    }
  }

  return Plural;
});
