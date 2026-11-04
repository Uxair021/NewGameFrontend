/**
 * Most sound effects are synthesized at runtime via the Web Audio API — no audio
 * files. The one exception is the reel-spin loop, which plays a recorded sample
 * from /public/Sound. The AudioContext is created lazily on first use — background
 * music's first use is the loading screen's onDone (not a user gesture), so it's created
 * suspended; `resumeAudio()` (called synchronously from a real click handler, e.g. SPIN)
 * is what actually unlocks playback, satisfying browsers' autoplay-requires-gesture policy.
 */

// Overall volume for everything (SFX + music) — the single knob to turn the whole game up/down.
const MASTER_VOLUME = 1;

// --- Player sound settings (the Sound key's popup — see shared/SoundSettings.tsx) -----------
// Three groups, each with its own volume (0–1) and mute:
//   master — "All Sound/Music": everything, on top of the two below;
//   music  — the background music;
//   sound  — reel sounds (spin loop, reel stops) and every other effect, plus the spoken voice.
// The graph: effects → soundGain → masterGain → speakers; music → musicGain (base level + ducking)
// → musicUserGain → masterGain. Saved in localStorage, so a choice carries across games and reloads.

export interface SoundSettings {
  masterVolume: number;
  masterMuted: boolean;
  musicVolume: number;
  musicMuted: boolean;
  soundVolume: number;
  soundMuted: boolean;
}

const SETTINGS_STORAGE_KEY = "texas-slots-sound-settings";
const DEFAULT_SETTINGS: SoundSettings = {
  masterVolume: 1,
  masterMuted: false,
  musicVolume: 1,
  musicMuted: false,
  soundVolume: 1,
  soundMuted: false,
};

function loadSettings(): SoundSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const saved = JSON.parse(raw) as Partial<SoundSettings>;
    const vol = (v: unknown, d: number) => (typeof v === "number" && v >= 0 && v <= 1 ? v : d);
    const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    return {
      masterVolume: vol(saved.masterVolume, DEFAULT_SETTINGS.masterVolume),
      masterMuted: flag(saved.masterMuted, DEFAULT_SETTINGS.masterMuted),
      musicVolume: vol(saved.musicVolume, DEFAULT_SETTINGS.musicVolume),
      musicMuted: flag(saved.musicMuted, DEFAULT_SETTINGS.musicMuted),
      soundVolume: vol(saved.soundVolume, DEFAULT_SETTINGS.soundVolume),
      soundMuted: flag(saved.soundMuted, DEFAULT_SETTINGS.soundMuted),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let settings: SoundSettings = loadSettings();
const settingsListeners = new Set<() => void>();

const masterLevel = () => (settings.masterMuted ? 0 : settings.masterVolume * MASTER_VOLUME);
const musicLevel = () => (settings.musicMuted ? 0 : settings.musicVolume);
const soundLevel = () => (settings.soundMuted ? 0 : settings.soundVolume);
/** Effects can't be heard at all — skip building them (and the spoken voice) entirely. */
const effectsSilent = () => masterLevel() === 0 || soundLevel() === 0;

/** Current sound settings (a stable object until the next change — safe for useSyncExternalStore). */
export function getSoundSettings(): SoundSettings {
  return settings;
}

/** Calls `listener` after every settings change; returns the unsubscribe function. */
export function subscribeSoundSettings(listener: () => void): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}

/** Changes some of the sound settings — applied to the playing audio at once and saved. */
export function updateSoundSettings(patch: Partial<SoundSettings>): void {
  settings = { ...settings, ...patch };
  applyLevels();
  if (effectsSilent()) {
    // Loops already playing would otherwise keep going (at zero volume) and the voice keeps talking.
    stopReelSpinLoop();
    stopBonusAlarmLoop();
    stopActiveAlarm?.();
    cancelSpeech();
  }
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* private browsing / storage disabled — the setting just won't persist */
  }
  settingsListeners.forEach((listener) => listener());
}

/** Pushes the current settings onto the gain nodes (short glide, so a slider drag doesn't click). */
function applyLevels(): void {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  masterGain?.gain.setTargetAtTime(masterLevel(), now, 0.02);
  soundGain?.gain.setTargetAtTime(soundLevel(), now, 0.02);
  musicUserGain?.gain.setTargetAtTime(musicLevel(), now, 0.02);
}

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
/** Every effect (reels included) goes through here — the "Sound" group's volume. */
let soundGain: GainNode | null = null;
/** The player's "Music" volume, after musicGain's own base level and ducking. */
let musicUserGain: GainNode | null = null;

function getContext(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterLevel();
    masterGain.connect(audioCtx.destination);
    soundGain = audioCtx.createGain();
    soundGain.gain.value = soundLevel();
    soundGain.connect(masterGain);
    musicUserGain = audioCtx.createGain();
    musicUserGain.gain.value = musicLevel();
    musicUserGain.connect(masterGain);
    // Fetch + decode the default spin sound now, so the very first spin doesn't start silent.
    loadReelSpinBuffer(audioCtx, DEFAULT_REEL_SPIN_SOUND_URL, DEFAULT_REEL_SPIN_SLICE).catch(() => {});
  }
  // Stays paused while the tab is in the background (see the visibilitychange handler below),
  // even if something tries to play a sound meanwhile.
  if (audioCtx.state === "suspended" && !document.hidden) audioCtx.resume();
  return audioCtx;
}

