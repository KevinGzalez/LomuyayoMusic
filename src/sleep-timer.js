const MAX_MINUTES = 8 * 60;

export function createSleepTimer({ onExpire }) {
  const timers = new Map();

  function cancel(guildId) {
    const key = String(guildId);
    const current = timers.get(key);
    if (!current) return false;
    if (current.timeout) clearTimeout(current.timeout);
    timers.delete(key);
    return true;
  }

  function setMinutes(guildId, minutes, requestedBy = null) {
    const value = Number(minutes);
    if (!Number.isInteger(value) || value < 1 || value > MAX_MINUTES) {
      throw new RangeError(`Los minutos deben estar entre 1 y ${MAX_MINUTES}.`);
    }

    cancel(guildId);
    const key = String(guildId);
    const expiresAt = Date.now() + value * 60_000;
    const timeout = setTimeout(async () => {
      const state = timers.get(key);
      if (!state || state.expiresAt !== expiresAt) return;
      timers.delete(key);
      await onExpire(key, state).catch((error) => console.error('[Sleep Timer]', error));
    }, value * 60_000);
    timeout.unref();
    timers.set(key, { mode: 'minutes', minutes: value, expiresAt, requestedBy, timeout });
    return get(guildId);
  }

  function setEndOfTrack(guildId, trackId, requestedBy = null) {
    if (!trackId) throw new Error('No hay una canción activa.');
    cancel(guildId);
    timers.set(String(guildId), {
      mode: 'track',
      trackId: String(trackId),
      requestedBy,
      createdAt: Date.now(),
      timeout: null,
    });
    return get(guildId);
  }

  function handleTrackFinished(guildId, trackId) {
    const state = timers.get(String(guildId));
    if (!state || state.mode !== 'track' || String(trackId) !== state.trackId) return false;
    timers.delete(String(guildId));
    Promise.resolve(onExpire(String(guildId), state)).catch((error) => console.error('[Sleep Timer]', error));
    return true;
  }

  function get(guildId) {
    const state = timers.get(String(guildId));
    if (!state) return null;
    return {
      mode: state.mode,
      minutes: state.minutes ?? null,
      expiresAt: state.expiresAt ?? null,
      remainingMs: state.expiresAt ? Math.max(0, state.expiresAt - Date.now()) : null,
      trackId: state.trackId ?? null,
      requestedBy: state.requestedBy ?? null,
    };
  }

  return { cancel, get, handleTrackFinished, setEndOfTrack, setMinutes };
}

