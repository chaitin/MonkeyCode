// Code generated by ent, DO NOT EDIT.

package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqlgraph"
	"entgo.io/ent/schema/field"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/setting"
	"github.com/chaitin/MonkeyCode/backend/ent/types"
)

// SettingUpdate is the builder for updating Setting entities.
type SettingUpdate struct {
	config
	hooks     []Hook
	mutation  *SettingMutation
	modifiers []func(*sql.UpdateBuilder)
}

// Where appends a list predicates to the SettingUpdate builder.
func (su *SettingUpdate) Where(ps ...predicate.Setting) *SettingUpdate {
	su.mutation.Where(ps...)
	return su
}

// SetEnableSSO sets the "enable_sso" field.
func (su *SettingUpdate) SetEnableSSO(b bool) *SettingUpdate {
	su.mutation.SetEnableSSO(b)
	return su
}

// SetNillableEnableSSO sets the "enable_sso" field if the given value is not nil.
func (su *SettingUpdate) SetNillableEnableSSO(b *bool) *SettingUpdate {
	if b != nil {
		su.SetEnableSSO(*b)
	}
	return su
}

// SetForceTwoFactorAuth sets the "force_two_factor_auth" field.
func (su *SettingUpdate) SetForceTwoFactorAuth(b bool) *SettingUpdate {
	su.mutation.SetForceTwoFactorAuth(b)
	return su
}

// SetNillableForceTwoFactorAuth sets the "force_two_factor_auth" field if the given value is not nil.
func (su *SettingUpdate) SetNillableForceTwoFactorAuth(b *bool) *SettingUpdate {
	if b != nil {
		su.SetForceTwoFactorAuth(*b)
	}
	return su
}

// SetDisablePasswordLogin sets the "disable_password_login" field.
func (su *SettingUpdate) SetDisablePasswordLogin(b bool) *SettingUpdate {
	su.mutation.SetDisablePasswordLogin(b)
	return su
}

// SetNillableDisablePasswordLogin sets the "disable_password_login" field if the given value is not nil.
func (su *SettingUpdate) SetNillableDisablePasswordLogin(b *bool) *SettingUpdate {
	if b != nil {
		su.SetDisablePasswordLogin(*b)
	}
	return su
}

// SetEnableAutoLogin sets the "enable_auto_login" field.
func (su *SettingUpdate) SetEnableAutoLogin(b bool) *SettingUpdate {
	su.mutation.SetEnableAutoLogin(b)
	return su
}

// SetNillableEnableAutoLogin sets the "enable_auto_login" field if the given value is not nil.
func (su *SettingUpdate) SetNillableEnableAutoLogin(b *bool) *SettingUpdate {
	if b != nil {
		su.SetEnableAutoLogin(*b)
	}
	return su
}

// SetDingtalkOauth sets the "dingtalk_oauth" field.
func (su *SettingUpdate) SetDingtalkOauth(to *types.DingtalkOAuth) *SettingUpdate {
	su.mutation.SetDingtalkOauth(to)
	return su
}

// ClearDingtalkOauth clears the value of the "dingtalk_oauth" field.
func (su *SettingUpdate) ClearDingtalkOauth() *SettingUpdate {
	su.mutation.ClearDingtalkOauth()
	return su
}

// SetCustomOauth sets the "custom_oauth" field.
func (su *SettingUpdate) SetCustomOauth(to *types.CustomOAuth) *SettingUpdate {
	su.mutation.SetCustomOauth(to)
	return su
}

// ClearCustomOauth clears the value of the "custom_oauth" field.
func (su *SettingUpdate) ClearCustomOauth() *SettingUpdate {
	su.mutation.ClearCustomOauth()
	return su
}

// SetBaseURL sets the "base_url" field.
func (su *SettingUpdate) SetBaseURL(s string) *SettingUpdate {
	su.mutation.SetBaseURL(s)
	return su
}

// SetNillableBaseURL sets the "base_url" field if the given value is not nil.
func (su *SettingUpdate) SetNillableBaseURL(s *string) *SettingUpdate {
	if s != nil {
		su.SetBaseURL(*s)
	}
	return su
}

