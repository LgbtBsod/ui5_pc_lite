sap.ui.define([
  "sap/ui/core/format/DateFormat",
  "sap/pc_lite/lite/model/EntityConfig",
  "sap/pc_lite/lite/model/BusinessRules",
  "sap/pc_lite/lite/facade/DictionaryFacade"
], (DateFormat, EntityConfig, BusinessRules, DictionaryFacade) => {
  "use strict";

  // [SSOT] Тот же исходный паттерн, что util/ODataFormat.js и DatePicker>
  // valueFormat — только направление конвертации другое (сырая строка
  // formModel -> отображение, а не строка <-> JS Date для OData).
  const oIsoDateFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.DateValueFormat, UTC: true });
  // [Fix SSOT, аудит] EntityConfig.CONSTRAINTS.DisplayDateFormat — тот же
  // паттерн, на который биндится DatePicker>displayFormat в
  // StepWhenWhere.fragment.xml, а не независимый литерал "dd.MM.yyyy" здесь.
  const oDisplayDateFmt = DateFormat.getInstance({ pattern: EntityConfig.CONSTRAINTS.DisplayDateFormat, UTC: true });

  // Спред в Controller.extend({ formatter: Formatter, ... }) — статические
  // методы резолвятся биндингом ".formatter.xyz" как обычные функции.
  class Formatter {
    static locationRowHighlight(sNodeId, sSelectedId) {
      return sNodeId && sNodeId === sSelectedId ? "Information" : "None";
    }

    // [Поиск по всей иерархии, по запросу] Путь до родителя — только текст,
    // видимость этой строки (только во время активного поиска) решается
    // отдельным binding'ом на locationModel>/searchQuery в самой фрагменте,
    // не здесь — формиттер не знает и не должен знать про searchQuery.
    static locationRowParentPath(sNodeId, oLookupMap) {
      return (sNodeId && oLookupMap) ? DictionaryFacade.getParentPath(sNodeId, oLookupMap) : "";
    }

    // [Отправка — сводка] dictionaryModel>/_index/<TYPE> уже даёт готовую
    // карту Code->Text (см. DictionaryFacade._buildIndex) — здесь только
    // читаем её через multi-part binding, ничего заново не считаем.
    static dictText(oIndex, sCode) {
      return (oIndex && sCode && oIndex[sCode]) || "";
    }

    // [Отправка — сводка] formModel>/CheckDate хранит "yyyy-MM-dd" (valueFormat
    // DatePicker'а на шаге 1) — здесь то же самое отображение, что уже видел
    // пользователь в самом DatePicker (displayFormat="dd.MM.yyyy"), просто как
    // read-only текст, а не второй независимый формат.
    static displayDate(sIsoDate) {
      if (!sIsoDate) { return ""; }
      const oDate = oIsoDateFmt.parse(sIsoDate);
      return oDate ? oDisplayDateFmt.format(oDate) : sIsoDate;
    }

    // [Поля несоответствия, по запросу] "Описание несоответствия"/"Место
    // несоответствия" в ChecksTable/BarriersTable.fragment.xml биндят свой
    // enabled сюда — тонкая обёртка над BusinessRules (единственный
    // источник самого кода "Неудовлетворительно"), а не дублирование
    // сравнения здесь же.
    static isUnsatisfactoryResult(sResultCode) {
      return BusinessRules.isUnsatisfactoryResult(sResultCode);
    }

    // [Fix РЕАЛЬНЫЙ БАГ, аудит] Раньше "разрешены ли барьеры на этом уровне
    // КПР" было ХРАНИМЫМ полем formModel>/BarriersAllowed, которое обязана
    // была не забыть пересчитать RowsAndAutoFill.js#_updateBarriersAllowed
    // при КАЖДОЙ смене PkLevel — по соглашению, без единой точки записи (3
    // отдельных вызова в 3 файлах). Гипотетический будущий путь записи
    // PkLevel, забывший про этот вызов (например, "повторить прошлый
    // сабмит" одним действием), тихо оставил бы видимость шага "Барьеры"
    // рассинхронизированной со реальным уровнем. Теперь видимость (и в
    // Main.view.xml, и в BarriersTable.fragment.xml) биндится НАПРЯМУЮ на
    // formModel>/PkLevel через эти два формуттера — вычисляется заново при
    // каждом рендере, рассинхронизироваться нечему, потому что нечего
    // хранить отдельно от самого PkLevel.
    static isBarriersAllowed(sPkLevel) {
      return BusinessRules.isBarriersAllowed(sPkLevel);
    }

    static isBarriersHidden(sPkLevel) {
      return !BusinessRules.isBarriersAllowed(sPkLevel);
    }
  }

  return Formatter;
});
