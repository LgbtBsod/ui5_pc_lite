sap.ui.define([
  "sap/pc_lite/lite/util/SearchText"
], (SearchText) => {
  "use strict";

  // [Fix SF-02] Единая нормализация поиска (люди, местоположения, value-help).

  QUnit.module("util/SearchText#normalize");

  QUnit.test("регистр, ё/е, пробелы", (assert) => {
    assert.strictEqual(SearchText.normalize("  СемЁнов   Пётр\tИванович "), "семенов петр иванович");
    assert.strictEqual(SearchText.normalize(null), "");
    assert.strictEqual(SearchText.normalize(undefined), "");
    assert.strictEqual(SearchText.normalize("   "), "");
    assert.strictEqual(SearchText.normalize(42), "42");
  });

  QUnit.module("util/SearchText#matches");

  QUnit.test("все слова запроса — подстроки, в любом порядке", (assert) => {
    const sFio = "Слесарь Сергей Семёнов";
    assert.ok(SearchText.matches(sFio, "семенов"), "ё в тексте, е в запросе");
    assert.ok(SearchText.matches(sFio, "СЕМЁНОВ"), "регистр и ё в запросе");
    assert.ok(SearchText.matches(sFio, "семенов сергей"), "обратный порядок слов");
    assert.ok(SearchText.matches(sFio, "  серг   семен "), "лишние пробелы, части слов");
    assert.ok(SearchText.matches(sFio, "ерге"), "подстрока внутри слова");
    assert.notOk(SearchText.matches(sFio, "семенов иван"), "каждое слово обязано найтись");
  });

  QUnit.test("пустой запрос совпадает со всем", (assert) => {
    assert.ok(SearchText.matches("Что угодно", ""));
    assert.ok(SearchText.matches("Что угодно", "   "));
    assert.deepEqual(SearchText.tokens("   "), []);
  });

  QUnit.test("matchTokens работает по уже нормализованному ключу", (assert) => {
    const sKey = SearchText.normalize("Цех сборки LOC-003");
    assert.ok(SearchText.matchTokens(sKey, SearchText.tokens("loc-003")));
    assert.ok(SearchText.matchTokens(sKey, SearchText.tokens("СБОРКИ цех")));
    assert.notOk(SearchText.matchTokens(sKey, SearchText.tokens("LOC-004")));
    assert.notOk(SearchText.matchTokens(undefined, ["x"]), "отсутствующий ключ не падает");
  });

  QUnit.module("util/SearchText#rank");

  QUnit.test("точное < начало < начала слов < подстрока", (assert) => {
    assert.strictEqual(SearchText.rank("Иванов Иван", "иванов иван"), 0);
    assert.strictEqual(SearchText.rank("Иванов Иван", "иванов"), 1);
    assert.strictEqual(SearchText.rank("Слесарь Сергей Иванов", "иванов серг"), 2);
    assert.strictEqual(SearchText.rank("Слесарь Сергей Иванов", "ванов"), 3);
  });

  QUnit.module("util/SearchText#isRefinementOf");

  QUnit.test("новый запрос уточняет старый только если каждое старое слово внутри нового", (assert) => {
    assert.ok(SearchText.isRefinementOf("иванов", "ива"), "допечатали");
    assert.ok(SearchText.isRefinementOf("иван петр", "иван"), "добавили слово");
    assert.ok(SearchText.isRefinementOf("петр иванов", "иван"), "слово в другом месте");
    assert.notOk(SearchText.isRefinementOf("ива", "иванов"), "стёрли — не уточнение");
    assert.notOk(SearchText.isRefinementOf("петров", "иван"), "другой запрос");
    assert.notOk(SearchText.isRefinementOf("иван", ""), "пустой старый запрос не надмножество");
  });
});