// ClearBaseURL clears the value of the "base_url" field.
func (su *SettingUpdate) ClearBaseURL() *SettingUpdate {
	su.mutation.ClearBaseURL()
	return su
}

// SetCreatedAt sets the "created_at" field.
func (su *SettingUpdate) SetCreatedAt(t time.Time) *SettingUpdate {
	su.mutation.SetCreatedAt(t)
	return su
}

// SetNillableCreatedAt sets the "created_at" field if the given value is not nil.
func (su *SettingUpdate) SetNillableCreatedAt(t *time.Time) *SettingUpdate {
	if t != nil {
		su.SetCreatedAt(*t)
	}
	return su
}

// SetUpdatedAt sets the "updated_at" field.
func (su *SettingUpdate) SetUpdatedAt(t time.Time) *SettingUpdate {
	su.mutation.SetUpdatedAt(t)
	return su
}

// Mutation returns the SettingMutation object of the builder.
func (su *SettingUpdate) Mutation() *SettingMutation {
	return su.mutation
}

// Save executes the query and returns the number of nodes affected by the update operation.
func (su *SettingUpdate) Save(ctx context.Context) (int, error) {
	su.defaults()
	return withHooks(ctx, su.sqlSave, su.mutation, su.hooks)
}

// SaveX is like Save, but panics if an error occurs.
func (su *SettingUpdate) SaveX(ctx context.Context) int {
	affected, err := su.Save(ctx)
	if err != nil {
		panic(err)
	}
	return affected
}

// Exec executes the query.
func (su *SettingUpdate) Exec(ctx context.Context) error {
	_, err := su.Save(ctx)
	return err
}

// ExecX is like Exec, but panics if an error occurs.
func (su *SettingUpdate) ExecX(ctx context.Context) {
	if err := su.Exec(ctx); err != nil {
		panic(err)
	}
}

// defaults sets the default values of the builder before save.
func (su *SettingUpdate) defaults() {
	if _, ok := su.mutation.UpdatedAt(); !ok {
		v := setting.UpdateDefaultUpdatedAt()
		su.mutation.SetUpdatedAt(v)
	}
}

// Modify adds a statement modifier for attaching custom logic to the UPDATE statement.
func (su *SettingUpdate) Modify(modifiers ...func(u *sql.UpdateBuilder)) *SettingUpdate {
	su.modifiers = append(su.modifiers, modifiers...)
	return su
}

func (su *SettingUpdate) sqlSave(ctx context.Context) (n int, err error) {
	_spec := sqlgraph.NewUpdateSpec(setting.Table, setting.Columns, sqlgraph.NewFieldSpec(setting.FieldID, field.TypeUUID))
	if ps := su.mutation.predicates; len(ps) > 0 {
		_spec.Predicate = func(selector *sql.Selector) {
			for i := range ps {
				ps[i](selector)
			}
		}
	}
	if value, ok := su.mutation.EnableSSO(); ok {
		_spec.SetField(setting.FieldEnableSSO, field.TypeBool, value)
	}
	if value, ok := su.mutation.ForceTwoFactorAuth(); ok {
		_spec.SetField(setting.FieldForceTwoFactorAuth, field.TypeBool, value)
	}
	if value, ok := su.mutation.DisablePasswordLogin(); ok {
		_spec.SetField(setting.FieldDisablePasswordLogin, field.TypeBool, value)
	}
	if value, ok := su.mutation.EnableAutoLogin(); ok {
		_spec.SetField(setting.FieldEnableAutoLogin, field.TypeBool, value)
	}
	if value, ok := su.mutation.DingtalkOauth(); ok {
		_spec.SetField(setting.FieldDingtalkOauth, field.TypeJSON, value)
	}
	if su.mutation.DingtalkOauthCleared() {
		_spec.ClearField(setting.FieldDingtalkOauth, field.TypeJSON)
	}
	if value, ok := su.mutation.CustomOauth(); ok {
		_spec.SetField(setting.FieldCustomOauth, field.TypeJSON, value)
	}
	if su.mutation.CustomOauthCleared() {
		_spec.ClearField(setting.FieldCustomOauth, field.TypeJSON)
	}
	if value, ok := su.mutation.BaseURL(); ok {
		_spec.SetField(setting.FieldBaseURL, field.TypeString, value)
	}
	if su.mutation.BaseURLCleared() {
		_spec.ClearField(setting.FieldBaseURL, field.TypeString)
	}
	if value, ok := su.mutation.CreatedAt(); ok {
		_spec.SetField(setting.FieldCreatedAt, field.TypeTime, value)
	}
	if value, ok := su.mutation.UpdatedAt(); ok {
		_spec.SetField(setting.FieldUpdatedAt, field.TypeTime, value)
	}
	_spec.AddModifiers(su.modifiers...)
	if n, err = sqlgraph.UpdateNodes(ctx, su.driver, _spec); err != nil {
		if _, ok := err.(*sqlgraph.NotFoundError); ok {
			err = &NotFoundError{setting.Label}
		} else if sqlgraph.IsConstraintError(err) {
			err = &ConstraintError{msg: err.Error(), wrap: err}
		}
		return 0, err
	}
	su.mutation.done = true
	return n, nil
}