// Pauses all game audio (music and effects) while the tab is hidden — switched away from or
// minimized — and picks it back up automatically when the player returns.
document.addEventListener("visibilitychange", () => {
  if (!audioCtx) return;
  if (document.hidden) {
    audioCtx.suspend().catch(() => {});
    streamingMusic?.pause();
  } else {
    audioCtx.resume().catch(() => {});
    if (streamingMusic?.paused) streamingMusic.play().catch(() => {});
  }
});

/** Resumes (or lazily creates) the shared AudioContext. Must be called synchronously from
 * within a real click/tap handler, before any `await` — background music now starts from
 * the loading screen's onDone (a setTimeout, not a gesture), so the very first AudioContext
 * creation happens outside a user gesture and browsers leave it suspended until something
 * like this resumes it from an actual click. */
export function resumeAudio(): void {
  getContext();
  // A streamed track started outside a click (see startStreamingMusic) can be blocked by the
  // autoplay policy — retry it from this real gesture.
  if (streamingMusic?.paused) streamingMusic.play().catch(() => {});
}

/** "All Sound/Music" muted — the old single mute, kept for callers that still use it. */
export function isMuted(): boolean {
  return settings.masterMuted;
}

export function setMuted(value: boolean): void {
  // Speech doesn't route through masterGain (it's a separate browser subsystem, not part of
  // this WebAudio graph) — updateSoundSettings cancels it explicitly when everything goes silent.
  updateSoundSettings({ masterMuted: value });
}

export function toggleMuted(): boolean {
  setMuted(!settings.masterMuted);
  return settings.masterMuted;
}

/** A single synthesized note with a short attack and exponential decay. */
function tone(freq: number, startTime: number, duration: number, type: OscillatorType, peakGain: number): void {
  const ctx = getContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(soundGain!);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.03);
}

function playSequence(notes: number[], gap: number, duration: number, type: OscillatorType, peakGain: number): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  notes.forEach((freq, i) => tone(freq, t + i * gap, duration, type, peakGain));
}

// --- Reel spin loop (recorded sample, used only while reels are spinning) --
// Each game can pass its own track (and an optional trim so only a short lead-in segment of a
// longer recording loops, e.g. Crystal Clover uses just the first 0.4s of its sample) — same
// per-URL caching pattern as background music below, keyed by url+slice so the same file can be
// cached with different slices if different games ever want different parts of it.

/** The default spin sound: a recorded spinning slot reel (96 kbps, like every file in /Sound). */
const DEFAULT_REEL_SPIN_SOUND_URL = "/Sound/freesound_community-spinning-reel-27903.mp3";
/** The recording holds several takes separated by silence — this is its steadiest, fullest take
 * (seconds). Tune these two numbers to loop a different part of it. */
const DEFAULT_REEL_SPIN_SLICE: [number, number] = [18.0, 23.25];
/** Loop seam: the last this-many seconds of the slice are crossfaded into its start, so the loop
 * point has no click or jump. */
const REEL_SPIN_LOOP_CROSSFADE = 0.08;
/** The spin loop's own level, and how long it fades out when the reels stop (seconds). */
const REEL_SPIN_GAIN = 0.5;
const REEL_SPIN_FADE_OUT = 0.12;

const reelSpinBufferCache = new Map<string, AudioBuffer>();
const reelSpinBufferPromiseCache = new Map<string, Promise<AudioBuffer>>();

/** Copies just the first `endSeconds` of `buffer` into a new, shorter AudioBuffer — used to
 * loop only a lead-in slice of a longer recording instead of the whole file. */
function trimBuffer(ctx: AudioContext, buffer: AudioBuffer, endSeconds: number): AudioBuffer {
  const frameCount = Math.max(1, Math.min(buffer.length, Math.round(endSeconds * buffer.sampleRate)));
  const trimmed = ctx.createBuffer(buffer.numberOfChannels, frameCount, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(0, frameCount), channel);
  }
  return trimmed;
}

/** Makes `buffer` loop seamlessly: its last `fadeSeconds` are blended into its first, and that
 * tail is dropped — so the end of each pass flows into the start of the next with no click. */
function crossfadeLoop(ctx: AudioContext, buffer: AudioBuffer, fadeSeconds: number): AudioBuffer {
  const fade = Math.min(Math.floor(fadeSeconds * buffer.sampleRate), Math.floor(buffer.length / 2));
  if (fade < 2) return buffer;
  const length = buffer.length - fade;
  const looped = ctx.createBuffer(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const src = buffer.getChannelData(channel);
    const out = looped.getChannelData(channel);
    out.set(src.subarray(0, length));
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      out[i] = src[i] * k + src[length + i] * (1 - k);
    }
  }
  return looped;
}

