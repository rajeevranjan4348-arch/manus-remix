import { fetchServerWeather } from '../../server/weatherService';

const jsonResponse = (data: any, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*',
  },
});

export default async (req: Request) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed. Use GET or POST.', code: 'METHOD_NOT_ALLOWED' }, 405);
  }

  let city = '';
  if (req.method === 'GET') {
    const url = new URL(req.url);
    city = url.searchParams.get('city') || url.searchParams.get('location') || url.searchParams.get('q') || '';
  } else {
    try {
      const body = await req.json();
      city = body?.city || body?.location || body?.q || '';
    } catch {
      return jsonResponse({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, 400);
    }
  }

  city = city.trim();
  if (!city) {
    return jsonResponse({ error: 'City parameter is required (e.g. ?city=Delhi)', code: 'CITY_REQUIRED' }, 400);
  }

  try {
    const weatherData = await fetchServerWeather(city, 8000);
    if (!weatherData) {
      return jsonResponse({ error: `Could not retrieve weather data for "${city}". Please check the spelling.`, code: 'NOT_FOUND' }, 404);
    }

    return jsonResponse({ success: true, data: weatherData });
  } catch (error: any) {
    console.error('[Netlify Weather Function Error]:', error);
    return jsonResponse({ error: error?.message || 'Failed to fetch weather', code: 'INTERNAL_ERROR' }, 500);
  }
};