// SettingUpdateOne is the builder for updating a single Setting entity.
type SettingUpdateOne struct {
	config
	fields    []string
	hooks     []Hook
	mutation  *SettingMutation
	modifiers []func(*sql.UpdateBuilder)
}

// SetEnableSSO sets the "enable_sso" field.
func (suo *SettingUpdateOne) SetEnableSSO(b bool) *SettingUpdateOne {
	suo.mutation.SetEnableSSO(b)
	return suo
}

// SetNillableEnableSSO sets the "enable_sso" field if the given value is not nil.
func (suo *SettingUpdateOne) SetNillableEnableSSO(b *bool) *SettingUpdateOne {
	if b != nil {
		suo.SetEnableSSO(*b)
	}
	return suo
}

// SetForceTwoFactorAuth sets the "force_two_factor_auth" field.
func (suo *SettingUpdateOne) SetForceTwoFactorAuth(b bool) *SettingUpdateOne {
	suo.mutation.SetForceTwoFactorAuth(b)
	return suo
}

// SetNillableForceTwoFactorAuth sets the "force_two_factor_auth" field if the given value is not nil.
func (suo *SettingUpdateOne) SetNillableForceTwoFactorAuth(b *bool) *SettingUpdateOne {
	if b != nil {
		suo.SetForceTwoFactorAuth(*b)
	}
	return suo
}

// SetDisablePasswordLogin sets the "disable_password_login" field.
func (suo *SettingUpdateOne) SetDisablePasswordLogin(b bool) *SettingUpdateOne {
	suo.mutation.SetDisablePasswordLogin(b)
	return suo
}

// SetNillableDisablePasswordLogin sets the "disable_password_login" field if the given value is not nil.
func (suo *SettingUpdateOne) SetNillableDisablePasswordLogin(b *bool) *SettingUpdateOne {
	if b != nil {
		suo.SetDisablePasswordLogin(*b)
	}
	return suo
}

// SetEnableAutoLogin sets the "enable_auto_login" field.
func (suo *SettingUpdateOne) SetEnableAutoLogin(b bool) *SettingUpdateOne {
	suo.mutation.SetEnableAutoLogin(b)
	return suo
}

// SetNillableEnableAutoLogin sets the "enable_auto_login" field if the given value is not nil.
func (suo *SettingUpdateOne) SetNillableEnableAutoLogin(b *bool) *SettingUpdateOne {
	if b != nil {
		suo.SetEnableAutoLogin(*b)
	}
	return suo
}

// SetDingtalkOauth sets the "dingtalk_oauth" field.
func (suo *SettingUpdateOne) SetDingtalkOauth(to *types.DingtalkOAuth) *SettingUpdateOne {
	suo.mutation.SetDingtalkOauth(to)
	return suo
}

