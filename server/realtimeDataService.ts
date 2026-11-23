import { geocodeLocationServer } from './geocodingService';

/**
 * Server-Side Real-Time Data & Live Information Service
 *
 * Provides verified live temporal context (UTC, IST, global timezones),
 * real-time weather & air quality (Open-Meteo), live foreign exchange rates
 * (Frankfurter / Open Exchange Rates), live cryptocurrency spot prices
 * (CoinGecko / Coinbase), real-time tech & space news headlines, USGS
 * seismic activity, and Wikipedia / DuckDuckGo live knowledge lookups.
 */

export interface LiveTemporalContext {
  isoUtc: string;
  unixMs: number;
  utcFormatted: string;
  istFormatted: string;
  istTime24: string;
  istDate: string;
  dayOfWeek: string;
  year: number;
  worldClocks: {
    newDelhiIst: string;
    londonGmt: string;
    newYorkEst: string;
    sanFranciscoPst: string;
    tokyoJst: string;
  };
}

export interface LiveWeatherSnapshot {
  city: string;
  country?: string;
  latitude: number;
  longitude: number;
  temperatureC: number;
  temperatureF: number;
  feelsLikeC: number;
  humidity: number;
  windSpeedKmh: number;
  precipitationMm: number;
  condition: string;
  pm25?: number;
  pm10?: number;
  usAqi?: number;
  forecast: Array<{
    date: string;
    condition: string;
    maxC: number;
    minC: number;
  }>;
  fetchedAtUtc: string;
  sourceUrl: string;
}

export interface LiveCurrencySnapshot {
  base: string;
  target: string;
  amount: number;
  rate: number;
  convertedAmount: number;
  date: string;
  topRates: Record<string, number>;
  sourceUrl: string;
}

export interface LiveCryptoItem {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number;
  priceInr?: number;
  change24hPct?: number;
}

export interface LiveNewsOrFactItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
  publishedAt?: string;
}

export interface RealtimeEnrichmentResult {
  temporal: LiveTemporalContext;
  hasLiveDomainData: boolean;
  weather?: LiveWeatherSnapshot | null;
  currency?: LiveCurrencySnapshot | null;
  crypto?: LiveCryptoItem[];
  newsAndFacts?: LiveNewsOrFactItem[];
  sources: Array<{ title: string; url: string }>;
  systemContextBlock: string;
  directFallbackMarkdown?: string;
}

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snowfall',
  73: 'Moderate snowfall',
  75: 'Heavy snowfall',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Heavy thunderstorm with hail',
};

function formatTz(date: Date, timeZone: string, includeSeconds = true): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      ...(includeSeconds ? { second: '2-digit' } : {}),
      hour12: true,
      timeZoneName: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function getLiveTemporalContext(now: Date = new Date()): LiveTemporalContext {
  const istTime24 = (() => {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now);
    } catch {
      return now.toISOString().slice(11, 19);
    }
  })();

  const istDate = (() => {
    try {
      return new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(now);
    } catch {
      return now.toDateString();
    }
  })();

  const dayOfWeek = (() => {
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'long',
      }).format(now);
    } catch {
      return 'Today';
    }
  })();

  return {
    isoUtc: now.toISOString(),
    unixMs: now.getTime(),
    utcFormatted: formatTz(now, 'UTC'),
    istFormatted: formatTz(now, 'Asia/Kolkata'),
    istTime24,
    istDate,
    dayOfWeek,
    year: now.getUTCFullYear(),
    worldClocks: {
      newDelhiIst: formatTz(now, 'Asia/Kolkata', false),
      londonGmt: formatTz(now, 'Europe/London', false),
      newYorkEst: formatTz(now, 'America/New_York', false),
      sanFranciscoPst: formatTz(now, 'America/Los_Angeles', false),
      tokyoJst: formatTz(now, 'Asia/Tokyo', false),
    },
  };
}

