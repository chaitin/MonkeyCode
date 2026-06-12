import TeamManagerHosts from "./hosts"
import TeamManagerImages from "./images"
import TeamManagerModels from "./models"
import TeamManagerOIDC from "./oidc"

export default function TeamManagerSettings() {
  return (
    <div className="flex w-full flex-col gap-4">
      <TeamManagerHosts />
      <TeamManagerImages />
      <TeamManagerModels />
      <TeamManagerOIDC />
    </div>
  )
}