// ClearDingtalkOauth clears the value of the "dingtalk_oauth" field.
func (suo *SettingUpdateOne) ClearDingtalkOauth() *SettingUpdateOne {
	suo.mutation.ClearDingtalkOauth()
	return suo
}

// SetCustomOauth sets the "custom_oauth" field.
func (suo *SettingUpdateOne) SetCustomOauth(to *types.CustomOAuth) *SettingUpdateOne {
	suo.mutation.SetCustomOauth(to)
	return suo
}

// ClearCustomOauth clears the value of the "custom_oauth" field.
func (suo *SettingUpdateOne) ClearCustomOauth() *SettingUpdateOne {
	suo.mutation.ClearCustomOauth()
	return suo
}

// SetBaseURL sets the "base_url" field.
func (suo *SettingUpdateOne) SetBaseURL(s string) *SettingUpdateOne {
	suo.mutation.SetBaseURL(s)
	return suo
}

// SetNillableBaseURL sets the "base_url" field if the given value is not nil.
func (suo *SettingUpdateOne) SetNillableBaseURL(s *string) *SettingUpdateOne {
	if s != nil {
		suo.SetBaseURL(*s)
	}
	return suo
}

// ClearBaseURL clears the value of the "base_url" field.
func (suo *SettingUpdateOne) ClearBaseURL() *SettingUpdateOne {
	suo.mutation.ClearBaseURL()
	return suo
}

// SetCreatedAt sets the "created_at" field.
func (suo *SettingUpdateOne) SetCreatedAt(t time.Time) *SettingUpdateOne {
	suo.mutation.SetCreatedAt(t)
	return suo
}

// SetNillableCreatedAt sets the "created_at" field if the given value is not nil.
func (suo *SettingUpdateOne) SetNillableCreatedAt(t *time.Time) *SettingUpdateOne {
	if t != nil {
		suo.SetCreatedAt(*t)
	}
	return suo
}

// SetUpdatedAt sets the "updated_at" field.
func (suo *SettingUpdateOne) SetUpdatedAt(t time.Time) *SettingUpdateOne {
	suo.mutation.SetUpdatedAt(t)
	return suo
}

// Mutation returns the SettingMutation object of the builder.
func (suo *SettingUpdateOne) Mutation() *SettingMutation {
	return suo.mutation
}

// Where appends a list predicates to the SettingUpdate builder.
func (suo *SettingUpdateOne) Where(ps ...predicate.Setting) *SettingUpdateOne {
	suo.mutation.Where(ps...)
	return suo
}

// Select allows selecting one or more fields (columns) of the returned entity.
// The default is selecting all fields defined in the entity schema.
func (suo *SettingUpdateOne) Select(field string, fields ...string) *SettingUpdateOne {
	suo.fields = append([]string{field}, fields...)
	return suo
}

// Save executes the query and returns the updated Setting entity.
func (suo *SettingUpdateOne) Save(ctx context.Context) (*Setting, error) {
	suo.defaults()
	return withHooks(ctx, suo.sqlSave, suo.mutation, suo.hooks)
}

// SaveX is like Save, but panics if an error occurs.
func (suo *SettingUpdateOne) SaveX(ctx context.Context) *Setting {
	node, err := suo.Save(ctx)
	if err != nil {
		panic(err)
	}
	return node
}

// Exec executes the query on the entity.
func (suo *SettingUpdateOne) Exec(ctx context.Context) error {
	_, err := suo.Save(ctx)
	return err
}

// ExecX is like Exec, but panics if an error occurs.
func (suo *SettingUpdateOne) ExecX(ctx context.Context) {
	if err := suo.Exec(ctx); err != nil {
		panic(err)
	}
}

// defaults sets the default values of the builder before save.
func (suo *SettingUpdateOne) defaults() {
	if _, ok := suo.mutation.UpdatedAt(); !ok {
		v := setting.UpdateDefaultUpdatedAt()
		suo.mutation.SetUpdatedAt(v)
	}
}

