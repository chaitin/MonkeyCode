// Package errcode 提供统一的错误码定义和国际化支持
package errcode

import (
	"embed"
	"net/http"

	"github.com/GoYoko/web"
)

// LocalFS 嵌入本地化文件系统
//
//go:embed locale.*.toml
var LocalFS embed.FS

// 框架层面的错误
var (
	ErrUnauthorized = web.NewErr(http.StatusUnauthorized, http.StatusUnauthorized, "err-unauthorized")
	ErrForbidden    = web.NewErr(http.StatusForbidden, http.StatusForbidden, "err-forbidden")
	ErrBadRequest   = web.NewErr(http.StatusBadRequest, http.StatusBadRequest, "err-bad-request")
)

// 业务层面的错误
var (
	// 通用的错误
	ErrInternalServer    = web.NewErr(http.StatusOK, 10000, "err-internal-server")
	ErrPermision         = web.NewErr(http.StatusOK, 10001, "err-permision-denied")
	ErrNotFound          = web.NewErr(http.StatusOK, 10002, "err-not-found")
	ErrDuplicate         = web.NewErr(http.StatusOK, 10003, "err-duplicate")
	ErrDatabaseQuery     = web.NewErr(http.StatusOK, 10004, "err-database-query")
	ErrDatabaseOperation = web.NewErr(http.StatusOK, 10005, "err-database-operation-failed")
	ErrHTTPRequest       = web.NewErr(http.StatusOK, 10006, "err-http-request-failed")
	ErrHasInvalidEntry   = web.NewErr(http.StatusOK, 10007, "err-has-invalid-entry")
	ErrStreamDisconnect  = web.NewErr(http.StatusOK, 10008, "err-stream-disconnect")

	// 业务模块特有的 错误码

	// 文件管理
	ErrFilePermisionDenied = web.NewErr(http.StatusOK, 10100, "err-file-permision-denied")
	ErrFileOp              = web.NewErr(http.StatusOK, 10101, "err-file-op")

	// 主机管理
	ErrVMIDRequired          = web.NewErr(http.StatusOK, 10200, "err-vm-id-required")
	ErrVMNotBelongToUser     = web.NewErr(http.StatusOK, 10201, "err-vm-not-belong-to-user")
	ErrPermisionDenied       = web.NewErr(http.StatusOK, 10202, "err-permision-denied")
	ErrInvalidInstallToken   = web.NewErr(http.StatusOK, 10203, "err-host-id-required")
	ErrPublicHostNotFound    = web.NewErr(http.StatusOK, 10204, "err-public-host-not-found")
	ErrHostOffline           = web.NewErr(http.StatusOK, 10205, "err-host-offline")
	ErrVMExpired             = web.NewErr(http.StatusOK, 10206, "err-vm-expired")
	ErrApplyPortFailed       = web.NewErr(http.StatusOK, 10207, "err-apply-port-failed")
	ErrRecyclePortFailed     = web.NewErr(http.StatusOK, 10208, "err-recycle-port-failed")
	ErrPublicHostCannotRenew = web.NewErr(http.StatusOK, 10209, "err-public-host-cannot-renew")
	ErrPublicHostBeyondLimit = web.NewErr(http.StatusOK, 10230, "err-public-host-beyond-limit")
	ErrVmRemoved             = web.NewErr(http.StatusOK, 10231, "err-vm-removed")
	ErrVmBeyondExpireTime    = web.NewErr(http.StatusOK, 10232, "err-vm-beyond-expire-time")

	// 模型配置管理
	ErrInvalidAPIKey    = web.NewErr(http.StatusOK, 10300, "err-model-id-required")
	ErrInvalidParameter = web.NewErr(http.StatusOK, 10301, "err-invalid-parameter")
	ErrModelNotFound    = web.NewErr(http.StatusOK, 10302, "err-model-not-found")
	ErrImageNotFound    = web.NewErr(http.StatusOK, 10303, "err-image-not-found")

	// 项目管理
	ErrInvalidPlatform            = web.NewErr(http.StatusOK, 10400, "err-invalid-platform")
	ErrInvalidToken               = web.NewErr(http.StatusOK, 10401, "err-invalid-token")
	ErrInvalidCollaborarator      = web.NewErr(http.StatusOK, 10402, "err-invalid-collaborarator")
	ErrUpdateProjectFailed        = web.NewErr(http.StatusOK, 10403, "err-update-project-failed")
	ErrGitOperation               = web.NewErr(http.StatusOK, 10404, "err-git-operation")
	ErrProjectGitIdentityRequired = web.NewErr(http.StatusOK, 10405, "err-project-git-identity-required")
	ErrRepoAlreadyLinked          = web.NewErr(http.StatusOK, 10406, "err-repo-already-linked")
	ErrGitIdentityInUseByProject  = web.NewErr(http.StatusOK, 10407, "err-git-identity-in-use-by-project")
	ErrForbiddenBaseURL           = web.NewErr(http.StatusOK, 10408, "err-forbidden-base-url")

	// 团队管理
	ErrTeamMemberLimitExceeded = web.NewErr(http.StatusOK, 10500, "err-team-member-limit-exceeded")
	ErrInvalidPassword         = web.NewErr(http.StatusOK, 10501, "err-invalid-password")
	ErrSMSFailed               = web.NewErr(http.StatusOK, 10502, "err-sms-failed")
	ErrUserAlreadyExists       = web.NewErr(http.StatusOK, 10503, "err-user-already-exists")
	ErrChangePasswordFailed    = web.NewErr(http.StatusOK, 10504, "err-change-password-failed")
	ErrPasswordHashFailed      = web.NewErr(http.StatusOK, 10505, "err-password-hash-failed")

	// 用户管理
	ErrIdentityAlreadyBound = web.NewErr(http.StatusOK, 10601, "err-identity-already-bound")
	ErrInvalidState         = web.NewErr(http.StatusOK, 10602, "err-invalid-state")
	ErrNotLoggedIn          = web.NewErr(http.StatusOK, 10603, "err-not-logged-in")
	ErrUserBlocked          = web.NewErr(http.StatusOK, 10605, "err-user-blocked")
	ErrLoginFailed          = web.NewErr(http.StatusOK, 10606, "err-login-failed")
	ErrInvalidCoupon        = web.NewErr(http.StatusOK, 10607, "err-invalid-coupon")
	ErrResetPasswordFailed  = web.NewErr(http.StatusOK, 10608, "err-reset-password-failed")
	ErrWalletInsufficient   = web.NewErr(http.StatusOK, 10609, "err-wallet-insufficient")
	ErrAccountOverdraft     = web.NewErr(http.StatusOK, 10610, "err-account-overdraft")

	// captcha 模块
	ErrCreateCaptchaFailed  = web.NewErr(http.StatusOK, 10700, "err-create-captcha-failed")
	ErrRedeemCaptchaFailed  = web.NewErr(http.StatusOK, 10701, "err-redeem-captcha-failed")
	ErrCaptchaVerifyFailed  = web.NewErr(http.StatusOK, 10702, "err-captcha-verify-failed")

	ErrDepositFailed = web.NewErr(http.StatusOK, 10801, "err-deposit-failed")

	// 任务管理
	ErrTaskCannotDelete = web.NewErr(http.StatusOK, 10810, "err-task-cannot-delete")

	// 知识库索引管理
	ErrKBNilTree       = web.NewErr(http.StatusOK, 10900, "err-kb-nil-tree")
	ErrKBEmptyPath     = web.NewErr(http.StatusOK, 10901, "err-kb-empty-path")
	ErrKBPathNotFound  = web.NewErr(http.StatusOK, 10902, "err-kb-path-not-found")
	ErrKBNotFile       = web.NewErr(http.StatusOK, 10903, "err-kb-not-file")
	ErrKBNotDir        = web.NewErr(http.StatusOK, 10904, "err-kb-not-dir")
	ErrKBDirNotEmpty   = web.NewErr(http.StatusOK, 10905, "err-kb-dir-not-empty")
	ErrKBAlreadyExists = web.NewErr(http.StatusOK, 10906, "err-kb-already-exists")
)
