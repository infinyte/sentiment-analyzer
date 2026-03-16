export class NewsAPIService {
  private apiKey: string;
  private apiUrl = 'https://newsapi.org/v2';

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.NEWSAPI_API_KEY ?? '';
  }

  async getHeadlines(topic: string, days: number = 7): Promise<string[]> {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - days);

      const response = await fetch(
        `${this.apiUrl}/everything?q=${encodeURIComponent(topic)}&sortBy=publishedAt&language=en&from=${fromDate.toISOString()}&apiKey=${this.apiKey}`,
        { headers: { Accept: 'application/json' } }
      );

      if (!response.ok) {
        console.warn(`NewsAPI responded with ${response.status}`);
        return [];
      }

      const data = (await response.json()) as any;
      return (data.articles || []).slice(0, 20).map((a: any) => a.title);
    } catch (error) {
      console.error('NewsAPI error:', error);
      return [];
    }
  }
}
