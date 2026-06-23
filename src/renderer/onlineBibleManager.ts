export interface BibleInfo {
  filename: string;
  name: string;
  language: string;
  version: string;
  size: number;
  sha: string;
  url: string;
}

export interface FetchResult {
  bibles: BibleInfo[];
  timestamp: number;
  language?: string;
}

interface GitHubFile {
  name: string;
  size: number;
  sha: string;
  url: string;
  download_url: string;
}

const CONFIG = {
  REPO_OWNER: 'Beblia',
  REPO_NAME: 'Holy-Bible-XML-Format',
  API_BASE: 'https://api.github.com',
  CACHE_DURATION: 24 * 60 * 60 * 1000,
  TIMEOUT: 30000,
};

function parseFileName(filename: string): { language: string; version: string } {
  const withoutExt = filename.replace('.xml', '');
  const versionMatch = withoutExt.match(/(\d+[A-Z]*|[A-Z]{2,})Bible$/i);
  let version = versionMatch ? versionMatch[1] : 'Standard';
  let language = withoutExt.replace(/Bible$/, '').replace(version, '');
  if (!language || language === '') {
    language = withoutExt.replace(/Bible$/, '');
    version = 'Bible';
  }
  return { language, version };
}

function getBibleName(filename: string): string {
  const { language, version } = parseFileName(filename);
  if (version === 'Bible' || version === 'Standard') {
    return `${language} Bible`;
  }
  return `${language} ${version} Bible`;
}

class OnlineBibleManager {
  private static instance: OnlineBibleManager;
  private cache: Map<string, FetchResult> = new Map();

  private constructor() {}

  static getInstance(): OnlineBibleManager {
    if (!this.instance) {
      this.instance = new OnlineBibleManager();
    }
    return this.instance;
  }

  async fetchBibleList(language?: string): Promise<FetchResult> {
    const cacheKey = `bibleList:${language || 'all'}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const url = `${CONFIG.API_BASE}/repos/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/contents`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
      }

      const files: GitHubFile[] = await response.json();

      const bibles = files
        .filter((f: GitHubFile) => f.name.endsWith('.xml'))
        .map((f: GitHubFile) => this.fileToBibleInfo(f))
        .sort((a, b) => a.language.localeCompare(b.language));

      let filtered = bibles;
      if (language) {
        filtered = bibles.filter(b =>
          b.language.toLowerCase().includes(language.toLowerCase())
        );
      }

      const result: FetchResult = {
        bibles: filtered,
        timestamp: Date.now(),
        language,
      };

      this.setCache(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Failed to fetch bible list:', error);
      throw new Error(
        `Failed to fetch Bible list from GitHub. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async downloadBibleXml(filename: string): Promise<string> {
    try {
      const url = `https://raw.githubusercontent.com/${CONFIG.REPO_OWNER}/${CONFIG.REPO_NAME}/master/${filename}`;
      const response = await this.fetchWithTimeout(url);

      if (!response.ok) {
        throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
      }

      const content = await response.text();

      if (!content || content.trim().length === 0) {
        throw new Error('Downloaded file is empty');
      }

      return content;
    } catch (error) {
      console.error('Failed to download Bible XML:', error);
      throw new Error(
        `Failed to download Bible file: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async searchByLanguage(language: string): Promise<BibleInfo[]> {
    const result = await this.fetchBibleList(language);
    return result.bibles;
  }

  async getTurkishBibles(): Promise<BibleInfo[]> {
    return this.searchByLanguage('Turkish');
  }

  private fileToBibleInfo(file: GitHubFile): BibleInfo {
    const { language, version } = parseFileName(file.name);
    const name = getBibleName(file.name);

    return {
      filename: file.name,
      name,
      language,
      version,
      size: file.size,
      sha: file.sha,
      url: file.url,
    };
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.TIMEOUT);

    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  private getFromCache(key: string): FetchResult | null {
    const cached = this.cache.get(key);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > CONFIG.CACHE_DURATION) {
      this.cache.delete(key);
      return null;
    }

    return cached;
  }

  private setCache(key: string, value: FetchResult): void {
    this.cache.set(key, value);
  }

  clearCache(): void {
    this.cache.clear();
  }
}

export const onlineBibleManager = OnlineBibleManager.getInstance();

export { OnlineBibleManager };
