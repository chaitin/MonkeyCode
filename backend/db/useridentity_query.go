// Code generated by ent, DO NOT EDIT.

package db

import (
	"context"
	"fmt"
	"math"

	"entgo.io/ent"
	"entgo.io/ent/dialect"
	"entgo.io/ent/dialect/sql"
	"entgo.io/ent/dialect/sql/sqlgraph"
	"entgo.io/ent/schema/field"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/chaitin/MonkeyCode/backend/db/user"
	"github.com/chaitin/MonkeyCode/backend/db/useridentity"
	"github.com/google/uuid"
)

// UserIdentityQuery is the builder for querying UserIdentity entities.
type UserIdentityQuery struct {
	config
	ctx        *QueryContext
	order      []useridentity.OrderOption
	inters     []Interceptor
	predicates []predicate.UserIdentity
	withUser   *UserQuery
	modifiers  []func(*sql.Selector)
	// intermediate query (i.e. traversal path).
	sql  *sql.Selector
	path func(context.Context) (*sql.Selector, error)
}

// Where adds a new predicate for the UserIdentityQuery builder.
func (uiq *UserIdentityQuery) Where(ps ...predicate.UserIdentity) *UserIdentityQuery {
	uiq.predicates = append(uiq.predicates, ps...)
	return uiq
}

// Limit the number of records to be returned by this query.
func (uiq *UserIdentityQuery) Limit(limit int) *UserIdentityQuery {
	uiq.ctx.Limit = &limit
	return uiq
}

// Offset to start from.
func (uiq *UserIdentityQuery) Offset(offset int) *UserIdentityQuery {
	uiq.ctx.Offset = &offset
	return uiq
}

// Unique configures the query builder to filter duplicate records on query.
// By default, unique is set to true, and can be disabled using this method.
func (uiq *UserIdentityQuery) Unique(unique bool) *UserIdentityQuery {
	uiq.ctx.Unique = &unique
	return uiq
}

// Order specifies how the records should be ordered.
func (uiq *UserIdentityQuery) Order(o ...useridentity.OrderOption) *UserIdentityQuery {
	uiq.order = append(uiq.order, o...)
	return uiq
}

// QueryUser chains the current query on the "user" edge.
func (uiq *UserIdentityQuery) QueryUser() *UserQuery {
	query := (&UserClient{config: uiq.config}).Query()
	query.path = func(ctx context.Context) (fromU *sql.Selector, err error) {
		if err := uiq.prepareQuery(ctx); err != nil {
			return nil, err
		}
		selector := uiq.sqlQuery(ctx)
		if err := selector.Err(); err != nil {
			return nil, err
		}
		step := sqlgraph.NewStep(
			sqlgraph.From(useridentity.Table, useridentity.FieldID, selector),
			sqlgraph.To(user.Table, user.FieldID),
			sqlgraph.Edge(sqlgraph.M2O, true, useridentity.UserTable, useridentity.UserColumn),
		)
		fromU = sqlgraph.SetNeighbors(uiq.driver.Dialect(), step)
		return fromU, nil
	}
	return query
}

// First returns the first UserIdentity entity from the query.
// Returns a *NotFoundError when no UserIdentity was found.
func (uiq *UserIdentityQuery) First(ctx context.Context) (*UserIdentity, error) {
	nodes, err := uiq.Limit(1).All(setContextOp(ctx, uiq.ctx, ent.OpQueryFirst))
	if err != nil {
		return nil, err
	}
	if len(nodes) == 0 {
		return nil, &NotFoundError{useridentity.Label}
	}
	return nodes[0], nil
}

// FirstX is like First, but panics if an error occurs.
func (uiq *UserIdentityQuery) FirstX(ctx context.Context) *UserIdentity {
	node, err := uiq.First(ctx)
	if err != nil && !IsNotFound(err) {
		panic(err)
	}
	return node
}

