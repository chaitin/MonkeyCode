package preflight

func ReadSystem(dataDir string) *System { system, _ := systemInfo(dataDir); return system }
