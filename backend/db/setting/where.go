// Code generated by ent, DO NOT EDIT.

package setting

import (
	"time"

	"entgo.io/ent/dialect/sql"
	"github.com/chaitin/MonkeyCode/backend/db/predicate"
	"github.com/google/uuid"
)

// ID filters vertices based on their ID field.
func ID(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldID, id))
}

// IDEQ applies the EQ predicate on the ID field.
func IDEQ(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldID, id))
}

// IDNEQ applies the NEQ predicate on the ID field.
func IDNEQ(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldID, id))
}

// IDIn applies the In predicate on the ID field.
func IDIn(ids ...uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldIn(FieldID, ids...))
}

// IDNotIn applies the NotIn predicate on the ID field.
func IDNotIn(ids ...uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldNotIn(FieldID, ids...))
}

// IDGT applies the GT predicate on the ID field.
func IDGT(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldGT(FieldID, id))
}

// IDGTE applies the GTE predicate on the ID field.
func IDGTE(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldGTE(FieldID, id))
}

// IDLT applies the LT predicate on the ID field.
func IDLT(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldLT(FieldID, id))
}

// IDLTE applies the LTE predicate on the ID field.
func IDLTE(id uuid.UUID) predicate.Setting {
	return predicate.Setting(sql.FieldLTE(FieldID, id))
}

// EnableSSO applies equality check predicate on the "enable_sso" field. It's identical to EnableSSOEQ.
func EnableSSO(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldEnableSSO, v))
}

// ForceTwoFactorAuth applies equality check predicate on the "force_two_factor_auth" field. It's identical to ForceTwoFactorAuthEQ.
func ForceTwoFactorAuth(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldForceTwoFactorAuth, v))
}

// DisablePasswordLogin applies equality check predicate on the "disable_password_login" field. It's identical to DisablePasswordLoginEQ.
func DisablePasswordLogin(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldDisablePasswordLogin, v))
}

// EnableDingtalkOauth applies equality check predicate on the "enable_dingtalk_oauth" field. It's identical to EnableDingtalkOauthEQ.
func EnableDingtalkOauth(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldEnableDingtalkOauth, v))
}

// DingtalkClientID applies equality check predicate on the "dingtalk_client_id" field. It's identical to DingtalkClientIDEQ.
func DingtalkClientID(v string) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldDingtalkClientID, v))
}

// DingtalkClientSecret applies equality check predicate on the "dingtalk_client_secret" field. It's identical to DingtalkClientSecretEQ.
func DingtalkClientSecret(v string) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldDingtalkClientSecret, v))
}

// CreatedAt applies equality check predicate on the "created_at" field. It's identical to CreatedAtEQ.
func CreatedAt(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldCreatedAt, v))
}

// UpdatedAt applies equality check predicate on the "updated_at" field. It's identical to UpdatedAtEQ.
func UpdatedAt(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldUpdatedAt, v))
}

// EnableSSOEQ applies the EQ predicate on the "enable_sso" field.
func EnableSSOEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldEnableSSO, v))
}

// EnableSSONEQ applies the NEQ predicate on the "enable_sso" field.
func EnableSSONEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldEnableSSO, v))
}

// ForceTwoFactorAuthEQ applies the EQ predicate on the "force_two_factor_auth" field.
func ForceTwoFactorAuthEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldForceTwoFactorAuth, v))
}

// ForceTwoFactorAuthNEQ applies the NEQ predicate on the "force_two_factor_auth" field.
func ForceTwoFactorAuthNEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldForceTwoFactorAuth, v))
}

// DisablePasswordLoginEQ applies the EQ predicate on the "disable_password_login" field.
func DisablePasswordLoginEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldDisablePasswordLogin, v))
}

// DisablePasswordLoginNEQ applies the NEQ predicate on the "disable_password_login" field.
func DisablePasswordLoginNEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldDisablePasswordLogin, v))
}

// EnableDingtalkOauthEQ applies the EQ predicate on the "enable_dingtalk_oauth" field.
func EnableDingtalkOauthEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldEnableDingtalkOauth, v))
}

// EnableDingtalkOauthNEQ applies the NEQ predicate on the "enable_dingtalk_oauth" field.
func EnableDingtalkOauthNEQ(v bool) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldEnableDingtalkOauth, v))
}

// DingtalkClientIDEQ applies the EQ predicate on the "dingtalk_client_id" field.
func DingtalkClientIDEQ(v string) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldDingtalkClientID, v))
}

