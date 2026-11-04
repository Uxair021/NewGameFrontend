import { useEffect, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Music, Volume2, VolumeX, Waves, X } from "lucide-react";
import * as sound from "./sound/soundEngine";
import type { SoundSettings } from "./sound/soundEngine";

/**
 * The Sound key's popup, shared by every control bar (GameController, GameController2,
 * GameController3rd, SlotControlBar) and the game menu: three groups, each with a mute switch
 * and a volume slider — All Sound/Music (master), Music, and Sound (reels + effects). Settings
 * live in the sound engine (saved there), so they carry across games and reloads.
 *
 * Rendered `fixed` through a portal on document.body, like GameInfoPopup: the bars sit inside
 * CSS-scaled game cards, and a `fixed` popup inside a transformed parent would scale with it.
 */

/** Live sound settings — re-renders whenever they change (from this popup or anywhere else). */
export function useSoundSettings(): SoundSettings {
  return useSyncExternalStore(sound.subscribeSoundSettings, sound.getSoundSettings);
}

/** Nothing can be heard — what the Sound key's icon shows as "muted". */
export function isSilent(s: SoundSettings): boolean {
  const master = s.masterMuted || s.masterVolume === 0;
  const music = s.musicMuted || s.musicVolume === 0;
  const effects = s.soundMuted || s.soundVolume === 0;
  return master || (music && effects);
}

type Group = "master" | "music" | "sound";

const ROWS: { group: Group; label: string; hint: string; Icon: typeof Music }[] = [
  { group: "master", label: "All Sound / Music", hint: "Everything", Icon: Volume2 },
  { group: "music", label: "Music", hint: "Background music", Icon: Music },
  { group: "sound", label: "Sound", hint: "Reels & effects", Icon: Waves },
];

const KEYS: Record<Group, { volume: keyof SoundSettings; muted: keyof SoundSettings }> = {
  master: { volume: "masterVolume", muted: "masterMuted" },
  music: { volume: "musicVolume", muted: "musicMuted" },
  sound: { volume: "soundVolume", muted: "soundMuted" },
};

export function SoundSettingsPopup({ onClose }: { onClose: () => void }) {
  const settings = useSoundSettings();

  useEffect(() => {
    // Opening it is a real click — unlock audio so a slider change is heard straight away.
    sound.resumeAudio();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sound settings"
        className="w-full max-w-[440px] rounded-2xl border-2 border-[#d4a017] bg-[linear-gradient(180deg,#2a1206_0%,#120703_100%)] p-5 text-white shadow-[0_0_0_2px_#0a0102,0_20px_60px_rgba(0,0,0,.7),0_0_24px_rgba(255,179,0,.25)] sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="bg-[linear-gradient(180deg,#fff2b0_0%,#ffd700_50%,#c8890f_100%)] bg-clip-text text-[22px] font-black uppercase tracking-[0.12em] text-transparent sm:text-[26px]">
            Sound Settings
          </h2>
          <button
            type="button"
            aria-label="Close sound settings"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-[#d4a017]/60 text-[#ffe37a] transition-colors hover:bg-white/10"
          >
            <X size={20} strokeWidth={2.6} />
          </button>
        </div>

        <div className="space-y-3">
          {ROWS.map(({ group, label, hint, Icon }) => {
            const volume = settings[KEYS[group].volume] as number;
            const muted = settings[KEYS[group].muted] as boolean;
            const off = muted || volume === 0;
            // The music / sound rows can't be heard while All Sound/Music is off — show them dimmed.
            const masterOff = group !== "master" && (settings.masterMuted || settings.masterVolume === 0);
            const percent = Math.round(volume * 100);
            return (
              <div
                key={group}
                className={`rounded-xl border border-white/10 bg-black/30 px-3 py-3 transition-opacity sm:px-4 ${masterOff ? "opacity-50" : ""}`}
              >
                <div className="mb-2 flex items-center gap-3">
                  <Icon size={22} className="flex-none text-[#ffd700]" />
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="text-[16px] font-bold sm:text-[17px]">{label}</div>
                    <div className="text-[12px] text-white/50">{hint}</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!muted}
                    aria-label={`${label} ${muted ? "off" : "on"}`}
                    onClick={() => sound.updateSoundSettings({ [KEYS[group].muted]: !muted })}
                    className={`flex h-9 min-w-[64px] items-center justify-center gap-1 rounded-full border px-3 text-[13px] font-black uppercase tracking-wide transition-colors ${
                      muted
                        ? "border-white/20 bg-white/5 text-white/60 hover:bg-white/10"
                        : "border-[#ffd700] bg-[#ffd700]/15 text-[#ffe37a] hover:bg-[#ffd700]/25"
                    }`}
                  >
                    {muted ? <VolumeX size={16} strokeWidth={2.6} /> : <Volume2 size={16} strokeWidth={2.6} />}
                    {muted ? "Off" : "On"}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={percent}
                    aria-label={`${label} volume`}
                    onChange={(e) => {
                      const v = Number(e.target.value) / 100;
                      // Dragging up from 0 on a muted group turns it back on.
                      sound.updateSoundSettings(
                        muted && v > 0 ? { [KEYS[group].volume]: v, [KEYS[group].muted]: false } : { [KEYS[group].volume]: v }
                      );
                    }}
                    className={`h-2 flex-1 cursor-pointer ${off ? "accent-white/40" : "accent-[#ffd700]"}`}
                  />
                  <span className="w-11 text-right text-[14px] font-bold tabular-nums text-[#ffe37a]">{percent}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body
  );
}
