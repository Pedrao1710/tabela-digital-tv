import assert from 'node:assert/strict';
import { test } from 'node:test';

test('temperatura fica opcional e o provedor usa só cidade e coordenadas', async () => {
  const { createWeather } = await import('../weather.mjs');
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () =>
        url.pathname.startsWith('/geo')
          ? [{ country: 'BR', lat: -20.47, lon: -54.62 }]
          : { main: { temp: 27.6 } },
    };
  };
  assert.equal(await createWeather('', fetcher)({ city: 'Campo Grande' }), null);
  assert.equal(requests.length, 0);
  const weather = createWeather('test-key', fetcher);
  const store = { city: 'Campo Grande', name: 'Informação interna' };
  assert.deepEqual(await Promise.all([weather(store), weather(store)]), [28, 28]);
  assert.equal(await weather(store), 28);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].origin, 'https://api.openweathermap.org');
  assert.equal(requests[0].searchParams.get('q'), 'Campo Grande,BR');
  assert.equal(requests[1].searchParams.get('units'), 'metric');
  assert.equal(requests[1].searchParams.get('lat'), '-20.47');
  assert.ok(!requests.some((url) => String(url).includes('interna')));
});
