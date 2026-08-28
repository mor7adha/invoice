import { getStore } from '@netlify/blobs';

const COUNTER_KEY = 'next-document-numbers';
const STARTS = { invoice: 11603, receipt: 3902 };
const responseHeaders = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Type': 'application/json; charset=utf-8'
};

function normalizedCounters(value = {}) {
  return Object.fromEntries(Object.entries(STARTS).map(([name, start]) => {
    const candidate = Number.parseInt(value[name], 10);
    return [name, Number.isSafeInteger(candidate) && candidate >= start ? candidate : start];
  }));
}

function validMinimum(name, value) {
  const parsed = Number.parseInt(value, 10);
  const start = STARTS[name];
  return Number.isSafeInteger(parsed) && parsed >= start && parsed <= start + 9_000_000
    ? parsed
    : start;
}

async function readCounters(store) {
  const entry = await store.getWithMetadata(COUNTER_KEY, { consistency: 'strong' });
  if (!entry) return { counters: normalizedCounters(), etag: null };
  try {
    return { counters: normalizedCounters(JSON.parse(entry.data)), etag: entry.etag };
  } catch {
    return { counters: normalizedCounters(), etag: entry.etag };
  }
}

async function updateCounters(store, transform) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { counters, etag } = await readCounters(store);
    const result = transform({ ...counters });
    const options = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
    const write = await store.set(COUNTER_KEY, JSON.stringify(result.counters), options);
    if (write.modified) return result;
  }
  throw new Error('Could not update document sequence after multiple attempts');
}

export default async function handler(request) {
  const store = getStore({ name: 'document-sequences', consistency: 'strong' });

  try {
    if (request.method === 'GET') {
      const { counters } = await readCounters(store);
      return new Response(JSON.stringify(counters), { status: 200, headers: responseHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...responseHeaders, Allow: 'GET, POST' }
      });
    }

    const body = await request.json();
    if (body.action === 'sync') {
      const result = await updateCounters(store, counters => {
        for (const name of Object.keys(STARTS)) {
          counters[name] = Math.max(counters[name], validMinimum(name, body.sequences?.[name]));
        }
        return { counters };
      });
      return new Response(JSON.stringify(result.counters), { status: 200, headers: responseHeaders });
    }

    if (body.action === 'reserve' && Object.hasOwn(STARTS, body.documentName)) {
      const name = body.documentName;
      const result = await updateCounters(store, counters => {
        const issued = Math.max(counters[name], validMinimum(name, body.minimum));
        counters[name] = issued + 1;
        return { counters, issued, next: counters[name] };
      });
      return new Response(JSON.stringify({
        documentName: name,
        issued: result.issued,
        next: result.next
      }), { status: 200, headers: responseHeaders });
    }

    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400,
      headers: responseHeaders
    });
  } catch (error) {
    console.error('Document sequence error', error);
    return new Response(JSON.stringify({ error: 'Sequence service unavailable' }), {
      status: 500,
      headers: responseHeaders
    });
  }
}
