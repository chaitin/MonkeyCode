package environment

import (
	"context"
	"errors"
	"net/http"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/environment/sqlc"
	"github.com/jackc/pgx/v5"
)

type Specification struct {
	ID          string `json:"id"`
	Version     int64  `json:"version"`
	CPUMillis   int64  `json:"cpu_millis"`
	MemoryBytes int64  `json:"memory_bytes"`
}
type SpecificationCatalog struct {
	Revision int64           `json:"revision"`
	Items    []Specification `json:"items"`
}
type SpecificationSelection struct {
	SpecificationID      string `json:"specification_id,omitempty"`
	SpecificationVersion int64  `json:"specification_version,omitempty"`
}

func specificationResources(cpu, memory int64) Resources {
	return Resources{CPUMillis: cpu, MemoryBytes: memory, HostTasks: 1024, TemporaryBytes: min(512<<20, memory/2/4096*4096)}
}
func readSpecifications(ctx context.Context, q *sqlc.Queries) (SpecificationCatalog, error) {
	revision, err := q.SpecificationRevision(ctx)
	if err != nil {
		return SpecificationCatalog{}, err
	}
	rows, err := q.ListSpecifications(ctx)
	out := SpecificationCatalog{Revision: revision, Items: make([]Specification, 0, len(rows))}
	for _, row := range rows {
		out.Items = append(out.Items, Specification{row.ID, row.Version, row.CpuMillis, row.MemoryBytes})
	}
	return out, err
}
func (s *Service) getSpecifications(w http.ResponseWriter, r *http.Request) {
	var out SpecificationCatalog
	err := s.transaction(r.Context(), func(q *sqlc.Queries) error { var err error; out, err = readSpecifications(r.Context(), q); return err })
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func (s *Service) putSpecifications(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Revision *int64           `json:"revision"`
		Items    *[]Specification `json:"items"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Revision == nil || *in.Revision < 0 || in.Items == nil || len(*in.Items) > 100 {
		fail(w, r, bad("必须提供规格列表和版本，最多允许100个规格"))
		return
	}
	seen := map[string]bool{}
	resources := map[[2]int64]bool{}
	for _, item := range *in.Items {
		pair := [2]int64{item.CPUMillis, item.MemoryBytes}
		if !uuid.MatchString(item.ID) || item.Version < 0 || seen[item.ID] || resources[pair] || specificationResources(item.CPUMillis, item.MemoryBytes).Validate() != nil {
			fail(w, r, bad("规格ID、CPU或内存无效，规格不能重复"))
			return
		}
		seen[item.ID] = true
		resources[pair] = true
	}
	var out SpecificationCatalog
	err := s.transaction(r.Context(), func(q *sqlc.Queries) error {
		current, err := readSpecifications(r.Context(), q)
		if err != nil {
			return err
		}
		if current.Revision != *in.Revision {
			return conflict("specifications_conflict", "规格列表已被修改，请重新加载")
		}
		byID := map[string]Specification{}
		for _, item := range current.Items {
			byID[item.ID] = item
		}
		// 先标记删除，再更新提交的完整列表；事务内不会暴露中间状态。
		if err = q.RetireSpecifications(r.Context()); err != nil {
			return err
		}
		for position, item := range *in.Items {
			previous, exists := byID[item.ID]
			if exists {
				if item.Version != previous.Version {
					return conflict("specifications_conflict", "规格版本已变化，请重新加载")
				}
				if _, err = q.UpdateSpecification(r.Context(), sqlc.UpdateSpecificationParams{ID: item.ID, CpuMillis: item.CPUMillis, MemoryBytes: item.MemoryBytes, Position: int32(position)}); err != nil {
					return err
				}
			} else {
				if item.Version != 0 {
					return conflict("specifications_conflict", "新增规格版本必须为0")
				}
				used, err := q.SpecificationExists(r.Context(), item.ID)
				if err != nil {
					return err
				}
				if used {
					return conflict("specifications_conflict", "规格ID已使用，请重新加载")
				}
				if err = q.InsertSpecification(r.Context(), sqlc.InsertSpecificationParams{ID: item.ID, CpuMillis: item.CPUMillis, MemoryBytes: item.MemoryBytes, Position: int32(position)}); err != nil {
					return err
				}
			}
		}
		if err = q.AdvanceSpecificationRevision(r.Context()); err != nil {
			return err
		}
		out, err = readSpecifications(r.Context(), q)
		return err
	})
	if err != nil {
		fail(w, r, err)
		return
	}
	respond(w, r, 200, out)
}
func selectedSpecification(ctx context.Context, q *sqlc.Queries, in SpecificationSelection) (Resources, error) {
	if !uuid.MatchString(in.SpecificationID) || in.SpecificationVersion < 1 {
		return Resources{}, bad("必须选择有效的云电脑规格及版本")
	}
	item, err := q.GetSpecification(ctx, in.SpecificationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Resources{}, conflict("specification_unavailable", "规格已删除，请刷新规格列表")
	}
	if err != nil {
		return Resources{}, err
	}
	if item.Version != in.SpecificationVersion {
		return Resources{}, conflict("specification_changed", "规格已修改，请刷新后重新选择")
	}
	result := specificationResources(item.CpuMillis, item.MemoryBytes)
	return result, result.Validate()
}
