/* =====================================================================
   app.usp_request_checks       APP-3; FINAL PLAN/03 APP-3 step 2; called by the function getRequestChecks
   Single statement per file; CREATE OR ALTER, safe to run again. Reads only.

   The live approval checks of one request (PASS / FAIL / NOT_CHECKED with a message and a time),
   exactly as app.usp_request_decide will see them. The rules are in app.fn_request_checks.

   Input : @request_id, and optionally @actor_email, the person who is about to decide (the row
           USER_ELIGIBLE_FOR_STAGE is NOT_CHECKED without one).
   Output: six rows, check_order 1 to 6: request_id, request_status, check_order, check_code,
           check_status, message, checked_at_utc.
   Refusal: 50130 when the request does not exist.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_checks
    @request_id  bigint,
    @actor_email nvarchar(256) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM app.change_request AS r WHERE r.request_id = @request_id)
        THROW 50130, N'That request does not exist.', 1;

    SELECT c.request_id, c.request_status, c.check_order, c.check_code, c.check_status, c.message, c.checked_at_utc
    FROM app.fn_request_checks(@request_id, @actor_email) AS c
    ORDER BY c.check_order;
END
