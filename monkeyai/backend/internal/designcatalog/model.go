package designcatalog

import (
	"encoding/json"
	"os"
	"path/filepath"
)

const SchemaVersion = 1
const DigestSchema = "design-content-v1"

type SnapshotRef struct {
	PublisherID   string `json:"publisher_id"`
	ReleaseID     string `json:"release_id"`
	SchemaVersion int    `json:"schema_version"`
	DigestSchema  string `json:"digest_schema"`
}

type ArtifactRef struct {
	Path   string `json:"path"`
	SHA256 string `json:"sha256"`
}
type FileRef struct {
	Path   string  `json:"path"`
	SHA256 string  `json:"sha256"`
	Size   int64   `json:"size"`
	MIME   string  `json:"mime"`
	Role   *string `json:"role,omitempty"`
}
type Provenance struct {
	SourceID                string `json:"source_id"`
	UpstreamID              string `json:"upstream_id"`
	UpstreamDigest          string `json:"upstream_digest,omitempty"`
	UpstreamAssetSnapshotID string `json:"upstream_asset_snapshot_id,omitempty"`
	UpstreamURL             string `json:"upstream_url,omitempty"`
}
type Object struct {
	Key    string `json:"key"`
	SHA256 string `json:"sha256"`
	Size   int64  `json:"size"`
}
type Entry struct {
	Kind            string          `json:"kind"`
	ID              string          `json:"id"`
	Metadata        json.RawMessage `json:"metadata"`
	Files           []FileRef       `json:"files"`
	ContentDigest   string          `json:"content_digest"`
	Artifact        *ArtifactRef    `json:"artifact"`
	Provenance      json.RawMessage `json:"provenance,omitempty"`
	CatalogRank     *int64          `json:"catalog_rank,omitempty"`
	SourceSkillPath *string         `json:"source_skill_path"`
	Native          *Object         `json:"native,omitempty"`
	Export          json.RawMessage `json:"export,omitempty"`
}
type Term struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	LocalizedName map[string]string `json:"localizedName"`
	ParentID      string            `json:"parent_id,omitempty"`
	Count         int               `json:"count"`
	Provenance    json.RawMessage   `json:"provenance,omitempty"`
}
type ModeCategory struct {
	ModeID     string `json:"mode_id"`
	CategoryID string `json:"category_id"`
}
type ResourceCategory struct {
	Kind       string `json:"kind"`
	ID         string `json:"id"`
	ModeID     string `json:"mode_id"`
	CategoryID string `json:"category_id"`
}
type Taxonomy struct {
	Modes              []Term             `json:"modes"`
	Categories         []Term             `json:"categories"`
	ModeCategories     []ModeCategory     `json:"mode_categories"`
	ResourceCategories []ResourceCategory `json:"resource_categories"`
}
type Catalog struct {
	SnapshotRef
	Resources []Entry  `json:"resources"`
	Taxonomy  Taxonomy `json:"taxonomy"`
	Revision  string   `json:"revision,omitempty"`
}
type Package struct {
	SnapshotRef
	Entries  []Entry
	Taxonomy Taxonomy
	dir      string
	objects  map[string]string
}

func (p *Package) Close() error {
	if p == nil || p.dir == "" {
		return nil
	}
	return os.RemoveAll(p.dir)
}
func (p *Package) Entry(kind, id string) *Entry {
	for i := range p.Entries {
		if p.Entries[i].Kind == kind && p.Entries[i].ID == id {
			return &p.Entries[i]
		}
	}
	return nil
}
func (p *Package) Source(kind, id, path string) string {
	e := p.Entry(kind, id)
	if e != nil {
		for _, f := range e.Files {
			if f.Path == path {
				return p.objects[f.SHA256]
			}
		}
	}
	return ""
}
func (p *Package) objectPath(sha string) string { return filepath.Join(p.dir, sha[7:]) }

type Publisher struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Version string `json:"version"`
	URL     string `json:"url"`
}
type Release struct {
	Publisher      Publisher `json:"publisher"`
	ReleaseID      string    `json:"release_id"`
	Version        int64     `json:"version"`
	ManifestSHA256 string    `json:"manifest_sha256"`
}
type ManifestEntry struct {
	CatalogID     string   `json:"catalog_id"`
	Slug          string   `json:"slug"`
	Name          string   `json:"name"`
	Description   string   `json:"description"`
	ContentDigest string   `json:"content_digest"`
	Path          string   `json:"path"`
	SHA256        string   `json:"sha256"`
	Mode          string   `json:"mode"`
	Category      string   `json:"category"`
	Platform      string   `json:"platform"`
	Scenario      string   `json:"scenario"`
	Tags          []string `json:"tags"`
	TemplateKind  string   `json:"template_kind"`
	Downloadable  bool     `json:"downloadable"`
	HasSkill      bool     `json:"has_skill"`
	SkillPath     string   `json:"skill_path"`
	Context       string   `json:"context"`
	Title         string   `json:"title"`
	Variant       string   `json:"variant"`
	Recommended   bool     `json:"recommended"`
	Label         string   `json:"label"`
}
type DesignResources struct {
	SchemaVersion int             `json:"schema_version"`
	DigestSchema  string          `json:"digest_schema"`
	Taxonomy      *ArtifactRef    `json:"taxonomy"`
	Templates     []ManifestEntry `json:"templates"`
	DesignSystems []ManifestEntry `json:"design_systems"`
	Styles        []ManifestEntry `json:"styles"`
	Directions    []ManifestEntry `json:"directions"`
}
type Manifest struct {
	PublisherID     string          `json:"publisher_id"`
	ReleaseID       string          `json:"release_id"`
	Version         int64           `json:"version"`
	ManifestSHA256  string          `json:"manifest_sha256"`
	DesignResources DesignResources `json:"design_resources"`
}
