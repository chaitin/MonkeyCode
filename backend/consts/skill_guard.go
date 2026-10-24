package consts

// SkillGuardQueueKey is the Redis-backed recovery queue for pending Skill
// security scans. Queue entries contain only version IDs; task IDs and
// deadlines remain on agent_skill_versions.
const SkillGuardQueueKey = "skillguard:pending"
