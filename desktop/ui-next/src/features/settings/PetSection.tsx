import { useEffect, useRef, useState, type ReactNode } from "react";
import { preparePetAudio } from "@/lib/pet-audio-import";
import { useI18n } from "@/lib/i18n";
import { getSoundEnabled, onSoundEnabled, setSoundEnabled } from "@/lib/ipc/config";
import { inDesktopShell } from "@/lib/ipc/ipc";
import {
  activatePet, getPetPreferences, getPetWallet, onPetPreferences, onPetWalletInvalidated, previewPetSound,
  resetPetPosition, setPetEnabled, setPetPreferences, listPetSounds, importPetSound, removePetSound, onPetAudioError,
  type PetPreferencesPatch, type PetSettings, type PetSound, type PetWallet, type PetAudioAsset,
} from "@/lib/ipc/pet";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <div className="flex items-center justify-between gap-6 px-4 py-3">
    <div className="flex min-w-0 flex-col gap-0.5"><span className="text-sm font-medium">{label}</span>
      {hint && <span className="text-xs leading-relaxed text-base-content/50">{hint}</span>}</div>
    {children}
  </div>;
}

// 拖动期间只更新读数，松手/键盘完成后提交一次，避免音量拖动写几十次配置。
function Slider({ label, value, min = 0, max = 100, step = 1, disabled, onCommit }: {
  label: string; value: number; min?: number; max?: number; step?: number; disabled: boolean; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => { if (!disabled && !editing.current) setDraft(value); }, [value, disabled]);
  const commit = () => {
    if (!editing.current) return;
    editing.current = false;
    if (draft !== value) onCommit(draft);
  };
  return <div className="flex w-40 shrink-0 items-center gap-2">
    <input type="range" className="range range-xs" aria-label={label} min={min} max={max} step={step}
      value={draft} disabled={disabled} onPointerDown={() => { editing.current = true; }}
      onChange={e => { editing.current = true; setDraft(Number(e.target.value)); }}
      onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
    <output className="w-10 shrink-0 text-right font-mono text-xs tabular-nums">{draft}%</output>
  </div>;
}

const clockText = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const clockValue = (text: string) => { const [h, m] = text.split(":").map(Number); return (h ?? 0) * 60 + (m ?? 0); };

function Toggle({ label, checked, disabled, onChange }: {
  label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void;
}) {
  return <input type="checkbox" className="toggle toggle-sm" aria-label={label} checked={checked} disabled={disabled}
    onChange={e => onChange(e.target.checked)} />;
}

