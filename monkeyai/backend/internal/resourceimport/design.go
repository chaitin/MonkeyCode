package resourceimport

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"time"

	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/designcatalog"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/identity"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resource"
	"github.com/chaitin/MonkeyCode/monkeyai/backend/internal/resourceimport/sqlc"
	"github.com/jackc/pgx/v5"
)

type DesignCatalog interface {
	Plan(context.Context, *designcatalog.Package) (designcatalog.Plan, error)
	Prepare(context.Context, *designcatalog.Package) error
	Apply(context.Context, pgx.Tx, *designcatalog.Package, string, string) (designcatalog.Plan, error)
}

func (s *Service) WithDesignCatalog(catalog DesignCatalog) *Service { s.design = catalog; return s }
func containsSection(sections []string, section string) bool {
	return slices.Contains(sections, section)
}
func selectSections(request []string, info designcatalog.Inspection) ([]string, error) {
	if request == nil {
		if info.NewDesign {
			return nil, resource.Invalid("新设计包必须显式选择导入分区")
		}
		return []string{"agent"}, nil
	}
	if len(request) == 0 {
		return nil, resource.Invalid("至少选择一个导入分区")
	}
	seen := map[string]bool{}
	for _, section := range request {
		if (section != "agent" && section != "design") || seen[section] {
			return nil, resource.Invalid("导入分区无效或重复")
		}
		seen[section] = true
		if section == "agent" && !info.Agent.Present || section == "design" && !info.Design.Present {
			return nil, resource.Invalid("所选分区不存在")
		}
		if section == "design" && !info.Design.Supported {
			return nil, &resource.Error{Status: 400, Code: "unsupported_design_section", Message: "不支持设计分区版本"}
		}
	}
	out := []string{}
	for _, section := range []string{"agent", "design"} {
		if seen[section] {
			out = append(out, section)
		}
	}
	return out, nil
}

type SectionPlan struct {
	PlanDigest      string              `json:"plan_digest"`
	Agent           *Preview            `json:"agent,omitempty"`
	Design          *designcatalog.Plan `json:"design,omitempty"`
	AlreadyImported bool                `json:"already_imported"`
}
type SectionError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type SectionResult struct {
	Status          string          `json:"status"`
	Replayed        bool            `json:"replayed"`
	HTTPStatus      int             `json:"http_status,omitempty"`
	Error           *SectionError   `json:"error,omitempty"`
	Result          json.RawMessage `json:"result,omitempty"`
	RequestDigest   string          `json:"request_digest,omitempty"`
	RequestSections []string        `json:"request_sections,omitempty"`
}
type SectionResults struct {
	Status   string                   `json:"status"`
	Sections map[string]SectionResult `json:"sections"`
	Warning  string                   `json:"warning,omitempty"`
}