// DingtalkClientIDNEQ applies the NEQ predicate on the "dingtalk_client_id" field.
func DingtalkClientIDNEQ(v string) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldDingtalkClientID, v))
}

// DingtalkClientIDIn applies the In predicate on the "dingtalk_client_id" field.
func DingtalkClientIDIn(vs ...string) predicate.Setting {
	return predicate.Setting(sql.FieldIn(FieldDingtalkClientID, vs...))
}

// DingtalkClientIDNotIn applies the NotIn predicate on the "dingtalk_client_id" field.
func DingtalkClientIDNotIn(vs ...string) predicate.Setting {
	return predicate.Setting(sql.FieldNotIn(FieldDingtalkClientID, vs...))
}

// DingtalkClientIDGT applies the GT predicate on the "dingtalk_client_id" field.
func DingtalkClientIDGT(v string) predicate.Setting {
	return predicate.Setting(sql.FieldGT(FieldDingtalkClientID, v))
}

// DingtalkClientIDGTE applies the GTE predicate on the "dingtalk_client_id" field.
func DingtalkClientIDGTE(v string) predicate.Setting {
	return predicate.Setting(sql.FieldGTE(FieldDingtalkClientID, v))
}

// DingtalkClientIDLT applies the LT predicate on the "dingtalk_client_id" field.
func DingtalkClientIDLT(v string) predicate.Setting {
	return predicate.Setting(sql.FieldLT(FieldDingtalkClientID, v))
}

// DingtalkClientIDLTE applies the LTE predicate on the "dingtalk_client_id" field.
func DingtalkClientIDLTE(v string) predicate.Setting {
	return predicate.Setting(sql.FieldLTE(FieldDingtalkClientID, v))
}

// DingtalkClientIDContains applies the Contains predicate on the "dingtalk_client_id" field.
func DingtalkClientIDContains(v string) predicate.Setting {
	return predicate.Setting(sql.FieldContains(FieldDingtalkClientID, v))
}

// DingtalkClientIDHasPrefix applies the HasPrefix predicate on the "dingtalk_client_id" field.
func DingtalkClientIDHasPrefix(v string) predicate.Setting {
	return predicate.Setting(sql.FieldHasPrefix(FieldDingtalkClientID, v))
}

// DingtalkClientIDHasSuffix applies the HasSuffix predicate on the "dingtalk_client_id" field.
func DingtalkClientIDHasSuffix(v string) predicate.Setting {
	return predicate.Setting(sql.FieldHasSuffix(FieldDingtalkClientID, v))
}

// DingtalkClientIDIsNil applies the IsNil predicate on the "dingtalk_client_id" field.
func DingtalkClientIDIsNil() predicate.Setting {
	return predicate.Setting(sql.FieldIsNull(FieldDingtalkClientID))
}

// DingtalkClientIDNotNil applies the NotNil predicate on the "dingtalk_client_id" field.
func DingtalkClientIDNotNil() predicate.Setting {
	return predicate.Setting(sql.FieldNotNull(FieldDingtalkClientID))
}

// DingtalkClientIDEqualFold applies the EqualFold predicate on the "dingtalk_client_id" field.
func DingtalkClientIDEqualFold(v string) predicate.Setting {
	return predicate.Setting(sql.FieldEqualFold(FieldDingtalkClientID, v))
}

// DingtalkClientIDContainsFold applies the ContainsFold predicate on the "dingtalk_client_id" field.
func DingtalkClientIDContainsFold(v string) predicate.Setting {
	return predicate.Setting(sql.FieldContainsFold(FieldDingtalkClientID, v))
}

// DingtalkClientSecretEQ applies the EQ predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretEQ(v string) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretNEQ applies the NEQ predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretNEQ(v string) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretIn applies the In predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretIn(vs ...string) predicate.Setting {
	return predicate.Setting(sql.FieldIn(FieldDingtalkClientSecret, vs...))
}

// DingtalkClientSecretNotIn applies the NotIn predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretNotIn(vs ...string) predicate.Setting {
	return predicate.Setting(sql.FieldNotIn(FieldDingtalkClientSecret, vs...))
}

