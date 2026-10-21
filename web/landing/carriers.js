// Egyptian network operators, matched by ASN first and operator name second.
// ASN/name data checked against Hurricane Electric's Egypt network list and
// IPinfo AS pages (https://bgp.he.net/country/EG, https://ipinfo.io/AS8452,
// https://ipinfo.io/AS24835, https://ipinfo.io/AS36992, https://ipinfo.io/AS24863).
// Keep matching conservative: a wrong carrier is worse than no carrier.

const CARRIERS = [
  {
    id: 'vodafone',
    name: 'Vodafone Egypt',
    nameAr: 'فودافون مصر',
    shortName: 'Vodafone',
    shortNameAr: 'فودافون',
    wallet: 'Vodafone Cash',
    walletAr: 'فودافون كاش',
    walletSlug: 'vodafone-cash',
    type: 'mobile',
    asns: ['24835', '30995', '36935'],
    pattern: /vodafone|vodacom|voda/i,
  },
  {
    id: 'orange',
    name: 'Orange Egypt',
    nameAr: 'أورنج مصر',
    shortName: 'Orange',
    shortNameAr: 'أورنج',
    wallet: 'Orange Cash',
    walletAr: 'أورنج كاش',
    walletSlug: 'orange-cash',
    type: 'mobile',
    asns: ['24863', '37069'],
    pattern: /orange|mobinil|link egypt|link\.net/i,
  },
  {
    id: 'etisalat',
    name: 'Etisalat Egypt (e&)',
    nameAr: 'اتصالات مصر (e&)',
    shortName: 'Etisalat',
    shortNameAr: 'اتصالات',
    wallet: 'Etisalat Cash',
    walletAr: 'اتصالات كاش',
    walletSlug: 'etisalat-cash',
    type: 'mobile',
    asns: ['36992'],
    pattern: /etisalat|etisalat misr|e&/i,
  },
  {
    id: 'telecom-egypt',
    name: 'Telecom Egypt (WE)',
    nameAr: 'المصرية للاتصالات (WE)',
    shortName: 'WE',
    shortNameAr: 'وي',
    wallet: 'WE Pay',
    walletAr: 'WE Pay',
    walletSlug: 'we-pay',
    type: 'fixed',
    asns: ['8452'],
    pattern: /telecom egypt|te data|te-as|te\.eg|\bwe\b/i,
  },
  {
    id: 'noor',
    name: 'NOOR',
    nameAr: 'نور',
    shortName: 'NOOR',
    shortNameAr: 'نور',
    wallet: '',
    walletAr: '',
    walletSlug: 'wallet',
    type: 'fixed',
    asns: ['20928'],
    pattern: /\bnoor\b|noor group|noor data/i,
  },
];

export function normalizeAsn(value) {
  const match = String(value ?? '').toUpperCase().match(/^(?:AS)?\s*(\d{1,10})$/);
  return match ? match[1] : '';
}

export function identifyCarrier({ isp = '', org = '', asn = '' } = {}) {
  const asnNumber = normalizeAsn(asn);
  const byAsn = asnNumber
    ? CARRIERS.find((carrier) => carrier.asns.includes(asnNumber))
    : null;
  const haystack = `${isp} ${org}`.trim();
  const byName = haystack
    ? CARRIERS.find((carrier) => carrier.pattern.test(haystack))
    : null;
  const carrier = byAsn || byName;
  if (!carrier) return null;

  return {
    id: carrier.id,
    name: carrier.name,
    nameAr: carrier.nameAr,
    shortName: carrier.shortName,
    shortNameAr: carrier.shortNameAr,
    wallet: carrier.wallet,
    walletAr: carrier.walletAr,
    walletSlug: carrier.walletSlug,
    type: carrier.type,
    asn: asnNumber ? `AS${asnNumber}` : '',
    matchedBy: byAsn ? 'asn' : 'name',
  };
}