function NumberInput({ label, value, min, max, disabled, onChange }: {
  label: string; value: number; min: number; max: number; disabled: boolean; onChange: (v: number) => void;
}) {
  return <input key={`${label}:${value}`} type="number" className="input input-sm w-24" aria-label={label} defaultValue={value}
    min={min} max={max} disabled={disabled} onBlur={e => {
      const next = Number(e.target.value);
      if (!e.target.value || !Number.isInteger(next) || next < min || next > max) { e.target.value = String(value); return; }
      if (next !== value) onChange(next);
    }} onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

export function PetSection() {
  const { t } = useI18n();
  const [settings, setSettings] = useState<PetSettings | null>(null);
  const [wallet, setWallet] = useState<PetWallet | null>(null);
  const [sound, setSound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<PetAudioAsset[]>([]);
  const importInput = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(true);
  const walletRevision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    if (!inDesktopShell()) return;
    let alive = true;
    let revision = 0;
    const off = onPetPreferences(v => { revision++; if (mounted.current) setSettings(v); });
    const offSound = onSoundEnabled(v => { if (mounted.current) setSound(v); });
    const offAudio = onPetAudioError(message => { if (alive) setError(message); });
    void listPetSounds().then(value => { if (alive) setAssets(value || []); }).catch(e => { if (alive) setError(String(e)); });
    const version = revision;
    void getPetPreferences().then(v => { if (alive && revision === version) setSettings(v); })
      .catch(e => { if (alive) setError(String(e)); });
    const refreshWallet = () => {
      const version = ++walletRevision.current;
      setWallet(null);
      void getPetWallet().then(v => { if (alive && version === walletRevision.current) setWallet(v); }).catch(() => {});
    };
    const offWallet = onPetWalletInvalidated(refreshWallet);
    refreshWallet();
    void getSoundEnabled().then(v => { if (alive) setSound(v); }).catch(() => {});
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => { alive = false; mounted.current = false; off(); offSound(); offWallet(); offAudio(); window.clearInterval(timer); };
  }, []);
  const run = async (operation: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await operation(); } catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setBusy(false); }
  };
  const save = (patch: PetPreferencesPatch) => void run(async () => {
    const preferences = await setPetPreferences(patch);
    if (mounted.current) setSettings(old => old ? { ...old, preferences } : old);
  });
  if (!inDesktopShell()) return <p className="text-sm text-base-content/60">{t("settings.browserReadonly")}</p>;
  if (!settings) return <div role={error ? "alert" : "status"} className="text-sm">{error || t("pet.loading")}</div>;
  const p = settings.preferences;
  const fmt = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return <section aria-label={t("settings.nav.pet")} className="flex flex-col gap-4">
    <p className="text-xs leading-relaxed text-base-content/50">{t("pet.hint")}</p>
    {error && <div role="alert" className="alert alert-error alert-soft py-2 text-xs">{error}</div>}
    <div className="divide-y divide-base-300 rounded-box border border-base-300">
      <Row label={t("pet.visible")} hint={t("pet.visibleHint")}><Toggle label={t("pet.visible")} checked={settings.enabled} disabled={busy} onChange={enabled => void run(async () => {
        await setPetEnabled(enabled); if (mounted.current) setSettings(old => old ? { ...old, enabled } : old);
      })} /></Row>
      <Row label={t("pet.scale")}><Slider label={t("pet.scale")} value={p.scale} min={75} max={150} step={5} disabled={busy} onCommit={scale => save({ scale })} /></Row>
      <Row label={t("pet.snap")}><Toggle label={t("pet.snap")} checked={p.snap} disabled={busy} onChange={snap => save({ snap })} /></Row>
      <Row label={t("pet.bubble")}><select className="select select-sm w-40" aria-label={t("pet.bubble")} value={p.bubble} disabled={busy}
        onChange={e => save({ bubble: e.target.value as typeof p.bubble })}>
        {(["tasks", "quota", "credits", "none"] as const).map(v => <option key={v} value={v}>{t(`pet.bubble.${v}`)}</option>)}
      </select></Row>
      <Row label={t("pet.clickBubble")}><select className="select select-sm w-40" aria-label={t("pet.clickBubble")} value={p.click_bubble} disabled={busy}
        onChange={e => save({ click_bubble: e.target.value as typeof p.click_bubble })}>
        {(["credits", "greeting", "none"] as const).map(v => <option key={v} value={v}>{t(`pet.clickBubble.${v}`)}</option>)}
      </select></Row>
      <Row label={t("pet.bubbleSeconds")} hint={t("pet.bubbleSecondsHint")}><NumberInput label={t("pet.bubbleSeconds")} value={p.bubble_seconds} min={0} max={60} disabled={busy} onChange={bubble_seconds => save({ bubble_seconds })} /></Row>
      <Row label={t("pet.position")}><button className="btn btn-sm" disabled={busy} onClick={() => void run(resetPetPosition)}>{t("pet.resetPosition")}</button></Row>
    </div>

    <div className="divide-y divide-base-300 rounded-box border border-base-300">
      <Row label={t("pet.account")} hint={wallet?.status === "signed_out" ? t("pet.signIn") : wallet?.stale || wallet?.status === "unavailable" ? t("pet.stale") : t("pet.accountHint")}>
        <button className="btn btn-ghost btn-sm shrink-0" disabled={busy} onClick={() => void run(async () => {
          const version = ++walletRevision.current;
          const v = await getPetWallet(true); if (mounted.current && version === walletRevision.current) setWallet(v);
        })}>{t("pet.refresh")}</button>
      </Row>
      <div className="flex flex-wrap gap-6 px-4 py-3 text-sm">
        <span>{t("pet.credits")} <strong className="font-mono tabular-nums">{fmt(wallet?.credits)}</strong></span>
        <span title={t("pet.usedHint")}>{t("pet.usedToday")} <strong className="font-mono tabular-nums">{fmt(wallet?.usage_day === Math.floor((now / 1000 + 28800) / 86400) ? wallet.used_today : null)}</strong></span>
        <span>{t("pet.remaining")} <strong className="font-mono tabular-nums">{fmt(wallet?.remaining)} / {fmt(wallet?.total)}</strong></span>
        {wallet?.updated_at ? <span className="text-xs text-base-content/50">{t("pet.updated", { time: new Date(wallet.updated_at).toLocaleTimeString() })}</span> : null}
        <button className="link text-xs" onClick={() => void run(() => activatePet("account"))}>{t("pet.openAccount")}</button>
      </div>
      <Row label={t("pet.alerts")}><Toggle label={t("pet.alerts")} checked={p.quota_alerts} disabled={busy} onChange={quota_alerts => save({ quota_alerts })} /></Row>
      {p.quota_alerts && <>
        <Row label={t("pet.warning")}><NumberInput label={t("pet.warning")} value={p.quota_warning} min={p.quota_critical + 1} max={100} disabled={busy} onChange={quota_warning => save({ quota_warning })} /></Row>
        <Row label={t("pet.critical")}><NumberInput label={t("pet.critical")} value={p.quota_critical} min={1} max={p.quota_warning - 1} disabled={busy} onChange={quota_critical => save({ quota_critical })} /></Row>
        <Row label={t("pet.creditWarning")} hint={t("pet.creditWarningHint")}><NumberInput label={t("pet.creditWarning")} value={p.credits_warning} min={0} max={1000000000} disabled={busy} onChange={credits_warning => save({ credits_warning })} /></Row>
      </>}
    </div>

    <div className="divide-y divide-base-300 rounded-box border border-base-300">
      <Row label={t("pet.soundMaster")}><Toggle label={t("pet.soundMaster")} checked={sound} disabled={busy} onChange={enabled => void run(async () => {
        await setSoundEnabled(enabled); if (mounted.current) setSound(enabled);
      })} /></Row>
      <Row label={t("pet.audioLibrary")} hint={t("pet.importHint")}>
        <input ref={importInput} type="file" className="hidden" aria-label={t("pet.importSound")} accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
          onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void run(async () => {
            const data = await preparePetAudio(file); await importPetSound(file.name, data);
            const next = await listPetSounds(); if (mounted.current) setAssets(next);
          }); }} />
        <button className="btn btn-sm shrink-0" disabled={busy} onClick={() => importInput.current?.click()}>{t("pet.importSound")}</button>
      </Row>
      {assets.length > 0 && <details className="px-4 py-3 text-xs"><summary className="cursor-pointer">{t("pet.importedSounds", { count: assets.length })}</summary>
        <div className="mt-2 flex flex-col gap-2">{assets.map(asset => <div key={asset.id} className="flex items-center justify-between gap-3">
          <span className="truncate" title={asset.name}>{asset.name}</span><button className="btn btn-ghost btn-xs shrink-0" disabled={busy || Object.values(p.sounds).some(s => s.source === `custom:${asset.id}`)}
            onClick={() => void run(async () => { await removePetSound(asset.id); const next = await listPetSounds(); if (mounted.current) setAssets(next); })}>{t("pet.removeSound")}</button>
        </div>)}</div></details>}
      {(["press", "release", "start", "end", "error", "approval", "question", "idle"] as PetSound[]).map(key => <Row key={key} label={t(`pet.sound.${key}`)}>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Toggle label={t(`pet.sound.${key}`)} checked={p.sounds[key].enabled} disabled={busy} onChange={enabled => save({ sounds: { [key]: { enabled } } })} />
          <select className="select select-sm w-36" aria-label={t("pet.sourceLabel", { event: t(`pet.sound.${key}`) })} value={p.sounds[key].source} disabled={busy}
            onChange={e => save({ sounds: { [key]: { source: e.target.value } } })}>
            {(["default", "soft", "toy", "bell"] as const).map(source => <option key={source} value={source}>{t(`pet.source.${source}`)}</option>)}
            {assets.map(asset => <option key={asset.id} value={`custom:${asset.id}`}>{asset.name}</option>)}
            {p.sounds[key].source?.startsWith("custom:") && !assets.some(a => `custom:${a.id}` === p.sounds[key].source) && <option value={p.sounds[key].source}>{t("pet.sourceMissing")}</option>}
          </select>
          <Slider label={t("pet.volume", { event: t(`pet.sound.${key}`) })} value={p.sounds[key].volume} disabled={busy} onCommit={volume => save({ sounds: { [key]: { volume } } })} />
          <button className="btn btn-ghost btn-xs" aria-label={t("pet.previewLabel", { event: t(`pet.sound.${key}`) })} disabled={busy || !sound || !p.sounds[key].enabled}
            onClick={() => void run(() => previewPetSound(key))}>{t("pet.preview")}</button>
        </div>
      </Row>)}
      <Row label={t("pet.quiet")} hint={t("pet.quietHint")}><Toggle label={t("pet.quiet")} checked={p.quiet_enabled} disabled={busy} onChange={quiet_enabled => save({ quiet_enabled })} /></Row>
      {p.quiet_enabled && <Row label={t("pet.quietTime")} hint={t("pet.quietTimeHint")}>
        <div className="flex items-center gap-2"><input type="time" className="input input-sm w-28" aria-label={t("pet.quietStart")} value={clockText(p.quiet_start)} disabled={busy}
          onChange={e => { if (e.target.value) save({ quiet_start: clockValue(e.target.value) }); }} />
          <span>–</span><input type="time" className="input input-sm w-28" aria-label={t("pet.quietEnd")} value={clockText(p.quiet_end)} disabled={busy}
          onChange={e => { if (e.target.value) save({ quiet_end: clockValue(e.target.value) }); }} /></div>
      </Row>}
      <Row label={p.muted_until > now ? t("pet.mutedUntil", { time: new Date(p.muted_until).toLocaleTimeString() }) : t("pet.temporaryQuiet")}>
        <button className="btn btn-sm" disabled={busy} onClick={() => save({ muted_until: p.muted_until > Date.now() ? 0 : Date.now() + 3600000 })}>
          {p.muted_until > now ? t("pet.unmute") : t("pet.muteHour")}
        </button>
      </Row>
    </div>
    <div className="flex justify-end"><button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => save(settings.defaults)}>{t("pet.restore")}</button></div>
  </section>;
}