// FirstID returns the first UserIdentity ID from the query.
// Returns a *NotFoundError when no UserIdentity ID was found.
func (uiq *UserIdentityQuery) FirstID(ctx context.Context) (id uuid.UUID, err error) {
	var ids []uuid.UUID
	if ids, err = uiq.Limit(1).IDs(setContextOp(ctx, uiq.ctx, ent.OpQueryFirstID)); err != nil {
		return
	}
	if len(ids) == 0 {
		err = &NotFoundError{useridentity.Label}
		return
	}
	return ids[0], nil
}

// FirstIDX is like FirstID, but panics if an error occurs.
func (uiq *UserIdentityQuery) FirstIDX(ctx context.Context) uuid.UUID {
	id, err := uiq.FirstID(ctx)
	if err != nil && !IsNotFound(err) {
		panic(err)
	}
	return id
}

// Only returns a single UserIdentity entity found by the query, ensuring it only returns one.
// Returns a *NotSingularError when more than one UserIdentity entity is found.
// Returns a *NotFoundError when no UserIdentity entities are found.
func (uiq *UserIdentityQuery) Only(ctx context.Context) (*UserIdentity, error) {
	nodes, err := uiq.Limit(2).All(setContextOp(ctx, uiq.ctx, ent.OpQueryOnly))
	if err != nil {
		return nil, err
	}
	switch len(nodes) {
	case 1:
		return nodes[0], nil
	case 0:
		return nil, &NotFoundError{useridentity.Label}
	default:
		return nil, &NotSingularError{useridentity.Label}
	}
}

// OnlyX is like Only, but panics if an error occurs.
func (uiq *UserIdentityQuery) OnlyX(ctx context.Context) *UserIdentity {
	node, err := uiq.Only(ctx)
	if err != nil {
		panic(err)
	}
	return node
}

// OnlyID is like Only, but returns the only UserIdentity ID in the query.
// Returns a *NotSingularError when more than one UserIdentity ID is found.
// Returns a *NotFoundError when no entities are found.
func (uiq *UserIdentityQuery) OnlyID(ctx context.Context) (id uuid.UUID, err error) {
	var ids []uuid.UUID
	if ids, err = uiq.Limit(2).IDs(setContextOp(ctx, uiq.ctx, ent.OpQueryOnlyID)); err != nil {
		return
	}
	switch len(ids) {
	case 1:
		id = ids[0]
	case 0:
		err = &NotFoundError{useridentity.Label}
	default:
		err = &NotSingularError{useridentity.Label}
	}
	return
}

// OnlyIDX is like OnlyID, but panics if an error occurs.
func (uiq *UserIdentityQuery) OnlyIDX(ctx context.Context) uuid.UUID {
	id, err := uiq.OnlyID(ctx)
	if err != nil {
		panic(err)
	}
	return id
}

// All executes the query and returns a list of UserIdentities.
func (uiq *UserIdentityQuery) All(ctx context.Context) ([]*UserIdentity, error) {
	ctx = setContextOp(ctx, uiq.ctx, ent.OpQueryAll)
	if err := uiq.prepareQuery(ctx); err != nil {
		return nil, err
	}
	qr := querierAll[[]*UserIdentity, *UserIdentityQuery]()
	return withInterceptors[[]*UserIdentity](ctx, uiq, qr, uiq.inters)
}

// AllX is like All, but panics if an error occurs.
func (uiq *UserIdentityQuery) AllX(ctx context.Context) []*UserIdentity {
	nodes, err := uiq.All(ctx)
	if err != nil {
		panic(err)
	}
	return nodes
}

// IDs executes the query and returns a list of UserIdentity IDs.
func (uiq *UserIdentityQuery) IDs(ctx context.Context) (ids []uuid.UUID, err error) {
	if uiq.ctx.Unique == nil && uiq.path != nil {
		uiq.Unique(true)
	}
	ctx = setContextOp(ctx, uiq.ctx, ent.OpQueryIDs)
	if err = uiq.Select(useridentity.FieldID).Scan(ctx, &ids); err != nil {
		return nil, err
	}
	return ids, nil
}

// IDsX is like IDs, but panics if an error occurs.
func (uiq *UserIdentityQuery) IDsX(ctx context.Context) []uuid.UUID {
	ids, err := uiq.IDs(ctx)
	if err != nil {
		panic(err)
	}
	return ids
}