export function buildRealtimeTemporalSystemBlock(now: Date = new Date()): string {
  const t = getLiveTemporalContext(now);
  return (
    `\n\n[VERIFIED REAL-TIME CLOCK & TEMPORAL CONTEXT]\n` +
    `- Current UTC Timestamp: ${t.isoUtc} (${t.utcFormatted})\n` +
    `- Current India Standard Time (IST / Asia/Kolkata): ${t.istFormatted} (${t.istDate}, ${t.istTime24} IST)\n` +
    `- World Clocks: New York: ${t.worldClocks.newYorkEst} | London: ${t.worldClocks.londonGmt} | Tokyo: ${t.worldClocks.tokyoJst}\n` +
    `- Current Year: ${t.year}\n` +
    `- Instruction: Always use this exact real-time date and time when answering questions about "today", "now", "current time", "current date", "this week", or "this year".`
  );
}

/**
 * Extract weather city from natural language query
 */
export function detectWeatherCity(query: string): { wantsWeather: boolean; city?: string } {
  const clean = query.replace(/[?.!,;]+$/g, '').trim();
  const hasWeatherKeyword =
    /\b(weather|temperature|forecast|humidity|wind\s+speed|air\s+quality|aqi|pm2\.?5|rain|raining|snowing|climate|hot\s+or\s+cold|sunny)\b/i.test(
      clean
    );
  if (!hasWeatherKeyword) return { wantsWeather: false };

  const inMatch = clean.match(
    /(?:weather|temperature|forecast|humidity|air\s+quality|aqi|climate|rain)\s+(?:in|for|at|of|around|near)\s+([A-Za-z][A-Za-z\s,.-]{1,40}?)(?:\s+(?:right\s+now|today|now|currently|tomorrow|this\s+week))?$/i
  );
  if (inMatch?.[1]) {
    return { wantsWeather: true, city: inMatch[1].trim() };
  }

  const prefixMatch = clean.match(
    /(?:what(?:'s|\s+is)\s+(?:the\s+)?)?([A-Za-z][A-Za-z\s]{1,30}?)\s+(?:weather|temperature|forecast|aqi|air\s+quality)\b/i
  );
  if (prefixMatch?.[1]) {
    const candidate = prefixMatch[1]
      .replace(/^(?:current|live|today's|todays|the|in|at|for|tell\s+me|check)\s+/i, '')
      .trim();
    if (
      candidate &&
      !/^(what|how|is|the|current|live|today|tomorrow|weather|temperature|forecast|local|outside|my|here)$/i.test(candidate)
    ) {
      return { wantsWeather: true, city: candidate };
    }
  }

  return { wantsWeather: true, city: 'New Delhi' };
}

export async function fetchLiveWeatherSnapshot(cityQuery: string): Promise<LiveWeatherSnapshot | null> {
  try {
    const cleanCity = (cityQuery || 'New Delhi').trim();
    const geoResult = await geocodeLocationServer(cleanCity);
    const loc = geoResult.location;
    if (!loc) return null;

    const { latitude, longitude, name, country } = loc;
    const weatherPromise = fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto`,
      { signal: AbortSignal.timeout(5000) }
    );
    const aqiPromise = fetch(
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=pm10,pm2_5,us_aqi`,
      { signal: AbortSignal.timeout(4000) }
    ).catch(() => null);

    const [weatherRes, aqiRes] = await Promise.all([weatherPromise, aqiPromise]);
    if (!weatherRes.ok) return null;
    const weatherJson: any = await weatherRes.json();
    const current = weatherJson?.current;
    if (!current) return null;

    let pm25: number | undefined;
    let pm10: number | undefined;
    let usAqi: number | undefined;
    if (aqiRes && aqiRes.ok) {
      try {
        const aqiJson: any = await aqiRes.json();
        pm25 = aqiJson?.current?.pm2_5;
        pm10 = aqiJson?.current?.pm10;
        usAqi = aqiJson?.current?.us_aqi;
      } catch {}
    }

    const tempC = Math.round(Number(current.temperature_2m ?? 0) * 10) / 10;
    const tempF = Math.round(((tempC * 9) / 5 + 32) * 10) / 10;

    const forecast: LiveWeatherSnapshot['forecast'] = [];
    if (Array.isArray(weatherJson?.daily?.time)) {
      for (let i = 0; i < Math.min(5, weatherJson.daily.time.length); i++) {
        const code = Number(weatherJson.daily.weather_code?.[i] ?? 0);
        forecast.push({
          date: String(weatherJson.daily.time[i]),
          condition: WMO_CODES[code] || 'Clear',
          maxC: Math.round(Number(weatherJson.daily.temperature_2m_max?.[i] ?? tempC)),
          minC: Math.round(Number(weatherJson.daily.temperature_2m_min?.[i] ?? tempC)),
        });
      }
    }

    return {
      city: String(name || cleanCity),
      country: country ? String(country) : undefined,
      latitude: Number(latitude),
      longitude: Number(longitude),
      temperatureC: tempC,
      temperatureF: tempF,
      feelsLikeC: Math.round(Number(current.apparent_temperature ?? tempC) * 10) / 10,
      humidity: Math.round(Number(current.relative_humidity_2m ?? 0)),
      windSpeedKmh: Math.round(Number(current.wind_speed_10m ?? 0) * 10) / 10,
      precipitationMm: Number(current.precipitation ?? 0),
      condition: WMO_CODES[Number(current.weather_code ?? 0)] || 'Clear',
      pm25,
      pm10,
      usAqi,
      forecast,
      fetchedAtUtc: new Date().toISOString(),
      sourceUrl: 'https://open-meteo.com/',
    };
  } catch {
    return null;
  }
}

const CURRENCY_ALIASES: Record<string, string> = {
  usd: 'USD',
  dollar: 'USD',
  dollars: 'USD',
  inr: 'INR',
  rupee: 'INR',
  rupees: 'INR',
  eur: 'EUR',
  euro: 'EUR',
  euros: 'EUR',
  gbp: 'GBP',
  pound: 'GBP',
  pounds: 'GBP',
  jpy: 'JPY',
  yen: 'JPY',
  aud: 'AUD',
  cad: 'CAD',
  sgd: 'SGD',
  chf: 'CHF',
  cny: 'CNY',
  yuan: 'CNY',
  aed: 'AED',
  dirham: 'AED',
};

export function detectCurrencyQuery(query: string): {
  wantsCurrency: boolean;
  base: string;
  target: string;
  amount: number;
} {
  const lower = query.toLowerCase();
  const pairMatch = lower.match(
    /(?:(\d+(?:\.\d+)?)\s*)?\b(usd|inr|eur|gbp|jpy|aud|cad|sgd|chf|cny|aed|dollars?|rupees?|euros?|pounds?|yen|dirhams?)\b\s*(?:to|in|into|vs|\/)\s*\b(usd|inr|eur|gbp|jpy|aud|cad|sgd|chf|cny|aed|dollars?|rupees?|euros?|pounds?|yen|dirhams?)\b/i
  );
  if (pairMatch) {
    const amount = pairMatch[1] ? Number(pairMatch[1]) : 1;
    const base = CURRENCY_ALIASES[pairMatch[2].toLowerCase()] || 'USD';
    const target = CURRENCY_ALIASES[pairMatch[3].toLowerCase()] || (base === 'USD' ? 'INR' : 'USD');
    return { wantsCurrency: true, base, target, amount: Number.isFinite(amount) && amount > 0 ? amount : 1 };
  }

  if (/\b(exchange\s+rate|forex\s+rate|currency\s+rate|dollar\s+rate|usd\s+rate|rupee\s+rate)\b/i.test(lower)) {
    return { wantsCurrency: true, base: 'USD', target: 'INR', amount: 1 };
  }

  return { wantsCurrency: false, base: 'USD', target: 'INR', amount: 1 };
}

export async function fetchLiveExchangeRates(
  base = 'USD',
  target = 'INR',
  amount = 1
): Promise<LiveCurrencySnapshot | null> {
  const cleanBase = base.toUpperCase();
  const cleanTarget = target.toUpperCase();
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(cleanBase)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data: any = await res.json();
      const rates = data?.rates || {};
      const rate = cleanBase === cleanTarget ? 1 : Number(rates[cleanTarget]);
      if (Number.isFinite(rate) && rate > 0) {
        return {
          base: cleanBase,
          target: cleanTarget,
          amount,
          rate,
          convertedAmount: Math.round(amount * rate * 10000) / 10000,
          date: String(data?.date || new Date().toISOString().slice(0, 10)),
          topRates: {
            INR: rates.INR,
            EUR: rates.EUR,
            GBP: rates.GBP,
            JPY: rates.JPY,
            AUD: rates.AUD,
            CAD: rates.CAD,
            SGD: rates.SGD,
          },
          sourceUrl: 'https://www.frankfurter.dev/',
        };
      }
    }
  } catch {}

  try {
    const fallbackRes = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(cleanBase)}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (fallbackRes.ok) {
      const data: any = await fallbackRes.json();
      const rates = data?.rates || {};
      const rate = cleanBase === cleanTarget ? 1 : Number(rates[cleanTarget]);
      if (Number.isFinite(rate) && rate > 0) {
        return {
          base: cleanBase,
          target: cleanTarget,
          amount,
          rate,
          convertedAmount: Math.round(amount * rate * 10000) / 10000,
          date: String(data?.time_last_update_utc || new Date().toISOString()),
          topRates: {
            INR: rates.INR,
            EUR: rates.EUR,
            GBP: rates.GBP,
            JPY: rates.JPY,
            AED: rates.AED,
          },
          sourceUrl: 'https://www.exchangerate-api.com/',
        };
      }
    }
  } catch {}

  return null;
}

