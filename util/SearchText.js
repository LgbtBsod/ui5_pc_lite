sap.ui.define([], () => {
  "use strict";

  // [Fix SF-02, аудит] Единая нормализация поиска — люди, местоположения,
  // value-help. Раньше каждый поиск по-своему делал toLowerCase()+indexOf:
  // "Семенов" не находил "Семёнов", лишний пробел или другой порядок слов
  // ("Иванов Сергей" vs "Сергей Иванов") давали пустой результат.
  class SearchText {
    /** @returns {string} lower-case, 'ё'->'е', trim, collapse whitespace */
    static normalize(s) {
      return String(s == null ? "" : s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
    }

    /** @returns {string[]} normalized query tokens ([] for a blank query) */
    static tokens(sQuery) {
      const sNorm = SearchText.normalize(sQuery);
      return sNorm ? sNorm.split(" ") : [];
    }

    /** Fast path for pre-normalized text (e.g. a precomputed SearchKey). */
    static matchTokens(sNormText, aTokens) {
      const sText = sNormText || "";
      return (aTokens || []).every((t) => sText.indexOf(t) !== -1);
    }

    /** @returns {boolean} every query token is a substring of normalize(sText), in any order; blank query matches all */
    static matches(sText, sQuery) {
      return SearchText.matchTokens(SearchText.normalize(sText), SearchText.tokens(sQuery));
    }

    /**
     * Relevance rank for sorting results, lower is better:
     * 0 exact, 1 text starts with the query, 2 every token starts a word, 3 other substring match.
     */
    static rank(sText, sQuery) {
      const sNorm = SearchText.normalize(sText);
      const sQ = SearchText.normalize(sQuery);
      if (sNorm === sQ) { return 0; }
      if (sQ && sNorm.indexOf(sQ) === 0) { return 1; }
      const aWords = sNorm.split(" ");
      const bWordStarts = SearchText.tokens(sQuery).every((t) => aWords.some((w) => w.indexOf(t) === 0));
      return bWordStarts ? 2 : 3;
    }

    /**
     * @returns {boolean} whether every result matching sNewQuery is guaranteed to
     * match sOldQuery too (each old token is inside some new token) — i.e. the old
     * result set is a superset usable for the new query.
     */
    static isRefinementOf(sNewQuery, sOldQuery) {
      const aNew = SearchText.tokens(sNewQuery);
      const aOld = SearchText.tokens(sOldQuery);
      return aOld.length > 0 && aOld.every((o) => aNew.some((n) => n.indexOf(o) !== -1));
    }
  }

  return SearchText;
});
