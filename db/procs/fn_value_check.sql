/* =====================================================================
   app.fn_value_check           APP-3 helper (used by app.usp_request_create, usp_request_resubmit
                                and the VALUE_ALLOWED approval check, so the rule lives in ONE place)
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs gold.vw_floc_current (the synthetic stub or the data engineer's view).

   Is a proposed value acceptable for a catalogue field? FINAL PLAN/01 section 6.3 ("validates the
   field and value against the catalogue and allowed values") and section 6.2 (D-18).

   Input : the field code and the proposed value.
   Output: exactly one row with `problem`: NULL when the value is acceptable, otherwise a plain-English
           reason (at most 400 characters). The reasons, in the order they are tried:
     - the field is not in the catalogue
     - no value (blank after trimming outer spaces)
     - longer than the catalogue's max_length (the SAP field length)
     - a DECIMAL field that is not a plain number: digits and at most one decimal point, no sign,
       no thousands separator, at most 4 decimals (gold keeps decimal(18,4))
     - allowed_values_source LIST and the value is not an active entry of app.field_allowed_value
       (exact match, letter case included: the codes go to SAP as typed)
     - allowed_values_source CLASS_CHARACTERISTIC: refused for now, no field uses it yet and the
       table gold.class_characteristic arrives with the data engineer (DE-3)
     - FUNCTIONAL_LOCATION: the new location must exist in gold.vw_floc_current (decision D-18; the
       open point for DE-3 is that this view must hold every FLOC a heater could move to)

   Does NOT check that the value differs from the old one, that the field is editable, or who is
   asking: those depend on the request and are checked by the procedures.
   ===================================================================== */
CREATE OR ALTER FUNCTION app.fn_value_check
(
    @field_code nvarchar(64),
    @new_value  nvarchar(400)
)
RETURNS TABLE
AS
RETURN
(
    SELECT
        CAST(
            CASE
                WHEN c.field_code IS NULL
                    THEN N'the field is not in the catalogue'
                WHEN v.val IS NULL OR v.val = N''
                    THEN N'a new value is required'
                WHEN c.max_length IS NOT NULL AND LEN(v.val) > c.max_length
                    THEN N'the value is longer than ' + CAST(c.max_length AS nvarchar(10)) + N' characters, the length of the SAP field'
                WHEN c.data_type = N'DECIMAL'
                     AND (   v.val LIKE N'%[^0-9.]%'
                          OR v.val NOT LIKE N'%[0-9]%'
                          OR v.val LIKE N'%.%.%'
                          OR v.val LIKE N'%.[0-9][0-9][0-9][0-9][0-9]%')
                    THEN N'the value must be a number: digits and one decimal point, at most 4 decimals'
                WHEN c.allowed_values_source = N'LIST'
                     AND NOT EXISTS (SELECT 1
                                     FROM app.field_allowed_value AS a
                                     WHERE a.field_code = c.field_code
                                       AND a.is_active = 1
                                       AND a.allowed_value COLLATE Latin1_General_BIN2 = v.val COLLATE Latin1_General_BIN2)
                    THEN N'the value is not in the allowed list for this field'
                WHEN c.allowed_values_source = N'CLASS_CHARACTERISTIC'
                    THEN N'allowed values from the class characteristics are not available yet (data engineer, DE-3)'
                WHEN c.field_code = N'FUNCTIONAL_LOCATION'
                     AND NOT EXISTS (SELECT 1
                                     FROM gold.vw_floc_current AS f
                                     WHERE f.functional_location COLLATE Latin1_General_BIN2 = v.val COLLATE Latin1_General_BIN2)
                    THEN N'that functional location does not exist'
                ELSE NULL
            END AS nvarchar(400)) AS problem
    FROM (SELECT LTRIM(RTRIM(@new_value)) AS val) AS v
    LEFT JOIN app.field_catalog AS c ON c.field_code = @field_code
);
