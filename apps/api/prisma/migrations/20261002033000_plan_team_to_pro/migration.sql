-- Plan rename (C14 Decisions, AC-15/AC-17): `team` is removed, `enterprise` is added.
-- Data-only, no schema change. Any workspace still on `team` moves to `pro` so it keeps
-- working rather than silently dropping to Free (`getPlan` treats an unknown value as Free).
UPDATE "WorkspaceBilling" SET "plan" = 'pro' WHERE "plan" = 'team';
