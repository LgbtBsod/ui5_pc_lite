"! <p class="shorttext synchronized" lang="en">Data Provider Class extension for ZCHECK_LITE_SRV</p>
"! Classic (non-RAP, non-draft) Gateway OData V2 service. Единственный
"! редефинированный метод — CHECKROOTS_CREATE_DEEP_ENTITY. ВСЕ остальные
"! entity sets (Persons/LocationHierarchy/BarrierTypes/CheckTypes/
"! CheckResults/PkLevels/TimeZones/Professions/AutoRowRules — 9 штук, плюс
"! GET на сам CheckRoots) обслуживаются generic SADL-редиректом на
"! Referenced CDS-вьюхи (см. pc_lite/abap/README.md, раздел "Reference Data
"! Source vs новые объекты") — БЕЗ единой строчки кода здесь. Это не
"! недосмотр — по прямому указанию заказчика ("вариант попроще без драфта,
"! только на приём и словари"), read-методы этого класса намеренно пустые/
"! отсутствуют.
"!
"! ПОЧЕМУ НЕТ ZCL_CHECK_LITE_MPC_EXT: redux'овский ZCL_CHECK_MPC_EXT
"! существует ради одной вещи — sap:default-value на Result ('X' —
"! удовлетворительно) для inline-add в SmartTable. У лайта нет OData
"! inline-add вообще (checksModel/barriersModel — чистый JS до момента
"! единственного deep-create POST, см. facade/DeepEntityFacade.js), и
"! собственный клиент НЕ проставляет Status по умолчанию новой строке (см.
"! model/ModelsInit.js#emptyRow — Status: "", не "X") — то есть сама
"! потребность, ради которой существует MPC_EXT, здесь отсутствует.
"! Слепое копирование этого класса "на всякий случай" было бы декоративным
"! кодом без потребителя.
"!
"! Security: как и ZCL_CHECK_DPC_EXT — только статический SQL.
CLASS zcl_check_lite_dpc_ext DEFINITION
  PUBLIC
  INHERITING FROM zcl_check_lite_dpc
  CREATE PUBLIC .

  PUBLIC SECTION.

  PROTECTED SECTION.
    METHODS checkroots_create_deep_entity REDEFINITION.

  PRIVATE SECTION.
    "! [Fix РЕАЛЬНЫЙ БАГ, аудит] Валидируем ТЕКСТОВЫЕ поля (ObserverFullname/
    "! ObservedFullname/...Text), не *Pernr/*Key — ровно то же решение, что
    "! уже в ZCL_CHECK_DPC_EXT=>VALIDATE_REQUIRED_FIELDS (validates
    "! is_basic-observer_fullname, не observer_pernr), и ровно то, что
    "! реально объявлено Nullable="false" в pc_lite/model/metadata.xml
    "! (ObserverFullname/ObservedFullname/LpcText/ProfText/TimezoneText —
    "! везде ТЕКСТ мандатори, КОД — нет). Сервер валидирует контракт
    "! ($metadata), а не сегодняшнюю строгость конкретного клиента — см.
    "! pc_lite/abap/README.md, раздел "Несостыковка: клиент строже контракта".
    METHODS validate_required_fields
      IMPORTING
        is_basic TYPE zchk_basic
      RAISING
        /iwbep/cx_mgw_busi_exception.

    "! Конфликт интересов — тот же смысл и та же формула, что
    "! ZCL_CHECK_DPC_EXT=>VALIDATE_NO_CONFLICT_OF_INTEREST (сравнение по
    "! Pernr; если Pernr не заполнен ни у одной из сторон — не наша забота,
    "! сравнивать пустое с пустым как "конфликт" было бы ложным срабатыванием).
    METHODS validate_no_conflict_of_interest
      IMPORTING
        is_basic TYPE zchk_basic
      RAISING
        /iwbep/cx_mgw_busi_exception.

    "! [Общий с ZCHECK_SRV number range] ВАЖНО: DocId — сквозной человеко-
    "! читаемый номер по ОБЩЕЙ таблице ZCHK_ROOT (лайт и полная версия пишут
    "! в одну и ту же таблицу) — оба сервиса ОБЯЗАНЫ брать номер из ОДНОГО И
    "! ТОГО ЖЕ объекта диапазона номеров ('01'/'ZCHK_DOC', см.
    "! ZCL_CHECK_DPC_EXT=>GET_NEXT_DOC_ID в redux/abap). Если у лайта здесь
    "! случайно заведут свой отдельный number range object — получим
    "! дублирующиеся DOC-000001 от обоих сервисов на одной таблице. Это НЕ
    "! копия чужого метода "для консистентности стиля" — это единственно
    "! правильный вызов ровно того же объекта.
    METHODS get_next_doc_id
      RETURNING
        VALUE(rv_doc_id) TYPE zchk_root-doc_id.

