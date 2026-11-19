/* =====================================================================
   app.usp_equipment_requests   APP-4, read path C (D-17); screen S-5 ("Requests on this heater"); function getEquipmentRequests
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.vw_equipment_request and gold.vw_equipment_current. Reads only. Test: db/tests/t_request_reads.sql

   Every change request that touches one heater: its own requests, and the requests about the functional location
   (FLOC) it sits at, open ones first, newest first, with the overlap count of app.vw_equipment_request (how many
   OTHER open requests target the same field). Open visibility (POC-APP-04): everybody may read them.

   Two result sets, always in this order:
     1  one row: total_count
     2  the newest 100 rows: request_id, request_ref, request_status, is_open, equipment_id, functional_location,
        field_code, field_label, source_label, requested_at_utc, other_open_requests_same_field
   @only_set (testing aid, NULL = all): return only that numbered result set, so a test can read each set with
   INSERT ... EXEC, which cannot capture sets of different shapes. The functions never pass it.
   An unknown heater gives a count of 0 and no rows: it is not an error here (the heater screen reports a
   missing heater itself).
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_equipment_requests
    @equipment_id int,
    @only_set     tinyint = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @floc nvarchar(40) =
        (SELECT TOP (1) e.functional_location FROM gold.vw_equipment_current AS e WHERE e.equipment_id = @equipment_id);

    IF @only_set IS NULL OR @only_set = 1
    SELECT CAST(COUNT(*) AS int) AS total_count
    FROM app.vw_equipment_request AS q
    WHERE q.equipment_id = @equipment_id
       OR (q.equipment_id IS NULL AND @floc IS NOT NULL AND q.functional_location = @floc);

    IF @only_set IS NULL OR @only_set = 2
    SELECT TOP (100)
        q.request_id, q.request_ref, q.request_status, q.is_open, q.equipment_id, q.functional_location, q.field_code,
        q.field_label, q.source_label, q.requested_at_utc, q.other_open_requests_same_field
    FROM app.vw_equipment_request AS q
    WHERE q.equipment_id = @equipment_id
       OR (q.equipment_id IS NULL AND @floc IS NOT NULL AND q.functional_location = @floc)
    ORDER BY q.is_open DESC, q.requested_at_utc DESC, q.request_id DESC;
END