export function detectCryptoQuery(query: string): boolean {
  return /\b(bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|ripple|xrp|cardano|ada|crypto|cryptocurrency|coin\s+price)\b/i.test(
    query
  );
}

export async function fetchLiveCryptoPrices(): Promise<LiveCryptoItem[]> {
  const items: LiveCryptoItem[] = [];
  try {
    const cgRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,dogecoin,ripple&vs_currencies=usd,inr&include_24hr_change=true',
      { signal: AbortSignal.timeout(5000) }
    );
    if (cgRes.ok) {
      const data: any = await cgRes.json();
      const map: Array<{ id: string; symbol: string; name: string }> = [
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
        { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
        { id: 'solana', symbol: 'SOL', name: 'Solana' },
        { id: 'ripple', symbol: 'XRP', name: 'XRP' },
        { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
      ];
      for (const coin of map) {
        const entry = data?.[coin.id];
        if (entry && typeof entry.usd === 'number') {
          items.push({
            id: coin.id,
            symbol: coin.symbol,
            name: coin.name,
            priceUsd: entry.usd,
            priceInr: typeof entry.inr === 'number' ? entry.inr : undefined,
            change24hPct:
              typeof entry.usd_24h_change === 'number'
                ? Math.round(entry.usd_24h_change * 100) / 100
                : undefined,
          });
        }
      }
      if (items.length > 0) return items;
    }
  } catch {}

  // Fallback to Coinbase Spot API
  try {
    const pairs = [
      { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
      { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
      { id: 'solana', symbol: 'SOL', name: 'Solana' },
    ];
    await Promise.all(
      pairs.map(async (coin) => {
        try {
          const r = await fetch(`https://api.coinbase.com/v2/prices/${coin.symbol}-USD/spot`, {
            signal: AbortSignal.timeout(4000),
          });
          if (r.ok) {
            const j: any = await r.json();
            const amount = Number(j?.data?.amount);
            if (Number.isFinite(amount)) {
              items.push({
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name,
                priceUsd: amount,
              });
            }
          }
        } catch {}
      })
    );
  } catch {}

  return items;
}

export async function fetchLiveNewsAndFacts(query: string, limit = 5): Promise<LiveNewsOrFactItem[]> {
  const results: LiveNewsOrFactItem[] = [];
  const lower = query.toLowerCase();
  const isTechOrGeneralNews = /\b(news|headlines|top\s+stories|tech\s+news|breaking|world\s+news|latest\s+events|what's\s+happening|whats\s+happening)\b/i.test(
    lower
  );
  const isSpaceQuery = /\b(nasa|space|spacex|isro|astronomy|rocket|satellite|mars|moon|artemis|orbit)\b/i.test(lower);
  const isEarthquakeQuery = /\b(earthquake|seismic|tremor|tsunami|usgs|magnitude)\b/i.test(lower);

  const jobs: Promise<void>[] = [];

  if (isEarthquakeQuery) {
    jobs.push(
      (async () => {
        try {
          const eqRes = await fetch(
            'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson',
            { signal: AbortSignal.timeout(5000) }
          );
          if (eqRes.ok) {
            const eqData: any = await eqRes.json();
            const features = Array.isArray(eqData?.features) ? eqData.features.slice(0, 4) : [];
            for (const f of features) {
              const props = f?.properties;
              if (props?.title && props?.url) {
                const timeIso = props.time ? new Date(props.time).toISOString() : undefined;
                results.push({
                  title: String(props.title),
                  url: String(props.url),
                  snippet: `Magnitude ${props.mag} seismic event at ${props.place}${timeIso ? ` (${timeIso})` : ''}.`,
                  source: 'USGS Live Seismic Feed',
                  publishedAt: timeIso,
                });
              }
            }
          }
        } catch {}
      })()
    );
  }

  if (isSpaceQuery || isTechOrGeneralNews) {
    jobs.push(
      (async () => {
        try {
          const sfRes = await fetch('https://api.spaceflightnewsapi.net/v4/articles/?limit=4', {
            signal: AbortSignal.timeout(4500),
          });
          if (sfRes.ok) {
            const sfData: any = await sfRes.json();
            const articles = Array.isArray(sfData?.results) ? sfData.results : [];
            for (const art of articles) {
              if (art?.title && art?.url) {
                results.push({
                  title: String(art.title),
                  url: String(art.url),
                  snippet: String(art.summary || '').slice(0, 400),
                  source: String(art.news_site || 'Spaceflight News'),
                  publishedAt: art.published_at ? String(art.published_at) : undefined,
                });
              }
            }
          }
        } catch {}
      })()
    );
  }

  if (isTechOrGeneralNews) {
    jobs.push(
      (async () => {
        try {
          const hnIdsRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
            signal: AbortSignal.timeout(4000),
          });
          if (hnIdsRes.ok) {
            const ids: any = await hnIdsRes.json();
            if (Array.isArray(ids) && ids.length > 0) {
              const topIds = ids.slice(0, 4);
              const stories = await Promise.all(
                topIds.map(async (id: number) => {
                  try {
                    const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
                      signal: AbortSignal.timeout(3000),
                    });
                    return r.ok ? await r.json() : null;
                  } catch {
                    return null;
                  }
                })
              );
              for (const st of stories) {
                if (st?.title) {
                  const url = st.url || `https://news.ycombinator.com/item?id=${st.id}`;
                  results.push({
                    title: String(st.title),
                    url: String(url),
                    snippet: `Live top technology story (${st.score || 0} points, ${st.descendants || 0} comments).`,
                    source: 'Hacker News Live',
                    publishedAt: st.time ? new Date(st.time * 1000).toISOString() : undefined,
                  });
                }
              }
            }
          }
        } catch {}
      })()
    );
  }

  // Wikipedia & DuckDuckGo live knowledge lookup for factual queries
  const cleanSearchQuery = query
    .replace(/^(what is|whats|who is|whos|where is|tell me about|search for|latest on|explain)\s+/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  if (cleanSearchQuery.length >= 2) {
    jobs.push(
      (async () => {
        try {
          const wikiRes = await fetch(
            `https://en.wikipedia.org/w/rest.php/v1/search/page?q=${encodeURIComponent(cleanSearchQuery)}&limit=3`,
            { signal: AbortSignal.timeout(4500) }
          );
          if (wikiRes.ok) {
            const wikiData: any = await wikiRes.json();
            const pages = Array.isArray(wikiData?.pages) ? wikiData.pages : [];
            for (const p of pages) {
              const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(p.key || p.title || '')}`;
              const cleanExcerpt = String(p.description || p.excerpt || '')
                .replace(/<[^>]+>/g, '')
                .replace(/&quot;/g, '"')
                .replace(/&amp;/g, '&')
                .trim();
              if (p.title && cleanExcerpt) {
                results.push({
                  title: String(p.title),
                  url,
                  snippet: cleanExcerpt.slice(0, 500),
                  source: 'Wikipedia Live API',
                });
              }
            }
          }
        } catch {}
      })()
    );

    jobs.push(
      (async () => {
        try {
          const ddgRes = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(cleanSearchQuery)}&format=json&no_html=1&skip_disambig=1`,
            { signal: AbortSignal.timeout(4500) }
          );
          if (ddgRes.ok) {
            const ddg: any = await ddgRes.json();
            if (ddg?.AbstractText && ddg?.AbstractURL) {
              results.push({
                title: String(ddg.Heading || cleanSearchQuery),
                url: String(ddg.AbstractURL),
                snippet: String(ddg.AbstractText).slice(0, 600),
                source: 'DuckDuckGo Instant Answer',
              });
            }
          }
        } catch {}
      })()
    );
  }

  await Promise.all(jobs);
  return results.slice(0, limit);
}