/** `cut` is either a trim (loop the first N seconds) or a [start, end] slice. */
function loadReelSpinBuffer(ctx: AudioContext, url: string, cut?: number | [number, number]): Promise<AudioBuffer> {
  const cacheKey = cut === undefined ? url : `${url}#${Array.isArray(cut) ? cut.join("-") : cut}`;
  const cached = reelSpinBufferCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  let promise = reelSpinBufferPromiseCache.get(cacheKey);
  if (!promise) {
    promise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Spin sound failed to load (${res.status}): ${url}`);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) =>
        Array.isArray(cut)
          ? crossfadeLoop(ctx, sliceBuffer(ctx, buffer, cut[0], cut[1]), REEL_SPIN_LOOP_CROSSFADE)
          : cut
            ? trimBuffer(ctx, buffer, cut)
            : buffer
      )
      .then((buffer) => {
        reelSpinBufferCache.set(cacheKey, buffer);
        return buffer;
      })
      .catch((err) => {
        // Don't remember a failure — the next spin tries again instead of staying silent for good.
        reelSpinBufferPromiseCache.delete(cacheKey);
        throw err;
      });
    reelSpinBufferPromiseCache.set(cacheKey, promise);
  }
  return promise;
}

let spinLoopSource: AudioBufferSourceNode | null = null;
let spinLoopGain: GainNode | null = null;
// Bumped on every start/stop so a slow-to-decode load from a previous call
// can't start playback after a newer stop (or a newer start superseded it).
let spinLoopToken = 0;

/** Starts the looping spin sound — by default the recorded spinning reel above. A game can pass
 * its own `url`; `trimEndSeconds`, if given, loops only the first N seconds of it. */
export function startReelSpinLoop(url?: string, trimEndSeconds?: number): void {
  stopReelSpinLoop();
  const token = ++spinLoopToken;
  if (effectsSilent()) return;
  const ctx = getContext();
  const cut = url === undefined ? DEFAULT_REEL_SPIN_SLICE : trimEndSeconds;

  loadReelSpinBuffer(ctx, url ?? DEFAULT_REEL_SPIN_SOUND_URL, cut)
    .then((buffer) => {
      if (token !== spinLoopToken || effectsSilent()) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const gain = ctx.createGain();
      gain.gain.value = REEL_SPIN_GAIN;

      source.connect(gain);
      gain.connect(soundGain!);
      source.start();
      spinLoopSource = source;
      spinLoopGain = gain;
    })
    .catch(() => {
      /* missing/undecodable file — spin silently; the next spin retries the load */
    });
}

/** Reel-landing handler for a spin of `reelCount` reels: each call plays the reel-stop clunk, and
 * the call for the last reel also stops the spin sound — so it ends as the last reel lands, not
 * after that reel's settle animation finishes. (Games still call stopReelSpinLoop after the spin
 * too, as a fallback.) */
export function reelStopSounds(reelCount: number): () => void {
  let landed = 0;
  return () => {
    playReelStop();
    if (++landed >= reelCount) stopReelSpinLoop();
  };
}

/** Stops the spin sound with a short fade (no abrupt cut). */
export function stopReelSpinLoop(): void {
  spinLoopToken++;
  const source = spinLoopSource;
  const gain = spinLoopGain;
  spinLoopSource = null;
  spinLoopGain = null;
  if (!source || !gain || !audioCtx) return;
  const now = audioCtx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0, now + REEL_SPIN_FADE_OUT);
  try {
    source.stop(now + REEL_SPIN_FADE_OUT + 0.02);
  } catch {
    /* already stopped */
  }
  source.onended = () => {
    source.disconnect();
    gain.disconnect();
  };
}

// --- Bonus alarm loop (recorded sample — Top Dollar's DOLLAR-symbol bonus trigger) ---------
// A real recording (a school bell) instead of a synthesized tone, looped from a trimmed middle
// slice of the source file (0.5s-2.0s — the source's opening ring is faint, so the loop starts
// past it) rather than the whole file, and played louder than the reel-spin loop's own gain
// since this needs to read as loud and unmissable, per user request.

const BONUS_ALARM_SOUND_URL = "/Sound/universfield-school-bell-199584.mp3";
const BONUS_ALARM_SLICE_START_SECONDS = 0.5;
const BONUS_ALARM_SLICE_END_SECONDS = 2;
const BONUS_ALARM_GAIN = 0.9;

const bonusAlarmBufferCache = new Map<string, AudioBuffer>();
const bonusAlarmBufferPromiseCache = new Map<string, Promise<AudioBuffer>>();

/** Copies the `[startSeconds, endSeconds)` slice of `buffer` into a new, shorter AudioBuffer —
 * unlike trimBuffer above (which always starts at 0), this can skip a source recording's own
 * lead-in and loop just its clearest-sounding middle portion. */
function sliceBuffer(ctx: AudioContext, buffer: AudioBuffer, startSeconds: number, endSeconds: number): AudioBuffer {
  const startFrame = Math.max(0, Math.min(buffer.length, Math.round(startSeconds * buffer.sampleRate)));
  const endFrame = Math.max(startFrame + 1, Math.min(buffer.length, Math.round(endSeconds * buffer.sampleRate)));
  const sliced = ctx.createBuffer(buffer.numberOfChannels, endFrame - startFrame, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    sliced.copyToChannel(buffer.getChannelData(channel).subarray(startFrame, endFrame), channel);
  }
  return sliced;
}

function loadBonusAlarmBuffer(ctx: AudioContext): Promise<AudioBuffer> {
  const cached = bonusAlarmBufferCache.get(BONUS_ALARM_SOUND_URL);
  if (cached) return Promise.resolve(cached);
  let promise = bonusAlarmBufferPromiseCache.get(BONUS_ALARM_SOUND_URL);
  if (!promise) {
    promise = fetch(BONUS_ALARM_SOUND_URL)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => sliceBuffer(ctx, buffer, BONUS_ALARM_SLICE_START_SECONDS, BONUS_ALARM_SLICE_END_SECONDS))
      .then((buffer) => {
        bonusAlarmBufferCache.set(BONUS_ALARM_SOUND_URL, buffer);
        return buffer;
      });
    bonusAlarmBufferPromiseCache.set(BONUS_ALARM_SOUND_URL, promise);
  }
  return promise;
}

let bonusAlarmSource: AudioBufferSourceNode | null = null;
// Same start/stop race guard as spinLoopToken above.
let bonusAlarmToken = 0;

/** Top Dollar only — starts the DOLLAR bonus-trigger bell looping. Call stopBonusAlarmLoop()
 * once the bundle-selection chase begins (see TopDollarGame.tsx's runSpin). */
export function startBonusAlarmLoop(): void {
  stopBonusAlarmLoop();
  const token = ++bonusAlarmToken;
  if (effectsSilent()) return;
  const ctx = getContext();

  loadBonusAlarmBuffer(ctx).then((buffer) => {
    if (token !== bonusAlarmToken || effectsSilent()) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gain = ctx.createGain();
    gain.gain.value = BONUS_ALARM_GAIN;

    source.connect(gain);
    gain.connect(soundGain!);
    source.start();
    bonusAlarmSource = source;
  });
}

export function stopBonusAlarmLoop(): void {
  bonusAlarmToken++;
  if (!bonusAlarmSource) return;
  try {
    bonusAlarmSource.stop();
  } catch {
    /* already stopped */
  }
  bonusAlarmSource.disconnect();
  bonusAlarmSource = null;
}

// --- Background music (looped from game mount until the player leaves) -----
// Each game passes its own track URL (see games/<Game>/pixi or the game component's
// MUSIC_URL constant) so every game can have distinct background music. Decoded buffers
// are cached per-URL so switching games/re-mounting doesn't re-fetch/re-decode a track
// that's already been loaded once this session.

// BGM volume relative to MASTER_VOLUME above — this is the knob to turn the music itself up/down
// without affecting SFX. Effective loudness is MUSIC_VOLUME * MASTER_VOLUME.
const MUSIC_VOLUME = 0.3;

let musicGain: GainNode | null = null;
const musicBufferCache = new Map<string, AudioBuffer>();
const musicBufferPromiseCache = new Map<string, Promise<AudioBuffer>>();
let musicSource: AudioBufferSourceNode | null = null;
/** The <audio> element behind startStreamingMusic, routed through musicGain like a buffer track. */
let streamingMusic: HTMLAudioElement | null = null;
let streamingMusicNode: MediaElementAudioSourceNode | null = null;
let musicToken = 0;

function loadMusicBuffer(ctx: AudioContext, url: string, trimEndSeconds?: number): Promise<AudioBuffer> {
  const cacheKey = trimEndSeconds ? `${url}#${trimEndSeconds}` : url;
  const cached = musicBufferCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);
  let promise = musicBufferPromiseCache.get(cacheKey);
  if (!promise) {
    promise = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((data) => ctx.decodeAudioData(data))
      .then((buffer) => (trimEndSeconds ? trimBuffer(ctx, buffer, trimEndSeconds) : buffer))
      .then((buffer) => {
        musicBufferCache.set(cacheKey, buffer);
        return buffer;
      });
    musicBufferPromiseCache.set(cacheKey, promise);
  }
  return promise;
}

