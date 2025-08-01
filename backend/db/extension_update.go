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
	"github.com/chaitin/MonkeyCode/backend/db/extension"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
)

// ExtensionUpdate is the builder for updating Extension entities.
type ExtensionUpdate struct {
	config
	hooks     []Hook
	mutation  *ExtensionMutation
	modifiers []func(*sql.UpdateBuilder)
}

// Where appends a list predicates to the ExtensionUpdate builder.
func (eu *ExtensionUpdate) Where(ps ...predicate.Extension) *ExtensionUpdate {
	eu.mutation.Where(ps...)
	return eu
}

// SetVersion sets the "version" field.
func (eu *ExtensionUpdate) SetVersion(s string) *ExtensionUpdate {
	eu.mutation.SetVersion(s)
	return eu
}

// SetNillableVersion sets the "version" field if the given value is not nil.
func (eu *ExtensionUpdate) SetNillableVersion(s *string) *ExtensionUpdate {
	if s != nil {
		eu.SetVersion(*s)
	}
	return eu
}

// SetPath sets the "path" field.
func (eu *ExtensionUpdate) SetPath(s string) *ExtensionUpdate {
	eu.mutation.SetPath(s)
	return eu
}

// SetNillablePath sets the "path" field if the given value is not nil.
func (eu *ExtensionUpdate) SetNillablePath(s *string) *ExtensionUpdate {
	if s != nil {
		eu.SetPath(*s)
	}
	return eu
}

// SetCreatedAt sets the "created_at" field.
func (eu *ExtensionUpdate) SetCreatedAt(t time.Time) *ExtensionUpdate {
	eu.mutation.SetCreatedAt(t)
	return eu
}

// SetNillableCreatedAt sets the "created_at" field if the given value is not nil.
func (eu *ExtensionUpdate) SetNillableCreatedAt(t *time.Time) *ExtensionUpdate {
	if t != nil {
		eu.SetCreatedAt(*t)
	}
	return eu
}

// Mutation returns the ExtensionMutation object of the builder.
func (eu *ExtensionUpdate) Mutation() *ExtensionMutation {
	return eu.mutation
}

// Save executes the query and returns the number of nodes affected by the update operation.
func (eu *ExtensionUpdate) Save(ctx context.Context) (int, error) {
	return withHooks(ctx, eu.sqlSave, eu.mutation, eu.hooks)
}

// SaveX is like Save, but panics if an error occurs.
func (eu *ExtensionUpdate) SaveX(ctx context.Context) int {
	affected, err := eu.Save(ctx)
	if err != nil {
		panic(err)
	}
	return affected
}

// Exec executes the query.
func (eu *ExtensionUpdate) Exec(ctx context.Context) error {
	_, err := eu.Save(ctx)
	return err
}

// ExecX is like Exec, but panics if an error occurs.
func (eu *ExtensionUpdate) ExecX(ctx context.Context) {
	if err := eu.Exec(ctx); err != nil {
		panic(err)
	}
}

// Modify adds a statement modifier for attaching custom logic to the UPDATE statement.
func (eu *ExtensionUpdate) Modify(modifiers ...func(u *sql.UpdateBuilder)) *ExtensionUpdate {
	eu.modifiers = append(eu.modifiers, modifiers...)
	return eu
}

func (eu *ExtensionUpdate) sqlSave(ctx context.Context) (n int, err error) {
	_spec := sqlgraph.NewUpdateSpec(extension.Table, extension.Columns, sqlgraph.NewFieldSpec(extension.FieldID, field.TypeUUID))
	if ps := eu.mutation.predicates; len(ps) > 0 {
		_spec.Predicate = func(selector *sql.Selector) {
			for i := range ps {
				ps[i](selector)
			}
		}
	}
	if value, ok := eu.mutation.Version(); ok {
		_spec.SetField(extension.FieldVersion, field.TypeString, value)
	}
	if value, ok := eu.mutation.Path(); ok {
		_spec.SetField(extension.FieldPath, field.TypeString, value)
	}
	if value, ok := eu.mutation.CreatedAt(); ok {
		_spec.SetField(extension.FieldCreatedAt, field.TypeTime, value)
	}
	_spec.AddModifiers(eu.modifiers...)
	if n, err = sqlgraph.UpdateNodes(ctx, eu.driver, _spec); err != nil {
		if _, ok := err.(*sqlgraph.NotFoundError); ok {
			err = &NotFoundError{extension.Label}
		} else if sqlgraph.IsConstraintError(err) {
			err = &ConstraintError{msg: err.Error(), wrap: err}
		}
		return 0, err
	}
	eu.mutation.done = true
	return n, nil
}

// ExtensionUpdateOne is the builder for updating a single Extension entity.
type ExtensionUpdateOne struct {
	config
	fields    []string
	hooks     []Hook
	mutation  *ExtensionMutation
	modifiers []func(*sql.UpdateBuilder)
}

// SetVersion sets the "version" field.
func (euo *ExtensionUpdateOne) SetVersion(s string) *ExtensionUpdateOne {
	euo.mutation.SetVersion(s)
	return euo
}

