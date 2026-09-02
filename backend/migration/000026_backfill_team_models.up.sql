INSERT INTO team_models (id, team_id, model_id, created_at)
SELECT
    gen_random_uuid(),
    tg.team_id,
    tgm.model_id,
    MIN(tgm.created_at)
FROM team_group_models tgm
JOIN team_groups tg
    ON tg.id = tgm.group_id
   AND tg.deleted_at IS NULL
JOIN teams t
    ON t.id = tg.team_id
   AND t.deleted_at IS NULL
JOIN models m
    ON m.id = tgm.model_id
   AND m.deleted_at IS NULL
WHERE tgm.deleted_at IS NULL
GROUP BY tg.team_id, tgm.model_id
ON CONFLICT (team_id, model_id) DO NOTHING;