/** Kicks off fetching + decoding the background music buffer ahead of time, without playing it
 * — call this as early as possible (e.g. right when the game mounts), so the heavy fetch/decode/
 * trim work is already done by the time startBackgroundMusic() actually runs, instead of
 * competing with whatever's animating on screen at that exact moment (e.g. the top-screen-to-
 * base-game intro scroll, which is when startBackgroundMusic previously first got called —
 * confirmed with user: that first-time decode was landing mid-scroll and reading as a jerk/
 * hitch). loadMusicBuffer's own cache makes the later real call an instant hit either way. */
export function preloadBackgroundMusic(url: string, trimEndSeconds?: number): void {
  const ctx = getContext();
  loadMusicBuffer(ctx, url, trimEndSeconds).catch(() => {
    /* ignore — startBackgroundMusic will just retry the fetch/decode later */
  });
}

/**
 * Starts (or restarts, with a different track) the looping background music. Unlike the
 * one-shot SFX, this keeps running even while muted — muting only zeroes its gain — so
 * unmuting later doesn't require the track to be reloaded/restarted.
 *
 * `trimEndSeconds`, if given, loops only the first N seconds of `url` — for cutting off dead air
 * at the tail of a recording (e.g. a fade-out that ends in true silence a beat before the file
 * itself ends) so the loop doesn't have an audible gap of silence before jumping back to the
 * start. Same trimBuffer helper the reel-spin loop above uses.
 */
export function startBackgroundMusic(url: string, trimEndSeconds?: number): void {
  stopBackgroundMusic();
  const token = ++musicToken;
  const ctx = getContext();

  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOLUME;
    musicGain.connect(musicUserGain!);
  }

  loadMusicBuffer(ctx, url, trimEndSeconds).then((buffer) => {
    if (token !== musicToken) return;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(musicGain!);
    source.start();
    musicSource = source;
  });
}

/**
 * Same as startBackgroundMusic (same volume, mute and stop), but streams the file through an
 * <audio> element instead of decoding it whole. A decoded track is raw PCM — a 3-minute song is
 * ~65 MB held for as long as it plays — while streaming only keeps a small buffer. The one
 * difference: an <audio> loop can have a tiny gap at the loop point, and there's no
 * `trimEndSeconds`.
 */
export function startStreamingMusic(url: string): void {
  stopBackgroundMusic();
  const ctx = getContext();

  if (!musicGain) {
    musicGain = ctx.createGain();
    musicGain.gain.value = MUSIC_VOLUME;
    musicGain.connect(musicUserGain!);
  }

  const audio = new Audio(url);
  audio.loop = true;
  audio.preload = "auto";
  streamingMusicNode = ctx.createMediaElementSource(audio);
  streamingMusicNode.connect(musicGain);
  streamingMusic = audio;
  // Rejected when no click has happened yet — resumeAudio() retries from the next one.
  audio.play().catch(() => {});
}

