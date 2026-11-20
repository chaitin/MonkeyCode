package billing

import (
	core "github.com/chaitin/MonkeyCode/monkeyai/backend/internal/billing"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Pricing = core.Pricing
type Amount = core.Amount
type Account = core.Account
type ComputeCharge = core.ComputeCharge
type Service = core.Service

var ErrComputeInsufficientCredits = core.ErrComputeInsufficientCredits
var ErrComputeModeUnavailable = core.ErrComputeModeUnavailable

func ParseAmount(value string) (Amount, error) { return core.ParseAmount(value) }
func NewService(pool *pgxpool.Pool) *Service   { return core.NewService(pool) }
