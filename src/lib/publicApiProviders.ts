/**
 * Representative API providers for the 51 categories in the project brief.
 * Endpoints are templates; providers can change authentication, availability,
 * pricing, CORS and terms. This registry routes the agent's existing fetch_url /
 * web_search tools; it is not a guarantee that every endpoint is currently live.
 */
export interface PublicApiProvider {
  category: string;
  provider: string;
  exampleUrl: string;
  auth: 'none' | 'optional' | 'required' | 'unknown';
}

export const PUBLIC_API_PROVIDERS: PublicApiProvider[] = [
  { category: "Animals", provider: "Dog CEO", exampleUrl: "https://dog.ceo/api/breeds/list/all", auth: "none" },
  { category: "Anime", provider: "Jikan", exampleUrl: "https://api.jikan.moe/v4/anime?q=naruto&limit=5", auth: "none" },
  { category: "Anti-Malware", provider: "URLhaus", exampleUrl: "https://urlhaus-api.abuse.ch/v1/", auth: "none" },
  { category: "Art & Design", provider: "Art Institute of Chicago", exampleUrl: "https://api.artic.edu/api/v1/artworks/search?q=monet&limit=5", auth: "none" },
  { category: "Authentication & Authorization", provider: "Google OpenID configuration", exampleUrl: "https://accounts.google.com/.well-known/openid-configuration", auth: "none" },
  { category: "Blockchain", provider: "Blockchair", exampleUrl: "https://api.blockchair.com/bitcoin/stats", auth: "optional" },
  { category: "Books", provider: "Open Library", exampleUrl: "https://openlibrary.org/search.json?title=The%20Hobbit&limit=5", auth: "none" },
  { category: "Business", provider: "OpenCorporates", exampleUrl: "https://api.opencorporates.com/v0.4/companies/search?q=OpenAI", auth: "optional" },
  { category: "Calendar", provider: "Nager.Date", exampleUrl: "https://date.nager.at/api/v3/PublicHolidays/2026/IN", auth: "none" },
  { category: "Cloud Storage & File Sharing", provider: "Internet Archive", exampleUrl: "https://archive.org/advancedsearch.php?q=subject%3Asoftware&output=json&rows=5", auth: "none" },
  { category: "Continuous Integration", provider: "GitHub Actions", exampleUrl: "https://api.github.com/repos/vitejs/vite/actions/runs?per_page=5", auth: "optional" },
  { category: "Cryptocurrency", provider: "CoinGecko", exampleUrl: "https://api.coingecko.com/api/v3/ping", auth: "optional" },
  { category: "Currency Exchange", provider: "Frankfurter", exampleUrl: "https://api.frankfurter.dev/v1/latest?base=USD", auth: "none" },
  { category: "Data Validation", provider: "Zippopotam.us", exampleUrl: "https://api.zippopotam.us/us/90210", auth: "none" },
  { category: "Development", provider: "GitHub REST", exampleUrl: "https://api.github.com/repos/nodejs/node", auth: "optional" },
  { category: "Dictionaries", provider: "Free Dictionary API", exampleUrl: "https://api.dictionaryapi.dev/api/v2/entries/en/hello", auth: "none" },
  { category: "Documents & Productivity", provider: "LibreOffice", exampleUrl: "https://www.libreoffice.org/", auth: "none" },
  { category: "Email", provider: "Abstract Email Validation", exampleUrl: "https://emailvalidation.abstractapi.com/v1/?api_key=YOUR_KEY&email=test%40example.com", auth: "required" },
  { category: "Entertainment", provider: "TVMaze", exampleUrl: "https://api.tvmaze.com/search/shows?q=office", auth: "none" },
  { category: "Environment", provider: "Open-Meteo Air Quality", exampleUrl: "https://air-quality-api.open-meteo.com/v1/air-quality?latitude=28.6139&longitude=77.2090&current=pm10,pm2_5", auth: "none" },
  { category: "Events", provider: "Ticketmaster Discovery", exampleUrl: "https://app.ticketmaster.com/discovery/v2/events.json?apikey=YOUR_KEY&keyword=music", auth: "required" },
  { category: "Finance", provider: "US Treasury Fiscal Data", exampleUrl: "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/avg_interest_rates?sort=-record_date&page[size]=5", auth: "none" },
  { category: "Food & Drink", provider: "TheMealDB", exampleUrl: "https://www.themealdb.com/api/json/v1/1/search.php?s=Arrabiata", auth: "none" },
  { category: "Games & Comics", provider: "PokéAPI", exampleUrl: "https://pokeapi.co/api/v2/pokemon/pikachu", auth: "none" },
  { category: "Geocoding", provider: "Open-Meteo Geocoding", exampleUrl: "https://geocoding-api.open-meteo.com/v1/search?name=Jaipur&count=5", auth: "none" },
  { category: "Government", provider: "Data.gov", exampleUrl: "https://catalog.data.gov/api/3/action/package_search?q=climate", auth: "none" },
  { category: "Health", provider: "openFDA", exampleUrl: "https://api.fda.gov/drug/label.json?limit=1", auth: "none" },
  { category: "Jobs", provider: "Arbeitnow", exampleUrl: "https://www.arbeitnow.com/api/job-board-api", auth: "none" },
  { category: "Machine Learning", provider: "Hugging Face Inference", exampleUrl: "https://api-inference.huggingface.co/models/", auth: "required" },
  { category: "Music", provider: "MusicBrainz", exampleUrl: "https://musicbrainz.org/ws/2/artist/?query=artist%3Aradiohead&fmt=json", auth: "none" },
  { category: "News", provider: "The Guardian Open Platform", exampleUrl: "https://content.guardianapis.com/search?api-key=YOUR_KEY&q=India", auth: "required" },
  { category: "Open Data", provider: "World Bank Indicators", exampleUrl: "https://api.worldbank.org/v2/country/IND/indicator/SP.POP.TOTL?format=json", auth: "none" },
  { category: "Open Source Projects", provider: "GitHub REST", exampleUrl: "https://api.github.com/repos/public-apis/public-apis", auth: "optional" },
  { category: "Patent", provider: "PatentsView", exampleUrl: "https://search.patentsview.org/api/v1/patent/", auth: "unknown" },
  { category: "Personality", provider: "Bored API", exampleUrl: "https://bored-api.appbrewery.com/random", auth: "none" },
  { category: "Phone", provider: "Abstract Phone Validation", exampleUrl: "https://phonevalidation.abstractapi.com/v1/?api_key=YOUR_KEY&phone=14152007986", auth: "required" },
  { category: "Photography", provider: "Unsplash", exampleUrl: "https://api.unsplash.com/search/photos?query=mountains&client_id=YOUR_KEY", auth: "required" },
  { category: "Programming", provider: "Stack Exchange", exampleUrl: "https://api.stackexchange.com/2.3/search/advanced?site=stackoverflow&q=javascript&pagesize=5", auth: "none" },
  { category: "Science & Math", provider: "NASA APIs", exampleUrl: "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY", auth: "optional" },
  { category: "Security", provider: "Have I Been Pwned", exampleUrl: "https://haveibeenpwned.com/api/v3/breachedaccount/test%40example.com", auth: "required" },
  { category: "Shopping", provider: "Best Buy", exampleUrl: "https://api.bestbuy.com/v1/products?apiKey=YOUR_KEY&format=json", auth: "required" },
  { category: "Social", provider: "Mastodon", exampleUrl: "https://mastodon.social/api/v1/trends/tags", auth: "none" },
  { category: "Sports & Fitness", provider: "TheSportsDB", exampleUrl: "https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php?l=English%20Premier%20League", auth: "none" },
  { category: "Test Data", provider: "JSONPlaceholder", exampleUrl: "https://jsonplaceholder.typicode.com/posts/1", auth: "none" },
  { category: "Text Analysis", provider: "LanguageTool", exampleUrl: "https://api.languagetool.org/v2/languages", auth: "none" },
  { category: "Tracking", provider: "OpenSky Network", exampleUrl: "https://opensky-network.org/api/states/all", auth: "optional" },
  { category: "Transportation", provider: "Transport for London", exampleUrl: "https://api.tfl.gov.uk/Line/Mode/bus/Status", auth: "none" },
  { category: "URL Shorteners", provider: "is.gd", exampleUrl: "https://is.gd/create.php?format=json&url=https%3A%2F%2Fexample.com", auth: "none" },
  { category: "Vehicle", provider: "NHTSA Vehicle API", exampleUrl: "https://vpic.nhtsa.dot.gov/api/vehicles/GetMakesForVehicleType/car?format=json", auth: "none" },
  { category: "Video", provider: "YouTube Data API", exampleUrl: "https://www.googleapis.com/youtube/v3/search?part=snippet&q=music&key=YOUR_KEY", auth: "required" },
  { category: "Weather", provider: "Open-Meteo", exampleUrl: "https://api.open-meteo.com/v1/forecast?latitude=28.6139&longitude=77.2090&current=temperature_2m", auth: "none" },
];

export const PUBLIC_API_PROVIDER_GUIDE = `
API ROUTING DIRECTORY:
src/lib/publicApiProviders.ts lists a representative provider for each of 51 categories. For relevant requests, select the matching provider and use its example URL as a template with properly encoded user inputs. Use existing fetch_url or web_search tools; do not claim a call succeeded unless a tool returns data. URLs containing YOUR_KEY are examples only and must not be called as-is. Required credentials must be configured server-side and never exposed in VITE_* browser variables. Validate results, timestamps, rate limits, privacy, and provider terms; if unavailable, explain the limitation and use an alternative source.
`;