export function stopBackgroundMusic(): void {
  musicToken++;
  if (streamingMusic) {
    streamingMusic.pause();
    // Drops the element's buffered audio so it can be freed.
    streamingMusic.removeAttribute("src");
    streamingMusic.load();
    streamingMusicNode?.disconnect();
    streamingMusic = null;
    streamingMusicNode = null;
  }
  if (!musicSource) return;
  try {
    musicSource.stop();
  } catch {
    /* already stopped */
  }
  musicSource.disconnect();
  musicSource = null;
}

// --- One-shot effects -------------------------------------------------------

/** Short mechanical "clunk" as an individual reel lands. */
export function playReelStop(): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  tone(140, t, 0.1, "square", 0.22);
  tone(85, t, 0.16, "sine", 0.18);
}

/** Bright coin/bell "ding" for a paying symbol landing. `step` is how many paying symbols have
 * already landed this spin (0 for the first) — each one rings a little higher, so a run of hits
 * climbs. */
export function playSymbolHit(step = 0): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  const base = 1046.5 * Math.pow(2, Math.min(step, 6) / 12); // C6, up a semitone per hit
  tone(base, t, 0.32, "sine", 0.22); // body
  tone(base * 2, t, 0.18, "triangle", 0.08); // shimmer an octave up
  tone(base * 1.5, t + 0.05, 0.22, "sine", 0.1); // quick fifth for the "ding-ling"
}

/** Synthesized single kick-drum-style hit — a punchier, more "drum beat" feel than the generic
 * mechanical playReelStop clunk above. A sine oscillator sweeps quickly from a higher pitch down
 * to a low thump (the classic synthesized-kick technique) under a fast amplitude decay. */
export function playDrumBeat(): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.7, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  osc.connect(gain);
  gain.connect(soundGain!);
  osc.start(t);
  osc.stop(t + 0.25);
}

/** Suspense drum roll for `durationMs`: snare-like hits that speed up (≈170ms → 55ms apart) and
 * rise in pitch toward the end. Returns a stop function — call it the moment the suspense
 * resolves (e.g. the last reel lands); the roll fades out over ~60ms. */
export function startDrumRoll(durationMs: number): () => void {
  if (effectsSilent()) return () => {};
  const ctx = getContext();
  const rollGain = ctx.createGain();
  rollGain.gain.value = 1;
  rollGain.connect(soundGain!);
  const t0 = ctx.currentTime;
  const total = durationMs / 1000;
  let at = 0;
  while (at < total) {
    const progress = at / total;
    const t = t0 + at;
    // Snare body: a short burst of band-limited noise.
    const frames = Math.max(1, Math.floor(ctx.sampleRate * 0.06));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1800 + progress * 1400;
    const hitGain = ctx.createGain();
    const peak = 0.18 + progress * 0.22;
    hitGain.gain.setValueAtTime(peak, t);
    hitGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    noise.connect(filter);
    filter.connect(hitGain);
    hitGain.connect(rollGain);
    noise.start(t);
    noise.stop(t + 0.08);
    // Low tom underneath, climbing in pitch.
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(110 + progress * 120, t);
    oscGain.gain.setValueAtTime(0.12 + progress * 0.1, t);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(oscGain);
    oscGain.connect(rollGain);
    osc.start(t);
    osc.stop(t + 0.1);
    at += 0.17 - progress * 0.115;
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    rollGain.gain.setValueAtTime(rollGain.gain.value, now);
    rollGain.gain.linearRampToValueAtTime(0, now + 0.06);
    window.setTimeout(() => rollGain.disconnect(), 120);
  };
}

/** '90s 8-bit arcade suspense riser for `durationMs`: square-wave arpeggio notes that climb in
 * pitch and speed up toward the end (like an old console's "something's coming" jingle), over a
 * low pulsing bass. Layer it with startDrumRoll. Returns a stop function (fades out in ~60ms). */
export function startChiptuneRiser(durationMs: number): () => void {
  if (effectsSilent()) return () => {};
  const ctx = getContext();
  const out = ctx.createGain();
  out.gain.value = CHIPTUNE_RISER_VOLUME;
  out.connect(soundGain!);
  // Dip the background music while the riser plays so it cuts through; restored on stop.
  const restoreMusic = duckMusic(RISER_MUSIC_DUCK);
  const t0 = ctx.currentTime;
  const total = durationMs / 1000;
  // Minor-arpeggio steps (semitones above the root), climbing an octave each time round.
  const steps = [0, 3, 7, 12];
  let at = 0;
  let n = 0;
  while (at < total) {
    const progress = at / total;
    const t = t0 + at;
    // The arpeggio steps up an octave a third of the way in, and again at two thirds.
    const semis = steps[n % steps.length] + 12 * Math.min(2, Math.floor(progress * 3));
    const freq = 330 * Math.pow(2, semis / 12);
    const len = 0.07;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.1 + progress * 0.18, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g);
    g.connect(out);
    osc.start(t);
    osc.stop(t + len + 0.02);
    // Low square-bass pulse on every 4th note, rising with the arpeggio.
    if (n % 4 === 0) {
      const bass = ctx.createOscillator();
      const bg = ctx.createGain();
      bass.type = "square";
      bass.frequency.setValueAtTime(82.4 * Math.pow(2, Math.floor(progress * 5) / 12), t);
      bg.gain.setValueAtTime(0.0001, t);
      bg.gain.linearRampToValueAtTime(0.2, t + 0.005);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      bass.connect(bg);
      bg.connect(out);
      bass.start(t);
      bass.stop(t + 0.18);
    }
    at += 0.11 - progress * 0.06; // 110ms apart at the start, 50ms by the end
    n++;
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    const now = ctx.currentTime;
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.06);
    window.setTimeout(() => out.disconnect(), 120);
    restoreMusic();
  };
}