// Modify adds a statement modifier for attaching custom logic to the UPDATE statement.
func (suo *SettingUpdateOne) Modify(modifiers ...func(u *sql.UpdateBuilder)) *SettingUpdateOne {
	suo.modifiers = append(suo.modifiers, modifiers...)
	return suo
}

func (suo *SettingUpdateOne) sqlSave(ctx context.Context) (_node *Setting, err error) {
	_spec := sqlgraph.NewUpdateSpec(setting.Table, setting.Columns, sqlgraph.NewFieldSpec(setting.FieldID, field.TypeUUID))
	id, ok := suo.mutation.ID()
	if !ok {
		return nil, &ValidationError{Name: "id", err: errors.New(`db: missing "Setting.id" for update`)}
	}
	_spec.Node.ID.Value = id
	if fields := suo.fields; len(fields) > 0 {
		_spec.Node.Columns = make([]string, 0, len(fields))
		_spec.Node.Columns = append(_spec.Node.Columns, setting.FieldID)
		for _, f := range fields {
			if !setting.ValidColumn(f) {
				return nil, &ValidationError{Name: f, err: fmt.Errorf("db: invalid field %q for query", f)}
			}
			if f != setting.FieldID {
				_spec.Node.Columns = append(_spec.Node.Columns, f)
			}
		}
	}
	if ps := suo.mutation.predicates; len(ps) > 0 {
		_spec.Predicate = func(selector *sql.Selector) {
			for i := range ps {
				ps[i](selector)
			}
		}
	}
	if value, ok := suo.mutation.EnableSSO(); ok {
		_spec.SetField(setting.FieldEnableSSO, field.TypeBool, value)
	}
	if value, ok := suo.mutation.ForceTwoFactorAuth(); ok {
		_spec.SetField(setting.FieldForceTwoFactorAuth, field.TypeBool, value)
	}
	if value, ok := suo.mutation.DisablePasswordLogin(); ok {
		_spec.SetField(setting.FieldDisablePasswordLogin, field.TypeBool, value)
	}
	if value, ok := suo.mutation.EnableAutoLogin(); ok {
		_spec.SetField(setting.FieldEnableAutoLogin, field.TypeBool, value)
	}
	if value, ok := suo.mutation.DingtalkOauth(); ok {
		_spec.SetField(setting.FieldDingtalkOauth, field.TypeJSON, value)
	}
	if suo.mutation.DingtalkOauthCleared() {
		_spec.ClearField(setting.FieldDingtalkOauth, field.TypeJSON)
	}
	if value, ok := suo.mutation.CustomOauth(); ok {
		_spec.SetField(setting.FieldCustomOauth, field.TypeJSON, value)
	}
	if suo.mutation.CustomOauthCleared() {
		_spec.ClearField(setting.FieldCustomOauth, field.TypeJSON)
	}
	if value, ok := suo.mutation.BaseURL(); ok {
		_spec.SetField(setting.FieldBaseURL, field.TypeString, value)
	}
	if suo.mutation.BaseURLCleared() {
		_spec.ClearField(setting.FieldBaseURL, field.TypeString)
	}
	if value, ok := suo.mutation.CreatedAt(); ok {
		_spec.SetField(setting.FieldCreatedAt, field.TypeTime, value)
	}
	if value, ok := suo.mutation.UpdatedAt(); ok {
		_spec.SetField(setting.FieldUpdatedAt, field.TypeTime, value)
	}
	_spec.AddModifiers(suo.modifiers...)
	_node = &Setting{config: suo.config}
	_spec.Assign = _node.assignValues
	_spec.ScanValues = _node.scanValues
	if err = sqlgraph.UpdateNode(ctx, suo.driver, _spec); err != nil {
		if _, ok := err.(*sqlgraph.NotFoundError); ok {
			err = &NotFoundError{setting.Label}
		} else if sqlgraph.IsConstraintError(err) {
			err = &ConstraintError{msg: err.Error(), wrap: err}
		}
		return nil, err
	}
	suo.mutation.done = true
	return _node, nil
}