// Count returns the count of the given query.
func (uiq *UserIdentityQuery) Count(ctx context.Context) (int, error) {
	ctx = setContextOp(ctx, uiq.ctx, ent.OpQueryCount)
	if err := uiq.prepareQuery(ctx); err != nil {
		return 0, err
	}
	return withInterceptors[int](ctx, uiq, querierCount[*UserIdentityQuery](), uiq.inters)
}

// CountX is like Count, but panics if an error occurs.
func (uiq *UserIdentityQuery) CountX(ctx context.Context) int {
	count, err := uiq.Count(ctx)
	if err != nil {
		panic(err)
	}
	return count
}

// Exist returns true if the query has elements in the graph.
func (uiq *UserIdentityQuery) Exist(ctx context.Context) (bool, error) {
	ctx = setContextOp(ctx, uiq.ctx, ent.OpQueryExist)
	switch _, err := uiq.FirstID(ctx); {
	case IsNotFound(err):
		return false, nil
	case err != nil:
		return false, fmt.Errorf("db: check existence: %w", err)
	default:
		return true, nil
	}
}

// ExistX is like Exist, but panics if an error occurs.
func (uiq *UserIdentityQuery) ExistX(ctx context.Context) bool {
	exist, err := uiq.Exist(ctx)
	if err != nil {
		panic(err)
	}
	return exist
}

// Clone returns a duplicate of the UserIdentityQuery builder, including all associated steps. It can be
// used to prepare common query builders and use them differently after the clone is made.
func (uiq *UserIdentityQuery) Clone() *UserIdentityQuery {
	if uiq == nil {
		return nil
	}
	return &UserIdentityQuery{
		config:     uiq.config,
		ctx:        uiq.ctx.Clone(),
		order:      append([]useridentity.OrderOption{}, uiq.order...),
		inters:     append([]Interceptor{}, uiq.inters...),
		predicates: append([]predicate.UserIdentity{}, uiq.predicates...),
		withUser:   uiq.withUser.Clone(),
		// clone intermediate query.
		sql:       uiq.sql.Clone(),
		path:      uiq.path,
		modifiers: append([]func(*sql.Selector){}, uiq.modifiers...),
	}
}

// WithUser tells the query-builder to eager-load the nodes that are connected to
// the "user" edge. The optional arguments are used to configure the query builder of the edge.
func (uiq *UserIdentityQuery) WithUser(opts ...func(*UserQuery)) *UserIdentityQuery {
	query := (&UserClient{config: uiq.config}).Query()
	for _, opt := range opts {
		opt(query)
	}
	uiq.withUser = query
	return uiq
}

// GroupBy is used to group vertices by one or more fields/columns.
// It is often used with aggregate functions, like: count, max, mean, min, sum.
//
// Example:
//
//	var v []struct {
//		DeletedAt time.Time `json:"deleted_at,omitempty"`
//		Count int `json:"count,omitempty"`
//	}
//
//	client.UserIdentity.Query().
//		GroupBy(useridentity.FieldDeletedAt).
//		Aggregate(db.Count()).
//		Scan(ctx, &v)
func (uiq *UserIdentityQuery) GroupBy(field string, fields ...string) *UserIdentityGroupBy {
	uiq.ctx.Fields = append([]string{field}, fields...)
	grbuild := &UserIdentityGroupBy{build: uiq}
	grbuild.flds = &uiq.ctx.Fields
	grbuild.label = useridentity.Label
	grbuild.scan = grbuild.Scan
	return grbuild
}

// Select allows the selection one or more fields/columns for the given query,
// instead of selecting all fields in the entity.
//
// Example:
//
//	var v []struct {
//		DeletedAt time.Time `json:"deleted_at,omitempty"`
//	}
//
//	client.UserIdentity.Query().
//		Select(useridentity.FieldDeletedAt).
//		Scan(ctx, &v)
func (uiq *UserIdentityQuery) Select(fields ...string) *UserIdentitySelect {
	uiq.ctx.Fields = append(uiq.ctx.Fields, fields...)
	sbuild := &UserIdentitySelect{UserIdentityQuery: uiq}
	sbuild.label = useridentity.Label
	sbuild.flds, sbuild.scan = &uiq.ctx.Fields, sbuild.Scan
	return sbuild
}