ENDCLASS.


CLASS zcl_check_lite_dpc_ext IMPLEMENTATION.

  METHOD validate_required_fields.
    DATA(lt_missing) = VALUE string_table(
      ( COND #( WHEN is_basic-observer_fullname_manual IS INITIAL
                 AND is_basic-observer_pernr           IS INITIAL THEN 'ФИО инспектора' ) )
      ( COND #( WHEN is_basic-observed_fullname_manual IS INITIAL
                 AND is_basic-observed_pernr           IS INITIAL THEN 'ФИО проверяемого' ) )
      ( COND #( WHEN is_basic-date     IS INITIAL THEN 'Дата проверки' ) )
      ( COND #( WHEN is_basic-time     IS INITIAL THEN 'Время проверки' ) )
      ( COND #( WHEN is_basic-timezone IS INITIAL THEN 'Часовой пояс' ) )
      ( COND #( WHEN is_basic-lpc_key  IS INITIAL THEN 'Уровень КПР' ) )
      ( COND #( WHEN is_basic-prof_key IS INITIAL THEN 'Профессия' ) ) ).
    " [Отличие от ZCL_CHECK_DPC_EXT] Там проверяется *_fullname (вычисляемое
    " поле CDS-проекции, читается через SELECT SINGLE после INSERT — уместно
    " в контексте update). Здесь, на create, ФИО ещё не в базе — проверяем
    " то, что реально пришло от клиента: Pernr (если выбран через F4) ИЛИ
    " ручной текст (см. ZCHK_BASIC.OBSERVER_FULLNAME_MANUAL) — хотя бы один
    " источник обязан быть непустым, ЛОГИКА та же (Nullable="false" на
    " ObserverFullname в контракте), выражение другое из-за момента вызова.

    DELETE lt_missing WHERE table_line IS INITIAL.
    CHECK lt_missing IS NOT INITIAL.

    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING
        iv_msg_type = 'E'
        iv_msg_text = |Не заполнены обязательные поля: { concat_lines_of( table = lt_missing sep = ', ' ) }|.
  ENDMETHOD.


  METHOD validate_no_conflict_of_interest.
    CHECK is_basic-observer_pernr IS NOT INITIAL
      AND is_basic-observer_pernr = is_basic-observed_pernr.
    RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
      EXPORTING
        iv_msg_type = 'E'
        iv_msg_text = 'Инспектор не может проверять сам себя (конфликт интересов)'.
  ENDMETHOD.


  METHOD get_next_doc_id.
    DATA(lv_number) = cl_numberrange_runtime=>number_get_next(
      nr_range_nr = '01'
      object      = 'ZCHK_DOC' ).
    rv_doc_id = |DOC-{ lv_number WIDTH = 6 ALIGN = RIGHT PAD = '0' }|.
  ENDMETHOD.


  METHOD checkroots_create_deep_entity.
    io_data_provider->read_entry_data( IMPORTING es_data = DATA(ls_deep) ).
    DATA(ls_root)  = CORRESPONDING zchk_root( ls_deep ).
    DATA(ls_basic) = CORRESPONDING zchk_basic( ls_deep-to_basic ).

    " [Fix РЕАЛЬНЫЙ БАГ, аудит] Симметрично redux/abap — CORRESPONDING не
    " находит ObserverFullname/ObservedFullname в zchk_basic (нет
    " одноимённых DB-полей, см. redux/abap/ddic/tables.md у
    " OBSERVER_FULLNAME_MANUAL) и молча их роняет. Переносим явно, ДО
    " валидации ниже (валидация читает именно *_fullname_manual).
    ls_basic-observer_fullname_manual = ls_deep-to_basic-observerfullname.
    ls_basic-observed_fullname_manual = ls_deep-to_basic-observedfullname.

    validate_required_fields( ls_basic ).
    validate_no_conflict_of_interest( ls_basic ).

    DATA(lt_items) = CORRESPONDING TABLE OF zchk_item( ls_deep-to_checks ).
    DATA(lt_barrs) = CORRESPONDING TABLE OF zchk_barr( ls_deep-to_barriers ).

    TRY.
        ls_root-root_id = cl_system_uuid=>create_uuid_x16_static( ).
      CATCH cx_uuid_error INTO DATA(lx_uuid).
        RAISE EXCEPTION TYPE /iwbep/cx_mgw_busi_exception
          EXPORTING iv_msg_type = 'E' iv_msg_text = lx_uuid->get_text( ).
    ENDTRY.

    GET TIME STAMP FIELD DATA(lv_now).
    " [Нет составного ETag — см. ZI_Lite_CheckRoot.ddls.asddls] Root и Basic
    " получают ОДИН и тот же lv_now намеренно — это и есть причина, по
    " которой лайту не нужна ZCL_CHECK_ROOT_ETAG_AMDP: LastChangedAt обеих
    " строк физически совпадает в момент создания и никогда больше не
    " меняется независимо (после create ни одна из них не PATCH'ится).
    ls_root = VALUE #( BASE ls_root
      doc_id = get_next_doc_id( ) status = 'OK' this_is_integration_data = abap_false
      created_by = sy-uname created_at = lv_now last_changed_at = lv_now ).
    ls_basic-root_id         = ls_root-root_id.
    ls_basic-last_changed_at = lv_now.

    lt_items = VALUE #( FOR ls_item IN lt_items ( CORRESPONDING #( BASE ( ls_item )
      root_id = ls_root-root_id item_id = cl_system_uuid=>create_uuid_x16_static( ) last_changed_at = lv_now ) ) ).
    lt_barrs = VALUE #( FOR ls_barr IN lt_barrs ( CORRESPONDING #( BASE ( ls_barr )
      root_id = ls_root-root_id barrier_id = cl_system_uuid=>create_uuid_x16_static( ) last_changed_at = lv_now ) ) ).

    INSERT zchk_root FROM ls_root.
    INSERT zchk_basic FROM ls_basic.
    IF lt_items IS NOT INITIAL.
      INSERT zchk_item FROM TABLE lt_items.
    ENDIF.
    IF lt_barrs IS NOT INITIAL.
      INSERT zchk_barr FROM TABLE lt_barrs.
    ENDIF.

    " Ответ — через ZI_Lite_CheckRoot (не сырой ls_root), чтобы
    " Updatable/ChecksHidden/BarriersHidden/*Text вернулись той же формулой,
    " что и на обычном GET (см. ZI_Lite_CheckRoot.ddls.asddls) — то же
    " решение, что redux/abap/classes/ZCL_CHECK_DPC_EXT, но БЕЗ
    " FORMAT_KPI_TITLE/_SUBTITLE (полей HeaderKpiTitle/HeaderKpiSubtitle в
    " pc_lite/model/metadata.xml нет вообще — некуда их писать).
    SELECT SINGLE * FROM zi_lite_checkroot
      WHERE rootid = @ls_root-root_id
      INTO CORRESPONDING FIELDS OF @DATA(ls_response).

    CREATE DATA er_deep_entity LIKE ls_response.
    ASSIGN er_deep_entity->* TO FIELD-SYMBOL(<ls_deep_entity>).
    <ls_deep_entity> = ls_response.
  ENDMETHOD.

ENDCLASS.