// --- Free-spins round won (the "Free Spins Complete" card) -----------------------------------

/** A brass-like note: two detuned sawtooths through a lowpass that opens on the attack. */
function brassNote(ctx: AudioContext, out: AudioNode, freq: number, t: number, duration: number, peak: number): void {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(700, t);
  filter.frequency.linearRampToValueAtTime(3200, t + 0.06);
  filter.frequency.exponentialRampToValueAtTime(1400, t + duration);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(peak, t + 0.03);
  gain.gain.setValueAtTime(peak * 0.8, t + duration * 0.6);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  filter.connect(gain);
  gain.connect(out);
  [freq, freq * 1.006].forEach((f) => {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(f, t);
    osc.connect(filter);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  });
}

/** Free-spins round complete: a triumphant fanfare (rising brass pickup into a big held major
 * chord with a deep hit under it) topped with a shower of coin sparkles. ~2.6s. Dips the music. */
export function playFreeSpinsWin(): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime + 0.05;
  const out = ctx.createGain();
  out.gain.value = 0.5;
  out.connect(soundGain!);
  const restoreMusic = duckMusic(0.3);

  // Pickup: G4 G4 C5 E5, then the held C major chord (C5 E5 G5 C6).
  [392, 392, 523.25, 659.25].forEach((f, i) => brassNote(ctx, out, f, t + i * 0.13, 0.16, 0.22));
  const chordAt = t + 4 * 0.13;
  [523.25, 659.25, 783.99, 1046.5].forEach((f) => brassNote(ctx, out, f, chordAt, 1.5, 0.16));
  // Deep hit under the chord.
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(130, chordAt);
  boom.frequency.exponentialRampToValueAtTime(50, chordAt + 0.5);
  boomGain.gain.setValueAtTime(0.0001, chordAt);
  boomGain.gain.linearRampToValueAtTime(0.8, chordAt + 0.01);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, chordAt + 0.6);
  boom.connect(boomGain);
  boomGain.connect(out);
  boom.start(chordAt);
  boom.stop(chordAt + 0.65);

  // Coin shower: bright blips from the C major scale, scattered over ~1.8s and thinning out.
  const coinNotes = [2093, 2349.3, 2637, 3136, 3520];
  for (let i = 0; i < 26; i++) {
    const ct = chordAt + 0.05 + Math.pow(i / 26, 1.4) * 1.8 + Math.random() * 0.04;
    const f = coinNotes[Math.floor(Math.random() * coinNotes.length)];
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ct);
    g.gain.linearRampToValueAtTime(0.09, ct + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, ct + 0.16);
    g.connect(out);
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(f, ct);
    osc.connect(g);
    osc.start(ct);
    osc.stop(ct + 0.18);
  }

  const totalMs = (chordAt - ctx.currentTime + 2.1) * 1000;
  window.setTimeout(() => {
    out.disconnect();
    restoreMusic();
  }, totalMs);
}

// --- Free-spins alarm (looping until the player starts the round) ----------------------------
// A synthesized "something big is coming" alarm: each cycle is a deep boom, four fast two-tone
// buzzer beeps, then a rising siren sweep. Scheduled a little ahead in short batches (so it never
// stutters, and stopping cuts it off cleanly). Part of the Sound group, and dips the music.

/** One alarm cycle (seconds). */
const ALARM_CYCLE = 1.3;
/** startFreeSpinAlarm's overall loudness. */
const ALARM_VOLUME = 0.55;
/** Background music level (fraction of MUSIC_VOLUME) while the alarm sounds. */
const ALARM_MUSIC_DUCK = 0.35;

let stopActiveAlarm: (() => void) | null = null;

/** Schedules one alarm cycle starting at `t` into `out`. */
function scheduleAlarmCycle(ctx: AudioContext, out: GainNode, t: number): void {
  // Deep boom on the downbeat — the weight under the alarm.
  const boom = ctx.createOscillator();
  const boomGain = ctx.createGain();
  boom.type = "sine";
  boom.frequency.setValueAtTime(110, t);
  boom.frequency.exponentialRampToValueAtTime(45, t + 0.35);
  boomGain.gain.setValueAtTime(0.0001, t);
  boomGain.gain.linearRampToValueAtTime(0.9, t + 0.01);
  boomGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
  boom.connect(boomGain);
  boomGain.connect(out);
  boom.start(t);
  boom.stop(t + 0.45);

  // Four fast two-tone buzzer beeps (hi-lo-hi-lo), slightly detuned squares for a raspy buzz.
  const beepFreqs = [880, 660, 880, 660];
  beepFreqs.forEach((freq, i) => {
    const bt = t + 0.04 + i * 0.13;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, bt);
    g.gain.linearRampToValueAtTime(0.16, bt + 0.008);
    g.gain.setValueAtTime(0.16, bt + 0.085);
    g.gain.exponentialRampToValueAtTime(0.0001, bt + 0.11);
    g.connect(out);
    [freq, freq * 1.007].forEach((f) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(f, bt);
      osc.connect(g);
      osc.start(bt);
      osc.stop(bt + 0.12);
    });
  });

  // Rising siren sweep — the "here it comes" lift at the end of each cycle.
  const st = t + 0.62;
  const siren = ctx.createOscillator();
  const sirenFilter = ctx.createBiquadFilter();
  const sirenGain = ctx.createGain();
  siren.type = "sawtooth";
  siren.frequency.setValueAtTime(420, st);
  siren.frequency.exponentialRampToValueAtTime(1250, st + 0.5);
  sirenFilter.type = "lowpass";
  sirenFilter.frequency.value = 2600;
  sirenGain.gain.setValueAtTime(0.0001, st);
  sirenGain.gain.linearRampToValueAtTime(0.13, st + 0.06);
  sirenGain.gain.setValueAtTime(0.13, st + 0.42);
  sirenGain.gain.exponentialRampToValueAtTime(0.0001, st + 0.58);
  siren.connect(sirenFilter);
  sirenFilter.connect(sirenGain);
  sirenGain.connect(out);
  siren.start(st);
  siren.stop(st + 0.6);
}

