import { Navigate, useSearchParams } from "react-router-dom";

const PublicTaskPage = () => {
  const [searchParams] = useSearchParams()
  const taskId = searchParams.get('id')
  if (!taskId) {
    return <Navigate to="/" replace />
  }
  return <Navigate to={`/console/task/${taskId}`} replace />
}

export default PublicTaskPage