// DingtalkClientSecretGT applies the GT predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretGT(v string) predicate.Setting {
	return predicate.Setting(sql.FieldGT(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretGTE applies the GTE predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretGTE(v string) predicate.Setting {
	return predicate.Setting(sql.FieldGTE(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretLT applies the LT predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretLT(v string) predicate.Setting {
	return predicate.Setting(sql.FieldLT(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretLTE applies the LTE predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretLTE(v string) predicate.Setting {
	return predicate.Setting(sql.FieldLTE(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretContains applies the Contains predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretContains(v string) predicate.Setting {
	return predicate.Setting(sql.FieldContains(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretHasPrefix applies the HasPrefix predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretHasPrefix(v string) predicate.Setting {
	return predicate.Setting(sql.FieldHasPrefix(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretHasSuffix applies the HasSuffix predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretHasSuffix(v string) predicate.Setting {
	return predicate.Setting(sql.FieldHasSuffix(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretIsNil applies the IsNil predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretIsNil() predicate.Setting {
	return predicate.Setting(sql.FieldIsNull(FieldDingtalkClientSecret))
}

// DingtalkClientSecretNotNil applies the NotNil predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretNotNil() predicate.Setting {
	return predicate.Setting(sql.FieldNotNull(FieldDingtalkClientSecret))
}

// DingtalkClientSecretEqualFold applies the EqualFold predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretEqualFold(v string) predicate.Setting {
	return predicate.Setting(sql.FieldEqualFold(FieldDingtalkClientSecret, v))
}

// DingtalkClientSecretContainsFold applies the ContainsFold predicate on the "dingtalk_client_secret" field.
func DingtalkClientSecretContainsFold(v string) predicate.Setting {
	return predicate.Setting(sql.FieldContainsFold(FieldDingtalkClientSecret, v))
}

// CreatedAtEQ applies the EQ predicate on the "created_at" field.
func CreatedAtEQ(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldCreatedAt, v))
}

// CreatedAtNEQ applies the NEQ predicate on the "created_at" field.
func CreatedAtNEQ(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldCreatedAt, v))
}

// CreatedAtIn applies the In predicate on the "created_at" field.
func CreatedAtIn(vs ...time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldIn(FieldCreatedAt, vs...))
}

// CreatedAtNotIn applies the NotIn predicate on the "created_at" field.
func CreatedAtNotIn(vs ...time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldNotIn(FieldCreatedAt, vs...))
}

// CreatedAtGT applies the GT predicate on the "created_at" field.
func CreatedAtGT(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldGT(FieldCreatedAt, v))
}

// CreatedAtGTE applies the GTE predicate on the "created_at" field.
func CreatedAtGTE(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldGTE(FieldCreatedAt, v))
}

// CreatedAtLT applies the LT predicate on the "created_at" field.
func CreatedAtLT(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldLT(FieldCreatedAt, v))
}

// CreatedAtLTE applies the LTE predicate on the "created_at" field.
func CreatedAtLTE(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldLTE(FieldCreatedAt, v))
}

// UpdatedAtEQ applies the EQ predicate on the "updated_at" field.
func UpdatedAtEQ(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldEQ(FieldUpdatedAt, v))
}

// UpdatedAtNEQ applies the NEQ predicate on the "updated_at" field.
func UpdatedAtNEQ(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldNEQ(FieldUpdatedAt, v))
}

// UpdatedAtIn applies the In predicate on the "updated_at" field.
func UpdatedAtIn(vs ...time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldIn(FieldUpdatedAt, vs...))
}

// UpdatedAtNotIn applies the NotIn predicate on the "updated_at" field.
func UpdatedAtNotIn(vs ...time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldNotIn(FieldUpdatedAt, vs...))
}

// UpdatedAtGT applies the GT predicate on the "updated_at" field.
func UpdatedAtGT(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldGT(FieldUpdatedAt, v))
}

// UpdatedAtGTE applies the GTE predicate on the "updated_at" field.
func UpdatedAtGTE(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldGTE(FieldUpdatedAt, v))
}

// UpdatedAtLT applies the LT predicate on the "updated_at" field.
func UpdatedAtLT(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldLT(FieldUpdatedAt, v))
}

// UpdatedAtLTE applies the LTE predicate on the "updated_at" field.
func UpdatedAtLTE(v time.Time) predicate.Setting {
	return predicate.Setting(sql.FieldLTE(FieldUpdatedAt, v))
}

// And groups predicates with the AND operator between them.
func And(predicates ...predicate.Setting) predicate.Setting {
	return predicate.Setting(sql.AndPredicates(predicates...))
}

// Or groups predicates with the OR operator between them.
func Or(predicates ...predicate.Setting) predicate.Setting {
	return predicate.Setting(sql.OrPredicates(predicates...))
}

// Not applies the not operator on the given predicate.
func Not(p predicate.Setting) predicate.Setting {
	return predicate.Setting(sql.NotPredicates(p))
}
