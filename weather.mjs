const normalize = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export function createWeather(key, fetcher = fetch) {
  const cache = new Map();
  async function load(path, params) {
    const url = new URL(path, 'https://api.openweathermap.org');
    url.search = new URLSearchParams({ ...params, appid: key });
    const response = await fetcher(url, { signal: AbortSignal.timeout(2500), redirect: 'error' });
    if (!response.ok) throw new Error('Temperatura indisponível.');
    return response.json();
  }
  async function temperature(city, state) {
    const matches = await load('/geo/1.0/direct', { q: city + ',BR', limit: '5' });
    const brazil = Array.isArray(matches) ? matches.filter((place) => place.country === 'BR') : [];
    const place =
      brazil.find((place) => state && normalize(place.state) === normalize(state)) || brazil[0];
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return null;
    const current = await load('/data/2.5/weather', {
      lat: place.lat,
      lon: place.lon,
      units: 'metric',
    });
    const value = current.main?.temp;
    return Number.isFinite(value) && value >= -90 && value <= 65 ? Math.round(value) : null;
  }
  return async ({ city, state }) => {
    if (!key || !city) return null;
    const query = JSON.stringify([city, state]);
    const prior = cache.get(query);
    if (prior && prior.expires > Date.now()) return prior.result;
    if (cache.size >= 256) cache.delete(cache.keys().next().value);
    const entry = { expires: Date.now() + 30 * 60 * 1000 };
    entry.result = temperature(city, state)
      .catch(() => null)
      .then((value) => {
        if (value === null) entry.expires = Date.now() + 5 * 60 * 1000;
        return value;
      });
    cache.set(query, entry);
    return entry.result;
  };
}
