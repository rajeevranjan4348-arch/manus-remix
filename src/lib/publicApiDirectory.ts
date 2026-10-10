/**
 * Category index based on the community-maintained public-apis directory.
 *
 * This is a discovery/index layer, not a claim that every listed service is
 * integrated or that API keys are available for free. Individual providers
 * have different authentication, pricing, CORS, rate-limit, and usage terms.
 */
export const PUBLIC_API_DIRECTORY_SOURCE =
  'https://github.com/public-apis/public-apis';

export const PUBLIC_API_CATEGORIES = [
  'Animals',
  'Anime',
  'Anti-Malware',
  'Art & Design',
  'Authentication & Authorization',
  'Blockchain',
  'Books',
  'Business',
  'Calendar',
  'Cloud Storage & File Sharing',
  'Continuous Integration',
  'Cryptocurrency',
  'Currency Exchange',
  'Data Validation',
  'Development',
  'Dictionaries',
  'Documents & Productivity',
  'Email',
  'Entertainment',
  'Environment',
  'Events',
  'Finance',
  'Food & Drink',
  'Games & Comics',
  'Geocoding',
  'Government',
  'Health',
  'Jobs',
  'Machine Learning',
  'Music',
  'News',
  'Open Data',
  'Open Source Projects',
  'Patent',
  'Personality',
  'Phone',
  'Photography',
  'Programming',
  'Science & Math',
  'Security',
  'Shopping',
  'Social',
  'Sports & Fitness',
  'Test Data',
  'Text Analysis',
  'Tracking',
  'Transportation',
  'URL Shorteners',
  'Vehicle',
  'Video',
  'Weather',
] as const;

export type PublicApiDirectoryCategory =
  (typeof PUBLIC_API_CATEGORIES)[number];

export interface PublicApiDirectoryInfo {
  source: string;
  categories: readonly PublicApiDirectoryCategory[];
  catalogEntryCount: number;
  integrationNotice: string;
}

/**
 * Keep directory discovery separate from the small set of API integrations
 * that have explicit endpoints in publicApiCatalog.ts.
 */
export const PUBLIC_API_DIRECTORY_INFO: PublicApiDirectoryInfo = {
  source: PUBLIC_API_DIRECTORY_SOURCE,
  categories: PUBLIC_API_CATEGORIES,
  catalogEntryCount: 9,
  integrationNotice:
    'Categories are indexed for discovery. An API is only runtime-integrated when it has a verified endpoint, supported auth handling, and an implemented call path. Provider-issued API keys must be configured separately; never store private keys in VITE_* variables.',
};
