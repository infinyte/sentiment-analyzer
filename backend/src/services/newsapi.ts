import logger from '../logger.js';

export interface NewsArticle {
  title: string;
  description: string;
  url: string;
  sourceName: string;
  publishedAt?: string;
}

export class NewsAPIService {
  private apiKey: string;
  private apiUrl = 'https://newsapi.org/v2';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.NEWSAPI_API_KEY ?? '';
  }

  async getArticles(topic: string, days: number = 7): Promise<NewsArticle[]> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const response = await fetch(
        `${this.apiUrl}/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&language=en&from=${fromDate.toISOString().split('T')[0]}&apiKey=${this.apiKey}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        logger.warn('newsapi non-ok response', { topic, status: response.status });
        return [];
      }

      const data = (await response.json()) as any;
      return (data.articles || []).slice(0, 20).map((article: any) => ({
        title: article.title || '',
        description: article.description || '',
        url: article.url || '',
        sourceName: article.source?.name || 'NewsAPI',
        publishedAt: article.publishedAt,
      }));
    } catch (error) {
      logger.error('newsapi fetch error', { topic, error: String(error) });
      return [];
    }
  }

  async getHeadlines(topic: string, days: number = 7): Promise<string[]> {
    const articles = await this.getArticles(topic, days);
    return articles.map(article => article.title).filter(Boolean);
  }
}