/**
 * Determines whether a prompt asks for real-time data, live facts, or current information
 */
export function isRealtimeOrLiveFactQuery(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  if (
    /^(hi|hello|hey|hiya|howdy|yo|namaste|greetings|good\s+(morning|afternoon|evening|night)|thanks|thank you|ok|okay)[!?.\s]*$/i.test(
      clean
    )
  ) {
    return false;
  }
  if (
    /which model|what model|what llm|which llm|underlying model|what ai model|model are you|who built you|your architecture/i.test(
      clean
    )
  ) {
    return false;
  }
  return (
    /\b(latest|today|current|currently|right\s+now|now|breaking|live|real[\s-]?time|news|headlines|recent|this\s+week|this\s+month|this\s+year|yesterday|weather|temperature|forecast|aqi|air\s+quality|humidity|stock\s+price|share\s+price|market\s+cap|exchange\s+rate|forex|usd|inr|eur|gbp|jpy|bitcoin|btc|ethereum|eth|solana|crypto|cryptocurrency|gold\s+price|silver\s+price|world\s+news|india\s+news|tech\s+news|space\s+news|earthquake|election|box\s+office|release\s+date|latest\s+version|price\s+today|score|standings|ipl|world\s+cup|who\s+won|who\s+is\s+(the\s+)?(prime\s+minister|president|chief\s+minister|ceo|founder|governor|richest|champion)|what\s+time|what\s+is\s+the\s+date|today's\s+date|todays\s+date|day\s+today)\b/i.test(
      clean
    ) ||
    /\b(202[5-9]|203\d)\b/.test(clean) ||
    /\b(what\s+happened|what's\s+happening|whats\s+happening|tell\s+me\s+about\s+the\s+latest|latest\s+on)\b/i.test(
      clean
    )
  );
}