/**
 * Starts the looping free-spins alarm (after `delayMs`, e.g. to let the award jingle finish).
 * Returns a stop function — call it the moment the player starts the free spins; the alarm fades
 * out over ~150ms. Starting it again replaces any alarm already sounding.
 */
export function startFreeSpinAlarm(delayMs = 0): () => void {
  stopActiveAlarm?.();
  if (effectsSilent()) return () => {};
  const ctx = getContext();
  const out = ctx.createGain();
  out.gain.value = ALARM_VOLUME;
  out.connect(soundGain!);
  const restoreMusic = duckMusic(ALARM_MUSIC_DUCK);

  let nextCycle = ctx.currentTime + delayMs / 1000;
  const schedule = () => {
    // Keep ~1.5 cycles queued ahead of the clock.
    while (nextCycle < ctx.currentTime + ALARM_CYCLE * 1.5) {
      scheduleAlarmCycle(ctx, out, Math.max(nextCycle, ctx.currentTime));
      nextCycle += ALARM_CYCLE;
    }
  };
  schedule();
  const timer = window.setInterval(schedule, 250);

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (stopActiveAlarm === stop) stopActiveAlarm = null;
    window.clearInterval(timer);
    const now = ctx.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(out.gain.value, now);
    out.gain.linearRampToValueAtTime(0, now + 0.15);
    // Disconnecting silences every beep already queued ahead.
    window.setTimeout(() => out.disconnect(), 200);
    restoreMusic();
  };
  stopActiveAlarm = stop;
  return stop;
}

/** startChiptuneRiser's overall loudness (its notes rise from ~0.1 to ~0.28 within this). */
const CHIPTUNE_RISER_VOLUME = 1;
/** Background music level (fraction of MUSIC_VOLUME) while the riser plays. */
const RISER_MUSIC_DUCK = 0.4;

/** Fades the background music down to `level` x MUSIC_VOLUME; returns a function that fades it
 * back. Nested ducks are counted, so the music only comes back when the last one ends. */
let musicDuckCount = 0;
function duckMusic(level: number): () => void {
  if (!musicGain) return () => {};
  const ctx = getContext();
  const gain = musicGain.gain;
  musicDuckCount++;
  gain.cancelScheduledValues(ctx.currentTime);
  gain.setValueAtTime(gain.value, ctx.currentTime);
  gain.linearRampToValueAtTime(MUSIC_VOLUME * level, ctx.currentTime + 0.25);
  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    musicDuckCount = Math.max(0, musicDuckCount - 1);
    if (musicDuckCount > 0 || !musicGain) return;
    const now = getContext().currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(MUSIC_VOLUME, now + 0.4);
  };
}

/** A short burst of filtered white noise with an exponential decay — the raw material for a
 * physical "hit" sound (rattle, explosion) that a pure oscillator can't produce. */
function noiseBurst(startTime: number, duration: number, peakGain: number, lowpassFreq: number): void {
  const ctx = getContext();
  const frameCount = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / frameCount);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = lowpassFreq;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peakGain, startTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(soundGain!);
  noise.start(startTime);
  noise.stop(startTime + duration + 0.02);
}

/** Rattling clicks building in pitch — a gem/prop shaking in place before it "opens", with a
 * swelling low rumble underneath for physical weight (enhanced per user request — the plain
 * click sequence alone read as thin). */
export function playShakeRattle(): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  const clickCount = 9;
  for (let i = 0; i < clickCount; i++) {
    const progress = i / (clickCount - 1);
    const pitch = 160 + progress * 140 + Math.random() * 40; // climbs as the rattle builds
    tone(pitch, t + i * 0.055, 0.05, i % 2 === 0 ? "square" : "triangle", 0.16);
  }
  const rumble = ctx.createOscillator();
  const rumbleGain = ctx.createGain();
  rumble.type = "sine";
  rumble.frequency.setValueAtTime(55, t);
  rumble.frequency.linearRampToValueAtTime(70, t + 0.5);
  rumbleGain.gain.setValueAtTime(0.0001, t);
  rumbleGain.gain.linearRampToValueAtTime(0.18, t + 0.3);
  rumbleGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
  rumble.connect(rumbleGain);
  rumbleGain.connect(soundGain!);
  rumble.start(t);
  rumble.stop(t + 0.6);
}

/** A punchy explosion/impact burst — noise + a low sine thump, topped with a bright ascending
 * sparkle arpeggio right after impact (enhanced per user request — reads as light glinting off
 * shattered gem facets instead of a plain generic "boom"). */
export function playBurst(): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  noiseBurst(t, 0.35, 0.55, 1400);
  tone(95, t, 0.3, "sine", 0.4);
  const sparkle = [1046, 1318, 1568, 2093];
  sparkle.forEach((freq, i) => tone(freq, t + 0.03 + i * 0.045, 0.22, "triangle", 0.16));
}

/** A pitch sweeping downward, layered with a quick descending "coin cascade" of blips — a
 * revealed value dropping down/away (e.g. into a credit meter), enhanced per user request so it
 * reads as coins tumbling down rather than a single plain tone sweep. */