func sectionError(err error) (int, string, string) {
	var e *resource.Error
	if errors.As(err, &e) {
		return e.Status, e.Code, e.Message
	}
	var d *designcatalog.Fault
	if errors.As(err, &d) {
		return d.Status, d.Code, d.Message
	}
	return 503, "service_unavailable", "分区存储或数据库暂不可用"
}
func (s *Service) receipt(ctx context.Context, upload, section string) (sqlc.ImportSectionRow, bool, error) {
	if upload == "" {
		return sqlc.ImportSectionRow{}, false, nil
	}
	row, err := sqlc.New(s.Pool).ImportSection(ctx, sqlc.ImportSectionParams{Column1: upload, Section: section})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, false, nil
	}
	return row, err == nil && row.Status == "succeeded", err
}
func (s *Service) previewSections(ctx context.Context, loaded loadedImport) (Preview, error) {
	out := Preview{PackageSHA256: loaded.sha, Sections: loaded.sections, SectionPlans: map[string]SectionPlan{}, Changes: []Change{}, IgnoredStatic: []string{}}
	for _, section := range loaded.sections {
		row, done, err := s.receipt(ctx, loaded.input.UploadID, section)
		if err != nil {
			return out, err
		}
		plan := SectionPlan{}
		if done {
			var result SectionResult
			if err = json.Unmarshal(row.Result, &result); err != nil {
				return out, err
			}
			plan.PlanDigest = row.PlanDigest
			plan.AlreadyImported = true
			if section == "agent" {
				var pre Preview
				if err = json.Unmarshal(result.Result, &pre); err != nil {
					return out, err
				}
				plan.Agent = &pre
			} else {
				var pre designcatalog.Plan
				if err = json.Unmarshal(result.Result, &pre); err != nil {
					return out, err
				}
				plan.Design = &pre
			}
		} else if section == "agent" {
			pre, err := s.Evaluate(ctx, s.Pool, loaded.pkg, loaded.items, loaded.input.Options, loaded.sha)
			if err != nil {
				return out, conflict(err.Error())
			}
			plan = SectionPlan{PlanDigest: pre.PlanDigest, Agent: &pre}
		} else {
			pre, err := s.design.Plan(ctx, loaded.design)
			if err != nil {
				status, code, message := sectionError(err)
				return out, &resource.Error{Status: status, Code: code, Message: message}
			}
			plan = SectionPlan{PlanDigest: pre.PlanDigest, Design: &pre}
		}
		out.SectionPlans[section] = plan
		if plan.Agent != nil {
			out.Publisher = plan.Agent.Publisher
			out.ReleaseID = plan.Agent.ReleaseID
			out.Version = plan.Agent.Version
			out.Changes = plan.Agent.Changes
			out.RequiresConfirm = plan.Agent.RequiresConfirm
			out.IgnoredStatic = plan.Agent.IgnoredStatic
		}
		if plan.Design != nil && out.Publisher == "" {
			out.Publisher = plan.Design.PublisherID
			out.ReleaseID = plan.Design.ReleaseID
		}
	}
	actor, _ := identity.UserFromContext(ctx)
	modes := loaded.input.Options.AuthorizationModes
	if modes == nil {
		modes = map[string]string{}
	}
	out.PlanDigest = resource.Hash(resource.Object{"actor": actor.ID, "upload_id": loaded.input.UploadID, "package_sha256": loaded.sha, "sections": loaded.sections, "section_plans": out.SectionPlans, "authorization_modes": modes})
	return out, nil
}
func saveSection(ctx context.Context, q resource.Queryer, loaded loadedImport, section, digest string, result SectionResult) error {
	if loaded.input.UploadID == "" {
		return nil
	}
	return sqlc.New(q).SaveImportSection(ctx, payload(resource.Object{"upload_id": loaded.input.UploadID, "section": section, "status": result.Status, "plan_digest": digest, "result": result}))
}
func (s *Service) applySections(ctx context.Context, loaded loadedImport) (SectionResults, int, error) {
	out := SectionResults{Status: "succeeded", Sections: map[string]SectionResult{}}
	if loaded.input.PackageSHA256 != loaded.sha || loaded.input.PlanDigest == "" || !loaded.input.Options.ConfirmFinal {
		return out, 400, resource.Invalid("必须先预览并确认所选分区")
	}
	if len(loaded.input.SectionPlanDigests) != len(loaded.sections) {
		return out, 400, resource.Invalid("缺少逐分区计划")
	}
	allReplayed := true
	verifiedRequest := false
	for _, section := range loaded.sections {
		row, done, err := s.receipt(ctx, loaded.input.UploadID, section)
		if err != nil {
			return out, 503, err
		}
		if !done {
			allReplayed = false
			continue
		}
		var result SectionResult
		if err = json.Unmarshal(row.Result, &result); err != nil {
			return out, 503, err
		}
		if row.PlanDigest != loaded.input.SectionPlanDigests[section] {
			allReplayed = false
		}
		if result.RequestDigest == loaded.input.PlanDigest && slices.Equal(result.RequestSections, loaded.sections) {
			verifiedRequest = true
		}
		result.Replayed = true
		out.Sections[section] = result
	}
	if allReplayed && verifiedRequest {
		return out, 200, nil
	}
	preview, err := s.previewSections(ctx, loaded)
	if err != nil {
		return out, 409, err
	}
	if preview.PlanDigest != loaded.input.PlanDigest {
		return out, 409, conflict("资源包或预览结果已变化，请重新预览")
	}
	if len(loaded.input.SectionPlanDigests) != len(loaded.sections) {
		return out, 400, resource.Invalid("缺少逐分区计划")
	}
	for _, section := range loaded.sections {
		if loaded.input.SectionPlanDigests[section] != preview.SectionPlans[section].PlanDigest {
			return out, 409, conflict("分区计划已变化，请重新预览")
		}
	}
	successes := 0
	failureStatus := 400
	actor, _ := identity.UserFromContext(ctx)
	for _, section := range loaded.sections {
		if result, ok := out.Sections[section]; ok && result.Status == "succeeded" {
			successes++
			continue
		}
		plan := preview.SectionPlans[section]
		result := SectionResult{Status: "succeeded", RequestDigest: loaded.input.PlanDigest, RequestSections: slices.Clone(loaded.sections)}
		var err error
		if section == "agent" {
			var pre Preview
			pre, err = s.apply(ctx, loaded.pkg, loaded.items, loaded.input.Options, loaded.sha, plan.PlanDigest, func(tx pgx.Tx, p Preview) error {
				if loaded.input.UploadID != "" {
					if err := sqlc.New(tx).BindSectionBatch(ctx, payload(resource.Object{"upload_id": loaded.input.UploadID, "publisher": p.Publisher, "release_id": p.ReleaseID})); err != nil {
						return err
					}
				}
				result.Result = payload(p)
				return saveSection(ctx, tx, loaded, section, plan.PlanDigest, result)
			})
			if err == nil {
				result.Result = payload(pre)
				if pre.AlreadyImported {
					err = saveSection(ctx, s.Pool, loaded, section, plan.PlanDigest, result)
				}
			}
		} else {
			err = s.design.Prepare(ctx, loaded.design)
			if err == nil {
				var tx pgx.Tx
				tx, err = s.Pool.Begin(ctx)
				if err == nil {
					var pre designcatalog.Plan
					pre, err = s.design.Apply(ctx, tx, loaded.design, actor.ID, plan.PlanDigest)
					if err == nil {
						result.Result = payload(pre)
						err = saveSection(ctx, tx, loaded, section, plan.PlanDigest, result)
					}
					if err == nil {
						err = tx.Commit(ctx)
					}
					if err := tx.Rollback(context.WithoutCancel(ctx)); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
						slog.Error("回滚事务失败", "module", "resourceimport", "operation", "applySections", "error", err)
					}
				}
			}
		}
		if err != nil {
			status, code, message := sectionError(err)
			result.Status = "failed"
			result.HTTPStatus = status
			result.Error = &SectionError{code, message}
			out.Status = "partial"
			if status >= 500 {
				failureStatus = 503
			} else if status == 409 && failureStatus != 503 {
				failureStatus = 409
			}
			recordCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
			recordErr := saveSection(recordCtx, s.Pool, loaded, section, plan.PlanDigest, result)
			cancel()
			if recordErr != nil {
				slog.WarnContext(ctx, "操作失败", "module", "resourceimport", "operation", "applySections", "error", recordErr)
				result.Error = &SectionError{"service_unavailable", "分区结果未能持久化，请重新预览恢复状态"}
				result.HTTPStatus = 503
				failureStatus = 503
			}
		} else {
			successes++
		}
		out.Sections[section] = result
	}
	if successes == 0 {
		out.Status = "failed"
		return out, failureStatus, nil
	}
	return out, 200, nil
}
func (s *Service) finishSections(ctx context.Context, loaded loadedImport) error {
	if loaded.tx == nil {
		return nil
	}
	rows, err := sqlc.New(loaded.tx).ListImportSections(ctx, loaded.input.UploadID)
	if err != nil {
		return err
	}
	done := map[string]bool{}
	for _, row := range rows {
		done[row.Section] = row.Status == "succeeded"
	}
	all := (!loaded.inspection.Agent.Present || done["agent"]) && (!loaded.inspection.Design.Present || !loaded.inspection.Design.Supported || done["design"])
	if all {
		if err = sqlc.New(loaded.tx).FinishImportUpload(ctx, loaded.input.UploadID); err != nil {
			return err
		}
	}
	return loaded.tx.Commit(ctx)
}
func (s *Service) discovery(w http.ResponseWriter, r *http.Request, loaded loadedImport) {
	available := []string{}
	if loaded.inspection.Agent.Present {
		available = append(available, "agent")
	}
	if loaded.inspection.Design.Present {
		available = append(available, "design")
	}
	resource.JSON(r.Context(), w, 200, resource.Object{"available_sections": available, "sections": loaded.inspection, "package_sha256": loaded.sha})
}