/**
 * Master real-time data enricher for any user query
 */
export async function enrichQueryWithRealtimeData(query: string): Promise<RealtimeEnrichmentResult> {
  const now = new Date();
  const temporal = getLiveTemporalContext(now);
  const clean = (query || '').trim();
  const sources: Array<{ title: string; url: string }> = [];
  const contextBlocks: string[] = [buildRealtimeTemporalSystemBlock(now)];

  const isTimeOrDateOnly =
    /\b(what\s+time\s+is\s+it|current\s+time|time\s+right\s+now|time\s+in\s+india|ist\s+time|utc\s+time|what\s+is\s+the\s+date|what's\s+the\s+date|todays?\s+date|what\s+day\s+is\s+(it|today))\b/i.test(
      clean
    );

  const weatherDetect = detectWeatherCity(clean);
  const currencyDetect = detectCurrencyQuery(clean);
  const wantsCrypto = detectCryptoQuery(clean);
  const wantsLiveSearch = isRealtimeOrLiveFactQuery(clean);

  let weather: LiveWeatherSnapshot | null = null;
  let currency: LiveCurrencySnapshot | null = null;
  let crypto: LiveCryptoItem[] = [];
  let newsAndFacts: LiveNewsOrFactItem[] = [];

  const tasks: Promise<void>[] = [];

  if (weatherDetect.wantsWeather && weatherDetect.city) {
    tasks.push(
      fetchLiveWeatherSnapshot(weatherDetect.city).then((w) => {
        weather = w;
      })
    );
  }

  if (currencyDetect.wantsCurrency) {
    tasks.push(
      fetchLiveExchangeRates(currencyDetect.base, currencyDetect.target, currencyDetect.amount).then((c) => {
        currency = c;
      })
    );
  }

  if (wantsCrypto) {
    tasks.push(
      fetchLiveCryptoPrices().then((items) => {
        crypto = items;
      })
    );
  }

  if (wantsLiveSearch && !isTimeOrDateOnly && !weatherDetect.wantsWeather && !currencyDetect.wantsCurrency) {
    tasks.push(
      fetchLiveNewsAndFacts(clean, 5).then((items) => {
        newsAndFacts = items;
      })
    );
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
  }

  if (weather) {
    const w = weather as LiveWeatherSnapshot;
    const aqiLine =
      w.usAqi !== undefined || w.pm25 !== undefined
        ? `\n- Air Quality: ${w.usAqi !== undefined ? `US AQI ${w.usAqi}` : ''}${w.pm25 !== undefined ? ` | PM2.5: ${w.pm25} µg/m³` : ''}${w.pm10 !== undefined ? ` | PM10: ${w.pm10} µg/m³` : ''}`
        : '';
    const forecastSummary = w.forecast
      .slice(0, 4)
      .map((f) => `${f.date}: ${f.condition} (${f.minC}°C–${f.maxC}°C)`)
      .join(' | ');
    contextBlocks.push(
      `\n[LIVE WEATHER & AIR QUALITY DATA (Open-Meteo Real-Time Satellite/Station Feed)]\n` +
        `- Location: ${w.city}${w.country ? `, ${w.country}` : ''} (${w.latitude.toFixed(2)}, ${w.longitude.toFixed(2)})\n` +
        `- Current Condition: ${w.condition}\n` +
        `- Temperature: ${w.temperatureC}°C (${w.temperatureF}°F) | Feels Like: ${w.feelsLikeC}°C\n` +
        `- Humidity: ${w.humidity}% | Wind Speed: ${w.windSpeedKmh} km/h | Precipitation: ${w.precipitationMm} mm` +
        aqiLine +
        (forecastSummary ? `\n- Upcoming Forecast: ${forecastSummary}` : '') +
        `\n- Observed At: ${w.fetchedAtUtc}`
    );
    sources.push({
      title: `Open-Meteo Live Weather — ${w.city}`,
      url: w.sourceUrl,
    });
  }

  if (currency) {
    const c = currency as LiveCurrencySnapshot;
    contextBlocks.push(
      `\n[LIVE FOREIGN EXCHANGE RATE (Real-Time Central Bank Feed)]\n` +
        `- Conversion: ${c.amount} ${c.base} = ${c.convertedAmount} ${c.target} (1 ${c.base} = ${c.rate} ${c.target})\n` +
        `- Reference Date: ${c.date}`
    );
    sources.push({
      title: `Frankfurter Live FX Rates (${c.base}/${c.target})`,
      url: c.sourceUrl,
    });
  }

  if (crypto.length > 0) {
    const lines = crypto
      .map(
        (coin) =>
          `- ${coin.name} (${coin.symbol}): $${coin.priceUsd.toLocaleString('en-US')}${
            coin.priceInr ? ` / ₹${coin.priceInr.toLocaleString('en-IN')}` : ''
          }${coin.change24hPct !== undefined ? ` (${coin.change24hPct >= 0 ? '+' : ''}${coin.change24hPct}% 24h)` : ''}`
      )
      .join('\n');
    contextBlocks.push(`\n[LIVE CRYPTOCURRENCY MARKET PRICES]\n${lines}\n- Fetched At: ${temporal.isoUtc}`);
    sources.push({
      title: 'CoinGecko / Coinbase Live Crypto Spot Feed',
      url: 'https://www.coingecko.com/',
    });
  }

  if (newsAndFacts.length > 0) {
    const lines = newsAndFacts
      .map(
        (item, idx) =>
          `${idx + 1}. **${item.title}** (${item.source}${item.publishedAt ? ` · ${item.publishedAt.slice(0, 10)}` : ''})\n   ${item.snippet}\n   URL: ${item.url}`
      )
      .join('\n');
    contextBlocks.push(
      `\n[LIVE WEB & NEWS INTELLIGENCE SNAPSHOT]\n${lines}\nUse these verified real-time facts and URLs to ground your answer.`
    );
    for (const item of newsAndFacts) {
      if (item.url && /^https?:\/\//i.test(item.url)) {
        sources.push({ title: item.title, url: item.url });
      }
    }
  }

  // Build a direct fallback markdown answer if the LLM key is unavailable or rate-limited
  let directFallbackMarkdown: string | undefined;

  if (isTimeOrDateOnly) {
    directFallbackMarkdown =
      `### Live Real-Time Date & Clock\n\n` +
      `- **India Standard Time (IST):** ${temporal.istFormatted} (\`${temporal.istTime24} IST\`)\n` +
      `- **UTC Time:** ${temporal.utcFormatted}\n` +
      `- **Date:** ${temporal.istDate}\n\n` +
      `#### World Clocks\n` +
      `- **New York:** ${temporal.worldClocks.newYorkEst}\n` +
      `- **London:** ${temporal.worldClocks.londonGmt}\n` +
      `- **Tokyo:** ${temporal.worldClocks.tokyoJst}\n` +
      `- **San Francisco:** ${temporal.worldClocks.sanFranciscoPst}`;
  } else if (weather) {
    const w = weather as LiveWeatherSnapshot;
    directFallbackMarkdown =
      `### Live Weather in ${w.city}${w.country ? `, ${w.country}` : ''}\n\n` +
      `- **Condition:** ${w.condition}\n` +
      `- **Temperature:** **${w.temperatureC}°C** (${w.temperatureF}°F) — *Feels like ${w.feelsLikeC}°C*\n` +
      `- **Humidity:** ${w.humidity}%\n` +
      `- **Wind Speed:** ${w.windSpeedKmh} km/h\n` +
      (w.usAqi !== undefined ? `- **Air Quality (US AQI):** ${w.usAqi} (PM2.5: ${w.pm25 ?? 'N/A'} µg/m³)\n` : '') +
      (w.forecast.length > 0
        ? `\n#### 5-Day Forecast\n` +
          w.forecast.map((f) => `- **${f.date}:** ${f.condition}, ${f.minC}°C – ${f.maxC}°C`).join('\n')
        : '') +
      `\n\n**Sources**\n- [Open-Meteo Live Weather — ${w.city}](${w.sourceUrl})`;
  } else if (currency) {
    const c = currency as LiveCurrencySnapshot;
    directFallbackMarkdown =
      `### Live Currency Exchange Rate (${c.base} → ${c.target})\n\n` +
      `- **${c.amount} ${c.base}** = **${c.convertedAmount} ${c.target}**\n` +
      `- **Spot Rate:** 1 ${c.base} = ${c.rate} ${c.target}\n` +
      `- **Reference Date:** ${c.date}\n\n` +
      `**Sources**\n- [Frankfurter Live FX Rates](${c.sourceUrl})`;
  } else if (crypto.length > 0) {
    directFallbackMarkdown =
      `### Live Cryptocurrency Market Prices\n\n` +
      crypto
        .map(
          (coin) =>
            `- **${coin.name} (${coin.symbol}):** $${coin.priceUsd.toLocaleString('en-US')}${
              coin.priceInr ? ` (₹${coin.priceInr.toLocaleString('en-IN')})` : ''
            }${coin.change24hPct !== undefined ? ` · **${coin.change24hPct >= 0 ? '+' : ''}${coin.change24hPct}%** (24h)` : ''}`
        )
        .join('\n') +
      `\n\n*Updated: ${temporal.utcFormatted}*\n\n**Sources**\n- [CoinGecko Live Crypto Prices](https://www.coingecko.com/)`;
  } else if (newsAndFacts.length > 0) {
    directFallbackMarkdown =
      `### Real-Time Information & Live Results\n\n` +
      newsAndFacts
        .map(
          (item) =>
            `- **[${item.title}](${item.url})** *(${item.source})*\n  ${item.snippet}`
        )
        .join('\n\n') +
      `\n\n*Retrieved live at ${temporal.utcFormatted}*\n\n**Sources**\n` +
      newsAndFacts.map((item) => `- [${item.title.replace(/[\[\]]/g, '')}](${item.url})`).join('\n');
  }

  return {
    temporal,
    hasLiveDomainData: Boolean(
      isTimeOrDateOnly || weather || currency || crypto.length > 0 || newsAndFacts.length > 0
    ),
    weather,
    currency,
    crypto,
    newsAndFacts,
    sources,
    systemContextBlock: contextBlocks.join('\n'),
    directFallbackMarkdown,
  };
}
