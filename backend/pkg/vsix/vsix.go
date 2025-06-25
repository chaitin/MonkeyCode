package vsix

import (
	"archive/zip"
	"html/template"
	"io"
)

func ChangeVsixEndpoint(vsixFile, target, endpoint string, w io.Writer) error {
	reader, err := zip.OpenReader(vsixFile)
	if err != nil {
		return err
	}
	defer reader.Close()

	newWriter := zip.NewWriter(w)
	defer newWriter.Close()

	for _, file := range reader.File {
		rc, err := file.Open()
		if err != nil {
			return err
		}
		defer rc.Close()

		if file.Name == target {
			writer, err := newWriter.Create(file.Name)
			if err != nil {
				return err
			}
			content, err := io.ReadAll(rc)
			if err != nil {
				return err
			}
			tmpl, err := template.New("package.json").Parse(string(content))
			if err != nil {
				return err
			}
			if err := tmpl.Execute(writer, map[string]any{
				"defaultEndpoint": endpoint,
			}); err != nil {
				return err
			}
		} else {
			writer, err := newWriter.Create(file.Name)
			if err != nil {
				return err
			}

			_, err = io.Copy(writer, rc)
			if err != nil {
				return err
			}
		}
	}

	err = newWriter.Close()
	if err != nil {
		return err
	}

	return nil
}
