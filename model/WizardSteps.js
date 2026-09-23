sap.ui.define([], () => {
  "use strict";

  // [Fix SSOT, аудит] Раньше порядок/число шагов wizard'а было переписано
  // вручную в четырёх независимых местах: STEP_PAGE_IDS и литерал
  // BARRIERS_STEP=5 в Main.controller.js, literal "=== 6"/"!== 6" в
  // Main.view.xml (гейтинг кнопок footer), и номера шагов в
  // FormValidator.js#REQUIRED_FIELDS/MIN_CHECK_ROWS_STEP — ничего не
  // проверяло, что они согласованы, и перестановка/вставка шага молча
  // рассинхронила бы Submit-кнопку, скип-логику барьеров и валидацию по
  // шагам одновременно. Единственный источник порядка — этот массив;
  // все зависимые номера шагов ниже вычислены из него.
  const STEP_PAGE_IDS = ["pageWhen", "pagePeople", "pageProfession", "pageChecks", "pageBarriers", "pageSubmit"];

  // [Fix SRP/SSOT, аудит] Main.controller.js#onInit раньше задавал
  // WizardProgressNavigator#stepTitles отдельным литеральным массивом из 6
  // rb.getText(...) вызовов, в СВОЁМ собственном порядке, никак структурно
  // не связанном со STEP_PAGE_IDS выше (тем самым единственным источником
  // порядка шагов, ради которого и заведён этот файл, см. комментарий над
  // STEP_PAGE_IDS) — перестановка или вставка шага там потребовала бы
  // вручную поправить ещё и этот второй список в контроллере, ничем не
  // защищённая синхронизация. Здесь — карта pageId -> i18n-ключ (не позиция
  // -> ключ), контроллер получает порядок заголовков через
  // STEP_PAGE_IDS.map(id => STEP_TITLE_KEYS[id]) — переставь STEP_PAGE_IDS,
  // и заголовки переставятся вместе с ним автоматически, без второго места
  // для правки.
  const STEP_TITLE_KEYS = {
    pageWhen: "wizStepWhen",
    pagePeople: "wizStepPeople",
    pageProfession: "wizStepProfession",
    pageChecks: "tabChecks",
    pageBarriers: "tabBarriers",
    pageSubmit: "wizStepSubmit"
  };

  function stepOf(sPageId) {
    return STEP_PAGE_IDS.indexOf(sPageId) + 1;
  }

  // [Fix WZ-05] i18n-ключ заголовка шага по номеру (для текста "откроется шаг «…»").
  function titleKeyOf(iStep) {
    return STEP_TITLE_KEYS[STEP_PAGE_IDS[iStep - 1]];
  }

  return {
    STEP_PAGE_IDS,
    STEP_TITLE_KEYS,
    titleKeyOf,
    TOTAL_STEPS: STEP_PAGE_IDS.length,
    WHEN: stepOf("pageWhen"),
    PEOPLE: stepOf("pagePeople"),
    PROFESSION: stepOf("pageProfession"),
    CHECKS: stepOf("pageChecks"),
    BARRIERS: stepOf("pageBarriers"),
    SUBMIT: stepOf("pageSubmit")
  };
});
