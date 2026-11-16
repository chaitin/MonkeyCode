package worker

func (w *Worker) wireObservation(result Observation) Observation {
	if !w.protection {
		result.Protection = nil
		result.ObservedAt = nil
		if result.Phase == "protected" {
			result.Phase = "failed"
			result.Reason = "process_exited"
		}
	}
	return result
}
