package cvt

import (
	"slices"
)

// Iter 用来迭代类型T的列表, 然后返回类型为R的列表
func Iter[T any, R any](ts []T, fn func(int, T) R) []R {
	r := make([]R, len(ts))
	for i, v := range ts {
		r[i] = fn(i, v)
	}
	return r
}

// IterToMap 迭代类型T的列表, 然后转换成一个 map[K]V.
// K: 可以是任何可比较的值
// V: 是任务类型
func IterToMap[T any, K comparable, V any](ts []T, fn func(int, T) (K, V)) map[K]V {
	m := make(map[K]V)
	for i, v := range ts {
		k, v := fn(i, v)
		m[k] = v
	}
	return m
}

// ForEach 简单的迭代
func ForEach[T any](ts []T, fn func(int, T)) {
	for i, t := range ts {
		fn(i, t)
	}
}

// Filter 过滤迭代
func Filter[T any, R any](ts []T, fn func(int, T) (R, bool)) []R {
	r := make([]R, 0)
	for i, v := range ts {
		if res, ok := fn(i, v); ok {
			r = append(r, res)
		}
	}
	return r
}

// Unique 去重
func Unique[T comparable](ts []T) []T {
	m := make(map[T]struct{})
	news := make([]T, 0)
	for _, v := range ts {
		if _, ok := m[v]; ok {
			continue
		}

		m[v] = struct{}{}
		news = append(news, v)
	}
	return news
}

// UniqueFn 根据fn去重
func UniqueFn[T any, K comparable](ts []T, fn func(T) K) []T {
	m := make(map[K]struct{})
	news := make([]T, 0)
	for _, v := range ts {
		k := fn(v)
		if _, ok := m[k]; ok {
			continue
		}

		m[k] = struct{}{}
		news = append(news, v)
	}
	return news
}

// Union 并集
func Union[T comparable](a, b []T) []T {
	return Unique(append(a, b...))
}

// Intersection 交集
func Intersection[T comparable](a, b []T) []T {
	return Filter(a, func(i int, t T) (T, bool) {
		return t, slices.Contains(b, t)
	})
}

// Difference 差集
func Difference[T comparable](a, b []T) []T {
	return Filter(a, func(i int, t T) (T, bool) {
		return t, !slices.Contains(b, t)
	})
}

// GroupBy 分组
func GroupBy[T any, K comparable, V any](collection []T, fn func(item T) (K, V)) map[K][]V {
	result := map[K][]V{}

	for _, item := range collection {
		k, v := fn(item)

		result[k] = append(result[k], v)
	}

	return result
}

// SumBy 求和
func SumBy[K comparable, T any](ts []T, fn func(item T) K) map[K]int64 {
	result := map[K]int64{}
	for _, item := range ts {
		k := fn(item)
		result[k]++
	}
	return result
}

// MapToList map 转成 slice
func MapToList[K comparable, V any, R any](m map[K]V, fn func(K, V) R) []R {
	r := make([]R, 0)
	for k, v := range m {
		r = append(r, fn(k, v))
	}
	return r
}

// NilWithZero t不为nil则执行fn. 否则返回类型为R的空值
func NilWithZero[T any, R any](t *T, fn func(*T) R) R {
	if t != nil {
		return fn(t)
	}
	var b R
	return b
}

// ZeroWithDefault 给t一个默认值def
func ZeroWithDefault[T comparable](t T, def T) T {
	var zero T
	if t == zero {
		return def
	}
	return t
}

// NilWithDefault 给空指针t一个默认值def
func NilWithDefault[T any](t, def *T) *T {
	if t != nil {
		return t
	}
	return def
}

// Contains 列表包含
func Contains[T any](ts []T, fn func(T) bool) bool {
	return slices.ContainsFunc(ts, fn)
}

// GetN 安全获取slice的索引值. 没有返回空值
func GetN[T any](ts []T, i int) T {
	if len(ts) > i {
		return ts[i]
	}
	var t T
	return t
}

// RangeByStep 步进ts
func RangeByStep[T any](ts []T, step int, fn func([]T)) {
	for len(ts) > 0 {
		if len(ts) < step {
			fn(ts)
			ts = nil
		} else {
			fn(ts[:step])
			ts = ts[step:]
		}
	}
}

// EqualIfNotZero 当b不为空时, 进行比较操作
func EqualIfNotZero[T comparable](a, b T) bool {
	var zero T
	if b == zero {
		return true
	}

	return a == b
}

// CanditionVar 条件变量
func CanditionVar[T any](fn ...func() (T, bool)) T {
	var t T
	for _, f := range fn {
		if v, ok := f(); ok {
			return v
		}
	}
	return t
}

type Identifier interface {
	GetID() string
}

// TopN 根据ID获取出现次数最多的前n个
func TopN[T Identifier](ts []T, n int) []T {
	all := make(map[string]T)
	counter := make(map[string]int)
	for _, t := range ts {
		counter[t.GetID()]++
		all[t.GetID()] = t
	}

	res := make([]T, 0)
	for i := 0; i < n; i++ {
		maxID := ""
		maxC := 0
		for k, c := range counter {
			if c > maxC {
				maxC = c
				maxID = k
			}
		}
		if maxID == "" {
			break
		}
		res = append(res, all[maxID])
		delete(counter, maxID)
	}
	return res
}

// Assert 段言a的类型是否为T, 如何不是返回类型为T的空值
func Assert[T any](a any) T {
	if t, ok := a.(T); ok {
		return t
	}
	var t T
	return t
}

type Fromer[A, B any] interface {
	From(a A) B
}

// From 从A对象转换为B对象
func From[A, B any](a A, f Fromer[A, B]) B {
	return f.From(a)
}

// Zero 返回类型为T的空值
func Zero[T any]() *T {
	var zero T
	return &zero
}
