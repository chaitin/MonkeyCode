package billing

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

const scale int64 = 1_000_000
const maxAmount Amount = 1_000_000_000_000 * Amount(scale)

type Amount int64

var decimalPattern = regexp.MustCompile(`^-?\d{1,13}(\.\d{1,6})?$`)

func ParseAmount(s string) (Amount, error) {
	if !decimalPattern.MatchString(s) {
		return 0, errors.New("积分必须是最多六位小数的十进制数")
	}
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return 0, errors.New("积分格式无效")
	}
	n := new(big.Int).Mul(r.Num(), big.NewInt(scale))
	n.Quo(n, r.Denom())
	if !n.IsInt64() || n.Cmp(big.NewInt(int64(maxAmount))) > 0 || n.Cmp(big.NewInt(-int64(maxAmount))) < 0 {
		return 0, errors.New("积分超出允许范围")
	}
	return Amount(n.Int64()), nil
}
func (a Amount) String() string {
	n := big.NewInt(int64(a))
	sign := ""
	if n.Sign() < 0 {
		sign = "-"
		n.Abs(n)
	}
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(n, big.NewInt(scale), r)
	if r.Sign() == 0 {
		return sign + q.String()
	}
	return sign + q.String() + "." + strings.TrimRight(fmt.Sprintf("%06d", r.Int64()), "0")
}
func (a Amount) MarshalJSON() ([]byte, error) { return json.Marshal(a.String()) }
func (a *Amount) UnmarshalJSON(b []byte) error {
	if bytes.Equal(b, []byte("null")) {
		return errors.New("积分不能为空")
	}
	s := string(b)
	if len(b) > 0 && b[0] == '"' {
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
	}
	v, err := ParseAmount(s)
	if err == nil {
		*a = v
	}
	return err
}
func rounded(n, d *big.Int) (Amount, error) {
	q, r := new(big.Int), new(big.Int)
	q.QuoRem(n, d, r)
	if new(big.Int).Mul(r, big.NewInt(2)).Cmp(d) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	if !q.IsInt64() || q.Sign() < 0 || q.Cmp(big.NewInt(int64(maxAmount))) > 0 {
		return 0, errors.New("计费金额超出允许范围")
	}
	return Amount(q.Int64()), nil
}
func priceTokens(input, cached, output int64, p Price) (Amount, error) {
	if input < 0 || cached < 0 || cached > input || output < 0 {
		return 0, errors.New("Token 用量无效")
	}
	total := new(big.Int)
	for _, v := range [][2]int64{{input - cached, int64(p.Input)}, {cached, int64(p.Cached)}, {output, int64(p.Output)}} {
		total.Add(total, new(big.Int).Mul(big.NewInt(v[0]), big.NewInt(v[1])))
	}
	total.Mul(total, big.NewInt(int64(p.Multiplier)))
	return rounded(total, new(big.Int).Mul(big.NewInt(scale), big.NewInt(scale)))
}
func quotaAmount(a Amount, up bool) int64 {
	n := int64(a)
	if up {
		return n/10000 + boolInt(n%10000 != 0)
	}
	return n/10000 + boolInt(n%10000 >= 5000)
}
func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}
func amountText(s string) Amount { a, _ := ParseAmount(s); return a }
func stringInt(n int64) string   { return strconv.FormatInt(n, 10) }