export function playSweepDown(): void {
  if (effectsSilent()) return;
  const ctx = getContext();
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(180, t + 0.6);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.35, t + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
  osc.connect(gain);
  gain.connect(soundGain!);
  osc.start(t);
  osc.stop(t + 0.7);

  const cascade = [1568, 1318, 1046, 880, 698];
  cascade.forEach((freq, i) => tone(freq, t + 0.08 + i * 0.09, 0.12, "triangle", 0.14));
}

/** Small/regular win chime (no celebration tier). */
export function playWinChime(): void {
  playSequence([523, 659, 784], 0.09, 0.25, "triangle", 0.25);
}

/** Distinct jingle when free spins are awarded or retriggered. */
export function playFreeSpinsJingle(): void {
  playSequence([784, 988, 1175, 1568], 0.12, 0.3, "square", 0.2);
}

/** Bigger fanfare for tiered wins, scaling with tier. */
export function playCelebration(tier: "BIG WIN" | "MEGA WIN" | "JACKPOT"): void {
  const sequences: Record<typeof tier, number[]> = {
    "BIG WIN": [523, 659, 784, 1047],
    "MEGA WIN": [523, 659, 784, 1047, 1319, 1047, 1319],
    JACKPOT: [392, 523, 659, 784, 1047, 1319, 1568, 2093],
  };
  playSequence(sequences[tier], 0.11, 0.35, "triangle", 0.3);
}

// --- Speech (Top Dollar's spoken offer announcements) -----------------------
// Uses the browser's own SpeechSynthesis API rather than an audio file or a paid TTS service —
// free, no asset to ship, and the amount it needs to say is a live number, not fixed text.
// Voices are loaded async by the browser (getVoices() often returns [] on first call, filling in
// only once the 'voiceschanged' event fires) so callers must await ensureVoicesLoaded() before
// picking one. This does NOT route through masterGain (it's a separate OS/browser subsystem, not
// part of the WebAudio graph above) — it follows the "Sound" group by hand (see speak and
// updateSoundSettings), and see cancelSpeech's own doc comment for why every caller that can interrupt a
// line (Take It / Try Again) must call it explicitly too.

let voicesReadyPromise: Promise<void> | null = null;

function ensureVoicesLoaded(): Promise<void> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve();
  if (!voicesReadyPromise) {
    voicesReadyPromise = new Promise((resolve) => {
      if (speechSynthesis.getVoices().length > 0) {
        resolve();
        return;
      }
      const onVoicesChanged = () => {
        speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
        resolve();
      };
      speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
      // Some browsers never fire voiceschanged (or already had voices ready before this ran) —
      // don't let a caller hang forever waiting on one that isn't coming.
      setTimeout(resolve, 500);
    });
  }
  return voicesReadyPromise;
}

/** Picks the best available American-English voice — required to be en-US specifically (per
 * user request), preferring one whose name suggests a higher-quality "Natural"/neural engine
 * (Windows 11's newer online voices, Chrome/Edge's Google voices) over a generic robotic one,
 * since actual voice quality is entirely up to the player's own OS/browser and this is the only
 * lever available to bias toward the better-sounding option when more than one exists. */
function pickAmericanVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return undefined;

  const isUS = (v: SpeechSynthesisVoice) => v.lang === "en-US" || v.lang === "en_US";
  const pool = voices.filter(isUS);
  if (pool.length === 0) return voices.find((v) => v.lang.startsWith("en")) ?? voices[0];

  return (
    pool.find((v) => /natural|neural/i.test(v.name)) ??
    pool.find((v) => /google/i.test(v.name)) ??
    pool[0]
  );
}

/** Bumped by every cancelSpeech() (including the one at the top of every speak() call) — lets
 * a speak() still waiting on ensureVoicesLoaded() notice it's been superseded (see below)
 * instead of a plain currentUtterance flag, which can't catch that: cancelSpeech() runs
 * synchronously, before the superseded call's utterance object even exists yet, so clearing a
 * "current utterance" reference at that point cancels nothing. */
let speechToken = 0;

/** Stops whatever offer line is currently being spoken, if any — call this the instant the
 * player acts (Take It / Try Again), whether by their own click or an automatic Take It (the
 * last offer auto-accepts), so the voice never keeps talking over a screen transition that's
 * already moved on. Safe to call when nothing is speaking. */
export function cancelSpeech(): void {
  speechToken += 1;
  if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
}

/** Speaks `text` in American English, resolving once it finishes (or is cancelled/errors) —
 * await it only if the caller actually needs to know when the line ends; the Top Dollar offer
 * announcements themselves are fire-and-forget so the Take-It/Try-Again buttons are usable
 * immediately, not gated on the voice finishing. Cancels any line already in progress first, so
 * two calls in a row can never overlap — including the case where a second speak() lands while
 * this one is still awaiting ensureVoicesLoaded(), which speechSynthesis.cancel() alone can't
 * catch since there's no utterance to cancel yet at that point. */
export function speak(text: string): Promise<void> {
  if (effectsSilent() || typeof speechSynthesis === "undefined") return Promise.resolve();
  cancelSpeech();
  const token = speechToken;

  return ensureVoicesLoaded().then(
    () =>
      new Promise((resolve) => {
        // A newer speak()/cancelSpeech() call superseded this one while voices were still
        // loading — don't let this stale line start playing after the fact.
        if (token !== speechToken) {
          resolve();
          return;
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "en-US";
        const voice = pickAmericanVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = 1.0;
        utterance.pitch = 1.05;
        // The voice isn't part of the WebAudio graph — give it the Sound group's level by hand.
        utterance.volume = masterLevel() * soundLevel();
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        speechSynthesis.speak(utterance);
      })
  );
}

