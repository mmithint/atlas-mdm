/* =====================================================================
   app.usp_request_bulk_decide  APP-3; FINAL PLAN/03 APP-3 step 4 ("bulk approve")
   Single statement per file; CREATE OR ALTER, safe to run again.
   Needs: app.usp_request_decide.

   Applies ONE decision to a list of requests, each on its own: every request gets its own
   transaction, its own event and its own notifications, and a request that cannot be decided is
   skipped with the reason (the refusal text of app.usp_request_decide) while the others go on.
   Nothing here is a business rule of its own: eligibility, checks and segregation are all in
   app.usp_request_decide, so a bulk approval can never do what a single approval refuses.

   Input : @request_ids, a comma-separated list of request numbers (at most 100; the same number twice
           counts once; processed in ascending order), @actor_email, @decision (APPROVE, REJECT or
           RETURN; the screen offers APPROVE), @comment (applied to every request; required for REJECT
           and RETURN).
   Output: one row per distinct number: request_id, request_ref, outcome (DECIDED or SKIPPED),
           new_status, needs_merge (1 = approved at the final stage, the function now calls the merge),
           reason (NULL when DECIDED).
   Refusal: 50151 an empty list, 50152 more than 100 requests.
   ===================================================================== */
CREATE OR ALTER PROCEDURE app.usp_request_bulk_decide
    @request_ids nvarchar(4000),
    @actor_email nvarchar(256),
    @decision    nvarchar(10),
    @comment     nvarchar(1000) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @ids TABLE (seq int IDENTITY(1,1) NOT NULL PRIMARY KEY, req_text nvarchar(40) NOT NULL);
    INSERT INTO @ids (req_text)
    SELECT x.req_text
    FROM (SELECT DISTINCT LTRIM(RTRIM(s.value)) AS req_text
          FROM STRING_SPLIT(ISNULL(@request_ids, N''), N',') AS s
          WHERE LTRIM(RTRIM(s.value)) <> N'') AS x
    ORDER BY TRY_CONVERT(bigint, x.req_text), x.req_text;

    DECLARE @n int = (SELECT COUNT(*) FROM @ids);
    IF @n = 0
        THROW 50151, N'Name at least one request.', 1;
    IF @n > 100
        THROW 50152, N'At most 100 requests can be decided at once.', 1;

    DECLARE @res TABLE
    (
        seq int NOT NULL PRIMARY KEY, request_id bigint NULL, req_text nvarchar(40) NOT NULL,
        outcome nvarchar(10) NOT NULL, new_status nvarchar(24) NULL, needs_merge bit NOT NULL, reason nvarchar(400) NULL
    );

    DECLARE @i int = 1, @rid bigint, @txt nvarchar(40), @ns nvarchar(24), @nm bit;
    WHILE @i <= @n
    BEGIN
        SELECT @txt = d.req_text, @rid = TRY_CONVERT(bigint, d.req_text) FROM @ids AS d WHERE d.seq = @i;
        SET @ns = NULL;
        SET @nm = NULL;

        IF @rid IS NULL
            INSERT INTO @res (seq, request_id, req_text, outcome, new_status, needs_merge, reason)
            VALUES (@i, NULL, @txt, N'SKIPPED', NULL, 0, N'not a request number');
        ELSE
        BEGIN
            BEGIN TRY
                EXEC app.usp_request_decide @request_id = @rid, @actor_email = @actor_email, @decision = @decision,
                                            @comment = @comment, @emit_result = 0, @o_new_status = @ns OUTPUT, @o_needs_merge = @nm OUTPUT;
                INSERT INTO @res (seq, request_id, req_text, outcome, new_status, needs_merge, reason)
                VALUES (@i, @rid, @txt, N'DECIDED', @ns, ISNULL(@nm, 0), NULL);
            END TRY
            BEGIN CATCH
                INSERT INTO @res (seq, request_id, req_text, outcome, new_status, needs_merge, reason)
                VALUES (@i, @rid, @txt, N'SKIPPED', NULL, 0, LEFT(ERROR_MESSAGE(), 400));
            END CATCH;
        END
        SET @i += 1;
    END

    SELECT r.request_id, c.request_ref, r.outcome, r.new_status, r.needs_merge, r.reason
    FROM @res AS r
    LEFT JOIN app.change_request AS c ON c.request_id = r.request_id
    ORDER BY r.seq;
END