// Aggregate returns a UserIdentitySelect configured with the given aggregations.
func (uiq *UserIdentityQuery) Aggregate(fns ...AggregateFunc) *UserIdentitySelect {
	return uiq.Select().Aggregate(fns...)
}

func (uiq *UserIdentityQuery) prepareQuery(ctx context.Context) error {
	for _, inter := range uiq.inters {
		if inter == nil {
			return fmt.Errorf("db: uninitialized interceptor (forgotten import db/runtime?)")
		}
		if trv, ok := inter.(Traverser); ok {
			if err := trv.Traverse(ctx, uiq); err != nil {
				return err
			}
		}
	}
	for _, f := range uiq.ctx.Fields {
		if !useridentity.ValidColumn(f) {
			return &ValidationError{Name: f, err: fmt.Errorf("db: invalid field %q for query", f)}
		}
	}
	if uiq.path != nil {
		prev, err := uiq.path(ctx)
		if err != nil {
			return err
		}
		uiq.sql = prev
	}
	return nil
}

func (uiq *UserIdentityQuery) sqlAll(ctx context.Context, hooks ...queryHook) ([]*UserIdentity, error) {
	var (
		nodes       = []*UserIdentity{}
		_spec       = uiq.querySpec()
		loadedTypes = [1]bool{
			uiq.withUser != nil,
		}
	)
	_spec.ScanValues = func(columns []string) ([]any, error) {
		return (*UserIdentity).scanValues(nil, columns)
	}
	_spec.Assign = func(columns []string, values []any) error {
		node := &UserIdentity{config: uiq.config}
		nodes = append(nodes, node)
		node.Edges.loadedTypes = loadedTypes
		return node.assignValues(columns, values)
	}
	if len(uiq.modifiers) > 0 {
		_spec.Modifiers = uiq.modifiers
	}
	for i := range hooks {
		hooks[i](ctx, _spec)
	}
	if err := sqlgraph.QueryNodes(ctx, uiq.driver, _spec); err != nil {
		return nil, err
	}
	if len(nodes) == 0 {
		return nodes, nil
	}
	if query := uiq.withUser; query != nil {
		if err := uiq.loadUser(ctx, query, nodes, nil,
			func(n *UserIdentity, e *User) { n.Edges.User = e }); err != nil {
			return nil, err
		}
	}
	return nodes, nil
}

func (uiq *UserIdentityQuery) loadUser(ctx context.Context, query *UserQuery, nodes []*UserIdentity, init func(*UserIdentity), assign func(*UserIdentity, *User)) error {
	ids := make([]uuid.UUID, 0, len(nodes))
	nodeids := make(map[uuid.UUID][]*UserIdentity)
	for i := range nodes {
		fk := nodes[i].UserID
		if _, ok := nodeids[fk]; !ok {
			ids = append(ids, fk)
		}
		nodeids[fk] = append(nodeids[fk], nodes[i])
	}
	if len(ids) == 0 {
		return nil
	}
	query.Where(user.IDIn(ids...))
	neighbors, err := query.All(ctx)
	if err != nil {
		return err
	}
	for _, n := range neighbors {
		nodes, ok := nodeids[n.ID]
		if !ok {
			return fmt.Errorf(`unexpected foreign-key "user_id" returned %v`, n.ID)
		}
		for i := range nodes {
			assign(nodes[i], n)
		}
	}
	return nil
}

func (uiq *UserIdentityQuery) sqlCount(ctx context.Context) (int, error) {
	_spec := uiq.querySpec()
	if len(uiq.modifiers) > 0 {
		_spec.Modifiers = uiq.modifiers
	}
	_spec.Node.Columns = uiq.ctx.Fields
	if len(uiq.ctx.Fields) > 0 {
		_spec.Unique = uiq.ctx.Unique != nil && *uiq.ctx.Unique
	}
	return sqlgraph.CountNodes(ctx, uiq.driver, _spec)
}

