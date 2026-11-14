/* =====================================================================
   merge_stub.sql            APP-1, stand-in for the gold merge procedure
   Database : the ATLAS Fabric SQL database (item of type SQL database)
   Run      : Fabric portal > SQL database > New query > paste > Run
   Re-runnable: yes. The procedure is created ONLY IF ABSENT, so the data
   engineer's real gold.usp_apply_approved_change is never overwritten.

   Contract (01_Architecture_and_Contracts.md section 6.5):
     EXEC gold.usp_apply_approved_change @request_id = 42, @actor = N'system:merge';
     returns one row: outcome (APPLIED | STALE | ALREADY_APPLIED | NOT_ELIGIBLE | ERROR),
                      message nvarchar(400), golden_version_id int
   This stub has the same signature and always returns
     ERROR, 'merge not yet implemented', NULL
   so the approval flow (APP-4) can be tested end to end before the real merge
   (data engineer, Fri 20 Nov). Its definition contains the marker ATLAS-STUB;
   db/dev/drop_stub.sql removes the procedure only when it carries that marker.
   Contains no data.
   ===================================================================== */
SET NOCOUNT ON;

IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 11
   OR @@VERSION LIKE N'%Data Warehouse%'
   OR DB_NAME() NOT LIKE N'ATLAS[_]SQL[_]DB%'
BEGIN
    PRINT 'FAIL MERGE.0 wrong editor: connected to "' + DB_NAME() + '" on engine ' + ISNULL(CAST(SERVERPROPERTY('EngineEdition') AS varchar(20)), '?') + ' (11 = the warehouse-style engine, which the SQL analytics endpoint uses). Open the item named ATLAS_SQL_DB whose type is SQL database and run this from New query there. Nothing was changed.';
    RETURN;
END
PRINT 'OK  connected to database "' + DB_NAME() + '"';

DECLARE @steps int = 0, @failed int = 0;
DECLARE @is_stub bit = 0;

/* ---- MERGE.1 schema -------------------------------------------------------- */
BEGIN TRY
    IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'gold')
        EXEC (N'CREATE SCHEMA gold AUTHORIZATION dbo');
    SET @steps += 1;
    PRINT 'OK  MERGE.1 schema gold ready';
END TRY
BEGIN CATCH
    SET @steps += 1; SET @failed += 1;
    PRINT 'FAIL MERGE.1 CREATE SCHEMA gold AUTHORIZATION dbo, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
    PRINT 'merge_stub RESULT: ' + CAST(@failed AS varchar(12)) + ' CHECK(S) FAILED';
    RETURN;
END CATCH;

/* ---- MERGE.2 the stub procedure (only if no procedure of that name exists) -- */
BEGIN TRY
    IF OBJECT_ID(N'gold.usp_apply_approved_change') IS NULL
    BEGIN
        EXEC (N'CREATE PROCEDURE gold.usp_apply_approved_change
    @request_id bigint,
    @actor      nvarchar(256)
AS
BEGIN
    -- ATLAS-STUB: stand-in until the data engineer delivers the real merge (01 section 6.5).
    SET NOCOUNT ON;
    SELECT
        CAST(N''ERROR'' AS nvarchar(16))                       AS outcome,
        CAST(N''merge not yet implemented'' AS nvarchar(400))  AS message,
        CAST(NULL AS int)                                      AS golden_version_id;
END');
        PRINT 'OK  MERGE.2 created the merge stub gold.usp_apply_approved_change';
    END
    ELSE IF OBJECT_DEFINITION(OBJECT_ID(N'gold.usp_apply_approved_change')) LIKE N'%ATLAS-STUB%'
        PRINT 'OK  MERGE.2 the merge stub already exists, left in place';
    ELSE
        PRINT 'INFO MERGE.2 gold.usp_apply_approved_change already exists and is not the stub (the data engineer''s real procedure?): left alone';
    SET @steps += 1;
END TRY
BEGIN CATCH
    SET @steps += 1; SET @failed += 1;
    PRINT 'FAIL MERGE.2 CREATE PROCEDURE gold.usp_apply_approved_change, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

/* ---- MERGE.3 call the stub once (never a real procedure) ------------------- */
BEGIN TRY
    IF OBJECT_ID(N'gold.usp_apply_approved_change') IS NOT NULL
       AND OBJECT_DEFINITION(OBJECT_ID(N'gold.usp_apply_approved_change')) LIKE N'%ATLAS-STUB%'
        SET @is_stub = 1;

    IF @is_stub = 1
    BEGIN
        DECLARE @r TABLE (outcome nvarchar(16) NULL, message nvarchar(400) NULL, golden_version_id int NULL);
        DECLARE @rows int, @outcome nvarchar(16), @message nvarchar(400), @version int;

        INSERT INTO @r (outcome, message, golden_version_id)
        EXEC gold.usp_apply_approved_change @request_id = 0, @actor = N'system:stub-check';

        SELECT @rows = COUNT(*) FROM @r;
        SELECT TOP (1) @outcome = outcome, @message = message, @version = golden_version_id FROM @r;

        SET @steps += 1;
        IF @rows = 1 AND @outcome = N'ERROR' AND @message = N'merge not yet implemented' AND @version IS NULL
            PRINT 'OK  MERGE.3 the stub returns one row: ERROR, merge not yet implemented, NULL';
        ELSE
        BEGIN
            SET @failed += 1;
            PRINT 'FAIL MERGE.3 the stub returned ' + CAST(@rows AS varchar(12)) + ' row(s); first row outcome=' + ISNULL(@outcome, N'NULL') + ', message=' + ISNULL(@message, N'NULL');
        END
    END
    ELSE
    BEGIN
        SET @steps += 1;
        PRINT 'INFO MERGE.3 skipped: the procedure is not the stub, so it is not called from here';
    END
END TRY
BEGIN CATCH
    SET @steps += 1; SET @failed += 1;
    PRINT 'FAIL MERGE.3 calling the stub, error ' + CAST(ERROR_NUMBER() AS varchar(12)) + ': ' + ERROR_MESSAGE();
END CATCH;

IF @failed = 0
    PRINT 'merge_stub RESULT: ALL ' + CAST(@steps AS varchar(12)) + ' CHECKS PASS';
ELSE
    PRINT 'merge_stub RESULT: ' + CAST(@failed AS varchar(12)) + ' CHECK(S) FAILED';