// SetNillableVersion sets the "version" field if the given value is not nil.
func (euo *ExtensionUpdateOne) SetNillableVersion(s *string) *ExtensionUpdateOne {
	if s != nil {
		euo.SetVersion(*s)
	}
	return euo
}

// SetPath sets the "path" field.
func (euo *ExtensionUpdateOne) SetPath(s string) *ExtensionUpdateOne {
	euo.mutation.SetPath(s)
	return euo
}

// SetNillablePath sets the "path" field if the given value is not nil.
func (euo *ExtensionUpdateOne) SetNillablePath(s *string) *ExtensionUpdateOne {
	if s != nil {
		euo.SetPath(*s)
	}
	return euo
}

// SetCreatedAt sets the "created_at" field.
func (euo *ExtensionUpdateOne) SetCreatedAt(t time.Time) *ExtensionUpdateOne {
	euo.mutation.SetCreatedAt(t)
	return euo
}

// SetNillableCreatedAt sets the "created_at" field if the given value is not nil.
func (euo *ExtensionUpdateOne) SetNillableCreatedAt(t *time.Time) *ExtensionUpdateOne {
	if t != nil {
		euo.SetCreatedAt(*t)
	}
	return euo
}

// Mutation returns the ExtensionMutation object of the builder.
func (euo *ExtensionUpdateOne) Mutation() *ExtensionMutation {
	return euo.mutation
}

// Where appends a list predicates to the ExtensionUpdate builder.
func (euo *ExtensionUpdateOne) Where(ps ...predicate.Extension) *ExtensionUpdateOne {
	euo.mutation.Where(ps...)
	return euo
}

// Select allows selecting one or more fields (columns) of the returned entity.
// The default is selecting all fields defined in the entity schema.
func (euo *ExtensionUpdateOne) Select(field string, fields ...string) *ExtensionUpdateOne {
	euo.fields = append([]string{field}, fields...)
	return euo
}

// Save executes the query and returns the updated Extension entity.
func (euo *ExtensionUpdateOne) Save(ctx context.Context) (*Extension, error) {
	return withHooks(ctx, euo.sqlSave, euo.mutation, euo.hooks)
}

// SaveX is like Save, but panics if an error occurs.
func (euo *ExtensionUpdateOne) SaveX(ctx context.Context) *Extension {
	node, err := euo.Save(ctx)
	if err != nil {
		panic(err)
	}
	return node
}

// Exec executes the query on the entity.
func (euo *ExtensionUpdateOne) Exec(ctx context.Context) error {
	_, err := euo.Save(ctx)
	return err
}

// ExecX is like Exec, but panics if an error occurs.
func (euo *ExtensionUpdateOne) ExecX(ctx context.Context) {
	if err := euo.Exec(ctx); err != nil {
		panic(err)
	}
}

// Modify adds a statement modifier for attaching custom logic to the UPDATE statement.
func (euo *ExtensionUpdateOne) Modify(modifiers ...func(u *sql.UpdateBuilder)) *ExtensionUpdateOne {
	euo.modifiers = append(euo.modifiers, modifiers...)
	return euo
}

func (euo *ExtensionUpdateOne) sqlSave(ctx context.Context) (_node *Extension, err error) {
	_spec := sqlgraph.NewUpdateSpec(extension.Table, extension.Columns, sqlgraph.NewFieldSpec(extension.FieldID, field.TypeUUID))
	id, ok := euo.mutation.ID()
	if !ok {
		return nil, &ValidationError{Name: "id", err: errors.New(`db: missing "Extension.id" for update`)}
	}
	_spec.Node.ID.Value = id
	if fields := euo.fields; len(fields) > 0 {
		_spec.Node.Columns = make([]string, 0, len(fields))
		_spec.Node.Columns = append(_spec.Node.Columns, extension.FieldID)
		for _, f := range fields {
			if !extension.ValidColumn(f) {
				return nil, &ValidationError{Name: f, err: fmt.Errorf("db: invalid field %q for query", f)}
			}
			if f != extension.FieldID {
				_spec.Node.Columns = append(_spec.Node.Columns, f)
			}
		}
	}
	if ps := euo.mutation.predicates; len(ps) > 0 {
		_spec.Predicate = func(selector *sql.Selector) {
			for i := range ps {
				ps[i](selector)
			}
		}
	}
	if value, ok := euo.mutation.Version(); ok {
		_spec.SetField(extension.FieldVersion, field.TypeString, value)
	}
	if value, ok := euo.mutation.Path(); ok {
		_spec.SetField(extension.FieldPath, field.TypeString, value)
	}
	if value, ok := euo.mutation.CreatedAt(); ok {
		_spec.SetField(extension.FieldCreatedAt, field.TypeTime, value)
	}
	_spec.AddModifiers(euo.modifiers...)
	_node = &Extension{config: euo.config}
	_spec.Assign = _node.assignValues
	_spec.ScanValues = _node.scanValues
	if err = sqlgraph.UpdateNode(ctx, euo.driver, _spec); err != nil {
		if _, ok := err.(*sqlgraph.NotFoundError); ok {
			err = &NotFoundError{extension.Label}
		} else if sqlgraph.IsConstraintError(err) {
			err = &ConstraintError{msg: err.Error(), wrap: err}
		}
		return nil, err
	}
	euo.mutation.done = true
	return _node, nil
}