func (uiq *UserIdentityQuery) querySpec() *sqlgraph.QuerySpec {
	_spec := sqlgraph.NewQuerySpec(useridentity.Table, useridentity.Columns, sqlgraph.NewFieldSpec(useridentity.FieldID, field.TypeUUID))
	_spec.From = uiq.sql
	if unique := uiq.ctx.Unique; unique != nil {
		_spec.Unique = *unique
	} else if uiq.path != nil {
		_spec.Unique = true
	}
	if fields := uiq.ctx.Fields; len(fields) > 0 {
		_spec.Node.Columns = make([]string, 0, len(fields))
		_spec.Node.Columns = append(_spec.Node.Columns, useridentity.FieldID)
		for i := range fields {
			if fields[i] != useridentity.FieldID {
				_spec.Node.Columns = append(_spec.Node.Columns, fields[i])
			}
		}
		if uiq.withUser != nil {
			_spec.Node.AddColumnOnce(useridentity.FieldUserID)
		}
	}
	if ps := uiq.predicates; len(ps) > 0 {
		_spec.Predicate = func(selector *sql.Selector) {
			for i := range ps {
				ps[i](selector)
			}
		}
	}
	if limit := uiq.ctx.Limit; limit != nil {
		_spec.Limit = *limit
	}
	if offset := uiq.ctx.Offset; offset != nil {
		_spec.Offset = *offset
	}
	if ps := uiq.order; len(ps) > 0 {
		_spec.Order = func(selector *sql.Selector) {
			for i := range ps {
				ps[i](selector)
			}
		}
	}
	return _spec
}

func (uiq *UserIdentityQuery) sqlQuery(ctx context.Context) *sql.Selector {
	builder := sql.Dialect(uiq.driver.Dialect())
	t1 := builder.Table(useridentity.Table)
	columns := uiq.ctx.Fields
	if len(columns) == 0 {
		columns = useridentity.Columns
	}
	selector := builder.Select(t1.Columns(columns...)...).From(t1)
	if uiq.sql != nil {
		selector = uiq.sql
		selector.Select(selector.Columns(columns...)...)
	}
	if uiq.ctx.Unique != nil && *uiq.ctx.Unique {
		selector.Distinct()
	}
	for _, m := range uiq.modifiers {
		m(selector)
	}
	for _, p := range uiq.predicates {
		p(selector)
	}
	for _, p := range uiq.order {
		p(selector)
	}
	if offset := uiq.ctx.Offset; offset != nil {
		// limit is mandatory for offset clause. We start
		// with default value, and override it below if needed.
		selector.Offset(*offset).Limit(math.MaxInt32)
	}
	if limit := uiq.ctx.Limit; limit != nil {
		selector.Limit(*limit)
	}
	return selector
}

// ForUpdate locks the selected rows against concurrent updates, and prevent them from being
// updated, deleted or "selected ... for update" by other sessions, until the transaction is
// either committed or rolled-back.
func (uiq *UserIdentityQuery) ForUpdate(opts ...sql.LockOption) *UserIdentityQuery {
	if uiq.driver.Dialect() == dialect.Postgres {
		uiq.Unique(false)
	}
	uiq.modifiers = append(uiq.modifiers, func(s *sql.Selector) {
		s.ForUpdate(opts...)
	})
	return uiq
}

// ForShare behaves similarly to ForUpdate, except that it acquires a shared mode lock
// on any rows that are read. Other sessions can read the rows, but cannot modify them
// until your transaction commits.
func (uiq *UserIdentityQuery) ForShare(opts ...sql.LockOption) *UserIdentityQuery {
	if uiq.driver.Dialect() == dialect.Postgres {
		uiq.Unique(false)
	}
	uiq.modifiers = append(uiq.modifiers, func(s *sql.Selector) {
		s.ForShare(opts...)
	})
	return uiq
}

