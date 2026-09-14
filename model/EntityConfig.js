sap.ui.define(["sap/pc_lite/lite/model/BusinessRules"], (BusinessRules) => {
  "use strict";

  return {

    // codeProp/textProp/dictType — ВНУТРЕННИЙ контракт checksModel/
    // barriersModel (жёстко зашит в фрагментах ChecksTable.fragment.xml/
    // BarriersTable.fragment.xml как literal binding path, например
    // "{checksModel>CheckText}", и в ModelsInit.emptyRow) — НЕ переименовывать
    // под целевые OData-имена (Code/Text), иначе Link-биндинги в фрагментах
    // и ModelsInit.emptyRow разъедутся с тем, что реально пишет
    // DictionaryValueHelp.js#onVhConfirm.
    // Перевод под контракт redux (Code/Text/Result) делается ОДИН раз, на
    // границе, в DeepEntityFacade._collectRows — см. MIGRATION_MAPPING.md.
    //
    // titleKey/sectionGate — [Fix OCP, аудит] раньше вызывающий код (Main
    // controller.js#_openDictVh/_purgeInvalidRows) угадывал эти два факта
    // хардкодным `sType === "Checks"`/`"Barriers"` тернарником вместо чтения
    // их отсюда же, хотя именно эта карта — заявленная точка расширения
    // (см. остальные потребители: _addRow/_deleteRow/_applyAutoRows/
    // DeepEntityFacade._collectRows уже читают её полностью дженерик).
    // sectionGate отсутствует у Checks — секция всегда разрешена, что
    // _purgeInvalidRows трактует как "не барьеры-специфичный случай".
    // footerCountKey — [Fix OCP/DRY, аудит] тот же приём, что titleKey/
    // sectionGate выше: RowsAndAutoFill.js#_updateFooterCount раньше не
    // читал эту карту вовсе, а напрямую хардкодил `"Checks"`/`"Barriers"` и
    // соответствующие им имена моделей/i18n-ключи (footerCountChecks/
    // footerCountBarriers) — единственные два места во всём миксине, не
    // прошедшие через EntityConfig.TYPES, при том что все соседние методы
    // (_addRow/_deleteRow/_applyAutoRows/_purgeInvalidRows/DeepEntityFacade.
    // _collectRows) уже дженерик и читают конфиг по sType. Имя i18n-ключа не
    // выводится из имени типа механически (footerCountChecks — не просто
    // "footerCount" + sType в нижнем регистре какой-то системой), поэтому
    // явное поле здесь, а не конкатенация строки в вызывающем коде.
    TYPES: {
      Checks: {
        model: "checksModel",
        codeProp: "CheckCode",
        textProp: "CheckText",
        dictType: "CHECKS",
        tableId: "checksTable",
        titleKey: "vhChecksTitle",
        footerCountKey: "footerCountChecks"
      },
      Barriers: {
        model: "barriersModel",
        codeProp: "BarrierCode",
        textProp: "BarrierText",
        dictType: "BARRIERS",
        tableId: "barriersTable",
        titleKey: "vhBarriersTitle",
        footerCountKey: "footerCountBarriers",
        sectionGate: BusinessRules.isBarriersAllowed
      }
    },

    // [Fix OCP, аудит] Тот же приём, что TYPES выше, для проверяемого/
    // проверяющего — Main.controller.js#onPersonLiveChange раньше решал
    // sPrefix/имя модели двумя хардкодными тернарниками по строке роли
    // (`sRole === "inspector" ? ... : ...`) вместо карты, хотя ровно
    // структурно та же задача уже решена картой для Checks/Barriers.
    ROLES: {
      inspected: { prefix: "Inspected", model: "inspectedPersonModel" },
      inspector: { prefix: "Inspector", model: "inspectorPersonModel" }
    },

    // [SSOT] Единственный источник констрейнтов, продублированных в metadata.xml
    // (Barrier.Comment/CheckItem.Comment MaxLength="2000", CheckRoot.Equipment
    // MaxLength="100") — раньше эти же числа были захардкожены литералами ещё и
    // в ChecksTable.fragment.xml/BarriersTable.fragment.xml/BaseInfo.fragment.xml.
    // ModelsInit публикует эти значения как constraintsModel — фрагменты биндятся
    // на него вместо повторения литералов. Формат даты/времени — тот же принцип:
    // единственная пара паттернов, используемая и util/ODataFormat.js (парсинг),
    // и DatePicker/TimePicker (ввод), вместо двух независимых строк "yyyy-MM-dd".
    // CommentMaxLength поднят с 500 до 2000 по запросу бизнеса — значение здесь
    // и в metadata.xml (Comment MaxLength) обязаны совпадать: это не только
    // UI-ограничение, но и реальная граница столбца на HANA/ABAP-стороне.
    CONSTRAINTS: {
      CommentMaxLength: 2000,
      EquipmentMaxLength: 100,
      // [Fix РЕАЛЬНЫЙ БАГ, аудит] Зеркало CheckRoot.LocationName
      // MaxLength="100" из metadata.xml — та же граница доверия, что уже
      // применена к Equipment (тот же тип поля с ограничением). Раньше у
      // LocationText не было ни этого лимита, ни FormValidator-перепроверки
      // (см. FormValidator.js#validate) — единственное свободно
      // редактируемое поле формы вообще без верхней границы длины.
      LocationNameMaxLength: 100,
      // [Поля несоответствия, по запросу] Те же два новых поля на строках
      // Checks/Barriers (NonConformityDescription/NonConformityLocation,
      // см. ChecksTable/BarriersTable.fragment.xml) — зеркало в metadata.xml
      // (CheckItem/Barrier), тот же принцип SSOT, что и у CommentMaxLength
      // выше. Description — свободный текст (TextArea, как Comment), Location
      // — короткая строка (Input, как остальные "текст расположения" поля
      // этого проекта, напр. RawText/Text у CheckItem).
      NonConformityDescriptionMaxLength: 2000,
      NonConformityLocationMaxLength: 200,
      DateValueFormat: "yyyy-MM-dd",
      TimeValueFormat: "HH:mm:ss",
      // [Fix SSOT, аудит] Раньше "dd.MM.yyyy" был независимо повторён
      // литералом здесь же (formatter.js#oDisplayDateFmt) И в
      // StepWhenWhere.fragment.xml (DatePicker>displayFormat) — тот же класс
      // риска, что уже закрыт для DateValueFormat/TimeValueFormat выше:
      // правка одного места молча не долетела бы до другого. Единственный
      // источник — здесь, formatter.js и фрагмент оба биндятся на
      // constraintsModel>/DisplayDateFormat.
      DisplayDateFormat: "dd.MM.yyyy"
    }
  };
});
