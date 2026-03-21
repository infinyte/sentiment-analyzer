import cryptoSlangMap from './crypto-slang-map.json' with { type: 'json' };

const repeatedCharacterPattern = /(.)\1{2,}/gu;
const urlPattern = /https?:\/\/\S+/giu;
const mentionPattern = /(^|\s)@[\p{L}\p{N}_-]+/gu;
const htmlEntityMap: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|nbsp);/gi, (entity) => htmlEntityMap[entity.toLowerCase()] ?? entity);
}

function replaceCryptoSlang(text: string): string {
  let normalized = text;
  for (const [slang, replacement] of Object.entries(cryptoSlangMap)) {
    const pattern = new RegExp(`\\b${slang}\\b`, 'giu');
    normalized = normalized.replace(pattern, replacement as string);
  }
  return normalized;
}

export function normalizeText(text: string): string {
  if (!text) return '';

  const nfkc = text.normalize('NFKC');
  const decoded = decodeHtmlEntities(nfkc);
  const withoutUrls = decoded.replace(urlPattern, ' ');
  const withoutMentions = withoutUrls.replace(mentionPattern, '$1');
  const collapsedRepeats = withoutMentions.replace(repeatedCharacterPattern, '$1$1');
  const slangRewritten = replaceCryptoSlang(collapsedRepeats);

  return slangRewritten.replace(/\s+/g, ' ').trim();
}