// Modify adds a query modifier for attaching custom logic to queries.
func (uiq *UserIdentityQuery) Modify(modifiers ...func(s *sql.Selector)) *UserIdentitySelect {
	uiq.modifiers = append(uiq.modifiers, modifiers...)
	return uiq.Select()
}

// UserIdentityGroupBy is the group-by builder for UserIdentity entities.
type UserIdentityGroupBy struct {
	selector
	build *UserIdentityQuery
}

// Aggregate adds the given aggregation functions to the group-by query.
func (uigb *UserIdentityGroupBy) Aggregate(fns ...AggregateFunc) *UserIdentityGroupBy {
	uigb.fns = append(uigb.fns, fns...)
	return uigb
}

// Scan applies the selector query and scans the result into the given value.
func (uigb *UserIdentityGroupBy) Scan(ctx context.Context, v any) error {
	ctx = setContextOp(ctx, uigb.build.ctx, ent.OpQueryGroupBy)
	if err := uigb.build.prepareQuery(ctx); err != nil {
		return err
	}
	return scanWithInterceptors[*UserIdentityQuery, *UserIdentityGroupBy](ctx, uigb.build, uigb, uigb.build.inters, v)
}

func (uigb *UserIdentityGroupBy) sqlScan(ctx context.Context, root *UserIdentityQuery, v any) error {
	selector := root.sqlQuery(ctx).Select()
	aggregation := make([]string, 0, len(uigb.fns))
	for _, fn := range uigb.fns {
		aggregation = append(aggregation, fn(selector))
	}
	if len(selector.SelectedColumns()) == 0 {
		columns := make([]string, 0, len(*uigb.flds)+len(uigb.fns))
		for _, f := range *uigb.flds {
			columns = append(columns, selector.C(f))
		}
		columns = append(columns, aggregation...)
		selector.Select(columns...)
	}
	selector.GroupBy(selector.Columns(*uigb.flds...)...)
	if err := selector.Err(); err != nil {
		return err
	}
	rows := &sql.Rows{}
	query, args := selector.Query()
	if err := uigb.build.driver.Query(ctx, query, args, rows); err != nil {
		return err
	}
	defer rows.Close()
	return sql.ScanSlice(rows, v)
}

// UserIdentitySelect is the builder for selecting fields of UserIdentity entities.
type UserIdentitySelect struct {
	*UserIdentityQuery
	selector
}

// Aggregate adds the given aggregation functions to the selector query.
func (uis *UserIdentitySelect) Aggregate(fns ...AggregateFunc) *UserIdentitySelect {
	uis.fns = append(uis.fns, fns...)
	return uis
}

// Scan applies the selector query and scans the result into the given value.
func (uis *UserIdentitySelect) Scan(ctx context.Context, v any) error {
	ctx = setContextOp(ctx, uis.ctx, ent.OpQuerySelect)
	if err := uis.prepareQuery(ctx); err != nil {
		return err
	}
	return scanWithInterceptors[*UserIdentityQuery, *UserIdentitySelect](ctx, uis.UserIdentityQuery, uis, uis.inters, v)
}

func (uis *UserIdentitySelect) sqlScan(ctx context.Context, root *UserIdentityQuery, v any) error {
	selector := root.sqlQuery(ctx)
	aggregation := make([]string, 0, len(uis.fns))
	for _, fn := range uis.fns {
		aggregation = append(aggregation, fn(selector))
	}
	switch n := len(*uis.selector.flds); {
	case n == 0 && len(aggregation) > 0:
		selector.Select(aggregation...)
	case n != 0 && len(aggregation) > 0:
		selector.AppendSelect(aggregation...)
	}
	rows := &sql.Rows{}
	query, args := selector.Query()
	if err := uis.driver.Query(ctx, query, args, rows); err != nil {
		return err
	}
	defer rows.Close()
	return sql.ScanSlice(rows, v)
}

// Modify adds a query modifier for attaching custom logic to queries.
func (uis *UserIdentitySelect) Modify(modifiers ...func(s *sql.Selector)) *UserIdentitySelect {
	uis.modifiers = append(uis.modifiers, modifiers...)
	return uis
}
