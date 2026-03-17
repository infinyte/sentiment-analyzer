import { extractCoins, extractHashtags, extractKeywords, extractAll } from '../../../services/social-media/scoring/coin-extractor';

describe('extractCoins', () => {
  it('detects $TICKER prefix', () => {
    expect(extractCoins('$BTC is mooning')).toContain('BTC');
  });

  it('detects #TICKER prefix', () => {
    expect(extractCoins('#ETH breaking out')).toContain('ETH');
  });

  it('detects bare uppercase symbol', () => {
    expect(extractCoins('SOL just broke $200')).toContain('SOL');
  });

  it('detects full coin name (case-insensitive)', () => {
    expect(extractCoins('bitcoin rallying hard today')).toContain('BTC');
    expect(extractCoins('Ethereum ETF approved')).toContain('ETH');
  });

  it('detects alternative coin names', () => {
    expect(extractCoins('dogecoin to the moon')).toContain('DOGE');
    expect(extractCoins('ripple XRP lawsuit settled')).toContain('XRP');
  });

  it('deduplicates when symbol appears multiple times', () => {
    const coins = extractCoins('BTC $BTC #BTC Bitcoin');
    expect(coins.filter(c => c === 'BTC').length).toBe(1);
  });

  it('returns empty array for unrelated text', () => {
    expect(extractCoins('the weather is nice today')).toEqual([]);
  });

  it('does not match very short or very long tokens', () => {
    const coins = extractCoins('A ABCDEFGHIJK random text');
    expect(coins).toEqual([]);
  });

  it('detects multiple coins in one post', () => {
    const coins = extractCoins('BTC and ETH both up, SOL following');
    expect(coins).toContain('BTC');
    expect(coins).toContain('ETH');
    expect(coins).toContain('SOL');
  });
});

describe('extractHashtags', () => {
  it('extracts hashtags', () => {
    expect(extractHashtags('#bitcoin is #bullish')).toEqual(['bitcoin', 'bullish']);
  });

  it('normalises to lowercase', () => {
    expect(extractHashtags('#Bitcoin #ETHEREUM')).toEqual(['bitcoin', 'ethereum']);
  });

  it('deduplicates repeated hashtags', () => {
    expect(extractHashtags('#btc #btc #btc')).toEqual(['btc']);
  });

  it('ignores bare # with no content', () => {
    expect(extractHashtags('hello # world')).toEqual([]);
  });

  it('returns empty for text with no hashtags', () => {
    expect(extractHashtags('no hashtags here')).toEqual([]);
  });
});

describe('extractKeywords', () => {
  it('finds positive crypto keywords', () => {
    expect(extractKeywords('massive bull run coming')).toContain('bull run');
  });

  it('finds negative crypto keywords', () => {
    expect(extractKeywords('market crash incoming fud everywhere')).toContain('fud');
  });

  it('finds DeFi and web3 keywords', () => {
    expect(extractKeywords('defi yields are insane right now')).toContain('defi');
    expect(extractKeywords('web3 is the future')).toContain('web3');
  });

  it('returns empty for unrelated text', () => {
    expect(extractKeywords('the quick brown fox')).toEqual([]);
  });
});

describe('extractAll', () => {
  it('returns all entity types from a rich post', () => {
    const text = '$BTC #bitcoin bull run — DeFi yields exploding, ETH also up';
    const { coins, hashtags, keywords } = extractAll(text);
    expect(coins).toContain('BTC');
    expect(coins).toContain('ETH');
    expect(hashtags).toContain('bitcoin');
    expect(keywords).toContain('bull run');
    expect(keywords).toContain('defi');
  });
});
